const { app, BrowserWindow, BrowserView, ipcMain } = require('electron');
const path = require('path');
const dotenv = require('dotenv');

// .env 파일 로드 (프로젝트 루트)
const envPath = path.resolve(__dirname, '.env');
console.log('[Electron] Loading .env from:', envPath);
dotenv.config({ path: envPath });

// API 키 확인 (OpenAI 또는 Google 중 하나만 있어도 시작 가능)
const hasOpenAI = !!process.env.OPENAI_API_KEY;
const hasGoogle = !!process.env.GOOGLE_API_KEY;
if (!hasOpenAI && !hasGoogle) {
  console.error('[Electron] ERROR: No API key found! Set OPENAI_API_KEY or GOOGLE_API_KEY in .env');
  console.error('[Electron] .env path:', envPath);
} else {
  if (hasOpenAI) {
    console.log('[Electron] OPENAI_API_KEY loaded:', process.env.OPENAI_API_KEY.substring(0, 20) + '...');
  } else {
    console.log('[Electron] OPENAI_API_KEY not set (OK if using Gemini)');
  }
  if (hasGoogle) {
    console.log('[Electron] GOOGLE_API_KEY loaded:', process.env.GOOGLE_API_KEY.substring(0, 20) + '...');
  } else {
    console.log('[Electron] GOOGLE_API_KEY not set (OK if using OpenAI)');
  }
}

const { BrowserController } = require('./packages/agent-core/dist/browserController');
const { LLMService } = require('./packages/agent-core/dist/llmService');

