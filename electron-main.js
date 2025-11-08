const { app, BrowserWindow, BrowserView, ipcMain, session } = require('electron');
const path = require('path');
const { EventEmitter } = require('events');
// Raise global listener cap to avoid noisy warnings while we ensure no duplicates
EventEmitter.defaultMaxListeners = 100;

// Note: API keys are loaded from Settings tab (localStorage)
console.log('[Electron] API keys will be loaded from Settings tab');

// Use browser-use style services
const { BrowserController } = require('./packages/agent-core/dist/browserController');
const { LLMService } = require('./packages/agent-core/dist/llmService');
const { BrowserProfile } = require('./packages/agent-core/dist/browser/BrowserProfile');

// Modular browser UX features
const { registerWindowShortcuts, attachShortcutsToWebContents } = require('./electron/keyboardShortcuts');
const { registerContextMenuForWebContents } = require('./electron/contextMenu');
const { registerDownloadHandlers } = require('./electron/downloads');
const { setupFindInPageIPC, attachFoundInPageForwarder } = require('./electron/findInPage');
const { applyInitialZoom } = require('./electron/zoomManager');
const { registerPermissionHandler } = require('./electron/permissions');
const { registerAutofillIPC } = require('./electron/autofill/ipc');
const fs = require('fs');

// Macro recording system
const RecordingManager = require('./macro/recording/RecordingManager');
const EventCollector = require('./macro/recording/EventCollector');

let mainWindow;
let browserView = null; // Current active BrowserView
let browserViews = new Map(); // Map of tabId -> BrowserView
let currentTabId = 0;
let aiWorkingTabId = null; // AI가 작업 중인 탭 ID (탭 격리용)
let browserController = null;
let llmService = null;
let isTaskRunning = false;
let stopRequested = false;
let screenshotInterval = null; // Auto-screenshot timer
let chatVisible = false; // Chat visibility state - 기본값 false로 변경
let currentMacroExecutor = null; // Current running macro executor

// Macro recording instances
let recordingManager = new RecordingManager();
let eventCollector = null;
// Map of window ID to editing macro (allows multiple flowchart windows)
const currentEditingMacros = new Map();

// Note: We do not reserve extra overlay space for the omnibox dropdown; it overlays visually.

// Omnibox overlay (a small BrowserView rendered above the main BrowserView)
let omniboxView = null;
let omniboxVisible = false;
let omniboxCloseHandler = null; // detach hook for outside clicks on content
let omniboxCloseAttachedWC = null; // which webContents the handler is attached to

function ensureOmniboxView() {
  if (omniboxView) return omniboxView;
  omniboxView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
    }
  });
  try {
    omniboxView.webContents.loadFile(path.join(__dirname, 'omnibox-overlay.html'));
  } catch (e) {
    console.warn('[Electron] Failed to load omnibox overlay:', e.message || e);
  }
  return omniboxView;
}

function bringOmniboxToFrontIfVisible() {
  if (omniboxVisible && omniboxView && !mainWindow.isDestroyed()) {
    try {
      // Re-add order to ensure overlay is on top
      mainWindow.removeBrowserView(omniboxView);
      mainWindow.addBrowserView(omniboxView);
    } catch (_) {}
  }
}

function attachOutsideClickCloser() {
  try {
    if (!browserView || !browserView.webContents) return;
    const wc = browserView.webContents;
    // If already attached to this webContents, skip
    if (omniboxCloseHandler && omniboxCloseAttachedWC === wc) return;
    // Reattach to current webContents
    detachOutsideClickCloser();
    omniboxCloseHandler = (_event, input) => {
      if (!omniboxVisible) return;
      // Close on mouse interactions in the content area
      if (input && (input.type === 'mouseDown' || input.type === 'mouseUp' || input.type === 'mouseWheel')) {
        try { mainWindow.webContents.send('omnibox-close-request'); } catch {}
      }
    };
    wc.on('before-input-event', omniboxCloseHandler);
    omniboxCloseAttachedWC = wc;
  } catch {}
}

