import { chromium, Page, Browser, BrowserContext } from 'playwright';
import { DomService } from './dom/service.js';
import { SerializedDOMState } from './dom/views.js';
import path from 'path';
import fs from 'fs';
import { EventBus } from './events/EventBus.js';
import {
  BrowserEventTypes,
  BrowserLaunchEvent,
  BrowserLaunchResult,
  BrowserStoppedEvent,
  NavigateToUrlEvent,
  NavigationStartedEvent,
  NavigationCompleteEvent,
  TabCreatedEvent,
  TabClosedEvent,
  SwitchTabEvent,
  ScreenshotEvent,
  AgentLogEvent,
} from './events/browserEvents.js';
import { BrowserProfile } from './browser/BrowserProfile.js';
import { BaseWatchdog, createDefaultWatchdogs, destroyWatchdogs } from './watchdogs/index.js';
import { BrowserError, ElementNotFoundError } from './errors/index.js';

export interface BrowserStateSummary {
  url: string;
  title: string;
  screenshot: string | null;
  domState: SerializedDOMState | null;
  llmRepresentation: string;
  selectorMap: Record<number, any>;
  scrollPosition: { x: number; y: number };
  viewportSize: { width: number; height: number };
  tabs: Array<{ id: string; url: string; title: string }>;
  timestamp: number;
  timing: Record<string, number>;
}

export interface TabInfo {
  id: string;
  url: string;
  title: string;
}

export class BrowserController {
  private page: Page | null = null;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private domService: DomService | null = null;
  private debugMode: boolean = false;
  private debugDir: string = './debug';

  // Browser profile for configuration
  public profile: BrowserProfile;

  // EventBus for browser-use style events
  public eventBus: EventBus;

  // Watchdogs for auto-handling browser events
  private watchdogs: BaseWatchdog[] = [];

  // DOM state cache
  private cachedDOMState: SerializedDOMState | null = null;
  private cacheTimestamp: number = 0;
  private readonly CACHE_TTL = 500; // ms

  constructor(debugMode: boolean = false, profile?: BrowserProfile) {
    this.debugMode = debugMode;
    this.profile = profile || BrowserProfile.createDefault();
    this.eventBus = new EventBus();

    if (this.debugMode && !fs.existsSync(this.debugDir)) {
      fs.mkdirSync(this.debugDir, { recursive: true });
    }

    // Set user data dir if in debug mode
    if (this.debugMode && !this.profile.userDataDir) {
      this.profile.userDataDir = this.debugDir;
    }
  }

