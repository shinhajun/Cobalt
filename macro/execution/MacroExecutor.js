// MacroExecutor.js - Executes macro steps in the browser

const EventEmitter = require('events');
const AIVariationEngine = require('./AIVariationEngine');

class MacroExecutor extends EventEmitter {
  constructor(browserView, mainWindow, llmService = null) {
    super();
    this.browserView = browserView;
    this.mainWindow = mainWindow;
    this.aiEngine = new AIVariationEngine(llmService);
    this.stopped = false;
  }

  /**
   * Execute a macro
   * @param {Object} macro - Macro object
   * @returns {Promise<Object>} Execution result
   */
  async execute(macro) {
    console.log('[MacroExecutor] Executing macro:', macro.name);
    console.log('[MacroExecutor] Total steps:', macro.steps.length);

    this.stopped = false;

    const result = {
      success: true,
      executedSteps: 0,
      errors: [],
      inputValues: {}
    };

    // Emit macro started event
    this.emit('macro-started', {
      name: macro.name,
      totalSteps: macro.steps.length,
      timestamp: Date.now()
    });

    try {
      for (let i = 0; i < macro.steps.length; i++) {
        if (this.stopped) {
          console.log('[MacroExecutor] Execution stopped by user');
          result.success = false;
          result.stopped = true;

          this.emit('macro-stopped', {
            reason: 'user',
            executedSteps: result.executedSteps,
            totalSteps: macro.steps.length
          });
          break;
        }

        const step = macro.steps[i];
        console.log(`[MacroExecutor] Executing step ${step.stepNumber}: ${step.type}`);

        // Emit step start event
        this.emit('step-start', {
          stepNumber: step.stepNumber,
          type: step.type,
          description: this.getStepDescription(step),
          progress: ((i / macro.steps.length) * 100).toFixed(1),
          timestamp: Date.now()
        });

        // Capture screenshot before step execution
        try {
          const screenshot = await this.captureScreenshot();
          if (screenshot) {
            this.emit('screenshot', {
              screenshot,
              stepNumber: step.stepNumber,
              timestamp: Date.now()
            });
          }
        } catch (screenshotError) {
          console.warn('[MacroExecutor] Screenshot failed:', screenshotError.message);
        }

        try {
          await this.executeStep(step, result);
          result.executedSteps++;

          // Emit step complete event
          this.emit('step-complete', {
            stepNumber: step.stepNumber,
            success: true,
            progress: (((i + 1) / macro.steps.length) * 100).toFixed(1),
            timestamp: Date.now()
          });

          // Small delay between steps
          // Note: Navigation steps have additional 500ms delay built into executeNavigation()
          await this.delay(100);
        } catch (error) {
          console.error(`[MacroExecutor] Step ${step.stepNumber} failed:`, error);

          result.errors.push({
            stepNumber: step.stepNumber,
            error: error.message
          });

          // Emit step error event
          this.emit('step-error', {
            stepNumber: step.stepNumber,
            error: error.message,
            progress: (((i + 1) / macro.steps.length) * 100).toFixed(1),
            timestamp: Date.now()
          });

          // Continue or stop based on error severity
          if (this.isCriticalError(error, step)) {
            result.success = false;
            break;
          }
        }
      }

      console.log('[MacroExecutor] Execution completed');
      console.log('[MacroExecutor] Steps executed:', result.executedSteps);
      console.log('[MacroExecutor] Errors:', result.errors.length);

      // Emit macro complete event
      this.emit('macro-complete', {
        success: result.success,
        executedSteps: result.executedSteps,
        totalSteps: macro.steps.length,
        errors: result.errors,
        timestamp: Date.now()
      });

      return result;
    } catch (error) {
      console.error('[MacroExecutor] Execution failed:', error);
      result.success = false;
      result.error = error.message;

      // Emit macro error event
      this.emit('macro-error', {
        error: error.message,
        timestamp: Date.now()
      });

      return result;
    }
  }

