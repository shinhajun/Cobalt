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
  ScrollToTextAction,
  GoBackAction,
  WaitAction,
  SelectDropdownAction,
  GetDropdownOptionsAction,
  UploadFileAction,
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
        // Normalize inputs from LLM
        const downNorm = typeof params.down === 'boolean'
          ? params.down
          : ((): boolean => {
              const s = String(params.down).toLowerCase();
              if (s === 'down' || s === 'true' || s === '1') return true;
              if (s === 'up' || s === 'false' || s === '0') return false;
              return true;
            })();

        let pagesNum: number = 1.0;
        if (typeof params.pages === 'number' && isFinite(params.pages)) {
          pagesNum = params.pages;
        } else if (params.pages !== undefined) {
          const parsed = parseFloat(String(params.pages));
          pagesNum = isFinite(parsed) && !isNaN(parsed) ? parsed : 1.0;
        }
        pagesNum = Math.max(0.1, Math.min(10.0, pagesNum));

        const result = await browserController.scroll(downNorm, pagesNum, params.index);

        if (!result.success) {
          return {
            error: `Failed to scroll: ${result.error}`,
          };
        }

        const memory = `Scrolled ${downNorm ? 'down' : 'up'} ${pagesNum} pages${
          params.index !== undefined ? ` in container ${params.index}` : ''
        }`;

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

  // Scroll to text
  registry.register({
    name: 'scroll_to_text',
    description: 'Scroll the page until a visible element containing the given text is centered',
    paramModel: ScrollToTextAction,
    handler: async (params: ScrollToTextAction, browserController: BrowserController): Promise<ActionResult> => {
      try {
        const result = await browserController.scrollToText(params.text, params.partial ?? true);
        if (!result.success) {
          return { error: `Failed to scroll to text '${params.text}': ${result.error}` };
        }
        const memory = `Scrolled to text '${params.text}'`;
        return { extractedContent: memory, longTermMemory: memory };
      } catch (error: any) {
        return { error: `Scroll to text failed: ${error.message}` };
      }
    },
  });

  // Go back
  registry.register({
    name: 'go_back',
    description: 'Navigate back in browser history',
    paramModel: GoBackAction,
    handler: async (_params: GoBackAction, browserController: BrowserController): Promise<ActionResult> => {
      try {
        const result = await browserController.goBack();
        if (!result.success) {
          return { error: `Failed to go back: ${result.error}` };
        }
        const memory = 'Navigated back';
        return { extractedContent: memory, longTermMemory: memory };
      } catch (error: any) {
        return { error: `Go back failed: ${error.message}` };
      }
    },
  });

  // Wait
  registry.register({
    name: 'wait',
    description: 'Wait for a number of seconds (max 30)',
    paramModel: WaitAction,
    handler: async (params: WaitAction, browserController: BrowserController): Promise<ActionResult> => {
      try {
        const seconds = Math.min(Math.max(params.seconds ?? 3, 0), 30);
        await browserController.wait(seconds);
        const memory = `Waited for ${seconds} seconds`;
        return { extractedContent: memory, longTermMemory: memory };
      } catch (error: any) {
        return { error: `Wait failed: ${error.message}` };
      }
    },
  });

  // Select dropdown option
  registry.register({
    name: 'select_dropdown',
    description: 'Select an option in a <select> by index and visible text/value',
    paramModel: SelectDropdownAction,
    handler: async (params: SelectDropdownAction, browserController: BrowserController): Promise<ActionResult> => {
      try {
        const result = await browserController.selectDropdown(params.index, params.option);
        if (!result.success) {
          return { error: `Failed to select dropdown: ${result.error}` };
        }
        const memory = `Selected option "${params.option}" on element at index ${params.index}`;
        return { extractedContent: memory, longTermMemory: memory };
      } catch (error: any) {
        return { error: `Select dropdown failed: ${error.message}` };
      }
    },
  });

  // Get dropdown options
  registry.register({
    name: 'get_dropdown_options',
    description: 'Get available options of a <select> by element index',
    paramModel: GetDropdownOptionsAction,
    handler: async (params: GetDropdownOptionsAction, browserController: BrowserController): Promise<ActionResult> => {
      try {
        const result = await browserController.getDropdownOptions(params.index);
        if (!result.success) {
          return { error: `Failed to get dropdown options: ${result.error}` };
        }

        const options = result.options || [];
        const preview = options.slice(0, 20).map((o: any) => `${o.text} (${o.value})${o.selected ? ' [selected]' : ''}`).join('\n');
        const memory = options.length > 0 ? `Found ${options.length} options for index ${params.index}` : `No options found for index ${params.index}`;
        return {
          extractedContent: preview || memory,
          longTermMemory: memory,
        };
      } catch (error: any) {
        return { error: `Get dropdown options failed: ${error.message}` };
      }
    },
  });

  // Upload file to input[type=file]
  registry.register({
    name: 'upload_file',
    description: 'Upload a file via an <input type="file"> element by index',
    paramModel: UploadFileAction,
    handler: async (params: UploadFileAction, browserController: BrowserController): Promise<ActionResult> => {
      try {
        const result = await browserController.uploadFile(params.index, params.filePath);
        if (!result.success) {
          return { error: `Failed to upload file: ${result.error}` };
        }
        const memory = `Uploaded file '${params.filePath}' to element ${params.index}`;
        return { extractedContent: memory, longTermMemory: memory };
      } catch (error: any) {
        return { error: `Upload file failed: ${error.message}` };
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
      const message = params.text || 'Task completed';
      const memory = `Task completed: ${message}`;

      return {
        extractedContent: memory,
        longTermMemory: memory,
      };
    },
  });
}