function detachOutsideClickCloser() {
  try {
    if (omniboxCloseHandler && omniboxCloseAttachedWC) {
      omniboxCloseAttachedWC.removeListener('before-input-event', omniboxCloseHandler);
    }
  } catch {}
  omniboxCloseHandler = null;
  omniboxCloseAttachedWC = null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    title: 'Cobalt',
    icon: path.join(__dirname, 'cobalt_logo.png'),
    autoHideMenuBar: true, // 메뉴바 자동 숨김
    titleBarStyle: 'hidden', // 타이틀바 텍스트 숨김
    titleBarOverlay: {
      color: '#f0f0f0',
      symbolColor: '#000000',
      height: 32
    },
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.js'),
      contextIsolation: false, // toolbar에서 require 사용 가능하도록
      nodeIntegration: true, // toolbar에서 require 사용 가능하도록
    }
  });

  // 메뉴바 완전히 제거
  mainWindow.setMenuBarVisibility(false);
  // Avoid MaxListeners warnings when multiple modules add listeners
  try { mainWindow.setMaxListeners(100); } catch (_) {}

  // Create initial tab (tabId = 0)
  const initialView = createBrowserViewForTab(0);

  // Make it the active BrowserView
  browserView = initialView;
  currentTabId = 0;
  mainWindow.addBrowserView(browserView);
  updateBrowserViewBounds();

  // Load Cobalt logo page as default
  browserView.webContents.loadFile(path.join(__dirname, 'cobalt-home.html'));

  // Toolbar UI 로드 (상단 주소창 + Chat UI)
  mainWindow.loadFile(path.join(__dirname, 'browser-toolbar.html'));

  // Register downloads handler (one-time)
  registerDownloadHandlers(session.defaultSession, mainWindow);

  // Register permissions handler (one-time)
  registerPermissionHandler(session.defaultSession, mainWindow);

  // Setup find-in-page IPC
  setupFindInPageIPC(mainWindow, () => browserView && browserView.webContents);

  // Setup autofill IPC (one-time)
  registerAutofillIPC(() => (browserView && browserView.webContents && browserView.webContents.getURL()) || '');

  // Keyboard shortcuts for window
  registerWindowShortcuts(
    mainWindow,
    () => (browserView && browserView.webContents),
    () => browserView,
  );

  // Handle new window requests for initial view (same as createBrowserViewForTab)
  browserView.webContents.setWindowOpenHandler(({ url }) => {
    console.log('[Electron] New window requested from initial view:', url);

    // Create new tab for the URL
    const newTabId = Date.now(); // Use timestamp as unique tab ID

    // Notify toolbar to create new tab with this URL
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('create-new-tab', {
        tabId: newTabId,
        url: url
      });
    }

    // Prevent default window.open behavior
    return { action: 'deny' };
  });

  // BrowserView URL 변경 시 toolbar에 알림
  browserView.webContents.on('did-navigate', () => {
    const url = browserView.webContents.getURL();
    const title = browserView.webContents.getTitle();
    mainWindow.webContents.send('url-changed', url, title);
  });

  browserView.webContents.on('did-navigate-in-page', () => {
    const url = browserView.webContents.getURL();
    const title = browserView.webContents.getTitle();
    mainWindow.webContents.send('url-changed', url, title);
  });

  browserView.webContents.on('page-title-updated', () => {
    const url = browserView.webContents.getURL();
    const title = browserView.webContents.getTitle();
    mainWindow.webContents.send('url-changed', url, title);
  });

  // Inject text selection popup script into BrowserView
  browserView.webContents.on('did-finish-load', () => {
    browserView.webContents.executeJavaScript(`
      (function() {
        // Disable legacy inline injection; use modular injector instead
        if (true) return;

        console.log('[Text Selection] Script injection started');

        let popup = null;
        let isEditingInput = false; // Flag to prevent popup recreation
        let isProcessingRequest = false; // Flag to prevent popup recreation during API calls

        // Listen for results via window.postMessage (from preload script)
        window.addEventListener('message', (event) => {
          console.log('[Text Selection] Message received:', event.data);

          // Only accept messages from same origin
          if (event.source !== window) {
            console.log('[Text Selection] Ignoring message from different source');
            return;
          }

          if (event.data.type === '__translation-result') {
            const result = event.data.payload;
            console.log('[Text Selection] Translation result received:', result);
            isProcessingRequest = false; // Reset flag

            if (result && result.translation) {
              // Use modern Clipboard API
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(result.translation).catch(err => {
                  console.error('[Text Selection] Failed to copy to clipboard:', err);
                });
              }

              // Update button with result
              if (window.__pendingTranslateButton && window.__pendingTranslateButton.parentNode) {
                const btn = window.__pendingTranslateButton;
                btn.textContent = result.translation;
                btn.disabled = false;
                btn.style.cursor = 'pointer';
                btn.style.opacity = '1';
                btn.style.width = 'auto';
                btn.style.maxWidth = '400px';
                btn.style.whiteSpace = 'nowrap';
                btn.style.overflow = 'hidden';
                btn.style.textOverflow = 'ellipsis';
                btn.style.background = '#dcfce7';
                btn.style.color = '#166534';

                delete window.__pendingTranslateButton;
              } else {
                console.warn('[Text Selection] No pending translate button found or button removed from DOM');
              }
            } else if (result && result.error) {
              console.error('[Text Selection] Translation error:', result.error);
              if (window.__pendingTranslateButton && window.__pendingTranslateButton.parentNode) {
                const btn = window.__pendingTranslateButton;
                btn.textContent = 'Translation failed';
                btn.disabled = false;
                btn.style.background = '#fee2e2';
                btn.style.color = '#991b1b';
                delete window.__pendingTranslateButton;
              }
            }
          } else if (event.data.type === '__edit-result') {
            const result = event.data.payload;
            console.log('[Text Selection] Edit result received:', result);
            isProcessingRequest = false; // Reset flag

            if (result && result.editedText) {
            // Use modern Clipboard API
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(result.editedText).catch(err => {
                console.error('[Text Selection] Failed to copy to clipboard:', err);
              });
            }

            // Replace the original text with edited text
            if (window.__pendingEditRange && window.__pendingEditElement) {
              try {
                const element = window.__pendingEditElement;
                const range = window.__pendingEditRange;

                // Check if it's an input/textarea element
                if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                  // For input/textarea, replace the selected portion of the value
                  const startPos = window.__pendingEditSelStart !== null ? window.__pendingEditSelStart : element.selectionStart;
                  const endPos = window.__pendingEditSelEnd !== null ? window.__pendingEditSelEnd : element.selectionEnd;
                  const originalValue = element.value;

                  element.value = originalValue.substring(0, startPos) +
                                  result.editedText +
                                  originalValue.substring(endPos);

                  // Set cursor position after the inserted text
                  const newCursorPos = startPos + result.editedText.length;
                  element.selectionStart = newCursorPos;
                  element.selectionEnd = newCursorPos;
                  element.focus();

                  console.log('[AI Edit] Input/Textarea value replaced successfully');
                } else if (element.isContentEditable) {
                  // For contentEditable elements, use range
                  range.deleteContents();
                  range.insertNode(document.createTextNode(result.editedText));
                  console.log('[AI Edit] ContentEditable text replaced successfully');
                } else {
                  console.warn('[AI Edit] Unknown editable element type');
                }
              } catch (error) {
                console.error('[AI Edit] Failed to replace text:', error);
              }
              delete window.__pendingEditRange;
              delete window.__pendingEditElement;
              delete window.__pendingEditSelStart;
              delete window.__pendingEditSelEnd;
            }

            // Update popup with result
            if (window.__pendingEditPopup && window.__pendingEditPopup.parentNode) {
              const popup = window.__pendingEditPopup;

              // Clear popup content
              popup.innerHTML = '';

              // Create result display
              const resultDiv = document.createElement('div');
              resultDiv.textContent = '✓ Text replaced';
              resultDiv.style.cssText = 'background: #dcfce7; color: #166534; padding: 6px 12px; border-radius: 4px; font-size: 13px; white-space: nowrap;';

              popup.appendChild(resultDiv);

              // Auto-close after 2 seconds
              setTimeout(() => {
                if (popup.parentNode) {
                  popup.remove();
                }
              }, 2000);

              delete window.__pendingEditPopup;
            } else {
              showNotification('✓ Text replaced', true);
            }
          } else if (result && result.error) {
            console.error('[Text Selection] Edit error:', result.error);

            // Update popup with error
            if (window.__pendingEditPopup && window.__pendingEditPopup.parentNode) {
              const popup = window.__pendingEditPopup;
              popup.innerHTML = '';

              const errorDiv = document.createElement('div');
              errorDiv.textContent = '✗ Edit failed';
              errorDiv.style.cssText = 'background: #fee2e2; color: #991b1b; padding: 6px 12px; border-radius: 4px; font-size: 13px; white-space: nowrap;';
              popup.appendChild(errorDiv);

              setTimeout(() => {
                if (popup.parentNode) popup.remove();
              }, 2000);

              delete window.__pendingEditPopup;
            } else {
              showNotification('✗ Edit failed', false);
            }
          }
        }
        });

        function showNotification(message, isSuccess) {
          // Remove existing notifications
          const existingNotifications = document.querySelectorAll('.ai-notification');
          existingNotifications.forEach(n => n.remove());

          const notification = document.createElement('div');
          notification.className = 'ai-notification';

          // Determine notification position based on available space
          const windowHeight = window.innerHeight;
          const notificationHeight = 150; // Approximate max height
          const topSpace = 80;
          const bottomSpace = windowHeight - topSpace - notificationHeight;

          let position = 'top: 80px;';
          let animationName = 'slideDown';

          // If not enough space at top and more space at bottom, show at bottom
          if (topSpace < notificationHeight && bottomSpace > topSpace) {
            position = 'bottom: 80px;';
            animationName = 'slideUp';
          }

          notification.style.cssText = 'position: fixed; ' + position + ' left: 50%; transform: translateX(-50%); background: rgba(255, 255, 255, 0.98); color: #1f2937; border: 1px solid ' + (isSuccess ? '#d1fae5' : '#dbeafe') + '; padding: 12px 20px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); z-index: 1000000; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 14px; max-width: 500px; word-wrap: break-word; animation: ' + animationName + ' 0.2s ease-out;';
          notification.innerHTML = message;

          // Add animations
          if (!document.getElementById('notification-animation-style')) {
            const style = document.createElement('style');
            style.id = 'notification-animation-style';
            style.textContent = '@keyframes slideDown { from { opacity: 0; transform: translateX(-50%) translateY(-20px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } } @keyframes slideUp { from { opacity: 0; transform: translateX(-50%) translateY(20px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }';
            document.head.appendChild(style);
          }

          document.body.appendChild(notification);

          setTimeout(() => {
            notification.style.transition = 'opacity 0.3s, transform 0.3s';
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(-50%) translateY(-20px)';
            setTimeout(() => notification.remove(), 300);
          }, 5000);
        }

        function createPopup(selectedText, x, y, isEditable, selectionRange, editableElement, startPos, endPos) {
          console.log('[Text Selection] createPopup called with text:', selectedText.substring(0, 30) + '...', 'isEditable:', isEditable);

          // Remove existing popup
          if (popup) popup.remove();

          // Store the selected text, range, element, and positions (they may be cleared when clicking button)
          const text = selectedText;
          const range = selectionRange;
          const element = editableElement;
          const selStart = startPos;
          const selEnd = endPos;

          // Create popup container
          popup = document.createElement('div');
          console.log('[Text Selection] Popup element created');

          // Calculate popup position (above or below selection)
          const popupHeight = 40; // Approximate height
          const windowHeight = window.innerHeight;
          const spaceAbove = y;
          const spaceBelow = windowHeight - y;

          // If not enough space above, show below
          let popupY = y - popupHeight - 5;
          if (spaceAbove < popupHeight + 20) {
            popupY = y + 5; // Show below
          }

          // Center horizontally on selection
          let popupX = x;
          if (popupX < 10) popupX = 10;
          if (popupX > window.innerWidth - 120) {
            popupX = window.innerWidth - 120;
          }

          popup.style.cssText = 'position: fixed; left: ' + popupX + 'px; top: ' + popupY + 'px; background: rgba(255, 255, 255, 0.98); border: 1px solid rgba(0, 0, 0, 0.1); border-radius: 6px; padding: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); z-index: 999999; display: flex; gap: 4px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; animation: popupFadeIn 0.15s ease-out;';

          // Prevent popup from triggering document events
          popup.onmousedown = (e) => {
            e.preventDefault();
            e.stopPropagation();
          };
          popup.onclick = (e) => {
            e.stopPropagation();
          };

          // Add animation
          if (!document.getElementById('text-selection-popup-style')) {
            const style = document.createElement('style');
            style.id = 'text-selection-popup-style';
            style.textContent = '@keyframes popupFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }';
            document.head.appendChild(style);
          }

          if (isEditable) {
            console.log('[Text Selection] Creating AI Edit button');
            // AI edit button
            const editBtn = document.createElement('button');
            editBtn.textContent = 'AI Edit';
            editBtn.style.cssText = 'background: #f9fafb; color: #374151; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: 500; font-size: 13px; transition: all 0.15s;';
            editBtn.onmouseover = () => {
              editBtn.style.background = '#e5e7eb';
            };
            editBtn.onmouseout = () => {
              editBtn.style.background = '#f9fafb';
            };
            editBtn.onmousedown = (e) => {
              e.preventDefault();
              e.stopPropagation();
            };

            editBtn.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();

              // Set flag to prevent popup recreation
              isEditingInput = true;

              console.log('[AI Edit] Button clicked, creating input field');

              // Create input field
              const inputField = document.createElement('input');
              inputField.type = 'text';
              inputField.placeholder = 'How to edit?';
              inputField.value = 'Fix grammar';
              inputField.style.cssText = 'background: white; color: #374151; border: 1px solid #d1d5db; padding: 6px 12px; border-radius: 4px; font-size: 13px; outline: none; width: 200px;';

              // Replace button with input
              editBtn.replaceWith(inputField);
              console.log('[AI Edit] Input field created and replaced button');

              // Immediately focus and select
              requestAnimationFrame(() => {
                inputField.focus();
                inputField.select();
                console.log('[AI Edit] Input field focused');
              });

              // Prevent all event propagation from input
              inputField.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('[AI Edit] Input mousedown prevented');
              }, true);

              inputField.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('[AI Edit] Input click prevented');
              }, true);

              inputField.addEventListener('focus', (e) => {
                e.stopPropagation();
                console.log('[AI Edit] Input focused');
              }, true);

              // Handle Enter key
              inputField.addEventListener('keydown', (e) => {
                e.stopPropagation();
                console.log('[AI Edit] Key pressed:', e.key);
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const promptText = inputField.value.trim();
                  if (promptText) {
                    console.log('[AI Edit] Submitting:', promptText);
                    isEditingInput = false; // Reset flag
                    isProcessingRequest = true; // Set processing flag

                    // Check if API is available
                    if (!window.__browserViewAPI) {
                      console.error('[Text Selection] BrowserView API not available for AI edit');
                      showNotification('AI Edit failed: API not ready', false);
                      popup.remove();
                      isProcessingRequest = false;
                      return;
                    }

                    // Replace input with loading status
                    const loadingDiv = document.createElement('div');
                    loadingDiv.textContent = 'Editing...';
                    loadingDiv.style.cssText = 'background: #fef3c7; color: #92400e; padding: 6px 12px; border-radius: 4px; font-size: 13px; font-weight: 500; white-space: nowrap;';
                    inputField.replaceWith(loadingDiv);

                    // Store range, element, and positions for later text replacement
                    window.__pendingEditRange = range;
                    window.__pendingEditElement = element;
                    window.__pendingEditSelStart = selStart;
                    window.__pendingEditSelEnd = selEnd;
                    window.__pendingEditPopup = popup;

                    // Send AI edit request via IPC
                    console.log('[Text Selection] Sending AI edit request via IPC');
                    window.__browserViewAPI.requestAIEdit(text, promptText);
                  }
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  console.log('[AI Edit] Cancelled');
                  isEditingInput = false; // Reset flag
                  popup.remove();
                }
              }, true);

              // Handle blur
              inputField.addEventListener('blur', () => {
                console.log('[AI Edit] Input blurred, closing in 300ms');
                setTimeout(() => {
                  if (popup && popup.parentNode) {
                    console.log('[AI Edit] Removing popup after blur');
                    popup.remove();
                    isEditingInput = false; // Reset flag
                  }
                }, 300);
              });
            };
            popup.appendChild(editBtn);
            console.log('[Text Selection] AI Edit button added to popup');
          } else {
            console.log('[Text Selection] Creating AI Translate button');
            // Translate button
            const translateBtn = document.createElement('button');
            translateBtn.textContent = 'AI Translate';
            translateBtn.style.cssText = 'background: #f9fafb; color: #374151; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: 500; font-size: 13px; transition: all 0.15s;';
            translateBtn.onmouseover = () => {
              translateBtn.style.background = '#e5e7eb';
            };
            translateBtn.onmouseout = () => {
              translateBtn.style.background = '#f9fafb';
            };

            // Prevent mousedown from propagating
            translateBtn.addEventListener('mousedown', (e) => {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
            }, true);

            translateBtn.onclick = (e) => {
              console.log('[Text Selection] Translate button clicked');
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();

              // Check if API is available
              if (!window.__browserViewAPI) {
                console.error('[Text Selection] BrowserView API not available for translation');
                showNotification('Translation failed: API not ready', false);
                return;
              }
              console.log('[Text Selection] API is available');

              // Set processing flag to prevent popup recreation
              isProcessingRequest = true;

              // Change button to show loading state
              console.log('[Text Selection] Changing button to loading state');
              translateBtn.textContent = 'Translating...';
              translateBtn.disabled = true;
              translateBtn.style.cursor = 'wait';
              translateBtn.style.background = '#fef3c7';
              translateBtn.style.color = '#92400e';
              translateBtn.style.opacity = '1';
              console.log('[Text Selection] Button text now:', translateBtn.textContent);

              // Send translation request via IPC
              window.__pendingTranslateButton = translateBtn;
              console.log('[Text Selection] Stored button reference, sending request for text:', text.substring(0, 30) + '...');
              window.__browserViewAPI.requestTranslation(text);
              console.log('[Text Selection] Translation request sent');
            };
            popup.appendChild(translateBtn);
            console.log('[Text Selection] AI Translate button added to popup');
          }

          console.log('[Text Selection] Appending popup to document.body');
          document.body.appendChild(popup);
          console.log('[Text Selection] Popup successfully added to DOM');

          // Store popup reference for later cleanup
          window.__currentPopup = popup;

          // Remove popup on click outside - but only for translate button
          // For edit button, the input field handles its own blur event
          if (!isEditable) {
            setTimeout(() => {
              const clickHandler = function(e) {
                // Don't remove if clicking the popup itself or if translation is in progress
                if (popup && popup.parentNode && !popup.contains(e.target) && !window.__pendingTranslateButton) {
                  popup.remove();
                  document.removeEventListener('click', clickHandler);
                }
              };
              document.addEventListener('click', clickHandler);
            }, 100);
          }
        }

        document.addEventListener('mouseup', (e) => {
          setTimeout(() => {
            console.log('[Text Selection] Mouseup event detected');

            // Don't create new popup if editing input is active or processing API request
            if (isEditingInput) {
              console.log('[Text Selection] Ignoring mouseup - editing input is active');
              return;
            }

            if (isProcessingRequest) {
              console.log('[Text Selection] Ignoring mouseup - API request in progress');
              return;
            }

            const selection = window.getSelection();
            const text = selection.toString().trim();

            console.log('[Text Selection] Selected text:', text ? text.substring(0, 50) + '...' : '(empty)');

            if (!text) {
              if (popup) popup.remove();
              return;
            }

            // Check if selection is in editable field
            const activeElement = document.activeElement;
            const isEditable = activeElement && (
              activeElement.tagName === 'INPUT' ||
              activeElement.tagName === 'TEXTAREA' ||
              activeElement.isContentEditable
            );

            // Get selection position and range
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();

            // Clone the range to preserve it and store the element
            const clonedRange = range.cloneRange();
            const editableElement = isEditable ? activeElement : null;

            // For input/textarea, also store selection positions
            let selectionStart = null;
            let selectionEnd = null;
            if (editableElement && (editableElement.tagName === 'INPUT' || editableElement.tagName === 'TEXTAREA')) {
              selectionStart = editableElement.selectionStart;
              selectionEnd = editableElement.selectionEnd;
            }

            console.log('[Text Selection] Creating popup, isEditable:', isEditable);
            createPopup(text, rect.left + rect.width / 2, rect.top, isEditable, clonedRange, editableElement, selectionStart, selectionEnd);
          }, 10);
        });
      })();
    `);
  });

  // Also inject modular text selection script (ensures new tabs share same behavior)
  try {
    const textSelPath = path.join(__dirname, 'electron', 'textSelection', 'inject.js');
    const textSelCode = fs.readFileSync(textSelPath, 'utf8');
    browserView.webContents.on('did-finish-load', () => {
      browserView.webContents.executeJavaScript(textSelCode).catch(() => {});
    });
  } catch (e) {
    console.warn('[Electron] Text selection inject not loaded for initial view:', e.message || e);
  }

  // Apply modular context menu, shortcuts, find result forwarder, zoom state
  try {
    applyInitialZoom(browserView.webContents);
    attachShortcutsToWebContents(browserView.webContents, mainWindow);
    attachFoundInPageForwarder(browserView.webContents, mainWindow);
    registerContextMenuForWebContents(
      browserView.webContents,
      mainWindow,
      (url) => {
        const newTabId = Date.now();
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('create-new-tab', { tabId: newTabId, url });
        }
      }
    );
  } catch (e) {
    console.warn('[Electron] Failed to apply initial UX hooks:', e.message || e);
  }

  // Forward link hover target URL to toolbar for status bar
  browserView.webContents.on('update-target-url', (_e, url) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('status-url', url || '');
    }
  });

  // Inject Autofill script
  try {
    const injectPath = path.join(__dirname, 'electron', 'autofill', 'inject.js');
    const code = fs.readFileSync(injectPath, 'utf8');
    browserView.webContents.on('did-finish-load', () => {
      browserView.webContents.executeJavaScript(code).catch(() => {});
    });
  } catch (e) {
    console.warn('[Electron] Autofill inject not loaded:', e.message || e);
  }

  // Window resize 시 BrowserView bounds 업데이트
  mainWindow.on('resize', updateBrowserViewBounds);
  // Keep omnibox overlay above the content
  mainWindow.on('resize', bringOmniboxToFrontIfVisible);

  mainWindow.once('closed', () => {
    // BrowserView는 윈도우가 닫힐 때 자동으로 파괴되므로 수동 제거 불필요
    browserView = null;
    mainWindow = null;

    // 모든 탭 BrowserView 정리
    browserViews.clear();
  });
}

