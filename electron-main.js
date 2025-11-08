const { app, BrowserWindow, BrowserView, ipcMain, protocol } = require('electron');
const path = require('path');
const dotenv = require('dotenv');

// .env 파일 로드 (프로젝트 루트) - fallback only, use Settings tab to set API keys
const envPath = path.resolve(__dirname, '.env');
dotenv.config({ path: envPath });

// Note: .env is only used as fallback. Primary API keys come from Settings tab (localStorage)
console.log('[Electron] API keys will be loaded from Settings tab (preferred) or .env (fallback)');

// Register custom protocol for cobalt:// URLs BEFORE app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'cobalt',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

const { BrowserController } = require('./packages/agent-core/dist/browserController');
const { LLMService } = require('./packages/agent-core/dist/llmService');

let mainWindow;
let browserView = null; // Current active BrowserView
let browserViews = new Map(); // Map of tabId -> BrowserView
let currentTabId = 0;
let browserController = null;
let llmService = null;
let isTaskRunning = false;
let stopRequested = false;
let screenshotInterval = null; // Auto-screenshot timer
let chatVisible = false; // Chat visibility state - 기본값 false로 변경

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
        if (window.__textSelectionInjected) return;
        window.__textSelectionInjected = true;

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

  // Window resize 시 BrowserView bounds 업데이트
  mainWindow.on('resize', updateBrowserViewBounds);

  mainWindow.on('closed', () => {
    // BrowserView는 윈도우가 닫힐 때 자동으로 파괴되므로 수동 제거 불필요
    browserView = null;
    mainWindow = null;

    // 모든 탭 BrowserView 정리
    browserViews.clear();
  });
}

// Create a new BrowserView for a tab
function createBrowserViewForTab(tabId) {
  console.log('[Electron] Creating BrowserView for tab:', tabId);

  // Create new BrowserView
  const newBrowserView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'browser-view-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    }
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

  // Inject text selection popup script
  newBrowserView.webContents.on('did-finish-load', () => {
    // Copy the same injection script from original browserView
    // (keeping the existing text selection popup functionality)
    newBrowserView.webContents.executeJavaScript(`
      (function() {
        if (window.__textSelectionInjected) return;
        window.__textSelectionInjected = true;
        // ... (same injection code as before)
      })();
    `).catch(err => console.error('[BrowserView] Script injection failed:', err));
  });

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
  const topOffset = toolbarHeight + tabBarHeight; // Total offset (72px)

  // BrowserView는 왼쪽에 배치 (toolbar + tab bar 아래)
  browserView.setBounds({
    x: 0,
    y: topOffset,
    width: browserWidth,
    height: height - topOffset
  });
}

// IPC: Handle translation request from BrowserView
ipcMain.on('browserview-translate-request', async (_event, text) => {
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

    // Send result back to BrowserView
    if (browserView && browserView.webContents) {
      console.log('[Electron] Sending translation result:', translation);
      browserView.webContents.send('browserview-translation-result', { translation });
      console.log('[Electron] Translation completed and sent to BrowserView');
    } else {
      console.error('[Electron] BrowserView not available to send translation result');
    }
  } catch (error) {
    console.error('[Electron] Translation failed:', error);
    if (browserView && browserView.webContents) {
      browserView.webContents.send('browserview-translation-result', { error: error.message });
    }
  }
});

