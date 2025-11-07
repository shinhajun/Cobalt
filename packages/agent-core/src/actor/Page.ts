import { Page as PlaywrightPage } from 'playwright';
import { BrowserSession, TargetID, SessionID } from '../browser/BrowserSession.js';
import { Element } from './Element.js';
import { Mouse } from './Mouse.js';
import { debug } from '../utils/logger.js';
import { LLMService } from '../llmService.js';

/**
 * Page class for page-level operations
 *
 * Based on browser-use's Page class
 */
export class Page {
  private browserSession: BrowserSession;
  private targetId: TargetID;
  private sessionId: SessionID | null;
  private _mouse: Mouse | null = null;
  private llm: LLMService | null = null;

  constructor(browserSession: BrowserSession, targetId: TargetID, sessionId: SessionID | null = null, llm: LLMService | null = null) {
    this.browserSession = browserSession;
    this.targetId = targetId;
    this.sessionId = sessionId;
    this.llm = llm;
  }

  /**
   * Ensure we have a session ID for this target
   */
  private async ensureSession(): Promise<SessionID> {
    if (!this.sessionId) {
      const sessionInfo = await this.browserSession.getOrCreateCDPSession(this.targetId, true);
      this.sessionId = sessionInfo.sessionId;

      // Enable necessary domains
      const cdpSession = sessionInfo.cdpSession;
      await Promise.all([
        (cdpSession as any).send('Page.enable'),
        (cdpSession as any).send('DOM.enable'),
        (cdpSession as any).send('Runtime.enable'),
        (cdpSession as any).send('Network.enable'),
      ]);
    }

    return this.sessionId;
  }

  /**
   * Get the mouse interface for this target
   */
  async getMouse(): Promise<Mouse> {
    if (!this._mouse) {
      const sessionId = await this.ensureSession();
      this._mouse = new Mouse(this.browserSession, sessionId, this.targetId);
    }
    return this._mouse;
  }

  /**
   * Reload the target
   */
  async reload(): Promise<void> {
    const sessionId = await this.ensureSession();
    const sessionInfo = await this.browserSession.getOrCreateCDPSession(this.targetId, false);
    await (sessionInfo.cdpSession as any).send('Page.reload');
  }

  /**
   * Get an element by its backend node ID
   */
  async getElement(backendNodeId: number): Promise<Element> {
    const sessionId = await this.ensureSession();
    return new Element(this.browserSession, backendNodeId, sessionId);
  }

