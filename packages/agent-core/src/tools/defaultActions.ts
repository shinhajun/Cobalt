/**
 * Default browser actions
 *
 * Based on browser-use's tools/service.py
 */

import { Registry, ActionResult } from './registry.js';
import {
  SearchAction,
  NavigateAction,
  ClickElementAction,
  InputTextAction,
  ScrollAction,
  SendKeysAction,
  SwitchTabAction,
  CloseTabAction,
  DoneAction,
} from './actions.js';
import { BrowserController } from '../browserController.js';
import { info } from '../utils/logger.js';

/**
 * Register all default browser actions
 */
export function registerDefaultActions(registry: Registry): void {
  // ============================================================================
  // Navigation Actions
  // ============================================================================

  registry.register({
    name: 'search',
    description: 'Search for a query using a search engine (google, bing, or duckduckgo)',
    paramModel: SearchAction,
    handler: async (params: SearchAction, browserController: BrowserController): Promise<ActionResult> => {
      const encodedQuery = encodeURIComponent(params.query);

      const searchEngines: Record<string, string> = {
        duckduckgo: `https://duckduckgo.com/?q=${encodedQuery}`,
        google: `https://www.google.com/search?q=${encodedQuery}&udm=14`,
        bing: `https://www.bing.com/search?q=${encodedQuery}`,
      };

      const engine = params.engine.toLowerCase();
      if (!(engine in searchEngines)) {
        return {
          error: `Unsupported search engine: ${params.engine}. Options: duckduckgo, google, bing`,
        };
      }

      const searchUrl = searchEngines[engine];

      try {
        const result = await browserController.navigate(searchUrl, false);

        if (!result.success) {
          return {
            error: `Failed to search ${params.engine} for "${params.query}": ${result.error}`,
          };
        }

        const memory = `Searched ${params.engine.charAt(0).toUpperCase() + params.engine.slice(1)} for '${params.query}'`;
        info(`🔍  ${memory}`);

        return {
          extractedContent: memory,
          longTermMemory: memory,
        };
      } catch (error: any) {
        return {
          error: `Failed to search ${params.engine}: ${error.message}`,
        };
      }
    },
  });

  registry.register({
    name: 'navigate',
    description: 'Navigate to a URL (optionally in a new tab)',
    paramModel: NavigateAction,
    handler: async (params: NavigateAction, browserController: BrowserController): Promise<ActionResult> => {
      try {
        const result = await browserController.navigate(params.url, params.newTab ?? false);

        if (!result.success) {
          return {
            error: `Failed to navigate: ${result.error}`,
          };
        }

        const memory = params.newTab
          ? `Opened new tab with URL ${params.url}`
          : `Navigated to ${params.url}`;

        info(`🔗 ${memory}`);

        return {
          extractedContent: memory,
          longTermMemory: memory,
        };
      } catch (error: any) {
        return {
          error: `Navigation failed: ${error.message}`,
        };
      }
    },
  });

  // ============================================================================
  // Element Interaction Actions
  // ============================================================================

  registry.register({
    name: 'click_element',
    description: 'Click on an interactive element by its index number',
    paramModel: ClickElementAction,
    handler: async (params: ClickElementAction, browserController: BrowserController): Promise<ActionResult> => {
      try {
        const result = await browserController.clickElement(params.index);

        if (!result.success) {
          return {
            error: `Failed to click element: ${result.error}`,
          };
        }

        const memory = `Clicked element at index ${params.index}`;

        return {
          extractedContent: memory,
          longTermMemory: memory,
        };
      } catch (error: any) {
        return {
          error: `Click failed: ${error.message}`,
        };
      }
    },
  });

  registry.register({
    name: 'input_text',
    description: 'Type text into an input field by its index',
    paramModel: InputTextAction,
    handler: async (params: InputTextAction, browserController: BrowserController): Promise<ActionResult> => {
      try {
        const result = await browserController.inputText(params.index, params.text, params.clear ?? true);

        if (!result.success) {
          return {
            error: `Failed to type text: ${result.error}`,
          };
        }

        const memory = `Typed "${params.text}" into element at index ${params.index}`;

        return {
          extractedContent: memory,
          longTermMemory: memory,
        };
      } catch (error: any) {
        return {
          error: `Input failed: ${error.message}`,
        };
      }
    },
  });

  // ============================================================================
  // Page Actions
  // ============================================================================

  registry.register({
    name: 'scroll',
    description: 'Scroll the page up or down by a number of pages',
    paramModel: ScrollAction,
    handler: async (params: ScrollAction, browserController: BrowserController): Promise<ActionResult> => {
      try {
        const result = await browserController.scroll(params.down, params.pages ?? 1.0);

        if (!result.success) {
          return {
            error: `Failed to scroll: ${result.error}`,
          };
        }

        const memory = `Scrolled ${params.down ? 'down' : 'up'} ${params.pages ?? 1.0} pages`;

        return {
          extractedContent: memory,
          longTermMemory: memory,
        };
      } catch (error: any) {
        return {
          error: `Scroll failed: ${error.message}`,
        };
      }
    },
  });

  registry.register({
    name: 'send_keys',
    description: 'Send keyboard keys (Enter, Escape, PageDown, etc.) or shortcuts (Control+a)',
    paramModel: SendKeysAction,
    handler: async (params: SendKeysAction, browserController: BrowserController): Promise<ActionResult> => {
      try {
        const result = await browserController.sendKeys(params.keys);

        if (!result.success) {
          return {
            error: `Failed to send keys: ${result.error}`,
          };
        }

        const memory = `Sent keys: ${params.keys}`;

        return {
          extractedContent: memory,
          longTermMemory: memory,
        };
      } catch (error: any) {
        return {
          error: `Send keys failed: ${error.message}`,
        };
      }
    },
  });

  // ============================================================================
  // Tab Management Actions
  // ============================================================================

  registry.register({
    name: 'switch_tab',
    description: 'Switch to another open tab by tab_id',
    paramModel: SwitchTabAction,
    handler: async (params: SwitchTabAction, browserController: BrowserController): Promise<ActionResult> => {
      try {
        const result = await browserController.switchTab(params.tabId);

        if (!result.success) {
          return {
            error: `Failed to switch tab: ${result.error}`,
          };
        }

        const memory = `Switched to tab ${params.tabId}`;

        return {
          extractedContent: memory,
          longTermMemory: memory,
        };
      } catch (error: any) {
        return {
          error: `Tab switch failed: ${error.message}`,
        };
      }
    },
  });

  registry.register({
    name: 'close_tab',
    description: 'Close a tab by tab_id',
    paramModel: CloseTabAction,
    handler: async (params: CloseTabAction, browserController: BrowserController): Promise<ActionResult> => {
      try {
        const result = await browserController.closeTab(params.tabId);

        if (!result.success) {
          return {
            error: `Failed to close tab: ${result.error}`,
          };
        }

        const memory = `Closed tab ${params.tabId}`;

        return {
          extractedContent: memory,
          longTermMemory: memory,
        };
      } catch (error: any) {
        return {
          error: `Close tab failed: ${error.message}`,
        };
      }
    },
  });

  // ============================================================================
  // Task Control Actions
  // ============================================================================

  registry.register({
    name: 'done',
    description: 'Mark the task as completed',
    paramModel: DoneAction,
    handler: async (params: DoneAction): Promise<ActionResult> => {
      const memory = `Task completed: ${params.text}`;

      return {
        extractedContent: memory,
        longTermMemory: memory,
      };
    },
  });
}
