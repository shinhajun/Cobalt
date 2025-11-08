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
          if (this.isCriticalError(error)) {
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

    await this.browserView.webContents.loadURL(step.url);

    // Wait for page to load
    await this.waitForPageLoad();
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

    // Execute click in page context
    const result = await this.browserView.webContents.executeJavaScript(`
      (function() {
        const element = document.querySelector('${selector}');
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
        const element = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (element) {
          // Focus element
          element.focus();

          // Set value
          element.value = ${JSON.stringify(value)};

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
    console.log('[MacroExecutor] Waiting:', step.timeout, 'ms');

    if (step.condition === 'page-load') {
      await this.waitForPageLoad(step.timeout);
    } else {
      await this.delay(step.timeout);
    }
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

    // Use Electron dialog
    const { dialog } = require('electron');

    const result = await dialog.showMessageBox(this.mainWindow, {
      type: 'question',
      title: 'Macro Input',
      message: question,
      buttons: ['OK', 'Cancel'],
      defaultId: 0,
      cancelId: 1
    });

    if (result.response === 1) {
      throw new Error('User cancelled input');
    }

    // For now, return default value
    // TODO: Implement proper input dialog
    return defaultValue;
  }

  /**
   * Wait for page to load
   * @param {number} timeout - Timeout in ms
   * @returns {Promise<void>}
   */
  async waitForPageLoad(timeout = 30000) {
    if (!this.browserView || !this.browserView.webContents) {
      return;
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        console.warn('[MacroExecutor] Page load timeout');
        resolve(); // Don't reject, just continue
      }, timeout);

      const loadHandler = () => {
        clearTimeout(timeoutId);
        resolve();
      };

      // Listen for load event
      this.browserView.webContents.once('did-finish-load', loadHandler);
      this.browserView.webContents.once('did-fail-load', (event, errorCode, errorDescription) => {
        clearTimeout(timeoutId);
        console.warn('[MacroExecutor] Page load failed:', errorDescription);
        resolve(); // Don't reject, just continue
      });
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
   * Check if error is critical
   * @param {Error} error - Error object
   * @returns {boolean} True if critical
   */
  isCriticalError(error) {
    const criticalErrors = [
      'BrowserView not available',
      'Navigation failed',
      'Page load timeout'
    ];

    return criticalErrors.some(msg => error.message.includes(msg));
  }

  /**
   * Stop execution
   */
  stop() {
    console.log('[MacroExecutor] Stopping execution');
    this.stopped = true;
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
