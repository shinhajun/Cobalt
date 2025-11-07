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
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
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
ipcMain.handle('analyze-task', async (event, { task, model }) => {
  console.log('[Electron] Analyzing task type:', task);

  try {
    // LLM으로 작업 유형 분석
    const tempLLM = new LLMService(model || 'gpt-5-mini');

    const analysisPrompt = `You are a task classifier. Analyze if the user's request requires browser automation or is just a simple question/conversation.

User request: "${task}"

Classify as:
- "chat": Simple question, general knowledge, calculation, explanation, or conversation that doesn't require web browsing
- "browser": Requires web browsing, clicking buttons, filling forms, searching websites, extracting data from websites, etc.

Respond in JSON format:
{
  "taskType": "chat" or "browser",
  "reason": "brief explanation",
  "response": "if taskType is chat, provide a helpful answer here. If browser, leave empty"
}`;

    const response = await tempLLM.chat([{ role: 'user', content: analysisPrompt }]);
    console.log('[Electron] Task analysis response:', response);

    // Parse JSON response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]);
      console.log('[Electron] Task classified as:', analysis.taskType);
      return analysis;
    } else {
      // Fallback: treat as browser task if parsing fails
      console.log('[Electron] Failed to parse analysis, defaulting to browser task');
      return { taskType: 'browser', reason: 'Unable to classify' };
    }
  } catch (error) {
    console.error('[Electron] Error analyzing task:', error);
    // Fallback: treat as browser task on error
    return { taskType: 'browser', reason: 'Analysis error' };
  }
});

// IPC: 작업 실행
ipcMain.handle('run-task', async (event, { taskPlan, model, settings }) => {
  console.log('[Electron] Task received:', taskPlan);
  console.log('[Electron] Model:', model || 'gpt-5-mini');
  if (settings) {
    console.log('[Electron] Settings:', {
      captchaVisionModel: settings.captchaVisionModel || '(default)',
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
        CAPTCHA_VISION_MODEL: process.env.CAPTCHA_VISION_MODEL,
      };
      if (settings && settings.captchaVisionModel) {
        process.env.CAPTCHA_VISION_MODEL = settings.captchaVisionModel;
        console.log('[Electron] Setting CAPTCHA_VISION_MODEL to:', settings.captchaVisionModel);
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
        if (prevEnv.CAPTCHA_VISION_MODEL !== undefined) process.env.CAPTCHA_VISION_MODEL = prevEnv.CAPTCHA_VISION_MODEL; else delete process.env.CAPTCHA_VISION_MODEL;
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
