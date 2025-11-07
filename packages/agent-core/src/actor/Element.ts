import { CDPSession, Page } from 'playwright';
import { BrowserSession, TargetID, SessionID } from '../browser/BrowserSession.js';
import { debug, warn, error } from '../utils/logger.js';

/**
 * Mouse button type
 */
export type MouseButton = 'left' | 'right' | 'middle';

/**
 * Modifier keys
 */
export type ModifierType = 'Alt' | 'Control' | 'Meta' | 'Shift';

/**
 * 2D Position
 */
export interface Position {
  x: number;
  y: number;
}

/**
 * Bounding box with position and dimensions
 */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Element information
 */
export interface ElementInfo {
  backendNodeId: number;
  nodeId: number | null;
  nodeName: string;
  nodeType: number;
  nodeValue: string | null;
  attributes: Record<string, string>;
  boundingBox: BoundingBox | null;
  error: string | null;
}

/**
 * Element class for advanced browser interactions
 *
 * Implements browser-use style element operations with:
 * - Multi-strategy click with visibility checks
 * - Advanced fill with verification
 * - Automatic scrolling
 * - Fallback mechanisms
 *
 * Based on browser_use/actor/element.py
 */
export class Element {
  private browserSession: BrowserSession;
  private backendNodeId: number;
  private sessionId: SessionID | null;
  private cdpSession: CDPSession | null = null;

  constructor(
    browserSession: BrowserSession,
    backendNodeId: number,
    sessionId?: SessionID | null
  ) {
    this.browserSession = browserSession;
    this.backendNodeId = backendNodeId;
    this.sessionId = sessionId || null;
  }

  /**
   * Initialize CDP session if not already done
   */
  private async ensureCDPSession(): Promise<CDPSession> {
    if (!this.cdpSession) {
      const sessionInfo = await this.browserSession.getOrCreateCDPSession(
        undefined,
        false
      );
      this.cdpSession = sessionInfo.cdpSession;
    }
    return this.cdpSession;
  }

  /**
   * Get page from browser session
   */
  private getPage(): Page {
    const page = this.browserSession.page;
    if (!page) {
      throw new Error('No active page in browser session');
    }
    return page;
  }