  /**
   * Execute JavaScript in the target
   *
   * @param pageFunction - JavaScript code in arrow function format: (...args) => {...}
   * @param args - Arguments to pass to the function
   * @returns String representation of the result
   */
  async evaluate(pageFunction: string, ...args: any[]): Promise<string> {
    const sessionId = await this.ensureSession();
    const sessionInfo = await this.browserSession.getOrCreateCDPSession(this.targetId, false);

    // Clean and fix common JavaScript string parsing issues
    pageFunction = this.fixJavaScriptString(pageFunction);

    // Enforce arrow function format
    if (!(pageFunction.startsWith('(') && pageFunction.includes('=>'))) {
      throw new Error(`JavaScript code must start with (...args) => format. Got: ${pageFunction.substring(0, 50)}...`);
    }

    // Build the expression - call the arrow function with provided args
    let expression: string;
    if (args.length > 0) {
      // Convert args to JSON representation for safe passing
      const argStrs = args.map((arg) => JSON.stringify(arg));
      expression = `(${pageFunction})(${argStrs.join(', ')})`;
    } else {
      expression = `(${pageFunction})()`;
    }

    debug(`[Page] Evaluating JavaScript: ${expression.substring(0, 100)}...`);

    const result = await (sessionInfo.cdpSession as any).send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });

    if (result.exceptionDetails) {
      throw new Error(`JavaScript evaluation failed: ${JSON.stringify(result.exceptionDetails)}`);
    }

    const value = result.result?.value;

    // Always return string representation
    if (value === null || value === undefined) {
      return '';
    } else if (typeof value === 'string') {
      return value;
    } else {
      // Convert objects, numbers, booleans to string
      try {
        return typeof value === 'object' ? JSON.stringify(value) : String(value);
      } catch (error) {
        return String(value);
      }
    }
  }

  /**
   * Fix common JavaScript string parsing issues
   */
  private fixJavaScriptString(jsCode: string): string {
    // Just do minimal, safe cleaning
    jsCode = jsCode.trim();

    // Only fix the most common and safe issues:

    // 1. Remove obvious Python/string wrapper quotes if they exist
    if ((jsCode.startsWith('"') && jsCode.endsWith('"')) || (jsCode.startsWith("'") && jsCode.endsWith("'"))) {
      const inner = jsCode.substring(1, jsCode.length - 1);
      if (inner.includes('() =>')) {
        jsCode = inner;
      }
    }

    // 2. Only fix clearly escaped quotes that shouldn't be
    if (jsCode.includes('\\"') && jsCode.split('\\"').length > jsCode.split('"').length) {
      jsCode = jsCode.replace(/\\"/g, '"');
    }
    if (jsCode.includes("\\'") && jsCode.split("\\'").length > jsCode.split("'").length) {
      jsCode = jsCode.replace(/\\'/g, "'");
    }

    // Final validation
    if (!jsCode) {
      throw new Error('JavaScript code is empty after cleaning');
    }

    return jsCode;
  }

  /**
   * Take a screenshot and return base64 encoded image
   */
  async screenshot(format: 'jpeg' | 'png' | 'webp' = 'jpeg', quality?: number): Promise<string> {
    const sessionId = await this.ensureSession();
    const sessionInfo = await this.browserSession.getOrCreateCDPSession(this.targetId, false);

    const params: any = { format };

    if (quality !== undefined && format === 'jpeg') {
      params.quality = quality;
    }

    const result = await (sessionInfo.cdpSession as any).send('Page.captureScreenshot', params);

    return result.data;
  }

  /**
   * Press a key on the page
   */
  async press(key: string): Promise<void> {
    const sessionId = await this.ensureSession();
    const sessionInfo = await this.browserSession.getOrCreateCDPSession(this.targetId, false);

    // Handle key combinations like "Control+A"
    if (key.includes('+')) {
      const parts = key.split('+');
      const modifiers = parts.slice(0, -1);
      const mainKey = parts[parts.length - 1];

      // Calculate modifier bitmask
      let modifierValue = 0;
      const modifierMap: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
      for (const mod of modifiers) {
        modifierValue |= modifierMap[mod] || 0;
      }

      // Press modifier keys
      for (const mod of modifiers) {
        const { code, vkCode } = this.getKeyInfo(mod);
        const params: any = { type: 'keyDown', key: mod, code };
        if (vkCode !== null) {
          params.windowsVirtualKeyCode = vkCode;
        }
        await (sessionInfo.cdpSession as any).send('Input.dispatchKeyEvent', params);
      }

      // Press main key with modifiers
      const { code: mainCode, vkCode: mainVkCode } = this.getKeyInfo(mainKey);
      const mainDownParams: any = {
        type: 'keyDown',
        key: mainKey,
        code: mainCode,
        modifiers: modifierValue,
      };
      if (mainVkCode !== null) {
        mainDownParams.windowsVirtualKeyCode = mainVkCode;
      }
      await (sessionInfo.cdpSession as any).send('Input.dispatchKeyEvent', mainDownParams);

      const mainUpParams: any = {
        type: 'keyUp',
        key: mainKey,
        code: mainCode,
        modifiers: modifierValue,
      };
      if (mainVkCode !== null) {
        mainUpParams.windowsVirtualKeyCode = mainVkCode;
      }
      await (sessionInfo.cdpSession as any).send('Input.dispatchKeyEvent', mainUpParams);

      // Release modifier keys
      for (const mod of modifiers.reverse()) {
        const { code, vkCode } = this.getKeyInfo(mod);
        const params: any = { type: 'keyUp', key: mod, code };
        if (vkCode !== null) {
          params.windowsVirtualKeyCode = vkCode;
        }
        await (sessionInfo.cdpSession as any).send('Input.dispatchKeyEvent', params);
      }
    } else {
      // Simple key press
      const { code, vkCode } = this.getKeyInfo(key);
      const keyDownParams: any = { type: 'keyDown', key, code };
      if (vkCode !== null) {
        keyDownParams.windowsVirtualKeyCode = vkCode;
      }
      await (sessionInfo.cdpSession as any).send('Input.dispatchKeyEvent', keyDownParams);

      const keyUpParams: any = { type: 'keyUp', key, code };
      if (vkCode !== null) {
        keyUpParams.windowsVirtualKeyCode = vkCode;
      }
      await (sessionInfo.cdpSession as any).send('Input.dispatchKeyEvent', keyUpParams);
    }
  }

  /**
   * Set the viewport size
   */
  async setViewportSize(width: number, height: number): Promise<void> {
    const sessionId = await this.ensureSession();
    const sessionInfo = await this.browserSession.getOrCreateCDPSession(this.targetId, false);

    await (sessionInfo.cdpSession as any).send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1.0,
      mobile: false,
    });
  }

  /**
   * Get the current URL
   */
  async getUrl(): Promise<string> {
    const page = this.getPlaywrightPage();
    return page.url();
  }

  /**
   * Get the current title
   */
  async getTitle(): Promise<string> {
    const page = this.getPlaywrightPage();
    return await page.title();
  }

  /**
   * Navigate this target to a URL
   */
  async goto(url: string): Promise<void> {
    // Use CDP Page.navigate instead of Playwright's page.goto()
    // This avoids HTTP/2 protocol errors on sites like Coupang
    const sessionId = await this.ensureSession();
    const sessionInfo = await this.browserSession.getOrCreateCDPSession(this.targetId, false);

    await (sessionInfo.cdpSession as any).send('Page.navigate', {
      url: url,
      transitionType: 'typed',
    });

    // Wait a bit for navigation to start
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  /**
   * Alias for goto
   */
  async navigate(url: string): Promise<void> {
    await this.goto(url);
  }

  /**
   * Navigate back in history
   */
  async goBack(): Promise<void> {
    const sessionId = await this.ensureSession();
    const sessionInfo = await this.browserSession.getOrCreateCDPSession(this.targetId, false);

    try {
      // Get navigation history
      const history = await (sessionInfo.cdpSession as any).send('Page.getNavigationHistory');
      const currentIndex = history.currentIndex;
      const entries = history.entries;

      // Check if we can go back
      if (currentIndex <= 0) {
        throw new Error('Cannot go back - no previous entry in history');
      }

      // Navigate to the previous entry
      const previousEntryId = entries[currentIndex - 1].id;
      await (sessionInfo.cdpSession as any).send('Page.navigateToHistoryEntry', {
        entryId: previousEntryId,
      });
    } catch (error: any) {
      throw new Error(`Failed to navigate back: ${error.message}`);
    }
  }

  /**
   * Navigate forward in history
   */
  async goForward(): Promise<void> {
    const sessionId = await this.ensureSession();
    const sessionInfo = await this.browserSession.getOrCreateCDPSession(this.targetId, false);

    try {
      // Get navigation history
      const history = await (sessionInfo.cdpSession as any).send('Page.getNavigationHistory');
      const currentIndex = history.currentIndex;
      const entries = history.entries;

      // Check if we can go forward
      if (currentIndex >= entries.length - 1) {
        throw new Error('Cannot go forward - no next entry in history');
      }

      // Navigate to the next entry
      const nextEntryId = entries[currentIndex + 1].id;
      await (sessionInfo.cdpSession as any).send('Page.navigateToHistoryEntry', {
        entryId: nextEntryId,
      });
    } catch (error: any) {
      throw new Error(`Failed to navigate forward: ${error.message}`);
    }
  }

  /**
   * Get key info for a character
   */
  private getKeyInfo(key: string): { code: string; vkCode: number | null } {
    // Common key mappings
    const keyMap: Record<string, { code: string; vkCode: number }> = {
      Enter: { code: 'Enter', vkCode: 13 },
      Tab: { code: 'Tab', vkCode: 9 },
      Backspace: { code: 'Backspace', vkCode: 8 },
      Delete: { code: 'Delete', vkCode: 46 },
      Escape: { code: 'Escape', vkCode: 27 },
      ArrowLeft: { code: 'ArrowLeft', vkCode: 37 },
      ArrowUp: { code: 'ArrowUp', vkCode: 38 },
      ArrowRight: { code: 'ArrowRight', vkCode: 39 },
      ArrowDown: { code: 'ArrowDown', vkCode: 40 },
      Home: { code: 'Home', vkCode: 36 },
      End: { code: 'End', vkCode: 35 },
      PageUp: { code: 'PageUp', vkCode: 33 },
      PageDown: { code: 'PageDown', vkCode: 34 },
      ' ': { code: 'Space', vkCode: 32 },
      Alt: { code: 'AltLeft', vkCode: 18 },
      Control: { code: 'ControlLeft', vkCode: 17 },
      Meta: { code: 'MetaLeft', vkCode: 91 },
      Shift: { code: 'ShiftLeft', vkCode: 16 },
    };

    if (keyMap[key]) {
      return keyMap[key];
    } else if (key.match(/^[a-zA-Z]$/)) {
      const code = `Key${key.toUpperCase()}`;
      const vkCode = key.toUpperCase().charCodeAt(0);
      return { code, vkCode };
    } else if (key.match(/^[0-9]$/)) {
      const code = `Digit${key}`;
      const vkCode = key.charCodeAt(0);
      return { code, vkCode };
    } else {
      return { code: 'Unidentified', vkCode: null };
    }
  }

  /**
   * Get an element by a natural language prompt using LLM
   *
   * Example:
   *   const submitButton = await page.getElementByPrompt("the submit button");
   *   await submitButton.click();
   *
   * @param prompt - Natural language description of the element to find
   * @param llm - Optional LLM service (uses constructor LLM if not provided)
   * @returns Element instance or null if not found
   */
  async getElementByPrompt(prompt: string, llm?: LLMService): Promise<Element | null> {
    const useLLM = llm || this.llm;

    if (!useLLM) {
      throw new Error('LLM not provided. Pass an LLM to the Page constructor or to this method.');
    }

    // Get DOM state with element indexes
    const browserController = (this.browserSession as any).browserController;
    if (!browserController) {
      throw new Error('BrowserController not available');
    }

    const browserState = await browserController.getBrowserState(false, true);

    if (!browserState.llmRepresentation) {
      throw new Error('DOM state not available');
    }

    // Create system message
    const systemPrompt = `You are an AI created to find an element on a page by a prompt.

<browser_state>
Interactive Elements: All interactive elements will be provided in format as [index]<type>text</type> where
- index: Numeric identifier for interaction
- type: HTML element type (button, input, etc.)
- text: Element description

Examples:
[33]<div>User form</div>
[35]<button aria-label='Submit form'>Submit</button>

Note that:
- Only elements with numeric indexes in [] are interactive
- (stacked) indentation (with \\t) is important and means that the element is a (html) child of the element above (with a lower index)
- Pure text elements without [] are not interactive.
</browser_state>

Your task is to find an element index (if any) that matches the prompt (written in <prompt> tag).

If none of the elements matches, return null in the element_index field.

Before you return the element index, reason about the state and elements for a sentence or two in the thinking field.

RESPONSE FORMAT (JSON):
{
  "thinking": "The user wants to find the submit button. Looking at the elements, index 35 is a button with aria-label 'Submit form' which matches.",
  "element_index": 35
}`;

    const userMessage = `<browser_state>
${browserState.llmRepresentation}
</browser_state>

<prompt>
${prompt}
</prompt>`;

    // Call LLM
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];

    const response = await useLLM.chatWithTools(messages, []);
    const responseText = response.content || '';

    // Parse response
    let elementIndex: number | null = null;
    try {
      // Try to extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*"element_index"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        elementIndex = parsed.element_index;
      }
    } catch (error) {
      debug('[Page] Failed to parse LLM response for element finding');
      return null;
    }

    // Check if element exists
    if (elementIndex === null || elementIndex === undefined) {
      return null;
    }

    const elementData = browserState.selectorMap[elementIndex];
    if (!elementData || !elementData.backendNodeId) {
      return null;
    }

    // Return Element instance
    const sessionId = await this.ensureSession();
    return new Element(this.browserSession, elementData.backendNodeId, sessionId);
  }

  /**
   * Get an element by prompt or throw error if not found
   *
   * @param prompt - Natural language description of the element
   * @param llm - Optional LLM service
   * @returns Element instance
   * @throws Error if element not found
   */
  async mustGetElementByPrompt(prompt: string, llm?: LLMService): Promise<Element> {
    const element = await this.getElementByPrompt(prompt, llm);
    if (!element) {
      throw new Error(`No element found for prompt: ${prompt}`);
    }
    return element;
  }

  /**
   * Get the Playwright Page instance
   */
  private getPlaywrightPage(): PlaywrightPage {
    if (!this.browserSession.currentPage) {
      throw new Error('No active page in browser session');
    }
    return this.browserSession.currentPage;
  }
}
