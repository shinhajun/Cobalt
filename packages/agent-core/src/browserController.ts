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
  // FIX 7 & FIX 16: Balanced cache TTL for performance vs freshness
  // 5s provides good caching (reduces expensive DOM collection from 3.5s → 0s on cache hit)
  // while still being fresh enough for dynamic pages
  private readonly CACHE_TTL = 5000; // ms - Optimized balance
  private domChangedSinceCache: boolean = false; // Track if DOM potentially changed
  private lastDOMHash: string = ''; // Track DOM changes via hash comparison

  // BrowserSession for CDP session management (browser-use style)
  private browserSession: BrowserSession | null = null;

  /**
   * Invalidate DOM cache (called on navigation, tab switch)
   * @param reason - Reason for invalidation (for logging)
   * @param forceful - If true, clear cache immediately. If false, just mark as potentially changed
   */
  private invalidateDOMCache(reason: string = 'unknown', forceful: boolean = true): void {
    debug(`[BrowserController] DOM cache invalidated: ${reason} (forceful=${forceful})`);

    if (forceful) {
      // Hard invalidation - clear everything
      this.cachedDOMState = null;
      this.cachedSelectorMap = {};
      this.cacheTimestamp = 0;
      this.domChangedSinceCache = false;
      this.lastDOMHash = ''; // Reset hash
    } else {
      // Soft invalidation - mark as potentially changed, let getBrowserState decide
      this.domChangedSinceCache = true;
    }
  }

  /**
   * Compute quick DOM hash to detect changes without full DOM collection
   * Uses URL, title, and element count for fast comparison
   */
  private async computeQuickDOMHash(): Promise<string> {
    if (!this.page) return '';

    try {
      const hash = await this.page.evaluate(() => {
        const count = document.querySelectorAll('*').length;
        const title = document.title;
        const url = window.location.href;
        return `${url}:${title}:${count}`;
      });
      return hash;
    } catch (error: any) {
      debug('[BrowserController] Failed to compute DOM hash:', error.message);
      return '';
    }
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

    // Add navigation listeners for proactive cache invalidation
    this.page.on('framenavigated', async (frame) => {
      if (frame === this.page?.mainFrame()) {
        debug('[BrowserController] Frame navigated, invalidating cache');
        this.invalidateDOMCache('framenavigated event', true);
      }
    });

    this.page.on('load', () => {
      debug('[BrowserController] Page loaded, invalidating cache');
      this.invalidateDOMCache('page load event', true);
    });

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

      // Use cache if: (1) within TTL AND (2) DOM hasn't potentially changed
      let cacheValid = this.cachedDOMState && cacheAge < this.CACHE_TTL && !this.domChangedSinceCache;

      // Additional validation: Check if DOM actually changed via hash comparison
      if (cacheValid && this.lastDOMHash) {
        const currentHash = await this.computeQuickDOMHash();
        if (currentHash && currentHash !== this.lastDOMHash) {
          debug(`[BrowserController] DOM hash changed (${this.lastDOMHash.substring(0, 50)}... -> ${currentHash.substring(0, 50)}...), invalidating cache`);
          cacheValid = false;
          this.lastDOMHash = currentHash; // Update for next comparison
        }
      }

      if (cacheValid) {
        debug(`[BrowserController] Using cached DOM (age: ${cacheAge}ms, unchanged)`);
        domState = this.cachedDOMState;
        selectorMap = this.cachedSelectorMap;
        llmRepresentation = this.formatDOMForLLM(selectorMap);
        timing.dom = 0; // Cache hit
      } else {
        // Cache miss, expired, or DOM changed - fetch fresh DOM
        const domStart = Date.now();
        const domResult = await this.domService.getSerializedDOMTree();
        domState = domResult.state;
        selectorMap = domState.selectorMap;
        llmRepresentation = domResult.llmRepresentation || this.formatDOMForLLM(domState.selectorMap);
        timing.dom = Date.now() - domStart;

        // FIX 8 & FIX 10: Smart wait detection - if DOM is empty OR title is missing, page may still be loading
        // Changed from AND to OR to catch cases where elements exist but title is empty (common in SPAs)
        const elementCount = Object.keys(selectorMap).length;
        if (elementCount === 0 || !title) {
          debug(`[BrowserController] Incomplete page detected (${elementCount} elements, title: "${title}") - waiting for page to load...`);
          await this.page.waitForTimeout(1000);

          // Retry DOM collection once
          const retryResult = await this.domService.getSerializedDOMTree();
          domState = retryResult.state;
          selectorMap = domState.selectorMap;
          llmRepresentation = retryResult.llmRepresentation || this.formatDOMForLLM(domState.selectorMap);

          // Re-check title after retry
          let retryTitle = '';
          try {
            retryTitle = await this.page.title();
          } catch (error: any) {
            debug('[BrowserController] Failed to get title after retry:', error.message);
          }

          const retryElementCount = Object.keys(selectorMap).length;
          debug(`[BrowserController] After retry: ${retryElementCount} elements, title: "${retryTitle}"`);

          // Update title if we got one
          if (retryTitle) {
            title = retryTitle;
          }
        }

        // Update cache, hash, and reset change flag
        this.cachedDOMState = domState;
        this.cachedSelectorMap = selectorMap;
        this.cacheTimestamp = now;
        this.domChangedSinceCache = false; // Reset flag after refresh
        this.lastDOMHash = await this.computeQuickDOMHash(); // Update hash for next comparison
        const reason = cacheAge >= this.CACHE_TTL ? 'expired' : (this.domChangedSinceCache ? 'changed' : 'initial');
        debug(`[BrowserController] DOM cache refreshed (${timing.dom}ms, was: ${reason})`);
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
    let indices = Object.keys(selectorMap).map(k => parseInt(k));

    if (indices.length === 0) {
      return 'No interactive elements found on the page.';
    }

    // FIX 15: Limit elements to prevent token explosion (2,524 → 150 elements)
    // Priority-based filtering: inputs > buttons > selects > links > others
    const MAX_ELEMENTS = 150;
    const totalElements = indices.length;

    if (totalElements > MAX_ELEMENTS) {
      // Sort by priority score (highest first)
      indices.sort((a, b) => {
        const scoreA = this.getElementPriority(selectorMap[a]);
        const scoreB = this.getElementPriority(selectorMap[b]);
        return scoreB - scoreA; // Descending order
      });

      // Keep only top 150 elements
      indices = indices.slice(0, MAX_ELEMENTS);
      debug(`[BrowserController] DOM filtered: ${totalElements} → ${MAX_ELEMENTS} elements (by priority)`);
    }

    // Sort by index for display
    indices.sort((a, b) => a - b);

    let output = `Interactive elements on page (showing ${indices.length} of ${totalElements} total):\n\n`;

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

    if (totalElements > MAX_ELEMENTS) {
      output += `\n... and ${totalElements - MAX_ELEMENTS} more elements (filtered by priority)\n`;
    }

    output += '\nTo interact with elements, use their index number (e.g., click element [5]).\n';

    return output;
  }

  /**
   * FIX 15: Calculate element priority for filtering
   * Higher score = more important for AI agent
   */
  private getElementPriority(elem: any): number {
    const tag = elem.tagName?.toLowerCase() || '';
    const text = elem.text?.trim() || '';
    const hasText = text.length > 0;

    // Base priority by tag type
    let priority = 50; // Default

    if (tag === 'input' || tag === 'textarea') priority = 100;
    else if (tag === 'button') priority = 95;
    else if (tag === 'select') priority = 90;
    else if (tag === 'a' && hasText) priority = 75;
    else if (tag === 'a') priority = 60;

    // Boost for meaningful text
    if (hasText && text.length > 3) priority += 10;
    if (text.length > 20) priority += 5;

    // Boost for interactive attributes
    if (elem.attributes?.['aria-label']) priority += 8;
    if (elem.attributes?.placeholder) priority += 8;
    if (elem.attributes?.role === 'button') priority += 10;

    return priority;
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
      // FIX 9: Removed browserSession check - it can be null during async cleanup even when browser is active
      if (!this.page || !this.domService) {
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

      // Store URL before click to detect navigation
      const urlBeforeClick = this.page.url();

      // Use browser-use style Element class with advanced click
      // browserSession should exist if page exists (created together in launch())
      if (!this.browserSession) {
        throw new Error('Browser session not initialized');
      }
      const element = new Element(
        this.browserSession,
        elementData.backendNodeId,
        this.browserSession.agentFocus.sessionId
      );

      await element.click();

      // FIX 3: Improved navigation handling after click
      // Increase timeout from 400ms to 2000ms for JavaScript-triggered navigation
      // Wait for navigation or timeout (race condition fix)
      await Promise.race([
        this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {}),
        this.page.waitForTimeout(2000), // Increased from 400ms to allow JS navigation
      ]);

      // Additional wait for network idle if navigation occurred
      const urlAfterClick = this.page.url();
      const navigationOccurred = urlBeforeClick !== urlAfterClick;

      if (navigationOccurred) {
        // Navigation detected - wait for page to stabilize
        await this.page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {
          debug('[BrowserController] Network idle timeout after click navigation');
        });
        this.invalidateDOMCache('click caused navigation', true); // Hard invalidate
      } else {
        // No URL change - but DOM might have changed (e.g., SPA, modal, dropdown)
        // Invalidate cache to be safe
        this.invalidateDOMCache('click action completed', false); // Soft invalidate
      }

      // Emit screenshot event after action
      await this.emitScreenshot(`Clicked element ${index}`);

      return { success: true };
    } catch (error: any) {
      // Auto-retry on stale node ID
      if (error.message && error.message.includes('STALE_NODE_ID')) {
        debug('[BrowserController] Stale node detected, retrying click with fresh DOM');
        try {
          // Force refresh DOM
          this.invalidateDOMCache('stale node detected in click', true);
          const freshState = await this.getBrowserState(false, true);
          const freshElementData = freshState.selectorMap[index];

          if (freshElementData && freshElementData.backendNodeId) {
            // Retry click with fresh element
            const freshElement = new Element(
              this.browserSession!,
              freshElementData.backendNodeId,
              this.browserSession!.agentFocus.sessionId
            );
            await freshElement.click();

            // Wait and check for navigation (same improved timeout as main click)
            await Promise.race([
              this.page!.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {}),
              this.page!.waitForTimeout(2000), // Increased from 400ms
            ]);

            await this.emitScreenshot(`Clicked element ${index} (retry after stale node)`);
            return { success: true };
          } else {
            return { success: false, error: `Element at index ${index} not found after DOM refresh` };
          }
        } catch (retryError: any) {
          logError('[BrowserController] Click retry failed:', retryError);
          return { success: false, error: `Click retry failed: ${retryError.message}` };
        }
      }

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
      // FIX 9: Removed browserSession check
      if (!this.page || !this.domService) {
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
      if (!this.browserSession) {
        throw new Error('Browser session not initialized');
      }
      const element = new Element(
        this.browserSession,
        elementData.backendNodeId,
        this.browserSession.agentFocus.sessionId
      );

      await element.fill(text, clear);

      // Wait briefly for input to register (browser-use: 50ms)
      await this.page.waitForTimeout(50);

      // FIX 7: Invalidate cache after input - typing may trigger autocomplete, dropdowns, or DOM changes
      this.invalidateDOMCache('text input action', false); // Soft invalidate

      // Emit screenshot event after action
      await this.emitScreenshot(`Input text into element ${index}`);

      return { success: true };
    } catch (error: any) {
      // Auto-retry on stale node ID
      if (error.message && error.message.includes('STALE_NODE_ID')) {
        debug('[BrowserController] Stale node detected, retrying input with fresh DOM');
        try {
          // Force refresh DOM
          this.invalidateDOMCache('stale node detected in input', true);
          const freshState = await this.getBrowserState(false, true);
          const freshElementData = freshState.selectorMap[index];

          if (freshElementData && freshElementData.backendNodeId) {
            // Retry fill with fresh element
            const freshElement = new Element(
              this.browserSession!,
              freshElementData.backendNodeId,
              this.browserSession!.agentFocus.sessionId
            );
            await freshElement.fill(text, clear);
            await this.page!.waitForTimeout(50);

            await this.emitScreenshot(`Input text into element ${index} (retry after stale node)`);
            return { success: true };
          } else {
            return { success: false, error: `Element at index ${index} not found after DOM refresh` };
          }
        } catch (retryError: any) {
          logError('[BrowserController] Input retry failed:', retryError);
          return { success: false, error: `Input retry failed: ${retryError.message}` };
        }
      }

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

      // CRITICAL FIX: Invalidate cache BEFORE navigation starts to prevent stale DOM
      this.invalidateDOMCache('page navigation starting', true);

      const cdpSession = await this.browserSession.getOrCreateCDPSession(targetId, false);

      await (cdpSession.cdpSession as any).send('Page.navigate', {
        url: url,
        transitionType: 'address_bar',
      });

      // Wait for page to stabilize - use multiple strategies to ensure proper loading
      const page = this.page;
      await Promise.race([
        page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {}),
        page.waitForLoadState('domcontentloaded', { timeout: 3000 })
          .then(() => page.waitForTimeout(500))
          .catch(() => {}),
        page.waitForTimeout(5000), // Fallback timeout
      ]);

      // FIX 2: Add mandatory page stabilization to ensure page is fully ready
      // This prevents empty page states (0 elements) that waste iterations
      try {
        // Wait for network to be idle (ensures resources loaded)
        await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {
          debug('[BrowserController] Network idle timeout - proceeding anyway');
        });

        // FIX 12: Increased buffer from 300ms to 600ms for SPA dynamic content
        // Amazon and other SPAs need more time for React/Vue rendering after navigation
        await page.waitForTimeout(600);

        // Verify page is actually ready by checking if we can query the DOM
        const elementCount = await page.evaluate(() => document.querySelectorAll('*').length).catch(() => 0);
        if (elementCount === 0) {
          debug('[BrowserController] Page appears empty, waiting longer...');
          await page.waitForTimeout(1000);
        }
      } catch (error: any) {
        debug('[BrowserController] Page stabilization check failed:', error.message);
        // Continue anyway - better to try than to fail completely
      }

      // FIX 1: Protect title access - can fail during navigation with "execution context destroyed"
      // This error is NORMAL during navigation and should not fail the entire navigate action
      let title = '';
      try {
        title = await this.page.title();
      } catch (error: any) {
        debug('[BrowserController] Failed to get title after navigation (context transition):', error.message);
        // Use empty title - navigation may still have succeeded
        title = '';
      }

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
   * Wait for a selector to reach a given state
   */
  async waitForSelector(
    selector: string,
    timeoutMs: number = 5000,
    state: 'visible' | 'attached' | 'detached' | 'hidden' = 'visible'
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.page) throw new Error('Browser not launched');

      const loc = this.page.locator(selector);
      await loc.waitFor({ state, timeout: timeoutMs });
      await this.emitScreenshot(`Waited for selector '${selector}' to be ${state}`);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Click element by selector (CSS or XPath if starts with //)
   */
  async clickSelector(selector: string, nth?: number): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.page) throw new Error('Browser not launched');

      let locator = selector.startsWith('//') ? this.page.locator(`xpath=${selector}`) : this.page.locator(selector);
      if (typeof nth === 'number' && nth >= 0) locator = locator.nth(nth);

      await locator.first().click({ timeout: 5000 });

      // Allow page to settle or navigate
      await Promise.race([
        this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {}),
        this.page.waitForTimeout(300),
      ]);

      this.invalidateDOMCache();
      await this.emitScreenshot(`Clicked selector '${selector}'${typeof nth === 'number' ? ` [nth=${nth}]` : ''}`);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Type into element matched by selector
   */
  async inputSelector(selector: string, text: string, clear: boolean = true): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.page) throw new Error('Browser not launched');

      const locator = selector.startsWith('//') ? this.page.locator(`xpath=${selector}`) : this.page.locator(selector);
      if (clear) {
        await locator.fill('', { timeout: 5000 }).catch(() => {});
      }
      await locator.fill(text, { timeout: 5000 });
      await this.page.waitForTimeout(50);
      await this.emitScreenshot(`Filled selector '${selector}' with text '${text}'`);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Click by visible text content (uses Playwright text engine)
   */
  async clickText(text: string, exact: boolean = false): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.page) throw new Error('Browser not launched');

      await this.page.getByText(text, { exact }).first().click({ timeout: 5000 });
      await Promise.race([
        this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {}),
        this.page.waitForTimeout(300),
      ]);
      this.invalidateDOMCache();
      await this.emitScreenshot(`Clicked text '${text}' (exact=${exact})`);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Select <option> on a <select> matched by selector by visible text or value
   */
  async selectDropdownBySelector(selector: string, option: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.page) throw new Error('Browser not launched');

      const locator = selector.startsWith('//') ? this.page.locator(`xpath=${selector}`) : this.page.locator(selector);
      await locator.selectOption({ label: option }).catch(async () => {
        await locator.selectOption({ value: option });
      });
      await this.page.waitForTimeout(50);
      await this.emitScreenshot(`Selected option '${option}' on selector '${selector}'`);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Assert current URL contains substring(s). Optionally wait for navigation first.
   */
  async assertUrlContains(includes: string | string[], timeoutMs: number = 3000): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.page) throw new Error('Browser not launched');
      // Small wait to allow URL updates after actions
      if (timeoutMs > 0) {
        await Promise.race([
          this.page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => {}),
          this.page.waitForTimeout(Math.min(500, timeoutMs)),
        ]);
      }

      const url = this.page.url();
      const needles = Array.isArray(includes) ? includes : [includes];
      const missing = needles.filter(n => !url.includes(n));
      if (missing.length > 0) {
        return { success: false, error: `URL '${url}' missing: ${missing.join(', ')}` };
      }
      await this.emitScreenshot(`Asserted URL contains: ${needles.join(' | ')}`);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Public helper: request a screenshot now (force bypass throttle)
   */
  async requestScreenshot(note: string = 'Requested screenshot'): Promise<{ success: boolean; error?: string }> {
    try {
      await this.emitScreenshot(note, true);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Evaluate arbitrary JS in the page context and return stringified result
   */
  async evaluateJS(code: string): Promise<{ success: boolean; error?: string; value?: string }> {
    try {
      if (!this.page) throw new Error('Browser not launched');

      // Wrap code in an async IIFE with error capture to avoid breaking the page
      const wrapped = `(() => { try { const r = (function(){ ${code}\n})(); return typeof r === 'string' ? r : JSON.stringify(r); } catch(e){ return 'Error: ' + (e && e.message || e); } })()`;
      const result = await this.page.evaluate(wrapped);
      const value = typeof result === 'string' ? result : String(result);
      await this.emitScreenshot('Evaluated JS');
      return { success: true, value };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Extract simple markdown-like text from the page and optional links
   */
  async extractPageMarkdown(extractLinks: boolean = false, startFromChar: number = 0): Promise<{ success: boolean; error?: string; markdown?: string; stats?: any }> {
    try {
      if (!this.page) throw new Error('Browser not launched');

      const data = await this.page.evaluate(({ withLinks }) => {
        const text = (document.body && (document.body as any).innerText) ? (document.body as any).innerText : '';
        let links: Array<{ text: string; href: string }> = [];
        if (withLinks) {
          links = Array.from(document.querySelectorAll('a[href]')).slice(0, 200).map(a => ({
            text: ((a.textContent || '').trim()).slice(0, 200),
            href: (a as HTMLAnchorElement).href,
          }));
        }
        return { text, links };
      }, { withLinks: extractLinks });

      const MAX = 30000;
      let content = data.text || '';
      if (startFromChar > 0) {
        if (startFromChar >= content.length) {
          return { success: false, error: `start_from_char (${startFromChar}) exceeds content length (${content.length})` };
        }
        content = content.slice(startFromChar);
      }
      let truncated = false;
      let nextStart = 0;
      if (content.length > MAX) {
        content = content.slice(0, MAX);
        truncated = true;
        nextStart = (startFromChar || 0) + MAX;
      }

      let md = content;
      if (extractLinks && Array.isArray(data.links)) {
        const lines = data.links.map((l: any) => `- [${l.text || 'link'}](${l.href})`);
        md += `\n\nLinks:\n${lines.join('\n')}`;
      }

      const stats = {
        original_chars: (data.text || '').length,
        returned_chars: md.length,
        truncated,
        next_start_char: truncated ? nextStart : undefined,
        links_count: extractLinks ? (data.links || []).length : 0,
      };

      await this.emitScreenshot('Extracted page content');
      return { success: true, markdown: md, stats };
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
      // Invalidate DOM cache (always hard invalidation for navigation)
      this.invalidateDOMCache('navigation back', true);
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
      // Enhanced browser state validation
      if (!this.browser) {
        return { success: false, error: 'Browser closed - please restart' };
      }
      if (!this.page) {
        return { success: false, error: 'No active page - browser session corrupted' };
      }
      // FIX 9: Removed browserSession check
      if (!this.domService) {
        throw new Error('Browser not launched');
      }

      // Verify page is still responsive
      try {
        await this.page.evaluate(() => document.readyState);
      } catch (error: any) {
        return { success: false, error: 'Page not responsive - may have navigated or crashed' };
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
      if (!this.browserSession) {
        throw new Error('Browser session not initialized');
      }
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
      // FIX 9: Removed browserSession check
      if (!this.page || !this.domService) {
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

      if (!this.browserSession) {
        throw new Error('Browser session not initialized');
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
      // FIX 9: Removed browserSession check
      if (!this.page || !this.domService) {
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

      if (!this.browserSession) {
        throw new Error('Browser session not initialized');
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

      // Invalidate DOM cache after tab switch (always hard invalidation)
      this.invalidateDOMCache('tab switch', true);

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
