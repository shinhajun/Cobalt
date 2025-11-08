import { chromium, Page, Browser, BrowserContext } from 'playwright';
import { DomService } from './dom/service.js';
import { SerializedDOMState } from './dom/views.js';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';

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

export class BrowserController extends EventEmitter {
  private page: Page | null = null;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private domService: DomService | null = null;
  private headless: boolean = true;
  private debugMode: boolean = false;
  private debugDir: string = './debug';

  constructor(debugMode: boolean = false, headless: boolean = true) {
    super();
    this.debugMode = debugMode;
    this.headless = headless;

    if (this.debugMode && !fs.existsSync(this.debugDir)) {
      fs.mkdirSync(this.debugDir, { recursive: true });
    }
  }

  async launch(): Promise<void> {
    const launchArgs = [
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920,1080',
      '--start-maximized',
      '--disable-infobars',
      '--disable-notifications',
      '--disable-popup-blocking',
    ];

    try {
      this.browser = await chromium.launch({
        channel: 'chrome',
        headless: this.headless,
        args: launchArgs,
        timeout: 60000,
      });
    } catch (_) {
      this.browser = await chromium.launch({
        headless: this.headless,
        args: launchArgs,
        timeout: 60000,
      });
    }

    const storageStatePath = path.join(this.debugDir, 'storageState.json');
    const context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'ko-KR',
      acceptDownloads: true,
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
      },
      storageState: fs.existsSync(storageStatePath) ? storageStatePath : undefined,
      bypassCSP: true,
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,
    });
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

    console.log('[BrowserController] Browser launched successfully');
  }

  async close(): Promise<void> {
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

      // Wait a bit for page to react
      await this.page.waitForTimeout(500);

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

      await this.typeByBackendNodeId(element.backendNodeId, text, clear);

      // Wait a bit for page to react
      await this.page.waitForTimeout(300);

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

      if (newTab) {
        const newPage = await this.context.newPage();
        await newPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        this.page = newPage; // Switch to new page
      } else {
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      }

      // Wait for page to stabilize
      await this.page.waitForTimeout(1000);

      // Emit screenshot event after action
      await this.emitScreenshot(`Navigated to ${url}`);

      return { success: true };
    } catch (error: any) {
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

      // Wait for page to stabilize after scroll
      await this.page.waitForTimeout(500);

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

      await this.page.waitForTimeout(300);

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

      this.page = pages[tabIndex];
      await this.page.bringToFront();

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

      // Focus the element first
      await cdp.send('DOM.focus', { objectId: object.objectId });

      // Clear if needed
      if (clearFirst) {
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'Control',
        });
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'char',
          text: 'a',
        });
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Control',
        });
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'char',
          text: '',
        });
      }

      // Type the text
      for (const char of text) {
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'char',
          text: char,
        });
      }
    } finally {
      await cdp.detach();
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
    await this.page.waitForTimeout(1000);
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
   */
  private async emitScreenshot(action: string): Promise<void> {
    if (!this.page) return;

    try {
      const screenshot = await this.page.screenshot({ type: 'png', fullPage: false });
      const image = Buffer.from(screenshot).toString('base64');
      const url = this.page.url();

      this.emit('screenshot', {
        image,
        action,
        timestamp: Date.now(),
        url,
      });
    } catch (error: any) {
      console.error('[BrowserController] Failed to emit screenshot:', error.message);
    }
  }

  /**
   * Emit log event
   */
  emitLog(type: 'thought' | 'observation' | 'system' | 'error', data: any): void {
    this.emit('log', { type, data });
  }
}
