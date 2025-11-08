/**
 * Browser State Service
 * Based on browser-use's BrowserSession.get_browser_state_summary()
 * Provides complete browser state including DOM, screenshots, and metadata
 */

import { BrowserController } from './browserController';
import { SerializedDOMState } from './dom/views';

export interface BrowserStateSummary {
  url: string;
  title: string;
  screenshot: string | null;  // base64 encoded
  domState: SerializedDOMState | null;
  llmRepresentation: string;  // Formatted DOM for LLM
  selectorMap: Record<number, any>;  // Index to DOM node mapping
  scrollPosition: { x: number; y: number };
  viewportSize: { width: number; height: number };
  tabs: Array<{ id: string; url: string; title: string }>;
  timestamp: number;
  timing: Record<string, number>;  // Performance metrics
}

export class BrowserStateService {
  constructor(private browserController: BrowserController) {}

  /**
   * Get complete browser state summary (browser-use style)
   * Called EVERY step to ensure fresh, accurate state
   *
   * @param includeScreenshot - Whether to capture screenshot (default: true)
   * @param includeDOM - Whether to extract DOM (default: true)
   * @returns Complete browser state summary
   */
  async getBrowserStateSummary(
    includeScreenshot: boolean = true,
    includeDOM: boolean = true
  ): Promise<BrowserStateSummary> {
    const startTime = Date.now();
    const timing: Record<string, number> = {};

    try {
      // Fetch all data in parallel for performance
      const [
        url,
        title,
        screenshot,
        domResult,
        scrollInfo,
        viewportInfo,
        tabs
      ] = await Promise.all([
        // Basic page info
        this.getCurrentUrl(),
        this.getPageTitle(),

        // Screenshot (if requested)
        includeScreenshot ? this.captureScreenshot() : Promise.resolve(null),

        // Enhanced DOM extraction (if requested)
        includeDOM ? this.browserController.getEnhancedDOM() : Promise.resolve(null),

        // Scroll and viewport info
        this.getScrollInfo(),
        this.getViewportInfo(),

        // Multi-tab info
        this.getTabsInfo(),
      ]);

      timing.total = Date.now() - startTime;
      if (domResult) {
        Object.assign(timing, domResult.timing);
      }

      return {
        url,
        title,
        screenshot,
        domState: domResult?.selectorMap ? {
          root: null,  // We don't expose the full tree
          selectorMap: domResult.selectorMap,
        } : null,
        llmRepresentation: domResult?.llmRepresentation || 'No interactive elements found.',
        selectorMap: domResult?.selectorMap || {},
        scrollPosition: scrollInfo,
        viewportSize: viewportInfo,
        tabs,
        timestamp: Date.now(),
        timing,
      };
    } catch (error) {
      console.error('[BrowserStateService] Error getting browser state:', error);

      // Return minimal state on error
      return {
        url: await this.getCurrentUrl().catch(() => 'unknown'),
        title: await this.getPageTitle().catch(() => 'unknown'),
        screenshot: null,
        domState: null,
        llmRepresentation: 'Error: Could not extract page state.',
        selectorMap: {},
        scrollPosition: { x: 0, y: 0 },
        viewportSize: { width: 0, height: 0 },
        tabs: [],
        timestamp: Date.now(),
        timing: { total: Date.now() - startTime, error: 1 },
      };
    }
  }

  /**
   * Get current URL
   */
  private async getCurrentUrl(): Promise<string> {
    return this.browserController.getCurrentUrl();
  }

  /**
   * Get page title
   */
  private async getPageTitle(): Promise<string> {
    try {
      const page = (this.browserController as any).page;
      if (!page) return 'No page';
      return await page.title();
    } catch (error) {
      return 'Unknown';
    }
  }

  /**
   * Capture screenshot as base64
   */
  private async captureScreenshot(): Promise<string | null> {
    try {
      // captureScreenshot returns Buffer, need to convert to base64
      const screenshot = await this.browserController.captureScreenshot();
      if (screenshot) {
        return Buffer.from(screenshot).toString('base64');
      }
      return null;
    } catch (error) {
      console.error('[BrowserStateService] Error capturing screenshot:', error);
      return null;
    }
  }

  /**
   * Get scroll information
   */
  private async getScrollInfo(): Promise<{ x: number; y: number }> {
    try {
      const info = await this.browserController.getScrollInfo();
      return { x: 0, y: info.scrollY };
    } catch (error) {
      return { x: 0, y: 0 };
    }
  }

  /**
   * Get viewport information
   */
  private async getViewportInfo(): Promise<{ width: number; height: number }> {
    try {
      const page = (this.browserController as any).page;
      if (!page) return { width: 0, height: 0 };

      const viewport = page.viewportSize();
      return viewport || { width: 0, height: 0 };
    } catch (error) {
      return { width: 0, height: 0 };
    }
  }

  /**
   * Get tabs information
   */
  private async getTabsInfo(): Promise<Array<{ id: string; url: string; title: string }>> {
    try {
      const tabs = await this.browserController.listTabs();
      return tabs.map(tab => ({
        id: tab.id,
        url: tab.url,
        title: tab.title || 'Untitled',
      }));
    } catch (error) {
      return [];
    }
  }
}