// Create a new BrowserView for a tab
function createBrowserViewForTab(tabId, options = {}) {
  console.log('[Electron] Creating BrowserView for tab:', tabId);

  // Create new BrowserView
  const webPreferences = {
    preload: path.join(__dirname, 'browser-view-preload.js'),
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    spellcheck: true,
  };
  if (options.incognito) {
    webPreferences.partition = `incog-${tabId}`; // in-memory session (no persist: prefix)
  }

  const newBrowserView = new BrowserView({
    webPreferences
  });

  // Setup event listeners for this BrowserView
  newBrowserView.webContents.on('did-navigate', () => {
    // Only send updates if this is the active tab
    if (currentTabId === tabId) {
      const url = newBrowserView.webContents.getURL();
      const title = newBrowserView.webContents.getTitle();
      mainWindow.webContents.send('url-changed', url, title);
    }
  });

  newBrowserView.webContents.on('did-navigate-in-page', () => {
    if (currentTabId === tabId) {
      const url = newBrowserView.webContents.getURL();
      const title = newBrowserView.webContents.getTitle();
      mainWindow.webContents.send('url-changed', url, title);
    }
  });

  newBrowserView.webContents.on('page-title-updated', () => {
    if (currentTabId === tabId) {
      const url = newBrowserView.webContents.getURL();
      const title = newBrowserView.webContents.getTitle();
      mainWindow.webContents.send('url-changed', url, title);
    }
  });

  // Handle new window requests (target="_blank", window.open, etc.)
  newBrowserView.webContents.setWindowOpenHandler(({ url }) => {
    console.log('[Electron] New window requested:', url);

    // Create new tab for the URL
    const newTabId = Date.now(); // Use timestamp as unique tab ID

    // Notify toolbar to create new tab with this URL
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('create-new-tab', {
        tabId: newTabId,
        url: url
      });
    }

    // Prevent default window.open behavior
    return { action: 'deny' };
  });

  // (Replaced) Text selection injection is handled by modular injector below

  // Inject modular text selection script for this view
  try {
    const textSelPath = path.join(__dirname, 'electron', 'textSelection', 'inject.js');
    const textSelCode = fs.readFileSync(textSelPath, 'utf8');
    newBrowserView.webContents.on('did-finish-load', () => {
      newBrowserView.webContents.executeJavaScript(textSelCode).catch(() => {});
    });
  } catch (e) {
    console.warn('[Electron] Text selection inject not loaded for tab:', e.message || e);
  }

  // Forward link hover target URL to toolbar for status bar
  newBrowserView.webContents.on('update-target-url', (_e, url) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('status-url', url || '');
    }
  });

  // Inject Autofill script on this view
  try {
    const injectPath = path.join(__dirname, 'electron', 'autofill', 'inject.js');
    const code = fs.readFileSync(injectPath, 'utf8');
    newBrowserView.webContents.on('did-finish-load', () => {
      newBrowserView.webContents.executeJavaScript(code).catch(() => {});
    });
  } catch (e) {
    console.warn('[Electron] Autofill inject not loaded for tab:', e.message || e);
  }

  // Attach per-view UX features
  try {
    applyInitialZoom(newBrowserView.webContents);
    attachShortcutsToWebContents(newBrowserView.webContents, mainWindow);
    attachFoundInPageForwarder(newBrowserView.webContents, mainWindow);
    registerContextMenuForWebContents(
      newBrowserView.webContents,
      mainWindow,
      (url) => {
        const newTabId = Date.now();
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('create-new-tab', { tabId: newTabId, url });
        }
      }
    );

    // Spellcheck languages
    try {
      const sess = newBrowserView.webContents.session;
      if (sess && typeof sess.setSpellCheckerEnabled === 'function') sess.setSpellCheckerEnabled(true);
      if (sess && typeof sess.setSpellCheckerLanguages === 'function') sess.setSpellCheckerLanguages(['en-US', 'ko']);
      // Ensure downloads are handled for non-default sessions too
      registerDownloadHandlers(sess, mainWindow);
    } catch {}
  } catch (e) {
    console.warn('[Electron] Failed to attach per-view UX hooks:', e.message || e);
  }

  // Store in map
  browserViews.set(tabId, newBrowserView);

  console.log('[Electron] BrowserView created and stored. Total BrowserViews:', browserViews.size);

  return newBrowserView;
}

// Switch to a different tab's BrowserView
function switchToTab(tabId) {
  console.log('[Electron] Switching to tab:', tabId);

  // Get the BrowserView for this tab
  const targetView = browserViews.get(tabId);

  if (!targetView) {
    console.error('[Electron] BrowserView not found for tab:', tabId);
    return false;
  }

  // Remove current BrowserView
  if (browserView && browserView !== targetView) {
    mainWindow.removeBrowserView(browserView);
  }

  // Add and show the target BrowserView
  browserView = targetView;
  currentTabId = tabId;
  mainWindow.addBrowserView(browserView);
  updateBrowserViewBounds();
  bringOmniboxToFrontIfVisible();
  if (omniboxVisible) attachOutsideClickCloser();

  // Send URL update to toolbar
  const url = browserView.webContents.getURL();
  const title = browserView.webContents.getTitle();
  mainWindow.webContents.send('url-changed', url, title);

  return true;
}

function updateBrowserViewBounds() {
  if (!mainWindow || !browserView) return;

  const { width, height } = mainWindow.getContentBounds();
  const chatPanelWidth = chatVisible ? Math.floor(width * 0.25) : 0; // 25% for chat when visible
  const browserWidth = width - chatPanelWidth; // 75% or 100% for browser
  const toolbarHeight = 40; // Toolbar height
  const tabBarHeight = 32; // Tab bar height (reduced)
  // Keep BrowserView fixed under the tab bar + toolbar (no extra overlay space)
  const topOffset = toolbarHeight + tabBarHeight;

  // BrowserView는 왼쪽에 배치 (toolbar + tab bar 아래)
  browserView.setBounds({
    x: 0,
    y: topOffset,
    width: browserWidth,
    height: height - topOffset
  });
  // Do not resize omnibox here; toolbar drives its position via IPC
}

// Macro Execution Overlay Functions
async function showMacroExecutionOverlay(macroName, progress, description, screenshot) {
  if (!browserView || !browserView.webContents) {
    console.log('[Macro Overlay] BrowserView not available');
    return;
  }

  // Check if document is ready for injection
  try {
    const hasDocument = await browserView.webContents.executeJavaScript(
      'typeof document !== "undefined" && document.readyState !== "loading"'
    ).catch(() => false);

    if (!hasDocument) {
      console.log('[Macro Overlay] Document not ready, retrying in 100ms...');
      setTimeout(() => {
        showMacroExecutionOverlay(macroName, progress, description, screenshot);
      }, 100);
      return;
    }
  } catch (err) {
    console.error('[Macro Overlay] Failed to check document readiness:', err.message);
    return;
  }

  try {
    await browserView.webContents.executeJavaScript(`
      (function(macroName, progress, description, screenshot) {
        let overlay = document.getElementById('__macro_overlay');
        if (!overlay) {
          // Create overlay first time
          overlay = document.createElement('div');
          overlay.id = '__macro_overlay';
          overlay.innerHTML = \`
            <style>
              #__macro_overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 20%, #f093fb 40%, #4facfe 60%, #00f2fe 80%, #43e97b 100%);
                background-size: 400% 400%;
                animation: gradient 20s ease infinite;
                z-index: 999999;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0;
              }
              @keyframes gradient {
                0% { background-position: 0% 50%; }
                50% { background-position: 100% 50%; }
                100% { background-position: 0% 50%; }
              }
              #__macro_content {
                background: white;
                border-radius: 12px;
                box-shadow: 0 30px 90px rgba(0,0,0,0.4);
                overflow: hidden;
                width: 85vw;
                height: 85vh;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
              }
              #__macro_header {
                background: rgba(246, 246, 246, 0.98);
                padding: 12px 16px;
                display: flex;
                align-items: center;
                gap: 12px;
                border-bottom: 1px solid rgba(0, 0, 0, 0.1);
                width: 100%;
                flex-shrink: 0;
              }
              #__macro_dots {
                display: flex;
                gap: 8px;
              }
              .dot {
                width: 12px;
                height: 12px;
                border-radius: 50%;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
              }
              .dot-red {
                background: linear-gradient(135deg, #ff5f57 0%, #ff4757 100%);
              }
              .dot-yellow {
                background: linear-gradient(135deg, #ffbd2e 0%, #ffa502 100%);
              }
              .dot-green {
                background: linear-gradient(135deg, #28ca42 0%, #26de81 100%);
              }
              #__macro_title {
                flex: 1;
                font-size: 14px;
                font-weight: 600;
                color: #333;
              }
              #__macro_img {
                display: block;
                width: 100%;
                height: 100%;
                max-width: 100%;
                max-height: 100%;
                object-fit: contain;
                object-position: center;
                background: white;
                flex: 1;
              }
              #__macro_footer {
                background: rgba(246, 246, 246, 0.98);
                padding: 16px;
                border-top: 1px solid rgba(0, 0, 0, 0.1);
                width: 100%;
                flex-shrink: 0;
              }
              #__macro_progress_container {
                margin-bottom: 8px;
              }
              #__macro_progress_bar {
                width: 100%;
                height: 6px;
                background: rgba(102, 126, 234, 0.2);
                border-radius: 3px;
                overflow: hidden;
              }
              #__macro_progress_fill {
                height: 100%;
                background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
                transition: width 0.3s ease;
                width: 0%;
              }
              #__macro_status {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-top: 8px;
              }
              #__macro_description {
                font-size: 13px;
                color: #666;
              }
              #__macro_percentage {
                font-size: 13px;
                font-weight: 600;
                color: #667eea;
              }
            </style>
            <div id="__macro_content">
              <div id="__macro_header">
                <div id="__macro_dots">
                  <div class="dot dot-red"></div>
                  <div class="dot dot-yellow"></div>
                  <div class="dot dot-green"></div>
                </div>
                <div id="__macro_title">Macro Running</div>
              </div>
              <img id="__macro_img" src="" />
              <div id="__macro_footer">
                <div id="__macro_progress_container">
                  <div id="__macro_progress_bar">
                    <div id="__macro_progress_fill"></div>
                  </div>
                </div>
                <div id="__macro_status">
                  <div id="__macro_description"></div>
                  <div id="__macro_percentage">0%</div>
                </div>
              </div>
            </div>
          \`;
          document.body.appendChild(overlay);
        }

        // Update title
        const titleEl = document.getElementById('__macro_title');
        if (titleEl) {
          titleEl.textContent = macroName || 'Macro Running';
        }

        // Update screenshot
        const img = document.getElementById('__macro_img');
        if (img && screenshot) {
          img.src = screenshot;
        }

        // Update progress
        const progressFill = document.getElementById('__macro_progress_fill');
        if (progressFill) {
          progressFill.style.width = progress + '%';
        }

        // Update description
        const descEl = document.getElementById('__macro_description');
        if (descEl) {
          descEl.textContent = description || '';
        }

        // Update percentage
        const percentEl = document.getElementById('__macro_percentage');
        if (percentEl) {
          percentEl.textContent = Math.round(progress) + '%';
        }
      })(${JSON.stringify(macroName)}, ${progress}, ${JSON.stringify(description)}, ${JSON.stringify(screenshot)});
    `);
    console.log('[Macro Overlay] Overlay injected successfully');
  } catch (err) {
    console.error('[Macro Overlay] Failed to inject overlay:', err.message);
  }
}

