// AIAgentBridge.js - Bridge between macro system and AI agent

const MacroToPrompt = require('./MacroToPrompt');

class AIAgentBridge {
  constructor(browserView, mainWindow, model = null) {
    this.browserView = browserView;
    this.mainWindow = mainWindow;
    this.llmService = null;
    this.model = model;
  }

  /**
   * Get LLM service instance
   */
  async getLLMService() {
    if (this.llmService) {
      return this.llmService;
    }

    const { LLMService } = require('../../packages/agent-core/dist/llmService');
    // Use provided model or fallback to claude-sonnet-4-5
    const modelToUse = this.model || 'claude-sonnet-4-5';
    console.log('[AIAgentBridge] Using model:', modelToUse);
    this.llmService = new LLMService(modelToUse);
    return this.llmService;
  }

  /**
   * Execute macro using AI agent
   * @param {Object} macro - Macro object
   * @returns {Promise<Object>} Execution result
   */
  async executeWithAI(macro) {
    console.log('[AIAgentBridge] Executing macro with AI:', macro.name);

    try {
      // 1. Convert macro to prompt
      const prompt = MacroToPrompt.convert(macro);
      console.log('[AIAgentBridge] Generated prompt:\n', prompt);

      // 2. Get LLM service
      const llm = await this.getLLMService();

      // 3. Build system prompt with browser tools
      const systemPrompt = this.buildSystemPrompt();

      // 4. Execute with AI
      const response = await llm.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ], {
        tools: this.getBrowserTools(),
        tool_choice: 'auto',
        max_tokens: 4000
      });

      console.log('[AIAgentBridge] AI response:', response);

      // 5. Parse and execute tool calls
      const result = await this.executeToolCalls(response);

      return {
        success: true,
        result
      };

    } catch (error) {
      console.error('[AIAgentBridge] AI execution failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Build system prompt for AI agent
   */
  buildSystemPrompt() {
    return `You are a browser automation assistant with access to browser control functions.

Your capabilities:
- navigate(url): Navigate to a URL
- click(selector, description): Click on an element
- type(selector, text, description): Type text into an input field
- press(key): Press a keyboard key
- wait(ms, condition): Wait for a condition

Instructions:
1. Execute each step carefully in order
2. If a selector doesn't work, try alternative selectors or describe the element
3. Report success/failure for each step
4. Handle errors gracefully
5. Be adaptive - if the page structure is different, adjust your approach

Execute the user's workflow step by step using the browser tools.`;
  }

  /**
   * Get browser control tool definitions
   */
  getBrowserTools() {
    return [
      {
        type: 'function',
        function: {
          name: 'navigate',
          description: 'Navigate to a URL in the browser',
          parameters: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'URL to navigate to'
              }
            },
            required: ['url']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'click',
          description: 'Click on an element in the page',
          parameters: {
            type: 'object',
            properties: {
              selector: {
                type: 'string',
                description: 'CSS selector for the element'
              },
              description: {
                type: 'string',
                description: 'Human-readable description of the element'
              }
            },
            required: ['selector']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'type',
          description: 'Type text into an input field',
          parameters: {
            type: 'object',
            properties: {
              selector: {
                type: 'string',
                description: 'CSS selector for the input field'
              },
              text: {
                type: 'string',
                description: 'Text to type'
              },
              description: {
                type: 'string',
                description: 'Human-readable description of the field'
              }
            },
            required: ['selector', 'text']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'press',
          description: 'Press a keyboard key',
          parameters: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: 'Key to press (e.g., Enter, Tab, Escape)'
              }
            },
            required: ['key']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'wait',
          description: 'Wait for a certain amount of time or condition',
          parameters: {
            type: 'object',
            properties: {
              ms: {
                type: 'number',
                description: 'Milliseconds to wait'
              },
              condition: {
                type: 'string',
                description: 'Condition to wait for (e.g., page-load, element-visible)'
              }
            },
            required: ['ms']
          }
        }
      }
    ];
  }

  /**
   * Execute tool calls from AI response
   */
  async executeToolCalls(response) {
    // This would parse the AI response and execute the browser actions
    // For now, we'll return a placeholder
    // In full implementation, this would:
    // 1. Parse tool_calls from response
    // 2. Execute each tool via browserView
    // 3. Return results

    console.log('[AIAgentBridge] Executing tool calls...');
    // TODO: Implement actual tool execution
    return {
      message: 'AI execution completed',
      toolCalls: []
    };
  }

  /**
   * Execute a single browser action
   */
  async executeBrowserAction(action, params) {
    if (!this.browserView || !this.browserView.webContents) {
      throw new Error('BrowserView not available');
    }

    console.log(`[AIAgentBridge] Executing ${action}:`, params);

    switch (action) {
      case 'navigate':
        await this.browserView.webContents.loadURL(params.url);
        await this.waitForPageLoad();
        break;

      case 'click':
        await this.browserView.webContents.executeJavaScript(`
          (function() {
            const element = document.querySelector('${params.selector}');
            if (element) {
              element.click();
              return { success: true };
            } else {
              return { success: false, error: 'Element not found' };
            }
          })();
        `);
        break;

      case 'type':
        await this.browserView.webContents.executeJavaScript(`
          (function() {
            const element = document.querySelector('${params.selector.replace(/'/g, "\\'")}');
            if (element) {
              element.focus();
              element.value = ${JSON.stringify(params.text)};
              element.dispatchEvent(new Event('input', { bubbles: true }));
              element.dispatchEvent(new Event('change', { bubbles: true }));
              return { success: true };
            } else {
              return { success: false, error: 'Element not found' };
            }
          })();
        `);
        break;

      case 'press':
        await this.browserView.webContents.sendInputEvent({
          type: 'keyDown',
          keyCode: params.key
        });
        await this.delay(50);
        await this.browserView.webContents.sendInputEvent({
          type: 'keyUp',
          keyCode: params.key
        });
        break;

      case 'wait':
        await this.delay(params.ms);
        break;

      default:
        console.warn('[AIAgentBridge] Unknown action:', action);
    }

    return { success: true };
  }

  /**
   * Wait for page to load
   */
  async waitForPageLoad(timeout = 30000) {
    if (!this.browserView || !this.browserView.webContents) {
      return;
    }

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve();
      }, timeout);

      const loadHandler = () => {
        clearTimeout(timeoutId);
        resolve();
      };

      this.browserView.webContents.once('did-finish-load', loadHandler);
    });
  }

  /**
   * Delay execution
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = AIAgentBridge;
