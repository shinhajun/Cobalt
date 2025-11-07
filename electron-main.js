const { app, BrowserWindow, ipcMain } = require('electron');
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
let browserController = null;
let llmService = null;
let isTaskRunning = false;
let stopRequested = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  // HTML UI 로드
  mainWindow.loadFile(path.join(__dirname, 'ui.html'));

  // 개발 모드에서 DevTools 열기
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
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

// IPC: 작업 실행
ipcMain.handle('run-task', async (event, { taskPlan, model, settings }) => {
  console.log('[Electron] Task received:', taskPlan);
  console.log('[Electron] Model:', model || 'gpt-5-mini');
  if (settings) {
    console.log('[Electron] Settings:', {
      captchaVisionModel: settings.captchaVisionModel || '(default)'
    });
  }

  if (isTaskRunning) {
    return { success: false, error: 'Task is already running' };
  }

  isTaskRunning = true;
  stopRequested = false;

  // 비동기로 작업 실행 (Stop 버튼이 작동하도록)
  (async () => {
    try {
      // 이전 인스턴스 정리
      if (browserController) {
        await browserController.close();
      }

      // 환경 구성 병합: UI에서 온 설정값이 있으면 우선 적용 (프로세스 env override)
      // *** LLMService 생성 전에 환경변수를 먼저 설정해야 비전 모델이 올바르게 초기화됨 ***
      let prevEnv = {
        CAPTCHA_VISION_MODEL: process.env.CAPTCHA_VISION_MODEL,
      };
      if (settings && settings.captchaVisionModel) {
        process.env.CAPTCHA_VISION_MODEL = settings.captchaVisionModel;
        console.log('[Electron] Setting CAPTCHA_VISION_MODEL to:', settings.captchaVisionModel);
      }

      // 새 인스턴스 생성
      browserController = new BrowserController(true);
      llmService = new LLMService(model || 'gpt-5-mini');

      // 이벤트 리스너 설정
      browserController.on('screenshot', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('agent-screenshot', data);
        }
      });

      browserController.on('log', (log) => {
        if (mainWindow) {
          mainWindow.webContents.send('agent-log', log);
        }
      });

      // 브라우저 시작
      await browserController.launch();

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

      if (mainWindow && isTaskRunning) {
        mainWindow.webContents.send('agent-stopped', {
          reason: result.success ? 'Task Completed' : 'Task Failed',
          success: result.success,
          report: result.message  // 보고서로 전달
        });
      }

    } catch (error) {
      console.error('[Electron] Task error:', error);

      if (mainWindow && isTaskRunning) {
        mainWindow.webContents.send('agent-stopped', {
          reason: 'Error',
          success: false,
          report: error.message
        });
      }
    } finally {
      // Restore previous env
      if (prevEnv) {
        if (prevEnv.CAPTCHA_VISION_MODEL !== undefined) process.env.CAPTCHA_VISION_MODEL = prevEnv.CAPTCHA_VISION_MODEL; else delete process.env.CAPTCHA_VISION_MODEL;
      }
      if (browserController) {
        await browserController.close();
        browserController = null;
      }
      isTaskRunning = false;
      stopRequested = false;
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
