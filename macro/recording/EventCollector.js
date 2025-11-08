// EventCollector.js - Collects events from BrowserView and sends to main process

const { EventType } = require('../types/MacroTypes');
const EventSerializer = require('./EventSerializer');

/**
 * This script is injected into the BrowserView to collect DOM events
 * It communicates with the main process via IPC
 */
const INJECTION_SCRIPT = `
(function() {
  console.log('[EventCollector] Injection script loaded');

  // Prevent duplicate injection
  if (window.__macroEventCollectorInstalled) {
    console.log('[EventCollector] Already installed, skipping');
    return;
  }
  window.__macroEventCollectorInstalled = true;

  // Helper: Get element info
  function getElementInfo(element) {
    if (!element) return null;

    // Get label for inputs
    let label = '';
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      const labelElement = document.querySelector(\`label[for="\${element.id}"]\`);
      if (labelElement) {
        label = labelElement.textContent.trim();
      }
    }

    return {
      tagName: element.tagName,
      id: element.id || '',
      className: element.className || '',
      name: element.name || '',
      type: element.type || '',
      placeholder: element.placeholder || '',
      label: label,
      text: element.textContent ? element.textContent.trim().substring(0, 50) : '',
      value: element.value || ''
    };
  }

  // Track last input event to debounce rapid typing
  let lastInputEvent = null;
  let inputDebounceTimer = null;

  // Click event
  document.addEventListener('click', (e) => {
    console.log('[EventCollector] Click detected');

    const event = {
      type: 'click',
      timestamp: Date.now(),
      target: getElementInfo(e.target),
      coordinates: {
        x: e.clientX,
        y: e.clientY
      },
      button: e.button
    };

    window.__browserViewAPI.sendMacroEvent(event);
  }, true);

  // Input event (text fields)
  document.addEventListener('input', (e) => {
    const target = e.target;

    // Only track input/textarea elements
    if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
      return;
    }

    console.log('[EventCollector] Input detected:', target.value);

    // Debounce rapid typing - wait for 500ms of no typing
    if (inputDebounceTimer) {
      clearTimeout(inputDebounceTimer);
    }

    lastInputEvent = {
      type: 'input',
      timestamp: Date.now(),
      target: getElementInfo(target),
      value: target.value,
      inputType: target.type || 'text'
    };

    inputDebounceTimer = setTimeout(() => {
      if (lastInputEvent) {
        console.log('[EventCollector] Sending debounced input event');
        window.__electronAPI.sendMacroEvent(lastInputEvent);
        lastInputEvent = null;
      }
    }, 500);
  }, true);

  // Keydown event (for special keys like Enter, Tab, etc.)
  document.addEventListener('keydown', (e) => {
    // Only track special keys
    const specialKeys = ['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (!specialKeys.includes(e.key)) {
      return;
    }

    console.log('[EventCollector] Keydown detected:', e.key);

    // Flush any pending input event first
    if (lastInputEvent) {
      window.__electronAPI.sendMacroEvent(lastInputEvent);
      lastInputEvent = null;
      if (inputDebounceTimer) {
        clearTimeout(inputDebounceTimer);
        inputDebounceTimer = null;
      }
    }

    const event = {
      type: 'keydown',
      timestamp: Date.now(),
      target: getElementInfo(e.target),
      key: e.key,
      keyCode: e.keyCode,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey
    };

    window.__browserViewAPI.sendMacroEvent(event);
  }, true);

  // Form submit
  document.addEventListener('submit', (e) => {
    console.log('[EventCollector] Form submit detected');

    const form = e.target;
    const event = {
      type: 'submit',
      timestamp: Date.now(),
      target: getElementInfo(form),
      formAction: form.action || ''
    };

    window.__browserViewAPI.sendMacroEvent(event);
  }, true);

  // Scroll event (debounced)
  let scrollDebounceTimer = null;
  document.addEventListener('scroll', (e) => {
    if (scrollDebounceTimer) {
      clearTimeout(scrollDebounceTimer);
    }

    scrollDebounceTimer = setTimeout(() => {
      console.log('[EventCollector] Scroll detected');

      const event = {
        type: 'scroll',
        timestamp: Date.now(),
        target: null,
        scrollX: window.scrollX,
        scrollY: window.scrollY
      };

      window.__browserViewAPI.sendMacroEvent(event);
    }, 300);
  }, true);

  console.log('[EventCollector] Event listeners installed');
})();
`;