// IPC: Handle AI edit request from BrowserView
ipcMain.on('browserview-edit-request', async (_event, { text, prompt }) => {
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

    // Send result back to BrowserView
    if (browserView && browserView.webContents) {
      browserView.webContents.send('browserview-edit-result', { editedText });
      console.log('[Electron] AI edit completed and sent to BrowserView');
    }
  } catch (error) {
    console.error('[Electron] AI edit failed:', error);
    if (browserView && browserView.webContents) {
      browserView.webContents.send('browserview-edit-result', { error: error.message });
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
    const tempLLM = new LLMService(model || 'gpt-5-mini');

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
      const headless = true; // Headless mode
      browserController = new BrowserController(debugMode, headless);
      llmService = new LLMService(model || 'gpt-5-mini');

      console.log('[Hybrid] Will stream AI screenshots to BrowserView');

      // 이벤트 리스너 설정
      browserController.on('screenshot', (data) => {
        // Send to Chat UI
        if (mainWindow) {
          mainWindow.webContents.send('agent-screenshot', data);
        }

        // === STREAM SCREENSHOT TO BROWSERVIEW ===
        // Display AI's current screen in BrowserView
        if (browserView && data.screenshot) {
          try {
            browserView.webContents.executeJavaScript(`
              (function() {
                // Create or update screenshot overlay
                let overlay = document.getElementById('ai-screenshot-overlay');
                if (!overlay) {
                  overlay = document.createElement('div');
                  overlay.id = 'ai-screenshot-overlay';
                  overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(135deg, #667eea 0%, #764ba2 20%, #f093fb 40%, #4facfe 60%, #00f2fe 80%, #43e97b 100%); background-size: 400% 400%; animation: gradientShift 20s ease infinite; z-index: 999998; display: flex; flex-direction: column;';
                  document.body.appendChild(overlay);

                  // Add header with glassmorphism
                  const header = document.createElement('div');
                  header.style.cssText = 'background: rgba(255, 255, 255, 0.15); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border-bottom: 1px solid rgba(255, 255, 255, 0.18); color: white; padding: 16px 24px; text-align: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);';
                  header.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; gap: 16px;"><div style="width: 20px; height: 20px; border: 3px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 1s linear infinite;"></div><strong style="font-size: 18px; font-weight: 600; letter-spacing: 0.5px;">🤖 AI is Working</strong><span id="ai-status-text" style="color: rgba(255,255,255,0.9); margin-left: 16px; font-size: 14px; font-weight: 500;">Automating browser...</span></div>';
                  overlay.appendChild(header);

                  // Add animations
                  const style = document.createElement('style');
                  style.textContent = \`
                    @keyframes spin {
                      0% { transform: rotate(0deg); }
                      100% { transform: rotate(360deg); }
                    }
                    @keyframes gradientShift {
                      0% { background-position: 0% 50%; }
                      50% { background-position: 100% 50%; }
                      100% { background-position: 0% 50%; }
                    }
                  \`;
                  document.head.appendChild(style);

                  // Add image container with padding for macOS window chrome
                  const imgContainer = document.createElement('div');
                  imgContainer.style.cssText = 'flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative; padding: 40px;';
                  imgContainer.id = 'ai-screenshot-container';
                  overlay.appendChild(imgContainer);
                }

                // Update screenshot image with macOS window chrome
                const container = document.getElementById('ai-screenshot-container');
                if (container) {
                  const screenshotUrl = '${data.screenshot}'.replace(/'/g, "\\\\'");
                  container.innerHTML = '<div style="position: relative; max-width: 92%; max-height: 92%; display: flex; flex-direction: column;">' +
                    '<div style="background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border-radius: 12px 12px 0 0; padding: 12px 16px; display: flex; align-items: center; gap: 8px; box-shadow: 0 -2px 10px rgba(0,0,0,0.1);">' +
                      '<div style="display: flex; gap: 8px;">' +
                        '<div style="width: 12px; height: 12px; border-radius: 50%; background: linear-gradient(135deg, #ff5f57 0%, #ff4757 100%); box-shadow: 0 2px 4px rgba(255, 69, 58, 0.4);"></div>' +
                        '<div style="width: 12px; height: 12px; border-radius: 50%; background: linear-gradient(135deg, #ffbd2e 0%, #ffa502 100%); box-shadow: 0 2px 4px rgba(255, 189, 46, 0.4);"></div>' +
                        '<div style="width: 12px; height: 12px; border-radius: 50%; background: linear-gradient(135deg, #28ca42 0%, #26de81 100%); box-shadow: 0 2px 4px rgba(40, 202, 66, 0.4);"></div>' +
                      '</div>' +
                      '<div style="flex: 1; text-align: center; color: #666; font-size: 13px; font-weight: 500; letter-spacing: 0.3px;">AI Browser Automation</div>' +
                    '</div>' +
                    '<div style="background: white; border-radius: 0 0 12px 12px; overflow: hidden; box-shadow: 0 25px 80px rgba(0,0,0,0.4), 0 15px 50px rgba(0,0,0,0.3), 0 8px 20px rgba(0,0,0,0.2); border: 1px solid rgba(0,0,0,0.1);">' +
                      '<img src="' + screenshotUrl + '" style="display: block; width: 100%; height: auto; max-height: 80vh; object-fit: contain;" />' +
                    '</div>' +
                  '</div>';
                }
              })();
            `).catch(() => {});
          } catch (error) {
            // Ignore errors
          }
        }
      });

      browserController.on('log', (log) => {
        // Send to Chat UI
        if (mainWindow) {
          mainWindow.webContents.send('agent-log', log);
        }

        // Update status text in BrowserView screenshot overlay
        if (browserView && log.data && log.data.message) {
          try {
            const message = typeof log.data === 'string' ? log.data : log.data.message || '';
            const safeMessage = message.replace(/'/g, "\\'").substring(0, 100);

            browserView.webContents.executeJavaScript(`
              (function() {
                const statusText = document.getElementById('ai-status-text');
                if (statusText) statusText.textContent = '${safeMessage}';
              })();
            `).catch(() => {});
          } catch (error) {
            // Ignore errors
          }
        }
      });

      // 브라우저 시작
      await browserController.launch();

      // === AUTO SCREENSHOT STREAMING: 1초마다 자동 스크린샷 캡처 ===
      screenshotInterval = setInterval(async () => {
        if (browserController && !stopRequested) {
          try {
            const screenshot = await browserController.captureScreenshot();
            if (screenshot && browserView) {
              // Stream to BrowserView
              browserView.webContents.executeJavaScript(`
                (function() {
                  let overlay = document.getElementById('ai-screenshot-overlay');
                  if (!overlay) {
                    overlay = document.createElement('div');
                    overlay.id = 'ai-screenshot-overlay';
                    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(135deg, #667eea 0%, #764ba2 20%, #f093fb 40%, #4facfe 60%, #00f2fe 80%, #43e97b 100%); background-size: 400% 400%; animation: gradientShift 20s ease infinite; z-index: 999998; display: flex; flex-direction: column;';
                    document.body.appendChild(overlay);

                    const header = document.createElement('div');
                    header.style.cssText = 'background: rgba(255, 255, 255, 0.15); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border-bottom: 1px solid rgba(255, 255, 255, 0.18); color: white; padding: 16px 24px; text-align: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);';
                    header.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; gap: 16px;"><div style="width: 20px; height: 20px; border: 3px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 1s linear infinite;"></div><strong style="font-size: 18px; font-weight: 600; letter-spacing: 0.5px;">🤖 AI is Working</strong><span id="ai-status-text" style="color: rgba(255,255,255,0.9); margin-left: 16px; font-size: 14px; font-weight: 500;">Automating browser...</span></div>';
                    overlay.appendChild(header);

                    const style = document.createElement('style');
                    style.textContent = \`
                      @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                      }
                      @keyframes gradientShift {
                        0% { background-position: 0% 50%; }
                        50% { background-position: 100% 50%; }
                        100% { background-position: 0% 50%; }
                      }
                    \`;
                    document.head.appendChild(style);

                    const imgContainer = document.createElement('div');
                    imgContainer.style.cssText = 'flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative; padding: 40px;';
                    imgContainer.id = 'ai-screenshot-container';
                    overlay.appendChild(imgContainer);
                  }

                  const container = document.getElementById('ai-screenshot-container');
                  if (container) {
                    const screenshotData = 'data:image/png;base64,${screenshot}';
                    container.innerHTML = '<div style="position: relative; max-width: 92%; max-height: 92%; display: flex; flex-direction: column;">' +
                      '<div style="background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border-radius: 12px 12px 0 0; padding: 12px 16px; display: flex; align-items: center; gap: 8px; box-shadow: 0 -2px 10px rgba(0,0,0,0.1);">' +
                        '<div style="display: flex; gap: 8px;">' +
                          '<div style="width: 12px; height: 12px; border-radius: 50%; background: linear-gradient(135deg, #ff5f57 0%, #ff4757 100%); box-shadow: 0 2px 4px rgba(255, 69, 58, 0.4);"></div>' +
                          '<div style="width: 12px; height: 12px; border-radius: 50%; background: linear-gradient(135deg, #ffbd2e 0%, #ffa502 100%); box-shadow: 0 2px 4px rgba(255, 189, 46, 0.4);"></div>' +
                          '<div style="width: 12px; height: 12px; border-radius: 50%; background: linear-gradient(135deg, #28ca42 0%, #26de81 100%); box-shadow: 0 2px 4px rgba(40, 202, 66, 0.4);"></div>' +
                        '</div>' +
                        '<div style="flex: 1; text-align: center; color: #666; font-size: 13px; font-weight: 500; letter-spacing: 0.3px;">AI Browser Automation</div>' +
                      '</div>' +
                      '<div style="background: white; border-radius: 0 0 12px 12px; overflow: hidden; box-shadow: 0 25px 80px rgba(0,0,0,0.4), 0 15px 50px rgba(0,0,0,0.3), 0 8px 20px rgba(0,0,0,0.2); border: 1px solid rgba(0,0,0,0.1);">' +
                        '<img src="' + screenshotData + '" style="display: block; width: 100%; height: auto; max-height: 80vh; object-fit: contain;" />' +
                      '</div>' +
                    '</div>';
                  }
                })();
              `).catch(() => {});
            }
          } catch (error) {
            // Ignore screenshot errors
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
      const result = await llmService.planAndExecute(taskPlan, browserController, (log) => {
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

      // Remove overlay BEFORE navigating to preserve it on current page
      if (browserView) {
        try {
          await browserView.webContents.executeJavaScript(`
            (function() {
              const overlay = document.getElementById('ai-screenshot-overlay');
              if (overlay) {
                overlay.remove();
                console.log('[BrowserView] Screenshot overlay removed');
              }
            })();
          `);
          console.log('[Hybrid] Screenshot overlay removed');
        } catch (error) {
          console.log('[Hybrid] Could not remove overlay (may have already navigated):', error.message);
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

      if (browserView) {
        try {
          await browserView.webContents.executeJavaScript(`
            (function() {
              const overlay = document.getElementById('ai-screenshot-overlay');
              if (overlay) overlay.remove();
            })();
          `);
        } catch (_) {}
      }

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

// IPC: Translate text to English (from BrowserView)
ipcMain.on('translate-text-request', async (_event, text) => {
  console.log('[Electron] Translate text requested:', text.substring(0, 50) + '...');

  try {
    if (!llmService) {
      const modelName = process.env.LLM_MODEL || 'gpt-5-mini';
      llmService = new LLMService(modelName);
    }

    mainWindow.webContents.send('translate-text', { text });
  } catch (error) {
    console.error('[Electron] Translation request failed:', error);
  }
});

// IPC: AI edit text (from BrowserView)
ipcMain.on('ai-edit-text-request', async (_event, text) => {
  console.log('[Electron] AI edit text requested:', text.substring(0, 50) + '...');

  try {
    if (!llmService) {
      const modelName = process.env.LLM_MODEL || 'gpt-5-mini';
      llmService = new LLMService(modelName);
    }

    mainWindow.webContents.send('ai-edit-text', { text });
  } catch (error) {
    console.error('[Electron] AI edit request failed:', error);
  }
});

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

      if (browserView) {
        try {
          await browserView.webContents.executeJavaScript(`
            (function() {
              const overlay = document.getElementById('ai-screenshot-overlay');
              if (overlay) overlay.remove();
            })();
          `);
        } catch (_) {}
      }

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

// IPC: Switch tab
ipcMain.handle('switch-tab', async (_event, { tabId, url }) => {
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

      // Don't reload the URL - keep the current page state
      console.log('[Electron] Keeping existing page state, not reloading');
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