  /**
   * Execute a single step
   * @param {Object} step - Step object
   * @param {Object} result - Execution result (for storing values)
   * @returns {Promise<void>}
   */
  async executeStep(step, result) {
    switch (step.type) {
      case 'navigation':
        await this.executeNavigation(step);
        break;

      case 'click':
        await this.executeClick(step);
        break;

      case 'input':
        await this.executeInput(step, result);
        break;

      case 'keypress':
        await this.executeKeypress(step);
        break;

      case 'wait':
        await this.executeWait(step);
        break;

      case 'scroll':
        await this.executeScroll(step);
        break;

      default:
        console.warn('[MacroExecutor] Unknown step type:', step.type);
    }
  }

  /**
   * Execute navigation step
   * @param {Object} step - Navigation step
   * @returns {Promise<void>}
   */
  async executeNavigation(step) {
    console.log('[MacroExecutor] Navigating to:', step.url);

    if (!this.browserView || !this.browserView.webContents) {
      throw new Error('BrowserView not available');
    }

    // Clean up any previous navigation listeners
    if (this.currentNavigationCleanup) {
      console.log('[MacroExecutor] Cleaning up previous navigation');
      this.currentNavigationCleanup();
      this.currentNavigationCleanup = null;
    }

    // Stop any ongoing navigation first
    if (this.browserView.webContents.isLoading()) {
      console.log('[MacroExecutor] Stopping previous navigation');
      this.browserView.webContents.stop();
      await this.delay(200);
    }

    // Create load promise BEFORE starting navigation to avoid race condition
    const loadPromise = new Promise((resolve, reject) => {
      let loadHandler, failHandler, timeoutId;

      // Cleanup function to remove all listeners
      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (loadHandler) {
          this.browserView.webContents.removeListener('did-finish-load', loadHandler);
        }
        if (failHandler) {
          this.browserView.webContents.removeListener('did-fail-load', failHandler);
        }
        this.currentNavigationCleanup = null;
      };

      // Store cleanup function for cancellation
      this.currentNavigationCleanup = cleanup;

      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Navigation timeout'));
      }, 30000);

      loadHandler = () => {
        cleanup();
        resolve();
      };

      failHandler = (event, errorCode, errorDescription) => {
        cleanup();

        // Error -3 (ERR_ABORTED) is expected when we call stop() on navigation
        if (errorCode === -3) {
          console.log('[MacroExecutor] Navigation aborted (expected)');
          resolve();
        }
        // Critical errors should stop execution
        else if (errorCode === -2 || errorCode === -6) {
          reject(new Error(`Navigation failed: ${errorDescription} (${errorCode})`));
        } else {
          resolve(); // Non-critical errors continue
        }
      };