class EventCollector {
  constructor(mainWindow, recordingManager) {
    this.mainWindow = mainWindow;
    this.recordingManager = recordingManager;
    this.isCollecting = false;
    this.currentView = null;
    this.navigationListener = null;
  }

  /**
   * Start collecting events from a BrowserView
   * @param {BrowserView} browserView - The BrowserView to collect from
   * @returns {Promise<Object>} Result
   */
  async startCollecting(browserView) {
    if (this.isCollecting) {
      console.warn('[EventCollector] Already collecting');
      return { success: false, error: 'Already collecting' };
    }

    console.log('[EventCollector] Starting event collection');

    this.currentView = browserView;
    this.isCollecting = true;

    // Inject event collection script into BrowserView
    try {
      await browserView.webContents.executeJavaScript(INJECTION_SCRIPT);
      console.log('[EventCollector] Injection script executed successfully');
    } catch (error) {
      console.error('[EventCollector] Failed to inject script:', error);
      return { success: false, error: error.message };
    }

    // Track last URL to detect actual page changes
    let lastUrl = browserView.webContents.getURL();

    // Listen for navigation events (only full page navigations)
    this.navigationListener = () => {
      const url = browserView.webContents.getURL();

      // Skip if URL hasn't actually changed (filters out hash changes, etc.)
      if (url === lastUrl) {
        return;
      }

      const title = browserView.webContents.getTitle();

      console.log('[EventCollector] Navigation detected:', lastUrl, '→', url);
      lastUrl = url;

      const event = {
        type: EventType.NAVIGATION,
        timestamp: Date.now(),
        target: null,
        url: url,
        title: title
      };

      const serialized = EventSerializer.serialize(event);
      this.recordingManager.addEvent(serialized);

      // Re-inject script on navigation
      setTimeout(() => {
        if (this.isCollecting) {
          browserView.webContents.executeJavaScript(INJECTION_SCRIPT).catch(err => {
            console.error('[EventCollector] Failed to re-inject after navigation:', err);
          });
        }
      }, 1000);
    };

    // Only listen to 'did-navigate' (full page loads), not 'did-navigate-in-page' (SPA hash changes)
    browserView.webContents.on('did-navigate', this.navigationListener);

    return { success: true };
  }

  /**
   * Stop collecting events
   * @returns {Object} Result
   */
  stopCollecting() {
    if (!this.isCollecting) {
      console.warn('[EventCollector] Not currently collecting');
      return { success: false, error: 'Not collecting' };
    }

    console.log('[EventCollector] Stopping event collection');

    this.isCollecting = false;

    // Remove navigation listeners
    if (this.currentView && this.navigationListener) {
      this.currentView.webContents.removeListener('did-navigate', this.navigationListener);
      this.currentView.webContents.removeListener('did-navigate-in-page', this.navigationListener);
    }

    // Remove injection from page
    if (this.currentView && this.currentView.webContents) {
      this.currentView.webContents.executeJavaScript(`
        window.__macroEventCollectorInstalled = false;
      `).catch(() => {});
    }

    this.currentView = null;
    this.navigationListener = null;

    return { success: true };
  }

  /**
   * Handle event from injected script
   * @param {Object} event - Raw event data
   */
  handleEvent(event) {
    if (!this.isCollecting) {
      return;
    }

    console.log('[EventCollector] Received event:', event.type);

    // Serialize and add to recording
    const serialized = EventSerializer.serialize(event);
    this.recordingManager.addEvent(serialized);
  }

  /**
   * Check if currently collecting
   * @returns {boolean} True if collecting
   */
  isActive() {
    return this.isCollecting;
  }
}

module.exports = EventCollector;