  async launch(): Promise<void> {
    // Emit launch event
    await this.eventBus.emit(BrowserEventTypes.BROWSER_LAUNCH, {
      type: 'browser_launch',
      headless: this.profile.headless,
      userDataDir: this.profile.userDataDir,
      timestamp: Date.now(),
    } as BrowserLaunchEvent);

    const launchArgs = this.profile.getLaunchArgs();

    try {
      this.browser = await chromium.launch({
        channel: 'chrome',
        headless: this.profile.headless,
        args: launchArgs,
        timeout: 60000,
      });
    } catch (_) {
      this.browser = await chromium.launch({
        headless: this.profile.headless,
        args: launchArgs,
        timeout: 60000,
      });
    }

    // Get context options from profile
    const contextOptions = this.profile.getContextOptions();

    // Add storage state if exists
    const storageStatePath = path.join(this.debugDir, 'storageState.json');
    if (fs.existsSync(storageStatePath) && !contextOptions.storageState) {
      contextOptions.storageState = storageStatePath;
    }

    const context = await this.browser.newContext(contextOptions);
    this.context = context;

    // Anti-detection script
    await context.addInitScript(() => {
      try {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        delete (navigator as any).__proto__.webdriver;

        (window as any).chrome = {
          runtime: {},
          loadTimes: function() {},
          csi: function() {},
          app: {}
        };

        Object.defineProperty(navigator, 'languages', {
          get: () => ['ko-KR', 'ko', 'en-US', 'en']
        });

        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5]
        });

        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters: any) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: 'denied' } as PermissionStatus) :
            originalQuery(parameters)
        );

        Object.defineProperty(navigator, 'platform', {
          get: () => 'Win32'
        });

        Object.defineProperty(navigator, 'vendor', {
          get: () => 'Google Inc.'
        });
      } catch (_) {}
    });

    this.page = await context.newPage();
    this.domService = new DomService(this.page);

    // Initialize watchdogs
    try {
      this.watchdogs = await createDefaultWatchdogs(this.eventBus, this);
      console.log('[BrowserController] Watchdogs initialized:', this.watchdogs.map(w => w.getName()));
    } catch (error: any) {
      console.error('[BrowserController] Failed to initialize watchdogs:', error.message);
    }

    // Emit launch result
    await this.eventBus.emit(BrowserEventTypes.BROWSER_LAUNCH_RESULT, {
      type: 'browser_launch_result',
      success: true,
      timestamp: Date.now(),
    } as BrowserLaunchResult);

    console.log('[BrowserController] Browser launched successfully');
  }

  async close(): Promise<void> {
    // Destroy watchdogs first
    if (this.watchdogs.length > 0) {
      try {
        await destroyWatchdogs(this.watchdogs);
        console.log('[BrowserController] Watchdogs destroyed');
      } catch (error: any) {
        console.error('[BrowserController] Failed to destroy watchdogs:', error.message);
      }
      this.watchdogs = [];
    }

    if (this.context) {
      await this.context.close();
    }
    if (this.browser) {
      await this.browser.close();
    }
    this.page = null;
    this.browser = null;
    this.context = null;
    this.domService = null;

    // Emit browser stopped event
    await this.eventBus.emit(BrowserEventTypes.BROWSER_STOPPED, {
      type: 'browser_stopped',
      reason: 'Browser closed by user',
      timestamp: Date.now(),
    } as BrowserStoppedEvent);

    console.log('[BrowserController] Browser closed');
  }

  /**
   * Get comprehensive browser state including DOM, screenshot, tabs
   */
  async getBrowserState(
    includeScreenshot: boolean = true,
    includeDOM: boolean = true
  ): Promise<BrowserStateSummary> {
    if (!this.page) {
      throw new Error('Browser not launched. Call launch() first.');
    }

    const startTime = Date.now();
    const timing: Record<string, number> = {};

    // Get basic page info
    const url = this.page.url();
    const title = await this.page.title();

    // Get screenshot
    let screenshot: string | null = null;
    if (includeScreenshot) {
      const screenshotStart = Date.now();
      const screenshotBuffer = await this.page.screenshot({ type: 'png', fullPage: false });
      screenshot = Buffer.from(screenshotBuffer).toString('base64');
      timing.screenshot = Date.now() - screenshotStart;
    }

    // Get DOM state
    let domState: SerializedDOMState | null = null;
    let llmRepresentation = '';
    let selectorMap: Record<number, any> = {};

    if (includeDOM && this.domService) {
      const domStart = Date.now();
      const domResult = await this.domService.getSerializedDOMTree();
      domState = domResult.state;
      selectorMap = domState.selectorMap;
      llmRepresentation = domResult.llmRepresentation || this.formatDOMForLLM(domState.selectorMap);
      timing.dom = Date.now() - domStart;
    }

    // Get scroll position and viewport
    const scrollPosition = await this.page.evaluate(() => ({
      x: window.scrollX,
      y: window.scrollY,
    }));

    const viewportSize = await this.page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));

    // Get all tabs
    const tabs = await this.getAllTabs();

    timing.total = Date.now() - startTime;

    return {
      url,
      title,
      screenshot,
      domState,
      llmRepresentation,
      selectorMap,
      scrollPosition,
      viewportSize,
      tabs,
      timestamp: Date.now(),
      timing,
    };
  }

  /**
   * Format DOM state for LLM consumption
   */
  private formatDOMForLLM(selectorMap: Record<number, any>): string {
    const indices = Object.keys(selectorMap).map(k => parseInt(k)).sort((a, b) => a - b);

    if (indices.length === 0) {
      return 'No interactive elements found on the page.';
    }

    let output = `Interactive elements on page (${indices.length} total):\n\n`;

    indices.forEach((index: number) => {
      const elem = selectorMap[index];
      const tag = elem.tagName?.toLowerCase() || 'unknown';
      const text = elem.text?.trim().substring(0, 50) || '';
      const placeholder = elem.attributes?.placeholder || '';
      const ariaLabel = elem.attributes?.['aria-label'] || '';

      output += `[${index}] <${tag}>`;

      if (text) output += ` "${text}"`;
      if (placeholder) output += ` placeholder="${placeholder}"`;
      if (ariaLabel) output += ` aria-label="${ariaLabel}"`;

      output += '\n';
    });

    output += '\nTo interact with elements, use their index number (e.g., click element [5]).\n';

    return output;
  }

  /**
   * Get all open tabs
   */
  private async getAllTabs(): Promise<TabInfo[]> {
    if (!this.context) {
      return [];
    }

    const pages = this.context.pages();
    const tabs: TabInfo[] = [];

    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      try {
        tabs.push({
          id: i.toString().padStart(4, '0'), // 4-char ID like browser-use
          url: p.url(),
          title: await p.title(),
        });
      } catch (error) {
        // Skip pages that might be closed
      }
    }

    return tabs;
  }

  // ==================== Actions ====================

  /**
   * Click element by index
   */
  async clickElement(index: number): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.page || !this.domService) {
        throw new Error('Browser not launched');
      }

      const state = await this.getBrowserState(false, true);
      const element = state.selectorMap[index];

      if (!element || !element.backendNodeId) {
        return { success: false, error: `Element at index ${index} not found` };
      }

      await this.clickByBackendNodeId(element.backendNodeId);

      // Wait briefly for click to register (browser-use: 50-80ms)
      await this.page.waitForTimeout(80);

      // Emit screenshot event after action
      await this.emitScreenshot(`Clicked element ${index}`);

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Type text into element by index
   */
  async inputText(index: number, text: string, clear: boolean = true): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.page || !this.domService) {
        throw new Error('Browser not launched');
      }

      const state = await this.getBrowserState(false, true);
      const element = state.selectorMap[index];

      if (!element || !element.backendNodeId) {
        return { success: false, error: `Element at index ${index} not found` };
      }

      // typeByBackendNodeId now handles all focus failures internally with 3-tier fallback
      // It will NOT throw on focus failures, only on critical errors
      await this.typeByBackendNodeId(element.backendNodeId, text, clear);

      // Wait briefly for input to register (browser-use: 50ms)
      await this.page.waitForTimeout(50);

      // Emit screenshot event after action
      await this.emitScreenshot(`Input text into element ${index}`);

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Navigate to URL
   */
  async navigate(url: string, newTab: boolean = false): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.page || !this.context) {
        throw new Error('Browser not launched');
      }

      // Emit navigate event
      await this.eventBus.emit(BrowserEventTypes.NAVIGATE_TO_URL, {
        type: 'navigate_to_url',
        url,
        newTab,
        timestamp: Date.now(),
      } as NavigateToUrlEvent);

      // Emit navigation started event
      await this.eventBus.emit(BrowserEventTypes.NAVIGATION_STARTED, {
        type: 'navigation_started',
        url,
        timestamp: Date.now(),
      } as NavigationStartedEvent);

      if (newTab) {
        const newPage = await this.context.newPage();

        // Emit tab created event
        await this.eventBus.emit(BrowserEventTypes.TAB_CREATED, {
          type: 'tab_created',
          tab: {
            id: (this.context.pages().length - 1).toString().padStart(4, '0'),
            url: 'about:blank',
            title: 'New Tab',
          },
          timestamp: Date.now(),
        } as TabCreatedEvent);

        await newPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        this.page = newPage; // Switch to new page
      } else {
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      }

      // Wait for page to stabilize (browser-use: minimal wait)
      await this.page.waitForTimeout(100);

      const title = await this.page.title();

      // Emit navigation complete event
      await this.eventBus.emit(BrowserEventTypes.NAVIGATION_COMPLETE, {
        type: 'navigation_complete',
        url,
        title,
        success: true,
        timestamp: Date.now(),
      } as NavigationCompleteEvent);

      // Emit screenshot event after action
      await this.emitScreenshot(`Navigated to ${url}`);

      return { success: true };
    } catch (error: any) {
      // Emit navigation complete with error
      await this.eventBus.emit(BrowserEventTypes.NAVIGATION_COMPLETE, {
        type: 'navigation_complete',
        url,
        title: '',
        success: false,
        error: error.message,
        timestamp: Date.now(),
      } as NavigationCompleteEvent);

      return { success: false, error: error.message };
    }
  }

  /**
   * Scroll page
   */
  async scroll(down: boolean, pages: number = 1.0): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.page) {
        throw new Error('Browser not launched');
      }

      await this.page.evaluate(({ down, pages }) => {
        const viewportHeight = window.innerHeight;
        const scrollAmount = viewportHeight * pages * (down ? 1 : -1);
        window.scrollBy(0, scrollAmount);
      }, { down, pages });

      // Wait for scroll to settle (browser-use: 200ms for DOM update)
      await this.page.waitForTimeout(200);

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Send keyboard keys
   */
  async sendKeys(keys: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.page) {
        throw new Error('Browser not launched');
      }

      // Handle special keys and shortcuts
      if (keys.includes('+')) {
        // Keyboard shortcut like "Control+o"
        const parts = keys.split('+');
        for (let i = 0; i < parts.length - 1; i++) {
          await this.page.keyboard.down(parts[i]);
        }
        await this.page.keyboard.press(parts[parts.length - 1]);
        for (let i = parts.length - 2; i >= 0; i--) {
          await this.page.keyboard.up(parts[i]);
        }
      } else {
        // Single key
        await this.page.keyboard.press(keys);
      }

      // Wait briefly for key press to register
      await this.page.waitForTimeout(50);

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Switch to tab by ID
   */
  async switchTab(tabId: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.context) {
        throw new Error('Browser not launched');
      }

      const tabIndex = parseInt(tabId, 10);
      const pages = this.context.pages();

      if (tabIndex < 0 || tabIndex >= pages.length) {
        return { success: false, error: `Tab ${tabId} not found` };
      }

      const previousPage = this.page;
      this.page = pages[tabIndex];
      await this.page.bringToFront();

      // Emit switch tab event
      await this.eventBus.emit(BrowserEventTypes.SWITCH_TAB, {
        type: 'switch_tab',
        tabId,
        previousTabId: previousPage ? pages.indexOf(previousPage).toString().padStart(4, '0') : undefined,
        timestamp: Date.now(),
      } as SwitchTabEvent);

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Close tab by ID
   */
  async closeTab(tabId: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.context) {
        throw new Error('Browser not launched');
      }

      const tabIndex = parseInt(tabId, 10);
      const pages = this.context.pages();

      if (tabIndex < 0 || tabIndex >= pages.length) {
        return { success: false, error: `Tab ${tabId} not found` };
      }

      await pages[tabIndex].close();

      // Emit tab closed event
      await this.eventBus.emit(BrowserEventTypes.TAB_CLOSED, {
        type: 'tab_closed',
        tabId,
        timestamp: Date.now(),
      } as TabClosedEvent);

      // If we closed current page, switch to first available
      if (this.page === pages[tabIndex] && pages.length > 1) {
        this.page = pages[0] === pages[tabIndex] ? pages[1] : pages[0];
      }

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ==================== CDP Helper Methods ====================

  private async clickByBackendNodeId(backendNodeId: number): Promise<void> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    const cdp = await this.page.context().newCDPSession(this.page);

    try {
      const { object } = await cdp.send('DOM.resolveNode', { backendNodeId });
      const boxModel = await cdp.send('DOM.getBoxModel', { objectId: object.objectId });

      if (!boxModel || !boxModel.model) {
        throw new Error('Could not get box model for element');
      }

      // Get center point of element
      const quad = boxModel.model.content;
      const centerX = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
      const centerY = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;

      // Dispatch mouse events
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: centerX,
        y: centerY,
        button: 'left',
        clickCount: 1,
      });

      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: centerX,
        y: centerY,
        button: 'left',
        clickCount: 1,
      });
    } finally {
      await cdp.detach();
    }
  }

  private async typeByBackendNodeId(backendNodeId: number, text: string, clearFirst: boolean = true): Promise<void> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    const cdp = await this.page.context().newCDPSession(this.page);

    try {
      const { object } = await cdp.send('DOM.resolveNode', { backendNodeId });

      // === browser-use style 3-tier focus strategy ===
      // Strategy 1: Try CDP DOM.focus with backendNodeId (not objectId!)
      let focusSucceeded = false;
      try {
        await cdp.send('DOM.focus', { backendNodeId }); // Use backendNodeId like browser-use
        focusSucceeded = true;
        console.log('[BrowserController] CDP DOM.focus succeeded');
        await this.page.waitForTimeout(100);
      } catch (focusError: any) {
        console.log('[BrowserController] CDP DOM.focus failed:', focusError.message);

        // Strategy 2: Try clicking the element using coordinates
        try {
          const boxModel = await cdp.send('DOM.getBoxModel', { backendNodeId });
          if (boxModel && boxModel.model) {
            const quad = boxModel.model.content;
            // Calculate center point from quad coordinates
            const centerX = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
            const centerY = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;

            console.log(`[BrowserController] Trying click fallback at (${centerX}, ${centerY})`);

            // Dispatch mouse click events
            await cdp.send('Input.dispatchMouseEvent', {
              type: 'mousePressed',
              x: centerX,
              y: centerY,
              button: 'left',
              clickCount: 1,
            });
            await cdp.send('Input.dispatchMouseEvent', {
              type: 'mouseReleased',
              x: centerX,
              y: centerY,
              button: 'left',
              clickCount: 1,
            });
            await this.page.waitForTimeout(50);
            focusSucceeded = true;
            console.log('[BrowserController] Click fallback succeeded');
          }
        } catch (clickError: any) {
          console.log('[BrowserController] Click fallback also failed:', clickError.message);
          // Strategy 3: Continue anyway - element might already be focused (common in Google Sheets)
          console.log('[BrowserController] Continuing with typing anyway (element might already be focused)');
        }
      }

      // Clear if needed - browser-use style with JavaScript
      if (clearFirst) {
        try {
          // Strategy 1: Direct JavaScript value setting (most reliable)
          // Set value to empty multiple times to handle autocomplete
          await cdp.send('Runtime.callFunctionOn', {
            functionDeclaration: `function() {
              // Clear any existing value
              this.value = "";

              // Try to select all text first
              try {
                this.select();
                this.setSelectionRange(0, 0);
              } catch (e) {}

              // Set value to empty again
              this.value = "";

              // Dispatch events to notify React/Vue frameworks
              this.dispatchEvent(new Event("input", { bubbles: true }));
              this.dispatchEvent(new Event("change", { bubbles: true }));
              this.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
              this.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));

              // Blur and focus again to reset any autocomplete
              this.blur();
              this.focus();

              return this.value;
            }`,
            objectId: object.objectId,
            returnByValue: true,
          });

          // Wait a bit for events to process
          await this.page.waitForTimeout(50);

          // Verify clearing worked
          const verifyResult = await cdp.send('Runtime.callFunctionOn', {
            functionDeclaration: 'function() { return this.value; }',
            objectId: object.objectId,
            returnByValue: true,
          });

          const currentValue = verifyResult?.result?.value || '';
          if (currentValue) {
            console.log('[BrowserController] JavaScript clear partially failed, field still contains:', currentValue);

            // Fallback: Force clear one more time
            await cdp.send('Runtime.callFunctionOn', {
              functionDeclaration: `function() {
                this.value = "";
                this.dispatchEvent(new Event("input", { bubbles: true }));
                return this.value;
              }`,
              objectId: object.objectId,
              returnByValue: true,
            });
          }
        } catch (error) {
          console.error('[BrowserController] Failed to clear field:', error);
        }
      }

      // Wait a bit before typing to ensure field is truly empty
      await this.page.waitForTimeout(50);

      // Type the text character by character (browser-use style)
      for (const char of text) {
        if (char === '\n') {
          // Handle newline as Enter key
          await cdp.send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: 'Enter',
            code: 'Enter',
            windowsVirtualKeyCode: 13,
          });
          await cdp.send('Input.dispatchKeyEvent', {
            type: 'char',
            text: '\r',
            key: 'Enter',
          });
          await cdp.send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'Enter',
            code: 'Enter',
            windowsVirtualKeyCode: 13,
          });
        } else {
          // Get proper key info for character
          const keyCode = this.getKeyCodeForChar(char);
          const baseKey = char;

          // Send keyDown
          await cdp.send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: baseKey,
            code: keyCode,
          });

          // Send char event immediately (this is crucial for text input)
          await cdp.send('Input.dispatchKeyEvent', {
            type: 'char',
            text: char,
            key: char,
          });

          // Send keyUp
          await cdp.send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: baseKey,
            code: keyCode,
          });
        }

        // Add minimal delay between keystrokes (1ms is enough for most cases)
        // browser-use uses 18ms for human-like typing, but we optimize for speed
        await this.page.waitForTimeout(1);
      }
    } finally {
      await cdp.detach();
    }
  }

  /**
   * Get key code for a character
   */
  private getKeyCodeForChar(char: string): string {
    const keyCodeMap: Record<string, string> = {
      ' ': 'Space',
      'Enter': 'Enter',
      'Tab': 'Tab',
      'Backspace': 'Backspace',
      'Delete': 'Delete',
      'Escape': 'Escape',
    };

    if (keyCodeMap[char]) {
      return keyCodeMap[char];
    } else if (char.match(/[a-zA-Z]/)) {
      return `Key${char.toUpperCase()}`;
    } else if (char.match(/[0-9]/)) {
      return `Digit${char}`;
    } else {
      return 'Unidentified';
    }
  }

  // ==================== Utility Methods ====================

  getCurrentUrl(): string {
    if (!this.page) return '';
    return this.page.url();
  }

  async getCookies(): Promise<any[]> {
    if (!this.context) return [];
    return await this.context.cookies();
  }

  async setCookies(cookies: any[]): Promise<void> {
    if (!this.context) return;
    await this.context.addCookies(cookies);
  }

  async captureScreenshot(): Promise<Buffer> {
    if (!this.page) throw new Error('Page not initialized');
    return await this.page.screenshot({ type: 'png', fullPage: false });
  }

  async goTo(url: string): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForTimeout(100); // Reduced from 1000ms to 100ms
  }

  /**
   * Get enhanced DOM (for browserState.ts compatibility)
   */
  async getEnhancedDOM(): Promise<{ selectorMap: any; llmRepresentation: string; timing: Record<string, number> } | null> {
    if (!this.domService) return null;
    const result = await this.domService.getSerializedDOMTree();
    return {
      selectorMap: result.state.selectorMap,
      llmRepresentation: result.llmRepresentation,
      timing: result.timing || {},
    };
  }

  /**
   * Get scroll info
   */
  async getScrollInfo(): Promise<{ scrollY: number }> {
    if (!this.page) return { scrollY: 0 };
    const scrollY = await this.page.evaluate(() => window.scrollY);
    return { scrollY };
  }

  /**
   * List all tabs
   */
  async listTabs(): Promise<TabInfo[]> {
    return this.getAllTabs();
  }

  // ==================== Getters ====================

  getPage(): Page | null {
    return this.page;
  }

  getBrowser(): Browser | null {
    return this.browser;
  }

  getContext(): BrowserContext | null {
    return this.context;
  }

  // ==================== Event Emitters ====================

  /**
   * Emit screenshot event with current page state
   * Throttled to prevent rapid screenshot spam
   */
  private lastScreenshotTime: number = 0;
  private readonly SCREENSHOT_THROTTLE_MS = 500; // Minimum 500ms between screenshots

  private async emitScreenshot(action: string, force: boolean = false): Promise<void> {
    if (!this.page) return;

    // Throttle screenshots to prevent flickering
    const now = Date.now();
    if (!force && now - this.lastScreenshotTime < this.SCREENSHOT_THROTTLE_MS) {
      console.log(`[BrowserController] Screenshot throttled (last: ${now - this.lastScreenshotTime}ms ago)`);
      return;
    }

    try {
      this.lastScreenshotTime = now;
      const screenshot = await this.page.screenshot({ type: 'png', fullPage: false });
      const image = Buffer.from(screenshot).toString('base64');
      const url = this.page.url();

      await this.eventBus.emit(BrowserEventTypes.SCREENSHOT, {
        type: 'screenshot',
        image,
        action,
        timestamp: Date.now(),
        url,
      } as ScreenshotEvent);
    } catch (error: any) {
      console.error('[BrowserController] Failed to emit screenshot:', error.message);
    }
  }

  /**
   * Emit log event
   */
  async emitLog(logType: 'thought' | 'observation' | 'system' | 'error', data: any): Promise<void> {
    await this.eventBus.emit(BrowserEventTypes.AGENT_LOG, {
      type: 'agent_log',
      logType,
      data,
      timestamp: Date.now(),
    } as AgentLogEvent);
  }
}