function removeMacroExecutionOverlay() {
  if (!browserView || !browserView.webContents) {
    console.log('[Macro Overlay] BrowserView not available');
    return;
  }

  try {
    browserView.webContents.executeJavaScript(`
      (function() {
        const overlay = document.getElementById('__macro_overlay');
        if (overlay) {
          overlay.remove();
        }
      })();
    `).catch((err) => {
      console.error('[Macro Overlay] Failed to remove overlay:', err.message);
    });
  } catch (err) {
    console.error('[Macro Overlay] Overlay removal error:', err);
  }
}

// IPC: Handle translation request from BrowserView
ipcMain.on('browserview-translate-request', async (event, text) => {
  console.log('[Electron] Translation request from BrowserView:', text.substring(0, 50) + '...');

  try {
    // Get selected model and API keys from chat UI's localStorage
    const selectedModel = await mainWindow.webContents.executeJavaScript('localStorage.getItem("selectedModel")');
    const openaiKey = await mainWindow.webContents.executeJavaScript('localStorage.getItem("openai_api_key")');
    const googleKey = await mainWindow.webContents.executeJavaScript('localStorage.getItem("google_api_key")');
    const claudeKey = await mainWindow.webContents.executeJavaScript('localStorage.getItem("claude_api_key")');

    // Decode base64 API keys and set to environment
    if (openaiKey) process.env.OPENAI_API_KEY = Buffer.from(openaiKey, 'base64').toString('utf8');
    if (googleKey) process.env.GOOGLE_API_KEY = Buffer.from(googleKey, 'base64').toString('utf8');
    if (claudeKey) process.env.CLAUDE_API_KEY = Buffer.from(claudeKey, 'base64').toString('utf8');

    const modelName = selectedModel || 'gpt-5-mini';
    console.log('[Electron] Using model for translation:', modelName);

    // Create LLMService with selected model
    const tempLLMService = new LLMService(modelName);

    const prompt = `Translate the following text to English. Only provide the translation, no explanations:\n\n${text}`;
    const translation = await tempLLMService.chat([{ role: 'user', content: prompt }]);

    // Send result back to requesting BrowserView
    if (event && event.sender) {
      console.log('[Electron] Sending translation result:', translation);
      event.sender.send('browserview-translation-result', { translation });
      console.log('[Electron] Translation completed and sent to BrowserView');
    }
  } catch (error) {
    console.error('[Electron] Translation failed:', error);
    if (event && event.sender) {
      event.sender.send('browserview-translation-result', { error: error.message });
    }
  }
});

