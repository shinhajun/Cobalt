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
  ClickSelectorAction,
  ClickTextAction,
  InputTextAction,
  InputSelectorAction,
  ScrollAction,
  SendKeysAction,
  ScrollToTextAction,
  WaitForSelectorAction,
  AssertUrlContainsAction,
  ScreenshotAction,
  EvaluateAction,
  ExtractAction,
  GoBackAction,
  WaitAction,
  SelectDropdownAction,
  SelectDropdownBySelectorAction,
  GetDropdownOptionsAction,
  UploadFileAction,
  SwitchTabAction,
  CloseTabAction,
  DoneAction,
  DoneStructuredAction,
  WriteFileAction,
  ReadFileAction,
  ReplaceFileAction,
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

        // Optionally submit with Enter (useful for search bars)
        if (params.submit) {
          const submitRes = await browserController.sendKeys('Enter');
          if (!submitRes.success) {
            return { error: `Input succeeded but submit failed: ${submitRes.error}` };
          }
        }

        const memory = params.submit
          ? `Typed "${params.text}" into element at index ${params.index} and submitted`
          : `Typed "${params.text}" into element at index ${params.index}`;

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

  // Wait for selector
  registry.register({
    name: 'wait_for_selector',
    description: 'Wait until a selector is visible/attached/hidden (default visible)',
    paramModel: WaitForSelectorAction,
    handler: async (params: WaitForSelectorAction, browserController: BrowserController): Promise<ActionResult> => {
      try {
        const result = await browserController.waitForSelector(params.selector, params.timeoutMs ?? 5000, params.state ?? 'visible');
        if (!result.success) return { error: `Failed waiting for selector '${params.selector}': ${result.error}` };
        const memory = `Waited for selector '${params.selector}' (${params.state ?? 'visible'})`;
        return { extractedContent: memory, longTermMemory: memory };
      } catch (error: any) {
        return { error: `wait_for_selector failed: ${error.message}` };
      }
    },
  });

  // Assert URL contains substrings
  registry.register({
    name: 'assert_url_contains',
    description: 'Assert current URL contains a substring or list of substrings',
    paramModel: AssertUrlContainsAction,
    handler: async (params: AssertUrlContainsAction, browserController: BrowserController): Promise<ActionResult> => {
      try {
        const result = await browserController.assertUrlContains(params.includes as any, params.timeoutMs ?? 3000);
        if (!result.success) return { error: result.error || 'URL assertion failed' };
        const incl = Array.isArray(params.includes) ? params.includes.join(', ') : params.includes;
        const memory = `Verified URL includes: ${incl}`;
        return { extractedContent: memory, longTermMemory: memory };
      } catch (error: any) {
        return { error: `assert_url_contains failed: ${error.message}` };
      }
    },
  });

  // Click by CSS/XPath selector (stable)
  registry.register({
    name: 'click_selector',
    description: 'Click element matching a CSS/XPath selector (more stable than index)',
    paramModel: ClickSelectorAction,
    handler: async (params: ClickSelectorAction, browserController: BrowserController): Promise<ActionResult> => {
      try {
        const result = await browserController.clickSelector(params.selector, params.nth);
        if (!result.success) {
          return { error: `Failed to click selector '${params.selector}': ${result.error}` };
        }
        const memory = `Clicked selector '${params.selector}'${params.nth !== undefined ? ` [nth=${params.nth}]` : ''}`;
        return { extractedContent: memory, longTermMemory: memory };
      } catch (error: any) {
        return { error: `Click selector failed: ${error.message}` };
      }
    },
  });

  // Click by visible text
  registry.register({
    name: 'click_text',
    description: 'Click element by its visible text (exact or partial)',
    paramModel: ClickTextAction,
    handler: async (params: ClickTextAction, browserController: BrowserController): Promise<ActionResult> => {
      try {
        const result = await browserController.clickText(params.text, params.exact ?? false);
        if (!result.success) return { error: `Failed to click text '${params.text}': ${result.error}` };
        const memory = `Clicked text '${params.text}' (exact=${params.exact ?? false})`;
        return { extractedContent: memory, longTermMemory: memory };
      } catch (error: any) {
        return { error: `Click text failed: ${error.message}` };
      }
    },
  });

  // Input by selector
  registry.register({
    name: 'input_selector',
    description: 'Type text into an input matched by CSS/XPath selector',
    paramModel: InputSelectorAction,
    handler: async (params: InputSelectorAction, browserController: BrowserController): Promise<ActionResult> => {
      try {
        const result = await browserController.inputSelector(params.selector, params.text, params.clear ?? true);
        if (!result.success) {
          return { error: `Failed to type into selector '${params.selector}': ${result.error}` };
        }
        if (params.submit) {
          const submitRes = await browserController.sendKeys('Enter');
          if (!submitRes.success) return { error: `Input succeeded but submit failed: ${submitRes.error}` };
        }
        const memory = params.submit
          ? `Typed \"${params.text}\" into selector '${params.selector}' and submitted`
          : `Typed \"${params.text}\" into selector '${params.selector}'`;
        return { extractedContent: memory, longTermMemory: memory };
      } catch (error: any) {
        return { error: `Input selector failed: ${error.message}` };
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

  // Screenshot (request immediate screenshot)
  registry.register({
    name: 'screenshot',
    description: 'Request a screenshot of the current page (forces capture now)',
    paramModel: ScreenshotAction,
    handler: async (params: ScreenshotAction, browserController: BrowserController): Promise<ActionResult> => {
      try {
        const note = params.note || 'Requested screenshot';
        const result = await browserController.requestScreenshot(note);
        if (!result.success) return { error: result.error || 'Screenshot failed' };
        const memory = `Screenshot captured: ${note}`;
        return { extractedContent: memory, longTermMemory: memory };
      } catch (error: any) {
        return { error: `Screenshot failed: ${error.message}` };
      }
    },
  });

  // Evaluate JavaScript in page
  registry.register({
    name: 'evaluate',
    description: 'Execute JavaScript in the page context and return stringified result',
    paramModel: EvaluateAction,
    handler: async (params: EvaluateAction, browserController: BrowserController): Promise<ActionResult> => {
      try {
        const result = await browserController.evaluateJS(params.code);
        if (!result.success) return { error: result.error || 'Evaluate failed' };
        const preview = (result.value || '').slice(0, 2000);
        const memory = `Evaluated JS (length=${(result.value || '').length})`;
        return { extractedContent: preview || memory, longTermMemory: memory };
      } catch (error: any) {
        return { error: `Evaluate failed: ${error.message}` };
      }
    },
  });

  // Extract simplified page markdown and links
  registry.register({
    name: 'extract',
    description: 'Extract page text as simplified markdown, optionally including links',
    paramModel: ExtractAction,
    handler: async (params: ExtractAction, browserController: BrowserController): Promise<ActionResult> => {
      try {
        const res = await browserController.extractPageMarkdown(params.extract_links ?? false, params.start_from_char ?? 0);
        if (!res.success) return { error: res.error || 'Extract failed' };
        const md = res.markdown || '';
        const preview = md.length > 30000 ? md.slice(0, 30000) : md;
        const stats = res.stats || {};
        const memory = `Content processed: original=${stats.original_chars || 0} returned=${stats.returned_chars || (md || '').length}${stats.truncated ? ` (truncated, next_start_char=${stats.next_start_char})` : ''}`;
        return { extractedContent: preview || memory, longTermMemory: memory, includeExtractedContentOnlyOnce: true };
      } catch (error: any) {
        return { error: `Extract failed: ${error.message}` };
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

  // Select dropdown by selector
  registry.register({
    name: 'select_dropdown_by_selector',
    description: 'Select an option in a <select> matched by CSS/XPath selector',
    paramModel: SelectDropdownBySelectorAction,
    handler: async (params: SelectDropdownBySelectorAction, browserController: BrowserController): Promise<ActionResult> => {
      try {
        const result = await browserController.selectDropdownBySelector(params.selector, params.option);
        if (!result.success) return { error: `Failed to select by selector '${params.selector}': ${result.error}` };
        const memory = `Selected option \"${params.option}\" on selector '${params.selector}'`;
        return { extractedContent: memory, longTermMemory: memory };
      } catch (error: any) {
        return { error: `Select dropdown by selector failed: ${error.message}` };
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

  // ============================================================================
  // File System-like Actions (local workspace)
  // ============================================================================

  registry.register({
    name: 'write_file',
    description: 'Write content to a file path (relative to current working directory by default)',
    paramModel: WriteFileAction,
    handler: async (params: WriteFileAction): Promise<ActionResult> => {
      try {
        const path = (await import('path')).default;
        const fs = (await import('fs')).default;
        const target = path.isAbsolute(params.filePath) ? params.filePath : path.resolve(process.cwd(), params.filePath);

        let content = params.content || '';
        if (params.leadingNewline) content = '\n' + content;
        if (params.trailingNewline && !content.endsWith('\n')) content += '\n';

        if (params.append) {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.appendFileSync(target, content, 'utf-8');
        } else {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, content, 'utf-8');
        }
        const memory = `Wrote ${content.length} bytes to ${params.filePath}${params.append ? ' (append)' : ''}`;
        return { extractedContent: memory, longTermMemory: memory };
      } catch (error: any) {
        return { error: `write_file failed: ${error.message}` };
      }
    },
  });

  registry.register({
    name: 'read_file',
    description: 'Read content of a file (relative to current working directory by default)',
    paramModel: ReadFileAction,
    handler: async (params: ReadFileAction): Promise<ActionResult> => {
      try {
        const path = (await import('path')).default;
        const fs = (await import('fs')).default;
        const target = path.isAbsolute(params.filePath) ? params.filePath : path.resolve(process.cwd(), params.filePath);
        if (!fs.existsSync(target)) return { error: `File not found: ${params.filePath}` };
        const content = fs.readFileSync(target, 'utf-8');
        const preview = content.length > 50000 ? content.slice(0, 50000) : content;
        const memory = `Read ${content.length} bytes from ${params.filePath}`;
        return { extractedContent: preview || memory, longTermMemory: memory, includeExtractedContentOnlyOnce: true };
      } catch (error: any) {
        return { error: `read_file failed: ${error.message}` };
      }
    },
  });

  registry.register({
    name: 'replace_file',
    description: 'Replace all occurrences of old_str with new_str in file',
    paramModel: ReplaceFileAction,
    handler: async (params: ReplaceFileAction): Promise<ActionResult> => {
      try {
        const path = (await import('path')).default;
        const fs = (await import('fs')).default;
        const target = path.isAbsolute(params.filePath) ? params.filePath : path.resolve(process.cwd(), params.filePath);
        if (!fs.existsSync(target)) return { error: `File not found: ${params.filePath}` };
        const content = fs.readFileSync(target, 'utf-8');
        const replaced = content.split(params.oldStr).join(params.newStr);
        fs.writeFileSync(target, replaced, 'utf-8');
        const delta = replaced.length - content.length;
        const memory = `Replaced in ${params.filePath} (Δ=${delta} bytes)`;
        return { extractedContent: memory, longTermMemory: memory };
      } catch (error: any) {
        return { error: `replace_file failed: ${error.message}` };
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

  registry.register({
    name: 'done_structured',
    description: 'Complete task with structured output payload',
    paramModel: DoneStructuredAction,
    handler: async (params: DoneStructuredAction): Promise<ActionResult> => {
      const success = params.success !== false;
      const text = params.text || 'Task completed';
      let payload: any = params.data;
      try {
        // Ensure serializable
        JSON.stringify(payload);
      } catch {
        payload = String(payload);
      }
      const summary = `Task completed: ${success} - ${text}`;
      const extracted = typeof payload === 'string' ? payload : JSON.stringify(payload);
      return {
        extractedContent: extracted,
        longTermMemory: summary,
        includeExtractedContentOnlyOnce: true,
      };
    },
  });
}
