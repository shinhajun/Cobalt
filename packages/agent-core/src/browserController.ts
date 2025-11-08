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
// Removed unused error imports
import { BrowserSession } from './browser/BrowserSession.js';
import { Element } from './actor/Element.js';
import { debug, info, warn, error as logError } from './utils/logger.js';

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
  private cachedSelectorMap: Record<number, any> = {};
  private cacheTimestamp: number = 0;
  private readonly CACHE_TTL = 500; // ms

  // BrowserSession for CDP session management (browser-use style)
  private browserSession: BrowserSession | null = null;

  /**
   * Invalidate DOM cache (called on navigation, tab switch)
   */
  private invalidateDOMCache(): void {
    debug('[BrowserController] DOM cache invalidated');
    this.cachedDOMState = null;
    this.cachedSelectorMap = {};
    this.cacheTimestamp = 0;
  }

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

    // Initialize BrowserSession for CDP session management
    this.browserSession = new BrowserSession(context, this.page);
    debug('[BrowserController] BrowserSession initialized');

    // Initialize watchdogs
    try {
      this.watchdogs = await createDefaultWatchdogs(this.eventBus, this);
      debug('[BrowserController] Watchdogs initialized:', this.watchdogs.map(w => w.getName()));
    } catch (error: any) {
      logError('[BrowserController] Failed to initialize watchdogs:', error.message);
    }

    // Emit launch result
    await this.eventBus.emit(BrowserEventTypes.BROWSER_LAUNCH_RESULT, {
      type: 'browser_launch_result',
      success: true,
      timestamp: Date.now(),
    } as BrowserLaunchResult);

    info('[BrowserController] Browser launched successfully');
  }

  async close(): Promise<void> {
    // Destroy BrowserSession first
    if (this.browserSession) {
      try {
        await this.browserSession.destroy();
        debug('[BrowserController] BrowserSession destroyed');
      } catch (error: any) {
        logError('[BrowserController] Failed to destroy BrowserSession:', error.message);
      }
      this.browserSession = null;
    }

    // Destroy watchdogs
    if (this.watchdogs.length > 0) {
      try {
        await destroyWatchdogs(this.watchdogs);
        debug('[BrowserController] Watchdogs destroyed');
      } catch (error: any) {
        logError('[BrowserController] Failed to destroy watchdogs:', error.message);
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

    info('[BrowserController] Browser closed');
  }

  /**
   * Get comprehensive browser state including DOM, screenshot, tabs
   *
   * DOM caching: Within CACHE_TTL (500ms), returns cached DOM to avoid expensive re-collection
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

    // Protect title access - can fail during navigation with "execution context destroyed"
    let title = '';
    try {
      title = await this.page.title();
    } catch (error: any) {
      debug('[BrowserController] Failed to get title (navigation in progress):', error.message);
      title = '';
    }

    // Get screenshot (CRITICAL: Use CDP to avoid Playwright's navigation waiting)
    let screenshot: string | null = null;
    if (includeScreenshot) {
      const screenshotStart = Date.now();

      // Try CDP first to avoid HTTP/2 errors during navigation
      let screenshotData: string | null = null;
      if (this.browserSession && this.browserSession.agentFocus) {
        const targetId = this.browserSession.agentFocus.targetId;
        if (targetId) {
          try {
            const cdpSession = await this.browserSession.getOrCreateCDPSession(targetId, false);
            const result = await (cdpSession.cdpSession as any).send('Page.captureScreenshot', {
              format: 'jpeg',
              quality: 70,
            });
            screenshotData = result.data;
          } catch (error: any) {
            debug('[BrowserController] CDP screenshot failed, using Playwright fallback:', error.message);
          }
        }
      }

      // Fallback to Playwright if CDP fails
      if (!screenshotData) {
        const screenshotBuffer = await this.page.screenshot({ type: 'jpeg', quality: 70, fullPage: false });
        screenshotData = Buffer.from(screenshotBuffer).toString('base64');
      }

      screenshot = screenshotData;
      timing.screenshot = Date.now() - screenshotStart;
    }

    // Get DOM state (OPTIMIZED: Cache for 500ms to avoid redundant collection)
    let domState: SerializedDOMState | null = null;
    let llmRepresentation = '';
    let selectorMap: Record<number, any> = {};

    if (includeDOM && this.domService) {
      const now = Date.now();
      const cacheAge = now - this.cacheTimestamp;

      // Use cache if within TTL
      if (this.cachedDOMState && cacheAge < this.CACHE_TTL) {
        debug(`[BrowserController] Using cached DOM (age: ${cacheAge}ms)`);
        domState = this.cachedDOMState;
        selectorMap = this.cachedSelectorMap;
        llmRepresentation = this.formatDOMForLLM(selectorMap);
        timing.dom = 0; // Cache hit
      } else {
        // Cache miss or expired - fetch fresh DOM
        const domStart = Date.now();
        const domResult = await this.domService.getSerializedDOMTree();
        domState = domResult.state;
        selectorMap = domState.selectorMap;
        llmRepresentation = domResult.llmRepresentation || this.formatDOMForLLM(domState.selectorMap);
        timing.dom = Date.now() - domStart;

        // Update cache
        this.cachedDOMState = domState;
        this.cachedSelectorMap = selectorMap;
        this.cacheTimestamp = now;
        debug(`[BrowserController] DOM cache refreshed (${timing.dom}ms)`);
      }
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
   * Click element by index (browser-use style with Element class)
   * OPTIMIZED: Reuses cached selectorMap instead of re-fetching DOM
   */
  async clickElement(index: number): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.page || !this.domService || !this.browserSession) {
        throw new Error('Browser not launched');
      }

      // OPTIMIZATION: Reuse cached selectorMap if available (avoids DOM re-fetch)
      const now = Date.now();
      const cacheAge = now - this.cacheTimestamp;
      let selectorMap = this.cachedSelectorMap;

      // Only fetch fresh DOM if cache is stale or empty
      if (!selectorMap || Object.keys(selectorMap).length === 0 || cacheAge >= this.CACHE_TTL) {
        debug(`[BrowserController] Cache miss in clickElement, fetching DOM (age: ${cacheAge}ms)`);
        const state = await this.getBrowserState(false, true);
        selectorMap = state.selectorMap;
      } else {
        debug(`[BrowserController] Using cached selectorMap in clickElement (age: ${cacheAge}ms)`);
      }

      const elementData = selectorMap[index];

      if (!elementData || !elementData.backendNodeId) {
        return { success: false, error: `Element at index ${index} not found` };
      }

      // Use browser-use style Element class with advanced click
      const element = new Element(
        this.browserSession,
        elementData.backendNodeId,
        this.browserSession.agentFocus.sessionId
      );

      await element.click();

      // Wait for navigation or timeout (race condition fix)
      // Some clicks trigger navigation - wait for DOMContentLoaded or 250ms, whichever comes first
      await Promise.race([
        this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {}),
        this.page.waitForTimeout(250),
      ]);

      // Emit screenshot event after action
      await this.emitScreenshot(`Clicked element ${index}`);

      return { success: true };
    } catch (error: any) {
      logError('[BrowserController] Click error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Type text into element by index (browser-use style with Element class)
   * OPTIMIZED: Reuses cached selectorMap instead of re-fetching DOM
   */
  async inputText(index: number, text: string, clear: boolean = true): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.page || !this.domService || !this.browserSession) {
        throw new Error('Browser not launched');
      }

      // OPTIMIZATION: Reuse cached selectorMap if available (avoids DOM re-fetch)
      const now = Date.now();
      const cacheAge = now - this.cacheTimestamp;
      let selectorMap = this.cachedSelectorMap;

      // Only fetch fresh DOM if cache is stale or empty
      if (!selectorMap || Object.keys(selectorMap).length === 0 || cacheAge >= this.CACHE_TTL) {
        debug(`[BrowserController] Cache miss in inputText, fetching DOM (age: ${cacheAge}ms)`);
        const state = await this.getBrowserState(false, true);
        selectorMap = state.selectorMap;
      } else {
        debug(`[BrowserController] Using cached selectorMap in inputText (age: ${cacheAge}ms)`);
      }

      const elementData = selectorMap[index];

      if (!elementData || !elementData.backendNodeId) {
        return { success: false, error: `Element at index ${index} not found` };
      }

      // Use browser-use style Element class with advanced fill
      const element = new Element(
        this.browserSession,
        elementData.backendNodeId,
        this.browserSession.agentFocus.sessionId
      );

      await element.fill(text, clear);

      // Wait briefly for input to register (browser-use: 50ms)
      await this.page.waitForTimeout(50);

      // Emit screenshot event after action
      await this.emitScreenshot(`Input text into element ${index}`);

      return { success: true };
    } catch (error: any) {
      logError('[BrowserController] Input text error:', error);
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

        this.page = newPage; // Switch to new page
      }

      // Use CDP Page.navigate instead of Playwright's page.goto()
      // This avoids HTTP/2 protocol errors on sites like Coupang
      if (!this.browserSession || !this.browserSession.agentFocus) {
        throw new Error('Browser session not initialized');
      }

      const targetId = this.browserSession.agentFocus.targetId;
      if (!targetId) {
        throw new Error('No target ID available for navigation');
      }

      const cdpSession = await this.browserSession.getOrCreateCDPSession(targetId, false);

      await (cdpSession.cdpSession as any).send('Page.navigate', {
        url: url,
        transitionType: 'address_bar',
      });

      // Wait for page to stabilize (browser-use: minimal wait)
      await this.page.waitForTimeout(200);

      const title = await this.page.title();

      // Invalidate DOM cache after navigation
      this.invalidateDOMCache();

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

      // Standardize common network errors for clearer LLM guidance
      const msg = String(error?.message || '')
      const netErrors = ['ERR_NAME_NOT_RESOLVED', 'ERR_INTERNET_DISCONNECTED', 'ERR_CONNECTION_REFUSED', 'ERR_TIMED_OUT', 'net::']
      const isNetwork = netErrors.some(e => msg.includes(e))
      const mapped = isNetwork ? `Navigation failed - site unavailable: ${url}` : msg

      return { success: false, error: mapped };
    }
  }

  /**
   * Scroll page
   */
  async scroll(
    down: boolean,
    pages: number | string = 1.0,
    index?: number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.page) {
        throw new Error('Browser not launched');
      }

      // Sanitize inputs from LLM
      const downNorm = typeof down === 'boolean'
        ? down
        : (() => {
            const s = String(down).toLowerCase();
            if (s === 'down' || s === 'true' || s === '1') return true;
            if (s === 'up' || s === 'false' || s === '0') return false;
            return true; // default to down
          })();

      let pagesNum: number = 1.0;
      if (typeof pages === 'number' && isFinite(pages)) {
        pagesNum = pages;
      } else {
        const parsed = parseFloat(String(pages));
        pagesNum = isFinite(parsed) && !isNaN(parsed) ? parsed : 1.0;
      }
      // Clamp pages to sane range
      pagesNum = Math.max(0.1, Math.min(10.0, pagesNum));

      if (typeof index === 'number') {
        // Scroll inside a specific container element (by LLM index)
        // Use cached selector map if available
        const now = Date.now();
        const cacheAge = now - this.cacheTimestamp;
        let selectorMap = this.cachedSelectorMap;

        if (!selectorMap || Object.keys(selectorMap).length === 0 || cacheAge >= this.CACHE_TTL) {
          const state = await this.getBrowserState(false, true);
          selectorMap = state.selectorMap;
        }

        const elementData = selectorMap[index];
        if (!elementData || !elementData.backendNodeId) {
          return { success: false, error: `Container element at index ${index} not found` };
        }

        const sessionInfo = await this.browserSession!.getOrCreateCDPSession(undefined, false);
        const cdpSession = (sessionInfo.cdpSession as any);

        const resolveResult = await cdpSession.send('DOM.resolveNode', {
          backendNodeId: elementData.backendNodeId,
        });
        const objectId = resolveResult?.object?.objectId;
        if (!objectId) {
          return { success: false, error: 'Failed to resolve container element' };
        }

        const res = await cdpSession.send('Runtime.callFunctionOn', {
          objectId,
          functionDeclaration: `function(args){
            try{
              const el = this;
              const vh = window.innerHeight || document.documentElement.clientHeight || 800;
              const pagesVal = Number(args.pages);
              const amount = vh * (isFinite(pagesVal) && pagesVal > 0 ? pagesVal : 1.0) * (args.down ? 1 : -1);
              if (el && (el.scrollHeight > el.clientHeight || getComputedStyle(el).overflowY === 'scroll' || getComputedStyle(el).overflowY === 'auto')){
                el.scrollBy(0, amount);
                return {ok:true, target:'container'};
              } else {
                window.scrollBy(0, amount);
                return {ok:true, target:'window'};
              }
            }catch(e){ return {ok:false, reason: String(e && e.message || e)} }
          }`,
          arguments: [{ value: { down: downNorm, pages: pagesNum } }],
          returnByValue: true,
        });
        const ok = res?.result?.value?.ok === true;
        if (!ok) {
          const reason = res?.result?.value?.reason || 'unknown error';
          return { success: false, error: `Container scroll failed: ${reason}` };
        }
      } else {
        await this.page.evaluate(({ down, pages }) => {
          const viewportHeight = window.innerHeight;
          const pagesVal = Number(pages);
          const p = (isFinite(pagesVal) && pagesVal > 0 ? pagesVal : 1.0);
          const scrollAmount = viewportHeight * p * (down ? 1 : -1);
          window.scrollBy(0, scrollAmount);
        }, { down: downNorm, pages: pagesNum });
      }

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
   * Navigate back in history
   */
  async goBack(): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.page) throw new Error('Browser not launched');
      await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {});
      // Small settle time
      await this.page.waitForTimeout(150);
      // Invalidate DOM cache
      this.invalidateDOMCache();
      await this.emitScreenshot('Navigated back');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Wait helper
   */
  async wait(seconds: number): Promise<void> {
    if (!this.page) throw new Error('Browser not launched');
    await this.page.waitForTimeout(Math.max(0, Math.floor(seconds * 1000)));
  }

  /**
   * Select dropdown option by element index.
   * Option can be the visible text or the value attribute.
   */
  async selectDropdown(index: number, option: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.page || !this.domService || !this.browserSession) {
        throw new Error('Browser not launched');
      }

      // Ensure we have fresh/cached selector map
      const now = Date.now();
      const cacheAge = now - this.cacheTimestamp;
      let selectorMap = this.cachedSelectorMap;
      if (!selectorMap || Object.keys(selectorMap).length === 0 || cacheAge >= this.CACHE_TTL) {
        const state = await this.getBrowserState(false, true);
        selectorMap = state.selectorMap;
      }

      const elementData = selectorMap[index];
      if (!elementData || !elementData.backendNodeId) {
        return { success: false, error: `Element at index ${index} not found` };
      }

      // Resolve node and run JS to select option
      const sessionInfo = await this.browserSession.getOrCreateCDPSession(undefined, false);
      const cdpSession = sessionInfo.cdpSession as any;

      const resolveResult = await cdpSession.send('DOM.resolveNode', {
        backendNodeId: elementData.backendNodeId,
      });
      const objectId = resolveResult?.object?.objectId;
      if (!objectId) {
        return { success: false, error: 'Failed to resolve select element' };
      }

      const result = await cdpSession.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function(opt) {
          try {
            const el = this;
            if (!el || el.tagName !== 'SELECT') return { ok: false, reason: 'Not a <select>' };
            const match = Array.from(el.options).find(o => (o.value === opt) || (o.textContent || '').trim() === opt);
            if (!match) return { ok: false, reason: 'Option not found' };
            el.value = match.value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true };
          } catch (e) { return { ok: false, reason: String(e && e.message || e) } }
        }`,
        arguments: [{ value: option }],
        returnByValue: true,
      });

      const ok = result?.result?.value?.ok === true;
      if (!ok) {
        const reason = result?.result?.value?.reason || 'unknown error';
        return { success: false, error: `Select failed: ${reason}` };
      }

      await this.page.waitForTimeout(50);
      await this.emitScreenshot(`Selected option '${option}' on element ${index}`);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Scroll to the first element containing the given visible text
   */
  async scrollToText(text: string, partial: boolean = true): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.page) throw new Error('Browser not launched');

      const found = await this.page.evaluate(({ text, partial }) => {
        const makeMatcher = (isPartial: boolean) => (t: string | null | undefined) => {
          if (!t) return false;
          const norm = (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const needle = text.toLowerCase();
          return isPartial ? norm.includes(needle) : norm === needle;
        };

        const search = (isPartial: boolean) => {
          const match = makeMatcher(isPartial);
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
          let node: Node | null = walker.currentNode;
          while ((node = walker.nextNode())) {
            const el = node as HTMLElement;
            if (!el || !el.getBoundingClientRect) continue;
            const style = window.getComputedStyle(el);
            if (style.visibility === 'hidden' || style.display === 'none') continue;
            // Try innerText first, fallback to aria-label or title
            if (match((el as any).innerText) || match(el.getAttribute('aria-label')) || match(el.getAttribute('title'))) {
              el.scrollIntoView({ behavior: 'instant', block: 'center' });
              return true;
            }
          }
          return false;
        };

        // Try exact match first; if not found and partial allowed, try partial
        if (search(false)) return true;
        if (partial && search(true)) return true;
        return false;
      }, { text, partial });

      if (!found) return { success: false, error: 'Text not found' };

      await this.page.waitForTimeout(150);
      await this.emitScreenshot(`Scrolled to text '${text}'`);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get dropdown options for a select element by index
   */
  async getDropdownOptions(index: number): Promise<{ success: boolean; error?: string; options?: Array<{ value: string; text: string; selected: boolean; disabled: boolean }> }> {
    try {
      if (!this.page || !this.domService || !this.browserSession) {
        throw new Error('Browser not launched');
      }

      // Ensure we have selector map
      const now = Date.now();
      const cacheAge = now - this.cacheTimestamp;
      let selectorMap = this.cachedSelectorMap;
      if (!selectorMap || Object.keys(selectorMap).length === 0 || cacheAge >= this.CACHE_TTL) {
        const state = await this.getBrowserState(false, true);
        selectorMap = state.selectorMap;
      }

      const elementData = selectorMap[index];
      if (!elementData || !elementData.backendNodeId) {
        return { success: false, error: `Element at index ${index} not found` };
      }

      const sessionInfo = await this.browserSession.getOrCreateCDPSession(undefined, false);
      const cdpSession = sessionInfo.cdpSession as any;
      const resolveResult = await cdpSession.send('DOM.resolveNode', { backendNodeId: elementData.backendNodeId });
      const objectId = resolveResult?.object?.objectId;
      if (!objectId) {
        return { success: false, error: 'Failed to resolve select element' };
      }

      const result = await cdpSession.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function(){
          try{
            const el = this;
            if (!el || el.tagName !== 'SELECT') return { ok:false, reason:'Not a <select>' };
            const opts = Array.from(el.options).map(o => ({ value: o.value, text: (o.textContent||'').trim(), selected: !!o.selected, disabled: !!o.disabled }));
            return { ok:true, options: opts };
          }catch(e){ return { ok:false, reason:String(e && e.message || e) } }
        }`,
        returnByValue: true,
      });

      if (!result?.result?.value?.ok) {
        const reason = result?.result?.value?.reason || 'unknown error';
        return { success: false, error: `Get options failed: ${reason}` };
      }
      const options = result.result.value.options as Array<{ value: string; text: string; selected: boolean; disabled: boolean }>;
      return { success: true, options };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Upload a file to an <input type="file"> element by index using CDP DOM.setFileInputFiles
   */
  async uploadFile(index: number, filePath: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.page || !this.domService || !this.browserSession) {
        throw new Error('Browser not launched');
      }

      const now = Date.now();
      const cacheAge = now - this.cacheTimestamp;
      let selectorMap = this.cachedSelectorMap;
      if (!selectorMap || Object.keys(selectorMap).length === 0 || cacheAge >= this.CACHE_TTL) {
        const state = await this.getBrowserState(false, true);
        selectorMap = state.selectorMap;
      }

      const elementData = selectorMap[index];
      if (!elementData || !elementData.backendNodeId) {
        return { success: false, error: `Element at index ${index} not found` };
      }

      // Resolve absolute path and check existence
      const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
      if (!fs.existsSync(absPath)) {
        return { success: false, error: `File not found: ${absPath}` };
      }

      const sessionInfo = await this.browserSession.getOrCreateCDPSession(undefined, false);
      const cdpSession = sessionInfo.cdpSession as any;

      await cdpSession.send('DOM.setFileInputFiles', {
        files: [absPath],
        backendNodeId: elementData.backendNodeId,
      });

      await this.page.waitForTimeout(100);
      await this.emitScreenshot(`Uploaded file to element ${index}`);
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

      // Invalidate DOM cache after tab switch
      this.invalidateDOMCache();

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
  // (Removed legacy clickByBackendNodeId, typeByBackendNodeId, getKeyCodeForChar - replaced by Element class)

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

    // Use CDP Page.navigate instead of Playwright's page.goto()
    // This avoids HTTP/2 protocol errors on sites like Coupang
    if (this.browserSession && this.browserSession.agentFocus) {
      const targetId = this.browserSession.agentFocus.targetId;
      if (targetId) {
        const cdpSession = await this.browserSession.getOrCreateCDPSession(targetId, false);
        await (cdpSession.cdpSession as any).send('Page.navigate', {
          url: url,
          transitionType: 'typed',
        });
        await this.page.waitForTimeout(200);
        return;
      }
    }

    // Fallback to Playwright if CDP not available
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForTimeout(100);
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
      debug(`[BrowserController] Screenshot throttled (last: ${now - this.lastScreenshotTime}ms ago)`);
      return;
    }

    try {
      this.lastScreenshotTime = now;

      // Use CDP for screenshot to avoid Playwright's automatic navigation waiting
      // This prevents HTTP/2 protocol errors on sites like Coupang
      if (this.browserSession && this.browserSession.agentFocus) {
        const targetId = this.browserSession.agentFocus.targetId;
        if (targetId) {
          const cdpSession = await this.browserSession.getOrCreateCDPSession(targetId, false);
          const result = await (cdpSession.cdpSession as any).send('Page.captureScreenshot', {
            format: 'png',
          });
          const image = result.data;
          const url = this.page.url();

          await this.eventBus.emit(BrowserEventTypes.SCREENSHOT, {
            type: 'screenshot',
            image,
            action,
            timestamp: Date.now(),
            url,
          } as ScreenshotEvent);
          return;
        }
      }

      // Fallback to Playwright if CDP not available
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
      logError('[BrowserController] Failed to emit screenshot:', error.message);
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