let mainWindow;
let browserView = null;
let browserController = null;
let llmService = null;
let isTaskRunning = false;
let stopRequested = false;
let screenshotInterval = null; // Auto-screenshot timer
let chatVisible = true; // Chat visibility state

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
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

  // BrowserView 생성 (왼쪽 70% - 실제 브라우저)
  browserView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'browser-view-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true, // contextBridge 사용으로 sandbox 활성화 가능
    }
  });

  mainWindow.addBrowserView(browserView);

  // Initial layout (70% for browser, 30% for chat)
  updateBrowserViewBounds();

  // Load Google as default page
  browserView.webContents.loadURL('https://www.google.com');

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

        // Setup result listeners when API becomes available
        function setupListeners() {
          if (!window.__browserViewAPI) {
            console.warn('[Text Selection] API not ready, retrying in 50ms...');
            setTimeout(setupListeners, 50);
            return;
          }

          console.log('[Text Selection] Setting up listeners');

          // Listen for translation results
          window.__browserViewAPI.onTranslationResult((result) => {
          console.log('[Text Selection] Translation result received:', result);
          if (result && result.translation) {
            // Use modern Clipboard API
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(result.translation).catch(err => {
                console.error('[Text Selection] Failed to copy to clipboard:', err);
              });
            }

            // Update button with result
            if (window.__pendingTranslateButton) {
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
            }
          }
        });

        // Listen for AI edit results
        window.__browserViewAPI.onEditResult((result) => {
          console.log('[Text Selection] Edit result received:', result);
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
          }
        });
        }

        // Start setting up listeners
        setupListeners();

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

                    // Check if API is available
                    if (!window.__browserViewAPI) {
                      console.error('[Text Selection] BrowserView API not available for AI edit');
                      showNotification('AI Edit failed: API not ready', false);
                      popup.remove();
                      return;
                    }

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
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();

              // Check if API is available
              if (!window.__browserViewAPI) {
                console.error('[Text Selection] BrowserView API not available for translation');
                showNotification('Translation failed: API not ready', false);
                return;
              }

              // Change button text to show loading
              translateBtn.textContent = 'Translating...';
              translateBtn.disabled = true;
              translateBtn.style.cursor = 'wait';
              translateBtn.style.opacity = '0.7';

              // Send translation request via IPC
              window.__pendingTranslateButton = translateBtn;
              console.log('[Text Selection] Sending translation request via IPC');
              window.__browserViewAPI.requestTranslation(text);
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

            // Don't create new popup if editing input is active
            if (isEditingInput) {
              console.log('[Text Selection] Ignoring mouseup - editing input is active');
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

  // 개발 모드에서 DevTools 열기
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    if (browserView) {
      mainWindow.removeBrowserView(browserView);
      browserView = null;
    }
    mainWindow = null;
  });
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
      browserView.webContents.send('browserview-translation-result', { translation });
      console.log('[Electron] Translation completed and sent to BrowserView');
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

    console.log('[Electron] Task analysis response:', JSON.stringify(response));

    // Check if tool was called
    if (response.toolCalls && response.toolCalls.length > 0) {
      const toolCall = response.toolCalls[0];
      const toolName = toolCall.function.name;
      const toolArgs = JSON.parse(toolCall.function.arguments);

      console.log('[Electron] Tool selected:', toolName, 'Args:', toolArgs);

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

    // Fallback: if no tool call, treat as browser task
    console.log('[Electron] No tool call detected, defaulting to browser task');
    return { taskType: 'browser', reason: 'No tool selected' };

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

          // 쿠키 동기화 설정 확인
          if (settings && settings.syncCookies) {
            console.log('[Hybrid] ✅ Cookie sync is ENABLED - Login session will be maintained');
          } else {
            console.log('[Hybrid] ⚠️ Cookie sync is DISABLED - AI will not be logged in');
          }
        } catch (error) {
          console.error('[Hybrid] Failed to get BrowserView cookies:', error);
        }
      }

      // 이전 인스턴스 정리
      if (browserController) {
        await browserController.close();
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
                  overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: #000; z-index: 999998; display: flex; flex-direction: column;';
                  document.body.appendChild(overlay);

                  // Add header
                  const header = document.createElement('div');
                  header.style.cssText = 'background: linear-gradient(135deg, #4361ee 0%, #3730a3 100%); color: white; padding: 12px 20px; text-align: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;';
                  header.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; gap: 12px;"><div style="width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 1s linear infinite;"></div><strong>🤖 AI Working...</strong><span id="ai-status-text" style="color: rgba(255,255,255,0.8); margin-left: 12px;">In progress</span></div>';
                  overlay.appendChild(header);

                  // Add spinner animation
                  const style = document.createElement('style');
                  style.textContent = '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
                  document.head.appendChild(style);

                  // Add image container with animated gradient
                  const imgContainer = document.createElement('div');
                  imgContainer.style.cssText = 'flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative; background: linear-gradient(45deg, #667eea 0%, #764ba2 25%, #f093fb 50%, #4facfe 75%, #00f2fe 100%); background-size: 400% 400%; animation: gradientFlow 15s ease infinite;';
                  imgContainer.id = 'ai-screenshot-container';
                  overlay.appendChild(imgContainer);

                  // Add gradient animation
                  const gradientStyle = document.createElement('style');
                  gradientStyle.textContent = '@keyframes gradientFlow { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }';
                  document.head.appendChild(gradientStyle);
                }

                // Update screenshot image
                const container = document.getElementById('ai-screenshot-container');
                if (container) {
                  container.innerHTML = '<div style="position: relative; max-width: 95%; max-height: 95%; display: flex; align-items: center; justify-content: center; padding: 20px;"><img src="${data.screenshot}" style="max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px; box-shadow: 0 20px 60px rgba(0,0,0,0.6), 0 10px 30px rgba(0,0,0,0.4);" /></div>';
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
                    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: #000; z-index: 999998; display: flex; flex-direction: column;';
                    document.body.appendChild(overlay);

                    const header = document.createElement('div');
                    header.style.cssText = 'background: linear-gradient(135deg, #4361ee 0%, #3730a3 100%); color: white; padding: 12px 20px; text-align: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;';
                    header.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; gap: 12px;"><div style="width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 1s linear infinite;"></div><strong>🤖 AI Working...</strong><span id="ai-status-text" style="color: rgba(255,255,255,0.8); margin-left: 12px;">In progress</span></div>';
                    overlay.appendChild(header);

                    const style = document.createElement('style');
                    style.textContent = '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
                    document.head.appendChild(style);

                    const imgContainer = document.createElement('div');
                    imgContainer.style.cssText = 'flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative; background: linear-gradient(45deg, #667eea 0%, #764ba2 25%, #f093fb 50%, #4facfe 75%, #00f2fe 100%); background-size: 400% 400%; animation: gradientFlow 15s ease infinite;';
                    imgContainer.id = 'ai-screenshot-container';
                    overlay.appendChild(imgContainer);

                    const gradientStyle = document.createElement('style');
                    gradientStyle.textContent = '@keyframes gradientFlow { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }';
                    document.head.appendChild(gradientStyle);
                  }

                  const container = document.getElementById('ai-screenshot-container');
                  if (container) {
                    container.innerHTML = '<div style="position: relative; max-width: 95%; max-height: 95%; display: flex; align-items: center; justify-content: center; padding: 20px;"><img src="data:image/png;base64,${screenshot}" style="max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);" /></div>';
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

      // === HYBRID MODE: Step 4 - Handle "이 페이지에서" commands ===
      const isCurrentPageCommand =
        taskPlan.includes('이 페이지') ||
        taskPlan.includes('현재 페이지') ||
        taskPlan.includes('this page') ||
        taskPlan.includes('current page');

      if (isCurrentPageCommand && currentURL && currentURL !== 'about:blank' && !currentURL.startsWith('chrome://')) {
        console.log('[Hybrid] Current page command detected, navigating to:', currentURL);
        await browserController.goTo(currentURL);
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

      // === HYBRID MODE: Step 5 - Restore BrowserView and sync result ===
      const syncResult = settings && settings.syncResultToBrowserView !== false; // default true
      if (syncResult && browserView) {
        try {
          const finalURL = browserController.getCurrentUrl();
          console.log('[Hybrid] Final URL from Playwright:', finalURL);

          if (finalURL && finalURL !== 'about:blank' && !finalURL.startsWith('chrome://')) {
            console.log('[Hybrid] Syncing result to BrowserView...');
            await browserView.webContents.loadURL(finalURL);
            console.log('[Hybrid] BrowserView navigated to:', finalURL);

            // === HYBRID MODE: Step 6 - Sync cookies back to BrowserView ===
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

      // === HYBRID MODE: Stop auto-screenshot and remove overlay ===
      if (screenshotInterval) {
        clearInterval(screenshotInterval);
        screenshotInterval = null;
        console.log('[Hybrid] Auto-screenshot streaming stopped');
      }

      if (browserView) {
        try {
          await browserView.webContents.executeJavaScript(`
            (function() {
              const overlay = document.getElementById('ai-screenshot-overlay');
              if (overlay) overlay.remove();
            })();
          `);
          console.log('[Hybrid] Screenshot overlay removed');
        } catch (error) {
          // Ignore errors if page changed
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
  console.log('[Electron] Switching to tab:', tabId, url);

  if (!browserView) {
    return { success: false, error: 'BrowserView not initialized' };
  }

  try {
    // Load the tab's URL
    await browserView.webContents.loadURL(url);
    return { success: true };
  } catch (error) {
    console.error('[Electron] Failed to switch tab:', error);
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