// IPC: Handle AI edit request from BrowserView
ipcMain.on('browserview-edit-request', async (event, { text, prompt }) => {
  console.log('[Electron] AI edit request from BrowserView');

  try {
    // Get selected model and API keys from chat UI's localStorage
    const selectedModel = await mainWindow.webContents.executeJavaScript('localStorage.getItem("selectedModel")');
    const openaiKey = await mainWindow.webContents.executeJavaScript('localStorage.getItem("openai_api_key")');
    const googleKey = await mainWindow.webContents.executeJavaScript('localStorage.getItem("google_api_key")');
    const claudeKey = await mainWindow.webContents.executeJavaScript('localStorage.getItem("claude_api_key")');

    // Decode base64 API keys and set to environment
    if (openaiKey) process.env.OPENAI_API_KEY = Buffer.from(openaiKey, 'base64').toString('utf8');
    if (googleKey) process.env.GOOGLE_API_KEY = Buffer.from(googleKey, 'base64').toString('utf8');
    if (claudeKey) process.env.CLAUDE_API_KEY = Buffer.from(claudeKey, 'base64').toString('utf8');

    const modelName = selectedModel || 'gpt-5-mini';
    console.log('[Electron] Using model for AI edit:', modelName);

    // Create LLMService with selected model
    const tempLLMService = new LLMService(modelName);

    const fullPrompt = `${prompt}\n\nOriginal text:\n${text}\n\nOnly provide the edited text, no explanations:`;
    const editedText = await tempLLMService.chat([{ role: 'user', content: fullPrompt }]);

    // Send result back to requesting BrowserView
    if (event && event.sender) {
      event.sender.send('browserview-edit-result', { editedText });
      console.log('[Electron] AI edit completed and sent to BrowserView');
    }
  } catch (error) {
    console.error('[Electron] AI edit failed:', error);
    if (event && event.sender) {
      event.sender.send('browserview-edit-result', { error: error.message });
    }
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (browserController) {
    browserController.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC: 작업 분석 (단순 질문 vs 브라우저 작업 판별)
ipcMain.handle('analyze-task', async (event, { task, model, conversationHistory }) => {
  console.log('[Electron] Analyzing task type:', task);
  console.log('[Electron] Conversation history length:', conversationHistory ? conversationHistory.length : 0);

  try {
    // Get API keys from settings tab (localStorage)
    const openaiKey = await mainWindow.webContents.executeJavaScript('localStorage.getItem("openai_api_key")');
    const googleKey = await mainWindow.webContents.executeJavaScript('localStorage.getItem("google_api_key")');
    const claudeKey = await mainWindow.webContents.executeJavaScript('localStorage.getItem("claude_api_key")');

    // Decode base64 API keys and set to environment
    if (openaiKey) {
      process.env.OPENAI_API_KEY = Buffer.from(openaiKey, 'base64').toString('utf8');
    }
    if (googleKey) {
      process.env.GOOGLE_API_KEY = Buffer.from(googleKey, 'base64').toString('utf8');
    }
    if (claudeKey) {
      process.env.CLAUDE_API_KEY = Buffer.from(claudeKey, 'base64').toString('utf8');
    }

    // LLM이 tool을 선택하도록 함
    const tempLLM = new LLMService(model || 'gpt-4o-mini');

    // Build conversation context
    let contextPrompt = 'You are a helpful AI assistant.';

    if (conversationHistory && conversationHistory.length > 0) {
      contextPrompt += '\n\nConversation history:';
      conversationHistory.forEach((msg) => {
        if (msg.type === 'user') {
          contextPrompt += `\nUser: ${msg.text}`;
        } else if (msg.type === 'assistant') {
          contextPrompt += `\nAssistant: ${msg.text}`;
        }
      });
      contextPrompt += `\n\nNow the user asks: "${task}"`;
    } else {
      contextPrompt += ` The user has asked: "${task}"`;
    }

    const analysisPrompt = contextPrompt + `

You have two options:
1. If you can answer this question directly without needing to browse the web, use the "answer_directly" tool
2. If you need to browse the web, search for information, or interact with websites, use the "needs_browser" tool

Examples:
- "What is 1+1?" → use answer_directly (you know math)
- "What day is today?" → use answer_directly (use current date)
- "오늘 몇일이야?" → use answer_directly (use current date)
- "Explain how React works" → use answer_directly (you know programming)
- "Search Google for AI news" → use needs_browser (explicitly needs web search)
- "Go to Amazon and find laptops" → use needs_browser (needs web browsing)
- "What's the weather today?" → use needs_browser (needs real-time weather data)

Choose the appropriate tool now.`;

    const tools = [
      {
        type: 'function',
        function: {
          name: 'answer_directly',
          description: 'Use this when you can answer the user\'s question directly without browsing the web. Provide your answer as the response parameter.',
          parameters: {
            type: 'object',
            properties: {
              response: {
                type: 'string',
                description: 'Your direct answer to the user\'s question'
              }
            },
            required: ['response']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'needs_browser',
          description: 'Use this when you need to browse the web, search for information, or interact with websites to answer the question.',
          parameters: {
            type: 'object',
            properties: {
              reason: {
                type: 'string',
                description: 'Brief explanation of why browser automation is needed'
              }
            },
            required: ['reason']
          }
        }
      }
    ];

    const response = await tempLLM.chatWithTools(
      [{ role: 'user', content: analysisPrompt }],
      tools
    );

    // Check if tool was called
    if (response.toolCalls && response.toolCalls.length > 0) {
      const toolCall = response.toolCalls[0];
      const toolName = toolCall.function.name;
      const toolArgs = JSON.parse(toolCall.function.arguments);

      if (toolName === 'answer_directly') {
        return {
          taskType: 'chat',
          reason: 'AI chose to answer directly',
          response: toolArgs.response
        };
      } else if (toolName === 'needs_browser') {
        return {
          taskType: 'browser',
          reason: toolArgs.reason || 'Needs browser automation'
        };
      }
    }

    // LLM이 직접 답변한 경우 (tool 사용 안 함)
    return {
      taskType: 'chat',
      reason: 'No tool call (LLM answered directly)',
      response: response.content || "I couldn't process that request. Please try rephrasing."
    };

  } catch (error) {
    console.error('[Electron] Error analyzing task:', error);
    // Fallback: treat as browser task on error
    return { taskType: 'browser', reason: 'Analysis error' };
  }
});

// IPC: 작업 실행
ipcMain.handle('run-task', async (event, { taskPlan, model, settings, conversationHistory }) => {
  console.log('[Electron] Task received:', taskPlan);
  console.log('[Electron] Model:', model || 'gpt-5-mini');
  console.log('[Electron] Conversation history length:', conversationHistory ? conversationHistory.length : 0);
  if (settings) {
    console.log('[Electron] Settings:', {
      visionModel: settings.visionModel || '(default)',
      syncResultToBrowserView: settings.syncResultToBrowserView !== undefined ? settings.syncResultToBrowserView : true,
      syncCookies: settings.syncCookies || false
    });
  }

  if (isTaskRunning) {
    return { success: false, error: 'Task is already running' };
  }

  isTaskRunning = true;
  stopRequested = false;
  aiWorkingTabId = currentTabId; // 현재 탭을 AI 작업 탭으로 설정
  console.log('[Electron] AI task started on tab:', aiWorkingTabId);

  // 비동기로 작업 실행 (Stop 버튼이 작동하도록)
  (async () => {
    let prevEnv;
    try {
      // === HYBRID MODE: Step 1 - Save current BrowserView state ===
      const currentURL = browserView ? browserView.webContents.getURL() : '';
      const currentTitle = browserView ? browserView.webContents.getTitle() : '';
      console.log('[Hybrid] Current BrowserView URL:', currentURL);
      console.log('[Hybrid] Current BrowserView Title:', currentTitle);

      // Get cookies from BrowserView (for syncing to Playwright)
      let browserViewCookies = [];
      if (browserView) {
        try {
          browserViewCookies = await browserView.webContents.session.cookies.get({});
          console.log('[Hybrid] Retrieved', browserViewCookies.length, 'cookies from BrowserView');
          if (settings && settings.syncCookies) {
            console.log('[Hybrid] Cookie sync enabled');
          }
        } catch (error) {
          console.error('[Hybrid] Failed to get BrowserView cookies:', error);
        }
      }

      // 이전 인스턴스 정리
      if (browserController) {
        await browserController.close();
      }

      // Get API keys from settings tab (localStorage)
      const openaiKey = await mainWindow.webContents.executeJavaScript('localStorage.getItem("openai_api_key")');
      const googleKey = await mainWindow.webContents.executeJavaScript('localStorage.getItem("google_api_key")');
      const claudeKey = await mainWindow.webContents.executeJavaScript('localStorage.getItem("claude_api_key")');

      // Decode base64 API keys and set to environment
      if (openaiKey) {
        process.env.OPENAI_API_KEY = Buffer.from(openaiKey, 'base64').toString('utf8');
        console.log('[Electron] Using OpenAI API key from settings tab');
      }
      if (googleKey) {
        process.env.GOOGLE_API_KEY = Buffer.from(googleKey, 'base64').toString('utf8');
        console.log('[Electron] Using Google API key from settings tab');
      }
      if (claudeKey) {
        process.env.CLAUDE_API_KEY = Buffer.from(claudeKey, 'base64').toString('utf8');
        console.log('[Electron] Using Claude API key from settings tab');
      }

      // 환경 구성 병합: UI에서 온 설정값이 있으면 우선 적용 (프로세스 env override)
      // *** LLMService 생성 전에 환경변수를 먼저 설정해야 비전 모델이 올바르게 초기화됨 ***
      prevEnv = {
        VISION_MODEL: process.env.VISION_MODEL,
      };
      if (settings && settings.visionModel) {
        process.env.VISION_MODEL = settings.visionModel;
        console.log('[Electron] Setting VISION_MODEL to:', settings.visionModel);
      }

      // === HYBRID MODE: Step 2 - Launch Playwright in headless, stream screenshots to BrowserView ===
      console.log('[Hybrid] Launching Playwright in headless mode, will stream screenshots to BrowserView');

      const debugMode = true;
      const profile = new BrowserProfile({ headless: true });
      browserController = new BrowserController(debugMode, profile);
      llmService = new LLMService(model || 'gpt-4o-mini');
      // Apply iteration/action limits from settings if provided
      try {
        if (settings && typeof settings.maxIterations === 'number') {
          llmService.setMaxIterations(settings.maxIterations);
          console.log('[Electron] Applied maxIterations:', settings.maxIterations);
        }
        if (settings && typeof settings.maxActionsPerStep === 'number') {
          llmService.setMaxActionsPerStep(settings.maxActionsPerStep);
          console.log('[Electron] Applied maxActionsPerStep:', settings.maxActionsPerStep);
        }
      } catch (e) {
        console.warn('[Electron] Failed to apply limit settings:', e?.message || e);
      }

      console.log('[Hybrid] Will stream AI screenshots to BrowserView');

      // 브라우저 시작
      await browserController.launch();

      // === EVENTBUS BRIDGE: Forward internal events to Chat UI ===
      // This allows watchdog/navigation logs to appear in the UI
      browserController.eventBus.on('*', (event) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('agent-internal-event', event);
        }
      });

      // === AUTO SCREENSHOT STREAMING ===
      // BrowserController doesn't auto-emit screenshot events in Electron environment
      // So we manually capture screenshots every 1 second and stream to Chat UI + BrowserView overlay
      screenshotInterval = setInterval(async () => {
        if (browserController && !stopRequested && aiWorkingTabId !== null) {
          try {
            const screenshotBuffer = await browserController.captureScreenshot();

            if (screenshotBuffer) {
              const screenshotBase64 = screenshotBuffer.toString('base64');
              const screenshotDataURL = `data:image/png;base64,${screenshotBase64}`;
              const currentUrl = browserController.getCurrentUrl();

              // Send screenshot to Chat UI (mainWindow) with tabId
              if (mainWindow) {
                mainWindow.webContents.send('agent-screenshot', {
                  screenshot: screenshotDataURL,
                  timestamp: Date.now(),
                  url: currentUrl,
                  tabId: aiWorkingTabId  // AI 작업 중인 탭 ID 포함
                });
              }

              // Inject overlay to AI working tab with screenshot
              const aiTabView = browserViews.get(aiWorkingTabId);
              if (aiTabView && aiTabView.webContents && !aiTabView.webContents.isDestroyed()) {
                // Check if page is ready
                if (!aiTabView.webContents.isLoading()) {
                  try {
                    // Use executeJavaScript with minimal code to update/create overlay
                    // This approach works better than CSS for dynamic image updates
                    aiTabView.webContents.executeJavaScript(`
                      (function(screenshot) {
                        let overlay = document.getElementById('__ai_overlay');
                        if (!overlay) {
                          // Create overlay first time
                          overlay = document.createElement('div');
                          overlay.id = '__ai_overlay';
                          overlay.innerHTML = \`
                            <style>
                              #__ai_overlay {
                                position: fixed;
                                top: 0;
                                left: 0;
                                width: 100vw;
                                height: 100vh;
                                background: linear-gradient(135deg, #667eea 0%, #764ba2 20%, #f093fb 40%, #4facfe 60%, #00f2fe 80%, #43e97b 100%);
                                background-size: 400% 400%;
                                animation: gradient 20s ease infinite;
                                z-index: 999999;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                padding: 0;
                              }
                              @keyframes gradient {
                                0% { background-position: 0% 50%; }
                                50% { background-position: 100% 50%; }
                                100% { background-position: 0% 50%; }
                              }
                              #__ai_content {
                                background: white;
                                border-radius: 12px;
                                box-shadow: 0 30px 90px rgba(0,0,0,0.4);
                                overflow: hidden;
                                max-width: 85vw;
                                max-height: 85vh;
                                display: flex;
                                flex-direction: column;
                                align-items: center;
                                justify-content: center;
                              }
                              #__ai_header {
                                background: rgba(246, 246, 246, 0.98);
                                padding: 12px 16px;
                                display: flex;
                                align-items: center;
                                gap: 8px;
                                border-bottom: 1px solid rgba(0, 0, 0, 0.1);
                                width: 100%;
                                flex-shrink: 0;
                              }
                              #__ai_dots {
                                display: flex;
                                gap: 8px;
                              }
                              .dot {
                                width: 12px;
                                height: 12px;
                                border-radius: 50%;
                                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                              }
                              .dot-red {
                                background: linear-gradient(135deg, #ff5f57 0%, #ff4757 100%);
                              }
                              .dot-yellow {
                                background: linear-gradient(135deg, #ffbd2e 0%, #ffa502 100%);
                              }
                              .dot-green {
                                background: linear-gradient(135deg, #28ca42 0%, #26de81 100%);
                              }
                              #__ai_img {
                                display: block;
                                max-width: 85vw;
                                max-height: calc(85vh - 50px);
                                width: auto;
                                height: auto;
                                object-fit: contain;
                                object-position: center;
                                background: white;
                              }
                            </style>
                            <div id="__ai_content">
                              <div id="__ai_header">
                                <div id="__ai_dots">
                                  <div class="dot dot-red"></div>
                                  <div class="dot dot-yellow"></div>
                                  <div class="dot dot-green"></div>
                                </div>
                              </div>
                              <img id="__ai_img" src="" />
                            </div>
                          \`;
                          document.body.appendChild(overlay);
                        }

                        // Update screenshot
                        const img = document.getElementById('__ai_img');
                        if (img && screenshot) {
                          img.src = screenshot;
                        }
                      })(${JSON.stringify(screenshotDataURL)});
                    `).then(() => {
                      console.log('[Hybrid] Overlay with screenshot injected successfully');
                    }).catch((err) => {
                      console.error('[Hybrid] Failed to inject overlay:', err.message);
                    });
                  } catch (err) {
                    console.error('[Hybrid] Overlay injection error:', err);
                  }
                } else {
                  console.log('[Hybrid] AI tab is still loading, skipping overlay injection');
                }
              } else {
                console.log('[Hybrid] AI tab view not available or destroyed');
              }
            } else {
              console.log('[Hybrid] No screenshot buffer captured');
            }
          } catch (error) {
            console.error('[Hybrid] Screenshot capture failed:', error);
          }
        }
      }, 1000); // Every 1 second

      console.log('[Hybrid] Auto-screenshot streaming started (1fps)');

      // === HYBRID MODE: Step 3 - Sync cookies to Playwright ===
      if (settings && settings.syncCookies && browserViewCookies.length > 0) {
        console.log('[Hybrid] Syncing cookies to Playwright...');
        try {
          // Convert Electron cookies to Playwright format
          const playwrightCookies = browserViewCookies
            .map(cookie => {
              // Normalize sameSite value to Playwright format
              let sameSite = 'Lax'; // Default fallback

              if (cookie.sameSite) {
                const sameSiteLower = cookie.sameSite.toLowerCase();
                if (sameSiteLower === 'strict') {
                  sameSite = 'Strict';
                } else if (sameSiteLower === 'lax') {
                  sameSite = 'Lax';
                } else if (sameSiteLower === 'none' || sameSiteLower === 'no_restriction') {
                  sameSite = 'None';
                } else if (sameSiteLower === 'unspecified') {
                  sameSite = 'Lax';
                }
              }

              return {
                name: cookie.name,
                value: cookie.value,
                domain: cookie.domain,
                path: cookie.path,
                expires: cookie.expirationDate || -1,
                httpOnly: cookie.httpOnly || false,
                secure: cookie.secure || false,
                sameSite: sameSite
              };
            })
            .filter(cookie => {
              // Filter out invalid cookies
              if (!cookie.name || !cookie.value) {
                console.warn('[Hybrid] Skipping invalid cookie:', cookie.name);
                return false;
              }
              return true;
            });

          await browserController.setCookies(playwrightCookies);
          console.log('[Hybrid] Synced', playwrightCookies.length, 'cookies to Playwright');
        } catch (error) {
          console.error('[Hybrid] Failed to sync cookies to Playwright:', error);
        }
      }

      // === HYBRID MODE: Step 4 - Always start from current BrowserView page ===
      // If user is viewing a page (not blank/chrome), start AI agent from that page
      if (currentURL && currentURL !== 'about:blank' && !currentURL.startsWith('chrome://') && !currentURL.startsWith('devtools://')) {
        console.log('[Hybrid] Starting AI agent from current BrowserView URL:', currentURL);
        await browserController.goTo(currentURL);
      } else {
        console.log('[Hybrid] No valid current page, AI will start from scratch');
      }

      if (mainWindow) {
        mainWindow.webContents.send('agent-started', { task: taskPlan });
      }

      // AI 작업 실행
      const result = await llmService.executeTask(taskPlan, browserController, (log) => {
        if (mainWindow) {
          mainWindow.webContents.send('agent-log', log);
        }
      }, () => stopRequested);

      console.log('[Electron] Task completed:', result);

      // === HYBRID MODE: Step 5 - Stop auto-screenshot and remove overlay FIRST ===
      if (screenshotInterval) {
        clearInterval(screenshotInterval);
        screenshotInterval = null;
        console.log('[Hybrid] Auto-screenshot streaming stopped');
      }

      // Store tab ID before clearing (FIX: overlay cleanup bug)
      const completedTabId = aiWorkingTabId;

      // Clear AI working tab
      console.log('[Electron] AI task ended, releasing tab:', completedTabId);
      aiWorkingTabId = null;

      // Remove overlay from AI working tab (using stored ID)
      const completedTabView = browserViews.get(completedTabId);
      if (completedTabView && completedTabView.webContents && !completedTabView.webContents.isDestroyed()) {
        try {
          await completedTabView.webContents.executeJavaScript(`
            (function() {
              const overlay = document.getElementById('__ai_overlay');
              if (overlay) overlay.remove();
            })();
          `);
          console.log('[Hybrid] Overlay removed successfully');
        } catch (error) {
          console.log('[Hybrid] Could not remove overlay:', error.message);
        }
      }

      // === HYBRID MODE: Step 6 - Restore BrowserView and sync result ===
      const syncResult = settings && settings.syncResultToBrowserView !== false; // default true
      if (syncResult && browserView) {
        try {
          const finalURL = browserController.getCurrentUrl();
          console.log('[Hybrid] Final URL from Playwright:', finalURL);

          if (finalURL && finalURL !== 'about:blank' && !finalURL.startsWith('chrome://')) {
            console.log('[Hybrid] Syncing result to BrowserView...');
            await browserView.webContents.loadURL(finalURL);
            console.log('[Hybrid] BrowserView navigated to:', finalURL);

            // === HYBRID MODE: Step 7 - Sync cookies back to BrowserView ===
            if (settings && settings.syncCookies) {
              console.log('[Hybrid] Syncing cookies back to BrowserView...');
              try {
                const playwrightCookies = await browserController.getCookies();

                for (const cookie of playwrightCookies) {
                  try {
                    await browserView.webContents.session.cookies.set({
                      url: `https://${cookie.domain}${cookie.path}`,
                      name: cookie.name,
                      value: cookie.value,
                      domain: cookie.domain,
                      path: cookie.path,
                      secure: cookie.secure,
                      httpOnly: cookie.httpOnly,
                      expirationDate: cookie.expires > 0 ? cookie.expires : undefined,
                      sameSite: cookie.sameSite || 'lax'
                    });
                  } catch (cookieError) {
                    // Ignore individual cookie errors
                  }
                }

                console.log('[Hybrid] Synced', playwrightCookies.length, 'cookies back to BrowserView');
              } catch (error) {
                console.error('[Hybrid] Failed to sync cookies to BrowserView:', error);
              }
            }
          } else {
            console.log('[Hybrid] No valid URL to sync (URL:', finalURL, ')');
          }
        } catch (error) {
          console.error('[Hybrid] Failed to sync result to BrowserView:', error);
        }
      }

      if (mainWindow && isTaskRunning) {
        mainWindow.webContents.send('agent-stopped', {
          reason: result.success ? 'Task Completed' : 'Task Failed',
          success: result.success,
          report: result.message  // 보고서로 전달
        });
      }

      console.log('[Hybrid] Task execution completed, switched back to BrowserView mode');

    } catch (error) {
      console.error('[Electron] Task error:', error);

      // Stop auto-screenshot and remove overlay on error
      if (screenshotInterval) {
        clearInterval(screenshotInterval);
        screenshotInterval = null;
      }

      // Clear AI working tab on error
      console.log('[Electron] AI task error, releasing tab:', aiWorkingTabId);

      // Remove overlay from AI working tab
      const errorTabView = browserViews.get(aiWorkingTabId);
      if (errorTabView && errorTabView.webContents && !errorTabView.webContents.isDestroyed()) {
        try {
          await errorTabView.webContents.executeJavaScript(`
            (function() {
              const overlay = document.getElementById('__ai_overlay');
              if (overlay) overlay.remove();
            })();
          `);
          console.log('[Hybrid] Overlay removed on error');
        } catch (err) {
          console.log('[Hybrid] Failed to remove overlay on error:', err.message);
        }
      }

      aiWorkingTabId = null;

      if (mainWindow && isTaskRunning) {
        mainWindow.webContents.send('agent-stopped', {
          reason: 'Error',
          success: false,
          report: error.message
        });
      }
    } finally {
      // Ensure flags reset even if errors occur
      isTaskRunning = false;
      stopRequested = false;
      // Restore previous env
      if (prevEnv) {
        if (prevEnv.VISION_MODEL !== undefined) process.env.VISION_MODEL = prevEnv.VISION_MODEL; else delete process.env.VISION_MODEL;
      }
      if (browserController) {
        await browserController.close();
        browserController = null;
      }
    }
  })();

  // 즉시 응답 반환
  return { success: true, message: 'Task started' };
});

// IPC: API 키 업데이트
ipcMain.handle('update-api-keys', async (_event, { openai, google, claude }) => {
  console.log('[Electron] Updating API keys...');

  try {
    if (openai) {
      process.env.OPENAI_API_KEY = openai;
      console.log('[Electron] OpenAI API key updated');
    }

    if (google) {
      process.env.GOOGLE_API_KEY = google;
      console.log('[Electron] Google API key updated');
    }

    if (claude) {
      process.env.CLAUDE_API_KEY = claude;
      console.log('[Electron] Claude API key updated');
    }

    return { success: true };
  } catch (error) {
    console.error('[Electron] Failed to update API keys:', error);
    return { success: false, error: error.message };
  }
});

// Note: Legacy 'translate-text-request' and 'ai-edit-text-request' removed
// These were unused - actual translation/editing uses 'browserview-translate-request'
// and 'browserview-edit-request' handled below

// IPC: Execute search from home page
ipcMain.on('execute-home-search', async (_event, query) => {
  console.log('[Electron] Home search requested:', query);
  console.log('[Electron] Query type:', typeof query);
  console.log('[Electron] Query length:', query ? query.length : 0);

  try {
    // Check if mainWindow is ready
    if (!mainWindow || mainWindow.isDestroyed()) {
      console.error('[Electron] mainWindow not available');
      return;
    }

    if (!mainWindow.webContents) {
      console.error('[Electron] mainWindow.webContents not available');
      return;
    }

    console.log('[Electron] mainWindow ready:', mainWindow.webContents.isLoading());

    // Wait for window to be ready if it's still loading
    if (mainWindow.webContents.isLoading()) {
      console.log('[Electron] Waiting for mainWindow to finish loading...');
      await new Promise(resolve => {
        mainWindow.webContents.once('did-finish-load', resolve);
      });
    }

    // Send message to toolbar to open chat and execute the query
    console.log('[Electron] Sending to toolbar:', query);
    mainWindow.webContents.send('execute-home-search', query);
    console.log('[Electron] Message sent successfully');
  } catch (error) {
    console.error('[Electron] Home search failed:', error);
  }
});

// IPC: Translate text to English (from toolbar)
ipcMain.handle('translate-text', async (_event, { text }) => {
  console.log('[Electron] Translate text requested:', text.substring(0, 50) + '...');

  try {
    // Get selected model and API keys from chat UI's localStorage
    const selectedModel = await mainWindow.webContents.executeJavaScript('localStorage.getItem("selectedModel")');
    const openaiKey = await mainWindow.webContents.executeJavaScript('localStorage.getItem("openai_api_key")');
    const googleKey = await mainWindow.webContents.executeJavaScript('localStorage.getItem("google_api_key")');
    const claudeKey = await mainWindow.webContents.executeJavaScript('localStorage.getItem("claude_api_key")');

    // Decode base64 API keys and set to environment
    if (openaiKey) process.env.OPENAI_API_KEY = Buffer.from(openaiKey, 'base64').toString('utf8');
    if (googleKey) process.env.GOOGLE_API_KEY = Buffer.from(googleKey, 'base64').toString('utf8');
    if (claudeKey) process.env.CLAUDE_API_KEY = Buffer.from(claudeKey, 'base64').toString('utf8');

    const modelName = selectedModel || 'gpt-5-mini';
    console.log('[Electron] Using model for translation:', modelName);

    const tempLLMService = new LLMService(modelName);

    const prompt = `Translate the following text to English. Only provide the translation, no explanations:\n\n${text}`;
    const response = await tempLLMService.chat([{ role: 'user', content: prompt }]);

    return { success: true, translation: response };
  } catch (error) {
    console.error('[Electron] Translation failed:', error);
    return { success: false, error: error.message };
  }
});

// IPC: AI edit text with user prompt
ipcMain.handle('ai-edit-text', async (_event, { text, prompt }) => {
  console.log('[Electron] AI edit text requested');

  try {
    // Get selected model and API keys from chat UI's localStorage
    const selectedModel = await mainWindow.webContents.executeJavaScript('localStorage.getItem("selectedModel")');
    const openaiKey = await mainWindow.webContents.executeJavaScript('localStorage.getItem("openai_api_key")');
    const googleKey = await mainWindow.webContents.executeJavaScript('localStorage.getItem("google_api_key")');
    const claudeKey = await mainWindow.webContents.executeJavaScript('localStorage.getItem("claude_api_key")');

    // Decode base64 API keys and set to environment
    if (openaiKey) process.env.OPENAI_API_KEY = Buffer.from(openaiKey, 'base64').toString('utf8');
    if (googleKey) process.env.GOOGLE_API_KEY = Buffer.from(googleKey, 'base64').toString('utf8');
    if (claudeKey) process.env.CLAUDE_API_KEY = Buffer.from(claudeKey, 'base64').toString('utf8');

    const modelName = selectedModel || 'gpt-5-mini';
    console.log('[Electron] Using model for AI edit:', modelName);

    const tempLLMService = new LLMService(modelName);

    const fullPrompt = `${prompt}\n\nOriginal text:\n${text}\n\nOnly provide the edited text, no explanations:`;
    const response = await tempLLMService.chat([{ role: 'user', content: fullPrompt }]);

    return { success: true, editedText: response };
  } catch (error) {
    console.error('[Electron] AI edit failed:', error);
    return { success: false, error: error.message };
  }
});

// IPC: 작업 중단
ipcMain.handle('stop-task', async (event) => {
  console.log('[Electron] Stop task requested');

  try {
    if (isTaskRunning) {
      // LLM 루프에 중단 신호 전달
      stopRequested = true;

      // Stop auto-screenshot and remove overlay when stopped
      if (screenshotInterval) {
        clearInterval(screenshotInterval);
        screenshotInterval = null;
      }

      // Clear AI working tab on stop
      console.log('[Electron] AI task stopped, releasing tab:', aiWorkingTabId);

      // Remove overlay from AI working tab
      const stoppedTabView = browserViews.get(aiWorkingTabId);
      if (stoppedTabView && stoppedTabView.webContents && !stoppedTabView.webContents.isDestroyed()) {
        try {
          await stoppedTabView.webContents.executeJavaScript(`
            (function() {
              const overlay = document.getElementById('__ai_overlay');
              if (overlay) overlay.remove();
            })();
          `);
          console.log('[Hybrid] Overlay removed on stop');
        } catch (err) {
          console.log('[Hybrid] Failed to remove overlay on stop:', err.message);
        }
      }

      aiWorkingTabId = null;

      // 브라우저가 열려 있으면 즉시 닫아 리소스 해제 (try/catch 보호)
      if (browserController) {
        try {
          await browserController.close();
        } catch (_) {}
        browserController = null;
      }
      llmService = null;

      if (mainWindow) {
        mainWindow.webContents.send('agent-stopped', {
          reason: 'Stopped by user',
          success: false,
          report: 'Task was manually stopped'
        });
      }

      console.log('[Electron] Task stopped successfully');
      return { success: true };
      } else {
      console.log('[Electron] No task running to stop');
      return { success: false, error: 'No task is currently running' };
    }
  } catch (error) {
    console.error('[Electron] Error stopping task:', error);
    isTaskRunning = false;
    stopRequested = false;
    return { success: false, error: error.message };
  }
});

// IPC: Switch to specific tab
ipcMain.handle('switch-to-tab', async (event, tabId) => {
  console.log('[Electron] Switch to tab requested:', tabId);

  try {
    if (!browserViews.has(tabId)) {
      console.error('[Electron] Tab not found:', tabId);
      return { success: false, error: 'Tab not found' };
    }

    // Hide current view
    if (browserView) {
      mainWindow.removeBrowserView(browserView);
    }

    // Show target view
    browserView = browserViews.get(tabId);
    currentTabId = tabId;
    mainWindow.addBrowserView(browserView);
    updateBrowserViewBounds();

    // Send URL update to toolbar
    const url = browserView.webContents.getURL();
    const title = browserView.webContents.getTitle();
    mainWindow.webContents.send('url-changed', url, title);

    // Notify toolbar to update tab UI
    mainWindow.webContents.send('tab-switched', { tabId });

    console.log('[Electron] Successfully switched to tab:', tabId);
    return { success: true };
  } catch (error) {
    console.error('[Electron] Failed to switch tab:', error);
    return { success: false, error: error.message };
  }
});

// IPC: Browser navigation (from toolbar)
ipcMain.handle('browser-navigation', async (event, { action, url }) => {
  console.log('[Electron] Browser navigation:', action, url);

  try {
    if (!browserView) {
      return { success: false, error: 'BrowserView not initialized' };
    }

    switch (action) {
      case 'navigate':
        if (url) {
          await browserView.webContents.loadURL(url);
          return { success: true };
        }
        return { success: false, error: 'URL is required' };

      case 'back':
        if (browserView.webContents.canGoBack()) {
          browserView.webContents.goBack();
          return { success: true };
        }
        return { success: false, error: 'Cannot go back' };

      case 'forward':
        if (browserView.webContents.canGoForward()) {
          browserView.webContents.goForward();
          return { success: true };
        }
        return { success: false, error: 'Cannot go forward' };

      case 'reload':
        browserView.webContents.reload();
        return { success: true };

      default:
        return { success: false, error: 'Unknown action' };
    }
  } catch (error) {
    console.error('[Electron] Browser navigation error:', error);
    return { success: false, error: error.message };
  }
});

// IPC: Get browser navigation state
ipcMain.handle('browser-can-navigate', async () => {
  if (!browserView) {
    return { canGoBack: false, canGoForward: false };
  }

  return {
    canGoBack: browserView.webContents.canGoBack(),
    canGoForward: browserView.webContents.canGoForward()
  };
});

// IPC: Get current URL
ipcMain.handle('browser-get-url', async () => {
  if (!browserView) {
    return null;
  }

  return browserView.webContents.getURL();
});

// IPC: Toggle chat visibility
ipcMain.handle('toggle-chat', async (_event, { visible }) => {
  chatVisible = visible;
  updateBrowserViewBounds();
  console.log('[Electron] Chat visibility:', chatVisible);
  return { success: true };
});

// IPC: Open omnibox overlay at given bounds
ipcMain.handle('omnibox-open', async (_event, { x, y, width, height, items }) => {
  try {
    const view = ensureOmniboxView();
    // Add overlay last to be above content
    mainWindow.addBrowserView(view);
    view.setBounds({ x: Math.max(0, x|0), y: Math.max(0, y|0), width: Math.max(50, width|0), height: Math.max(40, height|0) });
    omniboxVisible = true;
    // Forward items to overlay
    try { view.webContents.send('omnibox-set-items', Array.isArray(items) ? items : []); } catch {}
    attachOutsideClickCloser();
    return { success: true };
  } catch (e) {
    console.error('[Electron] omnibox-open failed:', e);
    return { success: false, error: String(e) };
  }
});

// IPC: Update omnibox overlay bounds
ipcMain.handle('omnibox-update', async (_event, { x, y, width, height }) => {
  try {
    if (!omniboxView || !omniboxVisible) return { success: false };
    omniboxView.setBounds({ x: Math.max(0, x|0), y: Math.max(0, y|0), width: Math.max(50, width|0), height: Math.max(40, height|0) });
    bringOmniboxToFrontIfVisible();
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
});

// IPC: Close omnibox overlay
ipcMain.handle('omnibox-close', async () => {
  try {
    if (omniboxView) {
      try { mainWindow.removeBrowserView(omniboxView); } catch (_) {}
    }
    omniboxVisible = false;
    detachOutsideClickCloser();
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
});


// IPC: Update items/query in the overlay
ipcMain.handle('omnibox-set-items', async (_event, { items, query }) => {
  try {
    if (!omniboxView) return { success: false };
    omniboxView.webContents.send('omnibox-set-items', Array.isArray(items) ? items : [], { query: query || '' });
    bringOmniboxToFrontIfVisible();
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
});

// IPC: Forward key actions to the overlay (up/down/enter)
ipcMain.handle('omnibox-key', async (_event, action) => {
  try {
    if (!omniboxView) return { success: false };
    omniboxView.webContents.send('omnibox-key', action);
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
});

// Overlay -> Main: selection changed or choose item; forward to toolbar
ipcMain.on('omnibox-selection', (_event, item) => {
  try { mainWindow.webContents.send('omnibox-selection', item || null); } catch (_) {}
});
ipcMain.on('omnibox-choose', (_event, item) => {
  try { mainWindow.webContents.send('omnibox-choose', item || null); } catch (_) {}
});
ipcMain.on('omnibox-remove-history', (_event, url) => {
  try { mainWindow.webContents.send('omnibox-remove-history', url || ''); } catch (_) {}
});
// Overlay -> Main: request toolbar to close omnibox (e.g., background click in overlay)
ipcMain.on('omnibox-close-request', () => {
  try { mainWindow.webContents.send('omnibox-close-request'); } catch (_) {}
});

// IPC: Reserve/release overlay height under the toolbar (e.g., omnibox dropdown)
// No-op overlay IPC removed to keep BrowserView position stable

// IPC: Switch tab
ipcMain.handle('switch-tab', async (_event, { tabId, url, restore }) => {
  console.log('[Electron] Switching to tab:', tabId, 'URL:', url);

  try {
    // Check if BrowserView already exists for this tab
    let tabView = browserViews.get(tabId);

    if (!tabView) {
      // Create new BrowserView for this tab
      console.log('[Electron] Creating new BrowserView for tab:', tabId);
      tabView = createBrowserViewForTab(tabId);

      // Switch to the newly created tab IMMEDIATELY
      console.log('[Electron] Switching to newly created tab:', tabId);
      switchToTab(tabId);

      // Load the URL if provided
      if (url) {
        console.log('[Electron] Loading URL for new tab:', url);
        await tabView.webContents.loadURL(url);
      }
    } else {
      // Switch to existing BrowserView (don't reload URL)
      console.log('[Electron] Switching to existing BrowserView for tab:', tabId);
      switchToTab(tabId);

      // During session restore, we may want to load the saved URL
      if (restore && url) {
        try {
          const current = tabView.webContents.getURL();
          if (current !== url) {
            console.log('[Electron] Restoring tab URL:', url);
            await tabView.webContents.loadURL(url);
          }
        } catch (e) {
          console.warn('[Electron] Failed to restore URL for tab', tabId, e.message || e);
        }
      } else {
        console.log('[Electron] Keeping existing page state, not reloading');
      }
    }

    return { success: true };
  } catch (error) {
    console.error('[Electron] Failed to switch tab:', error);
    return { success: false, error: error.message };
  }
});

// IPC: Close tab
ipcMain.handle('close-tab', async (_event, { tabId }) => {
  console.log('[Electron] Closing tab:', tabId);

  try {
    const tabView = browserViews.get(tabId);

    if (tabView) {
      console.log('[Electron] Found BrowserView for tab:', tabId);

      // Stop all media (audio/video) playback
      try {
        if (tabView.webContents && !tabView.webContents.isDestroyed()) {
          console.log('[Electron] Stopping media playback...');

          // Stop all audio
          tabView.webContents.setAudioMuted(true);

          // Execute JavaScript to stop all media elements
          await tabView.webContents.executeJavaScript(`
            (function() {
              // Stop all video and audio elements
              const mediaElements = document.querySelectorAll('video, audio');
              mediaElements.forEach(el => {
                el.pause();
                el.src = '';
                el.load();
              });

              // Stop Web Audio API contexts
              if (window.AudioContext || window.webkitAudioContext) {
                // Can't directly access all contexts, but we can try
                console.log('[Tab Close] Media elements stopped');
              }
            })();
          `).catch(err => console.warn('[Electron] Failed to stop media via JS:', err));

          // Close the webContents
          console.log('[Electron] Closing webContents...');
          tabView.webContents.closeDevTools();

          // Load about:blank to stop any ongoing processes
          await tabView.webContents.loadURL('about:blank').catch(err =>
            console.warn('[Electron] Failed to load about:blank:', err)
          );
        }
      } catch (err) {
        console.error('[Electron] Error while stopping media:', err);
      }

      // Remove from window if it's currently displayed
      if (browserView === tabView) {
        mainWindow.removeBrowserView(tabView);
        browserView = null;
        console.log('[Electron] Removed BrowserView from window');
      }

      // Remove from our map
      browserViews.delete(tabId);

      // Small delay to ensure cleanup
      await new Promise(resolve => setTimeout(resolve, 100));

      console.log('[Electron] Tab closed and BrowserView removed. Remaining tabs:', browserViews.size);
    } else {
      console.warn('[Electron] BrowserView not found for tab:', tabId);
    }

    return { success: true };
  } catch (error) {
    console.error('[Electron] Failed to close tab:', error);
    return { success: false, error: error.message };
  }
});

// IPC: Quick Actions (navigate, screenshot, refresh)
ipcMain.handle('quick-action', async (event, { action, data }) => {
  console.log('[Electron] Quick action:', action);

  try {
    if (!browserView) {
      return { success: false, error: 'BrowserView not initialized' };
    }

    switch (action) {
      case 'navigate':
        if (data && data.url) {
          await browserView.webContents.loadURL(data.url);
          return { success: true, message: `Navigated to ${data.url}` };
        }
        return { success: false, error: 'URL is required' };

      case 'screenshot':
        const image = await browserView.webContents.capturePage();
        const dataURL = image.toDataURL();
        if (mainWindow) {
          mainWindow.webContents.send('agent-screenshot', { screenshot: dataURL });
        }
        return { success: true, message: 'Screenshot captured' };

      case 'refresh':
        browserView.webContents.reload();
        return { success: true, message: 'Page refreshed' };

      default:
        return { success: false, error: 'Unknown action' };
    }
  } catch (error) {
    console.error('[Electron] Quick action error:', error);
    return { success: false, error: error.message };
  }
});

// IPC: open link in new tab from BrowserView preload
ipcMain.on('bv-open-in-new-tab', (_event, url) => {
  const newTabId = Date.now();
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('create-new-tab', { tabId: newTabId, url });
  }
});

// IPC: open incognito tab (optional future UI)
ipcMain.handle('open-incognito-tab', async (_event, url) => {
  const tabId = Date.now();
  try {
    const view = createBrowserViewForTab(tabId, { incognito: true });
    // show the tab
    switchToTab(tabId);
    if (url) await view.webContents.loadURL(url);
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('create-new-tab', { tabId, url: url || 'about:blank' });
    }
    return { success: true, tabId };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ============================================================================
// MACRO RECORDING IPC HANDLERS
// ============================================================================

// IPC: Start macro recording
ipcMain.handle('macro-start-recording', async (event, { name }) => {
  console.log('[Electron] Starting macro recording:', name);

  try {
    // Start recording in manager
    const result = recordingManager.startRecording(name);

    if (!result.success) {
      return result;
    }

    // Initialize event collector
    if (!eventCollector) {
      eventCollector = new EventCollector(mainWindow, recordingManager);
    }

    // Start collecting events from current BrowserView
    if (browserView) {
      await eventCollector.startCollecting(browserView);
      console.log('[Electron] Event collector started for current tab');
    } else {
      console.warn('[Electron] No active BrowserView to record');
    }

    return {
      success: true,
      macroId: result.macroId,
      startTime: result.startTime
    };
  } catch (error) {
    console.error('[Electron] Failed to start recording:', error);
    return { success: false, error: error.message };
  }
});

// IPC: Stop macro recording
ipcMain.handle('macro-stop-recording', async (event) => {
  console.log('[Electron] Stopping macro recording');

  try {
    // Stop event collector
    if (eventCollector) {
      eventCollector.stopCollecting();
      console.log('[Electron] Event collector stopped');
    }

    // Stop recording in manager
    const result = recordingManager.stopRecording();

    if (!result.success) {
      return result;
    }

    console.log('[Electron] Recording stopped, total events:', result.events.length);

    // Analyze and generate flowchart
    if (result.events.length > 0) {
      const ActionAnalyzer = require('./macro/analysis/ActionAnalyzer');
      const FlowchartGenerator = require('./macro/analysis/FlowchartGenerator');

      // Analyze events
      const analyzer = new ActionAnalyzer();
      const analyzedSteps = analyzer.analyze(result.events);
      console.log('[Electron] Events analyzed, steps:', analyzedSteps.length);

      // Generate flowchart data
      const generator = new FlowchartGenerator();
      const macro = generator.generate(result.macro, analyzedSteps);
      console.log('[Electron] Flowchart generated');

      // Store for viewing (using main window ID)
      if (mainWindow) {
        currentEditingMacros.set(mainWindow.id, macro);
      }

      return {
        success: true,
        macro: macro,
        events: result.events,
        duration: result.duration
      };
    }

    return result;
  } catch (error) {
    console.error('[Electron] Failed to stop recording:', error);
    return { success: false, error: error.message };
  }
});

// IPC: Record event from BrowserView
ipcMain.on('macro-record-event', (event, eventData) => {
  if (recordingManager.isRecording() && eventCollector) {
    eventCollector.handleEvent(eventData);
  }
});

// IPC: Show flowchart viewer
ipcMain.handle('macro-show-flowchart', async (event, macro) => {
  console.log('[Electron] Opening flowchart viewer for macro:', macro.name);

  try {
    // Create new window for flowchart
    const { BrowserWindow } = require('electron');

    const flowchartWindow = new BrowserWindow({
      width: 900,
      height: 700,
      title: `Macro: ${macro.name}`,
      parent: mainWindow,
      modal: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });
    try { flowchartWindow.setMaxListeners(100); } catch (_) {}

    // Store macro for this window
    currentEditingMacros.set(flowchartWindow.id, macro);

    // Clean up when window closes
    flowchartWindow.once('closed', () => {
      currentEditingMacros.delete(flowchartWindow.id);
    });

    // Use new React-based flowchart viewer
    flowchartWindow.loadFile(path.join(__dirname, 'macro', 'ui', 'MacroFlowchart-new.html'));

    return { success: true };
  } catch (error) {
    console.error('[Electron] Failed to open flowchart:', error);
    return { success: false, error: error.message };
  }
});

// IPC: Get current macro being edited
ipcMain.handle('get-current-macro', async (event) => {
  const sender = event.sender;
  const window = BrowserWindow.fromWebContents(sender);
  if (window) {
    return currentEditingMacros.get(window.id);
  }
  return null;
});

// IPC: Save macro
ipcMain.handle('save-macro', async (event, macroData) => {
  console.log('[Electron] Saving macro:', macroData.name);

  try {
    // Validate macro data exists
    if (!macroData) {
      throw new Error('No macro data provided');
    }

    const MacroStorage = require('./macro/execution/MacroStorage');
    const storage = new MacroStorage();

    await storage.save(macroData);

    console.log('[Electron] Macro saved successfully:', macroData.id);

    // Notify renderer that macro was saved
    mainWindow.webContents.send('macro-saved', { macroId: macroData.id });

    return { success: true, id: macroData.id };
  } catch (error) {
    console.error('[Electron] Failed to save macro:', error.message);
    console.error('[Electron] Error details:', error);

    // Provide more specific error messages
    let userFriendlyMessage = error.message;

    if (error.message.includes('name')) {
      userFriendlyMessage = `Name validation failed: ${error.message}`;
    } else if (error.message.includes('Step')) {
      userFriendlyMessage = `Invalid step configuration: ${error.message}`;
    } else if (error.message.includes('EACCES') || error.message.includes('EPERM')) {
      userFriendlyMessage = 'Permission denied. Unable to save macro file. Please check file permissions.';
    } else if (error.message.includes('ENOSPC')) {
      userFriendlyMessage = 'Not enough disk space to save macro.';
    }

    return { success: false, error: userFriendlyMessage };
  }
});

// IPC: Load macro
ipcMain.handle('load-macro', async (event, macroId) => {
  console.log('[Electron] Loading macro:', macroId);

  try {
    const MacroStorage = require('./macro/execution/MacroStorage');
    const storage = new MacroStorage();

    const macro = await storage.load(macroId);

    return { success: true, macro: macro };
  } catch (error) {
    console.error('[Electron] Failed to load macro:', error);
    return { success: false, error: error.message };
  }
});

// IPC: List all macros
ipcMain.handle('list-macros', async (event) => {
  console.log('[Electron] Listing all macros');

  try {
    const MacroStorage = require('./macro/execution/MacroStorage');
    const storage = new MacroStorage();

    const macros = await storage.listAll();

    return { success: true, macros: macros };
  } catch (error) {
    console.error('[Electron] Failed to list macros:', error);
    return { success: false, error: error.message };
  }
});

// IPC: Delete macro
ipcMain.handle('delete-macro', async (event, macroId) => {
  console.log('[Electron] Deleting macro:', macroId);

  try {
    const MacroStorage = require('./macro/execution/MacroStorage');
    const storage = new MacroStorage();

    await storage.delete(macroId);

    // Notify renderer that macro was deleted
    mainWindow.webContents.send('macro-deleted', { macroId });

    return { success: true };
  } catch (error) {
    console.error('[Electron] Failed to delete macro:', error);
    return { success: false, error: error.message };
  }
});

// IPC: Check if chat sidebar is visible
ipcMain.handle('is-chat-sidebar-visible', async (event) => {
  return chatVisible;
});

// IPC: Execute macro
ipcMain.handle('execute-macro', async (event, { macroData, model }) => {
  console.log('[Electron] Executing macro:', macroData.name, 'with model:', model);

  try {
    // 1. Load API keys from localStorage
    const openaiKey = await mainWindow.webContents.executeJavaScript(
      'localStorage.getItem("openai_api_key")'
    );
    const googleKey = await mainWindow.webContents.executeJavaScript(
      'localStorage.getItem("google_api_key")'
    );
    const claudeKey = await mainWindow.webContents.executeJavaScript(
      'localStorage.getItem("claude_api_key")'
    );

    // 2. Decode and set environment variables
    if (openaiKey) {
      process.env.OPENAI_API_KEY = Buffer.from(openaiKey, 'base64').toString('utf8');
    }
    if (googleKey) {
      process.env.GOOGLE_API_KEY = Buffer.from(googleKey, 'base64').toString('utf8');
    }
    if (claudeKey) {
      process.env.CLAUDE_API_KEY = Buffer.from(claudeKey, 'base64').toString('utf8');
    }

    // 3. Create LLMService with selected model
    const { LLMService } = require('./packages/agent-core/dist/llmService');
    const llmService = model ? new LLMService(model) : null;

    // 4. Create MacroExecutor with LLMService
    const MacroExecutor = require('./macro/execution/MacroExecutor');
    const executor = new MacroExecutor(browserView, mainWindow, llmService);

    // Store current executor
    currentMacroExecutor = executor;

    // Forward all executor events to renderer process
    executor.on('macro-started', (data) => {
      mainWindow.webContents.send('macro-started', data);
      // Show macro execution overlay
      showMacroExecutionOverlay(macroData.name, 0, '', null);
    });

    executor.on('step-start', (data) => {
      mainWindow.webContents.send('macro-step-start', data);
    });

    executor.on('step-complete', (data) => {
      mainWindow.webContents.send('macro-step-complete', data);
      // Update overlay with progress
      const progress = parseFloat(data.progress) || 0;
      const description = data.description || `Step ${data.stepNumber}`;
      showMacroExecutionOverlay(macroData.name, progress, description, null);
    });

    executor.on('step-error', (data) => {
      mainWindow.webContents.send('macro-step-error', data);
    });

    executor.on('screenshot', (data) => {
      mainWindow.webContents.send('macro-screenshot', data);
      // Update overlay with screenshot
      const progress = 0; // Progress will be updated by step-complete
      const description = `Step ${data.stepNumber}`;
      showMacroExecutionOverlay(macroData.name, progress, description, data.screenshot);
    });

    executor.on('macro-complete', (data) => {
      mainWindow.webContents.send('macro-complete', data);
      // Remove overlay
      removeMacroExecutionOverlay();
      currentMacroExecutor = null; // Clear executor after completion
    });

    executor.on('macro-stopped', (data) => {
      mainWindow.webContents.send('macro-stopped', data);
      // Remove overlay
      removeMacroExecutionOverlay();
      currentMacroExecutor = null; // Clear executor after stop
    });

    executor.on('macro-error', (data) => {
      mainWindow.webContents.send('macro-error', data);
      currentMacroExecutor = null; // Clear executor after error
    });

    const result = await executor.execute(macroData).catch(err => {
      console.error('[Electron] Executor promise rejection:', err);
      throw err; // Re-throw to be caught by outer try-catch
    });

    return { success: true, result: result };
  } catch (error) {
    console.error('[Electron] Failed to execute macro:', error);
    currentMacroExecutor = null; // Clear executor on error
    return { success: false, error: error.message };
  }
});

// IPC: Optimize macro with AI
ipcMain.handle('optimize-macro', async (event, { macroData, model }) => {
  console.log('[Electron] Optimizing macro:', macroData.name, 'with model:', model);

  try {
    // 1. Load API keys from localStorage
    const openaiKey = await mainWindow.webContents.executeJavaScript(
      'localStorage.getItem("openai_api_key")'
    );
    const googleKey = await mainWindow.webContents.executeJavaScript(
      'localStorage.getItem("google_api_key")'
    );
    const claudeKey = await mainWindow.webContents.executeJavaScript(
      'localStorage.getItem("claude_api_key")'
    );

    // 2. Decode and set environment variables
    if (openaiKey) {
      process.env.OPENAI_API_KEY = Buffer.from(openaiKey, 'base64').toString('utf8');
    }
    if (googleKey) {
      process.env.GOOGLE_API_KEY = Buffer.from(googleKey, 'base64').toString('utf8');
    }
    if (claudeKey) {
      process.env.CLAUDE_API_KEY = Buffer.from(claudeKey, 'base64').toString('utf8');
    }

    // 3. Create LLMService with selected model
    const { LLMService } = require('./packages/agent-core/dist/llmService');
    const llmService = new LLMService(model || 'gpt-5-mini');

    // 4. Create FlowOptimizer with LLMService
    const FlowOptimizer = require('./macro/optimization/FlowOptimizer');
    const optimizer = new FlowOptimizer(llmService);

    const result = await optimizer.optimize(macroData);

    // Create optimized macro
    const optimizedMacro = { ...macroData };
    optimizedMacro.steps = result.optimizedSteps;
    optimizedMacro.updatedAt = Date.now();

    return {
      success: true,
      optimizedMacro,
      removedSteps: result.removedSteps,
      aiSuggestions: result.aiSuggestions,
      savings: result.savings
    };
  } catch (error) {
    console.error('[Electron] Failed to optimize macro:', error);
    return { success: false, error: error.message };
  }
});

// IPC: Execute macro with AI agent
ipcMain.handle('ai-execute-macro', async (event, { macroData, model }) => {
  console.log('[Electron] AI executing macro:', macroData.name, 'with model:', model);

  try {
    const AIAgentBridge = require('./macro/integration/AIAgentBridge');
    const bridge = new AIAgentBridge(browserView, mainWindow, model);

    const result = await bridge.executeWithAI(macroData);

    return result;
  } catch (error) {
    console.error('[Electron] AI execution failed:', error);
    return { success: false, error: error.message };
  }
});

// IPC: Stop macro execution
ipcMain.on('macro-stop', (event) => {
  console.log('[Electron] Stopping macro execution');

  if (currentMacroExecutor) {
    currentMacroExecutor.stop();
  }
});

// IPC: Pause macro execution (placeholder for future implementation)
ipcMain.on('macro-pause', (event) => {
  console.log('[Electron] Pause macro - not yet implemented');
  // TODO: Implement pause functionality
});

// IPC: Resume macro execution (placeholder for future implementation)
ipcMain.on('macro-resume', (event) => {
  console.log('[Electron] Resume macro - not yet implemented');
  // TODO: Implement resume functionality
});
// Increase listener cap for all BrowserWindows to avoid noisy warnings
try {
  app.on('browser-window-created', (_e, win) => {
    try { win.setMaxListeners(100); } catch (_) {}
  });
} catch (_) {}