      // Attach listeners FIRST
      this.browserView.webContents.once('did-finish-load', loadHandler);
      this.browserView.webContents.once('did-fail-load', failHandler);
    });

    // Then start navigation
    await this.browserView.webContents.loadURL(step.url);

    // Wait for navigation to complete
    await loadPromise;

    // Additional delay to ensure page is fully ready
    await this.delay(500);
  }

  /**
   * Wait for element to be available with timeout
   * @param {string} selector - CSS selector
   * @param {string} xpath - XPath selector (fallback)
   * @param {number} timeout - Timeout in ms
   * @returns {Promise<Object>} Result with found element info
   */
  async waitForElement(selector, xpath = null, timeout = 5000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const result = await this.browserView.webContents.executeJavaScript(`
        (function() {
          const selector = ${JSON.stringify(selector)};
          const xpath = ${JSON.stringify(xpath)};

          // Try CSS selector first
          let element = document.querySelector(selector);

          // If not found and XPath is provided, try XPath
          if (!element && xpath) {
            const xpathResult = document.evaluate(
              xpath,
              document,
              null,
              XPathResult.FIRST_ORDERED_NODE_TYPE,
              null
            );
            element = xpathResult.singleNodeValue;
          }

          if (element) {
            // Check if element is visible and interactable
            const rect = element.getBoundingClientRect();
            const isVisible = rect.width > 0 && rect.height > 0 &&
                            window.getComputedStyle(element).visibility !== 'hidden' &&
                            window.getComputedStyle(element).display !== 'none';

            return {
              found: true,
              visible: isVisible,
              selector: selector,
              usedXPath: !document.querySelector(selector) && xpath
            };
          }

          return { found: false };
        })();
      `);

      if (result.found && result.visible) {
        return result;
      }

      // Wait 100ms before retry
      await this.delay(100);
    }

    return { found: false, error: 'Element not found or not visible within timeout' };
  }

  /**
   * Execute click step
   * @param {Object} step - Click step
   * @returns {Promise<void>}
   */
  async executeClick(step) {
    console.log('[MacroExecutor] Clicking:', step.target?.selector);

    if (!this.browserView || !this.browserView.webContents) {
      throw new Error('BrowserView not available');
    }

    const selector = step.target?.selector;
    if (!selector) {
      throw new Error('No selector for click target');
    }

    const xpath = step.target?.xpath || null;

    // Wait for element to be available
    const waitResult = await this.waitForElement(selector, xpath, 5000);

    if (!waitResult.found) {
      throw new Error(`Element not found: ${selector}${xpath ? ` (also tried XPath: ${xpath})` : ''}`);
    }

    if (waitResult.usedXPath) {
      console.log('[MacroExecutor] Using XPath fallback:', xpath);
    }

    // Execute click in page context
    const result = await this.browserView.webContents.executeJavaScript(`
      (function() {
        const selector = ${JSON.stringify(selector)};
        const xpath = ${JSON.stringify(xpath)};

        let element = document.querySelector(selector);

        // Fallback to XPath if CSS selector fails
        if (!element && xpath) {
          const xpathResult = document.evaluate(
            xpath,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
          );
          element = xpathResult.singleNodeValue;
        }

        if (element) {
          element.click();
          return { success: true };
        } else {
          return { success: false, error: 'Element not found' };
        }
      })();
    `);

    if (!result.success) {
      throw new Error(result.error || 'Click failed');
    }

    // Small delay after click
    await this.delay(300);
  }

  /**
   * Execute input step
   * @param {Object} step - Input step
   * @param {Object} result - Execution result (for storing values)
   * @returns {Promise<void>}
   */
  async executeInput(step, result) {
    console.log('[MacroExecutor] Typing into:', step.target?.selector);

    if (!this.browserView || !this.browserView.webContents) {
      throw new Error('BrowserView not available');
    }

    const selector = step.target?.selector;
    if (!selector) {
      throw new Error('No selector for input target');
    }

    const xpath = step.target?.xpath || null;

    // Wait for element to be available
    const waitResult = await this.waitForElement(selector, xpath, 5000);

    if (!waitResult.found) {
      throw new Error(`Element not found: ${selector}${xpath ? ` (also tried XPath: ${xpath})` : ''}`);
    }

    if (waitResult.usedXPath) {
      console.log('[MacroExecutor] Using XPath fallback for input:', xpath);
    }

    // Determine value based on input mode
    let value = '';

    if (step.inputMode === 'static' || !step.inputMode) {
      value = step.staticValue || '';
    } else if (step.inputMode === 'prompt') {
      // Ask user for value
      value = await this.promptUser(step);
    } else if (step.inputMode === 'ai') {
      // Generate value with AI
      value = await this.aiEngine.generateValue(step, result.inputValues);
    }

    console.log('[MacroExecutor] Value to input:', value);

    // Store value
    const fieldName = step.target?.description || `Step ${step.stepNumber}`;
    result.inputValues[fieldName] = value;

    // Execute input in page context
    const inputResult = await this.browserView.webContents.executeJavaScript(`
      (function() {
        const selector = ${JSON.stringify(selector)};
        const xpath = ${JSON.stringify(xpath)};
        const value = ${JSON.stringify(value)};

        let element = document.querySelector(selector);

        // Fallback to XPath if CSS selector fails
        if (!element && xpath) {
          const xpathResult = document.evaluate(
            xpath,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
          );
          element = xpathResult.singleNodeValue;
        }

        if (element) {
          // Focus element
          element.focus();

          // Set value
          element.value = value;

          // Trigger events
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));

          return { success: true };
        } else {
          return { success: false, error: 'Element not found' };
        }
      })();
    `);

    if (!inputResult.success) {
      throw new Error(inputResult.error || 'Input failed');
    }

    // Small delay after input
    await this.delay(200);
  }

  /**
   * Execute keypress step
   * @param {Object} step - Keypress step
   * @returns {Promise<void>}
   */
  async executeKeypress(step) {
    console.log('[MacroExecutor] Pressing key:', step.key);

    if (!this.browserView || !this.browserView.webContents) {
      throw new Error('BrowserView not available');
    }

    // Send key press
    await this.browserView.webContents.sendInputEvent({
      type: 'keyDown',
      keyCode: step.key
    });

    await this.delay(50);

    await this.browserView.webContents.sendInputEvent({
      type: 'keyUp',
      keyCode: step.key
    });

    // Wait a bit for any resulting actions
    await this.delay(500);
  }

  /**
   * Execute wait step
   * @param {Object} step - Wait step
   * @returns {Promise<void>}
   */
  async executeWait(step) {
    console.log('[MacroExecutor] Waiting:', step.timeout, 'ms, condition:', step.condition);

    if (!step.condition || step.condition === 'time') {
      // Simple timeout wait
      await this.delay(step.timeout || 1000);
    } else if (step.condition === 'page-load') {
      // Wait for page load
      await this.waitForPageLoad(step.timeout);
    } else if (step.condition === 'element-visible') {
      // Wait for element to become visible
      await this.waitForElement(step.selector, null, step.timeout || 10000);
    } else if (step.condition === 'element-hidden') {
      // Wait for element to be hidden
      await this.waitForElementHidden(step.selector, step.timeout || 10000);
    } else {
      // Unknown condition, fallback to simple timeout
      console.warn('[MacroExecutor] Unknown wait condition:', step.condition);
      await this.delay(step.timeout || 1000);
    }
  }

  /**
   * Wait for element to be hidden
   * @param {string} selector - CSS selector
   * @param {number} timeout - Timeout in ms
   * @returns {Promise<void>}
   */
  async waitForElementHidden(selector, timeout) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (this.stopped) {
        throw new Error('Execution stopped');
      }

      try {
        const result = await this.browserView.webContents.executeJavaScript(`
          (function() {
            const selector = ${JSON.stringify(selector)};
            const element = document.querySelector(selector);
            return !element || element.offsetParent === null;
          })();
        `);

        if (result) {
          console.log('[MacroExecutor] Element is hidden:', selector);
          return;
        }
      } catch (err) {
        // Continue waiting
      }

      await this.delay(200); // Check every 200ms
    }

    throw new Error(`Timeout waiting for element to hide: ${selector}`);
  }

  /**
   * Execute scroll step
   * @param {Object} step - Scroll step
   * @returns {Promise<void>}
   */
  async executeScroll(step) {
    console.log('[MacroExecutor] Scrolling to:', step.scrollX, step.scrollY);

    if (!this.browserView || !this.browserView.webContents) {
      throw new Error('BrowserView not available');
    }

    await this.browserView.webContents.executeJavaScript(`
      window.scrollTo(${step.scrollX || 0}, ${step.scrollY || 0});
    `);

    await this.delay(300);
  }

  /**
   * Prompt user for input value
   * @param {Object} step - Input step with prompt config
   * @returns {Promise<string>} User input
   */
  async promptUser(step) {
    const question = step.promptConfig?.question || 'Enter value:';
    const defaultValue = step.promptConfig?.defaultValue || '';

    // Send prompt request to main window and wait for response
    return new Promise((resolve, reject) => {
      const promptId = `prompt_${Date.now()}`;

      // Listen for response
      const { ipcMain } = require('electron');
      const responseHandler = (event, data) => {
        if (data.promptId === promptId) {
          ipcMain.removeListener('macro-prompt-response', responseHandler);
          if (data.cancelled) {
            reject(new Error('User cancelled input'));
          } else {
            resolve(data.value || defaultValue);
          }
        }
      };

      ipcMain.on('macro-prompt-response', responseHandler);

      // Send prompt to renderer
      this.mainWindow.webContents.send('macro-prompt-request', {
        promptId,
        question,
        defaultValue
      });

      // Timeout after 60 seconds
      setTimeout(() => {
        ipcMain.removeListener('macro-prompt-response', responseHandler);
        reject(new Error('Prompt timeout'));
      }, 60000);
    });
  }

  /**
   * Wait for page to load
   * @param {number} timeout - Timeout in ms
   * @returns {Promise<void>}
   */
  async waitForPageLoad(timeout = 30000) {
    if (!this.browserView || !this.browserView.webContents) {
      throw new Error('BrowserView not available');
    }

    return new Promise((resolve, reject) => {
      let loadHandler, failHandler;

      const timeoutId = setTimeout(() => {
        // Clean up listeners
        if (loadHandler) {
          this.browserView.webContents.removeListener('did-finish-load', loadHandler);
        }
        if (failHandler) {
          this.browserView.webContents.removeListener('did-fail-load', failHandler);
        }
        reject(new Error('Page load timeout after 30s'));
      }, timeout);

      loadHandler = () => {
        clearTimeout(timeoutId);
        if (failHandler) {
          this.browserView.webContents.removeListener('did-fail-load', failHandler);
        }
        resolve();
      };

      failHandler = (event, errorCode, errorDescription, validatedURL) => {
        clearTimeout(timeoutId);
        if (loadHandler) {
          this.browserView.webContents.removeListener('did-finish-load', loadHandler);
        }

        console.warn('[MacroExecutor] Page load failed:', errorDescription, 'Code:', errorCode);

        // Critical errors should stop execution
        if (errorCode === -2 || errorCode === -3 || errorCode === -6) {
          // ERR_FAILED (-2), ERR_ABORTED (-3), ERR_FILE_NOT_FOUND (-6)
          reject(new Error(`Navigation failed: ${errorDescription} (${errorCode})`));
        } else {
          // Non-critical errors (like -102 connection aborted by user) can continue
          console.warn('[MacroExecutor] Non-critical error, continuing...');
          resolve();
        }
      };

      // Listen for load events
      this.browserView.webContents.once('did-finish-load', loadHandler);
      this.browserView.webContents.once('did-fail-load', failHandler);
    });
  }

  /**
   * Delay execution
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise<void>}
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if error is critical (should stop execution)
   * @param {Error} error - Error object
   * @param {Object} step - Current step being executed
   * @returns {boolean} True if critical
   */
  isCriticalError(error, step) {
    const errorMsg = error.message;

    // Always critical errors
    const alwaysCritical = [
      'BrowserView not available',
      'Execution stopped'
    ];

    if (alwaysCritical.some(msg => errorMsg.includes(msg))) {
      return true;
    }

    // Navigation and page load errors are critical
    if (step && step.type === 'navigation') {
      return errorMsg.includes('Navigation failed') ||
             errorMsg.includes('Page load timeout');
    }

    // Element not found is critical for click and input steps
    if (step && (step.type === 'click' || step.type === 'input')) {
      return errorMsg.includes('Element not found');
    }

    // Timeout errors during wait conditions are critical
    if (step && step.type === 'wait' && step.condition) {
      return errorMsg.includes('Timeout waiting');
    }

    // Other errors are non-critical (log and continue)
    return false;
  }

  /**
   * Stop execution
   */
  stop() {
    console.log('[MacroExecutor] Stopping execution');
    this.stopped = true;

    // Clean up any pending navigation listeners
    if (this.currentNavigationCleanup) {
      console.log('[MacroExecutor] Cleaning up navigation listeners on stop');
      this.currentNavigationCleanup();
      this.currentNavigationCleanup = null;
    }
  }

  /**
   * Get human-readable description of a step
   * @param {Object} step - Step object
   * @returns {string} Description
   */
  getStepDescription(step) {
    switch (step.type) {
      case 'navigation':
        return `Navigate to ${step.url}`;
      case 'click':
        return `Click ${step.target?.description || step.target?.selector || 'element'}`;
      case 'input':
        return `Type into ${step.target?.description || step.target?.selector || 'field'}`;
      case 'keypress':
        return `Press ${step.key} key`;
      case 'wait':
        return `Wait ${step.timeout}ms`;
      case 'scroll':
        return `Scroll to ${step.scrollX || 0}, ${step.scrollY || 0}`;
      default:
        return `Execute ${step.type}`;
    }
  }

  /**
   * Capture screenshot of current browser view
   * @returns {Promise<string>} Base64 screenshot data URL
   */
  async captureScreenshot() {
    if (!this.browserView || !this.browserView.webContents) {
      return null;
    }

    try {
      const image = await this.browserView.webContents.capturePage();
      const buffer = image.toPNG();
      const base64 = buffer.toString('base64');
      return `data:image/png;base64,${base64}`;
    } catch (error) {
      console.warn('[MacroExecutor] Screenshot capture failed:', error.message);
      return null;
    }
  }
}

module.exports = MacroExecutor;