  /**
   * Advanced click implementation with visibility checks and fallbacks
   *
   * Strategy:
   * 1. Get viewport dimensions
   * 2. Try multiple methods to get element geometry (getContentQuads, getBoxModel, JS)
   * 3. Find largest visible quad within viewport
   * 4. Scroll element into view if needed
   * 5. Click at center of visible quad
   * 6. Fallback to JavaScript click if CDP fails
   *
   * Based on browser_use/actor/element.py:93-351
   */
  async click(
    button: MouseButton = 'left',
    clickCount: number = 1,
    modifiers?: ModifierType[]
  ): Promise<void> {
    const cdpSession = await this.ensureCDPSession();
    const page = this.getPage();

    try {
      // Get viewport dimensions for visibility checks
      const layoutMetrics = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth || window.innerWidth,
        clientHeight: document.documentElement.clientHeight || window.innerHeight,
      }));
      const viewportWidth = layoutMetrics.clientWidth;
      const viewportHeight = layoutMetrics.clientHeight;

      // Try multiple methods to get element geometry
      let quads: number[][] = [];

      // Method 1: Try DOM.getContentQuads first (best for inline elements)
      try {
        const contentQuadsResult = await (cdpSession as any).send('DOM.getContentQuads', {
          backendNodeId: this.backendNodeId,
        });
        if (contentQuadsResult && contentQuadsResult.quads && contentQuadsResult.quads.length > 0) {
          quads = contentQuadsResult.quads;
        }
      } catch (error) {
        // Method 1 failed, continue to Method 2
      }

      // Method 2: Fall back to DOM.getBoxModel
      if (quads.length === 0) {
        try {
          const boxModel = await (cdpSession as any).send('DOM.getBoxModel', {
            backendNodeId: this.backendNodeId,
          });
          if (boxModel && boxModel.model && boxModel.model.content) {
            const content = boxModel.model.content;
            if (content.length >= 8) {
              // Convert box model format to quad format
              quads = [[
                content[0], content[1], // x1, y1
                content[2], content[3], // x2, y2
                content[4], content[5], // x3, y3
                content[6], content[7], // x4, y4
              ]];
            }
          }
        } catch (error) {
          // Method 2 failed, continue to Method 3
        }
      }

      // Method 3: Fall back to JavaScript getBoundingClientRect
      if (quads.length === 0) {
        try {
          const resolveResult = await (cdpSession as any).send('DOM.resolveNode', {
            backendNodeId: this.backendNodeId,
          });
          if (resolveResult && resolveResult.object && resolveResult.object.objectId) {
            const objectId = resolveResult.object.objectId;

            // Get bounding rect via JavaScript
            const boundsResult = await (cdpSession as any).send('Runtime.callFunctionOn', {
              functionDeclaration: `
                function() {
                  const rect = this.getBoundingClientRect();
                  return {
                    x: rect.left,
                    y: rect.top,
                    width: rect.width,
                    height: rect.height
                  };
                }
              `,
              objectId,
              returnByValue: true,
            });

            if (boundsResult && boundsResult.result && boundsResult.result.value) {
              const rect = boundsResult.result.value;
              const x = rect.x;
              const y = rect.y;
              const w = rect.width;
              const h = rect.height;
              quads = [[
                x, y,           // top-left
                x + w, y,       // top-right
                x + w, y + h,   // bottom-right
                x, y + h,       // bottom-left
              ]];
            }
          }
        } catch (error) {
          // Method 3 failed, no quads available
        }
      }

      // If we still don't have quads, fall back to JS click
      if (quads.length === 0) {
        debug('[Element] No quads found, falling back to JavaScript click');
        await this.clickViaJavaScript();
        return;
      }

      // Find the largest visible quad within the viewport
      let bestQuad: number[] | null = null;
      let bestArea = 0;

      for (const quad of quads) {
        if (quad.length < 8) continue;

        // Calculate quad bounds
        const xs = [quad[0], quad[2], quad[4], quad[6]];
        const ys = [quad[1], quad[3], quad[5], quad[7]];
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);

        // Check if quad intersects with viewport
        if (maxX < 0 || maxY < 0 || minX > viewportWidth || minY > viewportHeight) {
          continue; // Quad is completely outside viewport
        }

        // Calculate visible area (intersection with viewport)
        const visibleMinX = Math.max(0, minX);
        const visibleMaxX = Math.min(viewportWidth, maxX);
        const visibleMinY = Math.max(0, minY);
        const visibleMaxY = Math.min(viewportHeight, maxY);

        const visibleWidth = visibleMaxX - visibleMinX;
        const visibleHeight = visibleMaxY - visibleMinY;
        const visibleArea = visibleWidth * visibleHeight;

        if (visibleArea > bestArea) {
          bestArea = visibleArea;
          bestQuad = quad;
        }
      }

      if (!bestQuad) {
        // No visible quad found, use the first quad anyway
        bestQuad = quads[0];
      }

      // Calculate center point of the best quad
      const centerX = (bestQuad[0] + bestQuad[2] + bestQuad[4] + bestQuad[6]) / 4;
      const centerY = (bestQuad[1] + bestQuad[3] + bestQuad[5] + bestQuad[7]) / 4;

      // Ensure click point is within viewport bounds
      const clampedX = Math.max(0, Math.min(viewportWidth - 1, centerX));
      const clampedY = Math.max(0, Math.min(viewportHeight - 1, centerY));

      // Scroll element into view
      try {
        await (cdpSession as any).send('DOM.scrollIntoViewIfNeeded', {
          backendNodeId: this.backendNodeId,
        });
        await page.waitForTimeout(50); // Wait for scroll to complete
      } catch (error) {
        // Scroll failed, continue anyway
      }

      // Calculate modifier bitmask for CDP
      let modifierValue = 0;
      if (modifiers && modifiers.length > 0) {
        const modifierMap: Record<ModifierType, number> = {
          'Alt': 1,
          'Control': 2,
          'Meta': 4,
          'Shift': 8,
        };
        for (const mod of modifiers) {
          modifierValue |= modifierMap[mod] || 0;
        }
      }

      // Perform the click using CDP
      try {
        // Move mouse to element
        await (cdpSession as any).send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: clampedX,
          y: clampedY,
        });
        await page.waitForTimeout(50);

        // Mouse down
        await (cdpSession as any).send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: clampedX,
          y: clampedY,
          button,
          clickCount,
          modifiers: modifierValue,
        });
        await page.waitForTimeout(80);

        // Mouse up
        await (cdpSession as any).send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: clampedX,
          y: clampedY,
          button,
          clickCount,
          modifiers: modifierValue,
        });

        debug(`[Element] Clicked at (${clampedX.toFixed(1)}, ${clampedY.toFixed(1)})`);
      } catch (error) {
        // Fall back to JavaScript click
        debug('[Element] CDP click failed, falling back to JavaScript click');
        await this.clickViaJavaScript();
      }
    } catch (error: any) {
      throw new Error(`Failed to click element: ${error.message}`);
    }
  }

  /**
   * Click via JavaScript as fallback
   */
  private async clickViaJavaScript(): Promise<void> {
    const cdpSession = await this.ensureCDPSession();
    const page = this.getPage();

    try {
      const resolveResult = await (cdpSession as any).send('DOM.resolveNode', {
        backendNodeId: this.backendNodeId,
      });
      if (!resolveResult || !resolveResult.object || !resolveResult.object.objectId) {
        throw new Error('Failed to resolve element');
      }
      const objectId = resolveResult.object.objectId;

      await (cdpSession as any).send('Runtime.callFunctionOn', {
        functionDeclaration: 'function() { this.click(); }',
        objectId,
      });
      await page.waitForTimeout(50);
    } catch (error: any) {
      throw new Error(`JavaScript click failed: ${error.message}`);
    }
  }

  /**
   * Advanced fill implementation with verification and fallbacks
   *
   * Strategy:
   * 1. Scroll element into view
   * 2. Get element coordinates
   * 3. Focus element (3-tier fallback: CDP focus, JS focus, click)
   * 4. Clear text (2-tier fallback: JS clear with verification, triple-click + delete)
   * 5. Type text character by character with human-like delays
   *
   * Based on browser_use/actor/element.py:353-507
   */
  async fill(value: string, clear: boolean = true): Promise<void> {
    const cdpSession = await this.ensureCDPSession();
    const page = this.getPage();

    try {
      // Scroll element into view
      try {
        await (cdpSession as any).send('DOM.scrollIntoViewIfNeeded', {
          backendNodeId: this.backendNodeId,
        });
        await page.waitForTimeout(10);
      } catch (error) {
        warn('[Element] Failed to scroll element into view:', error);
      }

      // Get object ID for the element
      const resolveResult = await (cdpSession as any).send('DOM.resolveNode', {
        backendNodeId: this.backendNodeId,
      });
      if (!resolveResult || !resolveResult.object || !resolveResult.object.objectId) {
        throw new Error('Failed to get object ID for element');
      }
      const objectId = resolveResult.object.objectId;

      // Get element coordinates for focus
      let inputCoordinates: Position | null = null;
      try {
        const boundsResult = await (cdpSession as any).send('Runtime.callFunctionOn', {
          functionDeclaration: 'function() { return this.getBoundingClientRect(); }',
          objectId,
          returnByValue: true,
        });
        if (boundsResult && boundsResult.result && boundsResult.result.value) {
          const bounds = boundsResult.result.value;
          inputCoordinates = {
            x: bounds.x + bounds.width / 2,
            y: bounds.y + bounds.height / 2,
          };
        }
      } catch (error) {
        warn('[Element] Could not get element coordinates:', error);
      }

      // Step 1: Focus the element (3-tier fallback)
      await this.focusElement(objectId, inputCoordinates);

      // Step 2: Clear existing text if requested
      if (clear) {
        const cleared = await this.clearTextField(objectId, inputCoordinates);
        if (!cleared) {
          warn('[Element] Text field clearing failed, typing may append to existing text');
        }
      }

      // Step 3: Type the text character by character with human-like delays
      debug(`[Element] Typing text character by character: "${value}"`);

      for (const char of value) {
        if (char === '\n') {
          // Send Enter key
          await (cdpSession as any).send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: 'Enter',
            code: 'Enter',
            windowsVirtualKeyCode: 13,
          });
          await page.waitForTimeout(1);

          await (cdpSession as any).send('Input.dispatchKeyEvent', {
            type: 'char',
            text: '\r',
            key: 'Enter',
          });

          await (cdpSession as any).send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'Enter',
            code: 'Enter',
            windowsVirtualKeyCode: 13,
          });
        } else {
          // Handle regular characters
          const { modifiers, vkCode, baseKey } = this.getCharModifiersAndVK(char);
          const keyCode = this.getKeyCodeForChar(baseKey);

          // keyDown
          await (cdpSession as any).send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: baseKey,
            code: keyCode,
            modifiers,
            windowsVirtualKeyCode: vkCode,
          });
          await page.waitForTimeout(1);

          // char event (this actually inputs the character)
          await (cdpSession as any).send('Input.dispatchKeyEvent', {
            type: 'char',
            text: char,
            key: char,
          });

          // keyUp
          await (cdpSession as any).send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: baseKey,
            code: keyCode,
            modifiers,
            windowsVirtualKeyCode: vkCode,
          });
        }

        // 18ms delay between keystrokes (human-like, browser-use standard)
        await page.waitForTimeout(18);
      }
    } catch (error: any) {
      throw new Error(`Failed to fill element: ${error.message}`);
    }
  }

  /**
   * Focus element with 3-tier fallback strategy
   */
  private async focusElement(objectId: string, coordinates: Position | null): Promise<boolean> {
    const cdpSession = await this.ensureCDPSession();
    const page = this.getPage();

    // Strategy 1: CDP focus (most reliable)
    try {
      debug('[Element] Focusing element using CDP focus');
      await (cdpSession as any).send('DOM.focus', {
        backendNodeId: this.backendNodeId,
      });
      debug('[Element] Element focused successfully using CDP focus');
      return true;
    } catch (error) {
      debug('[Element] CDP focus failed, trying JavaScript focus');
    }

    // Strategy 2: JavaScript focus (fallback)
    try {
      debug('[Element] Focusing element using JavaScript focus');
      await (cdpSession as any).send('Runtime.callFunctionOn', {
        functionDeclaration: 'function() { this.focus(); }',
        objectId,
      });
      debug('[Element] Element focused successfully using JavaScript');
      return true;
    } catch (error) {
      debug('[Element] JavaScript focus failed, trying click focus');
    }

    // Strategy 3: Click to focus (last resort)
    if (coordinates) {
      try {
        debug(`[Element] Focusing element by clicking at coordinates: (${coordinates.x}, ${coordinates.y})`);
        await (cdpSession as any).send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: coordinates.x,
          y: coordinates.y,
          button: 'left',
          clickCount: 1,
        });
        await (cdpSession as any).send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: coordinates.x,
          y: coordinates.y,
          button: 'left',
          clickCount: 1,
        });
        debug('[Element] Element focused using click');
        return true;
      } catch (error) {
        warn('[Element] Click focus failed:', error);
      }
    }

    return false;
  }

  /**
   * Clear text field with verification and fallback
   */
  private async clearTextField(objectId: string, coordinates: Position | null): Promise<boolean> {
    const cdpSession = await this.ensureCDPSession();
    const page = this.getPage();

    // Strategy 1: Direct JavaScript value setting (most reliable)
    try {
      debug('[Element] Clearing text field using JavaScript value setting');

      await (cdpSession as any).send('Runtime.callFunctionOn', {
        functionDeclaration: `
          function() {
            try { this.select(); } catch (e) {}
            this.value = "";
            this.dispatchEvent(new Event("input", { bubbles: true }));
            this.dispatchEvent(new Event("change", { bubbles: true }));
            return this.value;
          }
        `,
        objectId,
        returnByValue: true,
      });

      // Verify clearing worked
      const verifyResult = await (cdpSession as any).send('Runtime.callFunctionOn', {
        functionDeclaration: 'function() { return this.value; }',
        objectId,
        returnByValue: true,
      });

      const currentValue = verifyResult?.result?.value || '';
      if (!currentValue) {
        debug('[Element] Text field cleared successfully using JavaScript');
        return true;
      } else {
        debug(`[Element] JavaScript clear partially failed, field still contains: "${currentValue}"`);
      }
    } catch (error) {
      debug('[Element] JavaScript clear failed:', error);
    }

    // Strategy 2: Triple-click + Delete (fallback)
    if (coordinates) {
      try {
        debug('[Element] Fallback: Clearing using triple-click + Delete');

        // Triple-click to select all text
        await (cdpSession as any).send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: coordinates.x,
          y: coordinates.y,
          button: 'left',
          clickCount: 3,
        });
        await (cdpSession as any).send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: coordinates.x,
          y: coordinates.y,
          button: 'left',
          clickCount: 3,
        });

        // Delete selected text
        await (cdpSession as any).send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'Delete',
          code: 'Delete',
        });
        await (cdpSession as any).send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Delete',
          code: 'Delete',
        });

        debug('[Element] Text field cleared using triple-click + Delete');
        return true;
      } catch (error) {
        debug('[Element] Triple-click clear failed:', error);
      }
    }

    return false;
  }

  /**
   * Get modifiers, virtual key code, and base key for a character
   */
  private getCharModifiersAndVK(char: string): { modifiers: number; vkCode: number; baseKey: string } {
    // Characters that require Shift modifier
    const shiftChars: Record<string, [string, number]> = {
      '!': ['1', 49], '@': ['2', 50], '#': ['3', 51], '$': ['4', 52],
      '%': ['5', 53], '^': ['6', 54], '&': ['7', 55], '*': ['8', 56],
      '(': ['9', 57], ')': ['0', 48], '_': ['-', 189], '+': ['=', 187],
      '{': ['[', 219], '}': [']', 221], '|': ['\\', 220], ':': [';', 186],
      '"': ["'", 222], '<': [',', 188], '>': ['.', 190], '?': ['/', 191],
      '~': ['`', 192],
    };

    // Check if character requires Shift
    if (char in shiftChars) {
      const [baseKey, vkCode] = shiftChars[char];
      return { modifiers: 8, vkCode, baseKey }; // Shift=8
    }

    // Uppercase letters require Shift
    if (char.match(/[A-Z]/)) {
      return { modifiers: 8, vkCode: char.charCodeAt(0), baseKey: char.toLowerCase() };
    }

    // Lowercase letters
    if (char.match(/[a-z]/)) {
      return { modifiers: 0, vkCode: char.toUpperCase().charCodeAt(0), baseKey: char };
    }

    // Numbers
    if (char.match(/[0-9]/)) {
      return { modifiers: 0, vkCode: char.charCodeAt(0), baseKey: char };
    }

    // Special characters without Shift
    const noShiftChars: Record<string, number> = {
      ' ': 32, '-': 189, '=': 187, '[': 219, ']': 221, '\\': 220,
      ';': 186, "'": 222, ',': 188, '.': 190, '/': 191, '`': 192,
    };

    if (char in noShiftChars) {
      return { modifiers: 0, vkCode: noShiftChars[char], baseKey: char };
    }

    // Fallback
    return {
      modifiers: 0,
      vkCode: char.match(/[a-zA-Z]/) ? char.toUpperCase().charCodeAt(0) : char.charCodeAt(0),
      baseKey: char,
    };
  }

  /**
   * Get the proper key code for a character
   */
  private getKeyCodeForChar(char: string): string {
    const keyCodes: Record<string, string> = {
      ' ': 'Space', '.': 'Period', ',': 'Comma', '-': 'Minus',
      '_': 'Minus', '@': 'Digit2', '!': 'Digit1', '?': 'Slash',
      ':': 'Semicolon', ';': 'Semicolon', '(': 'Digit9', ')': 'Digit0',
      '[': 'BracketLeft', ']': 'BracketRight', '{': 'BracketLeft', '}': 'BracketRight',
      '/': 'Slash', '\\': 'Backslash', '=': 'Equal', '+': 'Equal',
      '*': 'Digit8', '&': 'Digit7', '%': 'Digit5', '$': 'Digit4',
      '#': 'Digit3', '^': 'Digit6', '~': 'Backquote', '`': 'Backquote',
      '"': 'Quote', "'": 'Quote', '<': 'Comma', '>': 'Period', '|': 'Backslash',
    };

    if (char in keyCodes) {
      return keyCodes[char];
    } else if (char.match(/[a-zA-Z]/)) {
      return `Key${char.toUpperCase()}`;
    } else if (char.match(/[0-9]/)) {
      return `Digit${char}`;
    } else {
      return 'Unidentified';
    }
  }

  /**
   * Get bounding box of the element
   */
  async getBoundingBox(): Promise<BoundingBox | null> {
    const cdpSession = await this.ensureCDPSession();

    try {
      const boxModel = await (cdpSession as any).send('DOM.getBoxModel', {
        backendNodeId: this.backendNodeId,
      });

      if (!boxModel || !boxModel.model || !boxModel.model.content) {
        return null;
      }

      const content = boxModel.model.content;
      if (content.length < 8) {
        return null;
      }

      const xs = [content[0], content[2], content[4], content[6]];
      const ys = [content[1], content[3], content[5], content[7]];

      const x = Math.min(...xs);
      const y = Math.min(...ys);
      const width = Math.max(...xs) - x;
      const height = Math.max(...ys) - y;

      return { x, y, width, height };
    } catch (error) {
      return null;
    }
  }

  /**
   * Get basic element information
   */
  async getBasicInfo(): Promise<ElementInfo> {
    const cdpSession = await this.ensureCDPSession();

    try {
      const resolveResult = await (cdpSession as any).send('DOM.resolveNode', {
        backendNodeId: this.backendNodeId,
      });
      const nodeId = resolveResult?.object?.nodeId || null;

      const describeResult = await (cdpSession as any).send('DOM.describeNode', {
        backendNodeId: this.backendNodeId,
      });
      const nodeInfo = describeResult?.node || {};

      const boundingBox = await this.getBoundingBox();

      // Parse attributes
      const attributesList = nodeInfo.attributes || [];
      const attributes: Record<string, string> = {};
      for (let i = 0; i < attributesList.length; i += 2) {
        if (i + 1 < attributesList.length) {
          attributes[attributesList[i]] = attributesList[i + 1];
        }
      }

      return {
        backendNodeId: this.backendNodeId,
        nodeId,
        nodeName: nodeInfo.nodeName || '',
        nodeType: nodeInfo.nodeType || 0,
        nodeValue: nodeInfo.nodeValue || null,
        attributes,
        boundingBox,
        error: null,
      };
    } catch (error: any) {
      return {
        backendNodeId: this.backendNodeId,
        nodeId: null,
        nodeName: '',
        nodeType: 0,
        nodeValue: null,
        attributes: {},
        boundingBox: null,
        error: error.message,
      };
    }
  }
}
