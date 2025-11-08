const { contextBridge, ipcRenderer } = require('electron');

console.log('[BrowserView Preload] Starting preload script');

// contextIsolation이 true일 때 사용하는 방식
contextBridge.exposeInMainWorld('__browserViewAPI', {
  // 번역 요청
  requestTranslation: (text) => {
    console.log('[BrowserView Preload] requestTranslation called');
    ipcRenderer.send('browserview-translate-request', text);
  },

  // AI 수정 요청
  requestAIEdit: (text, prompt) => {
    console.log('[BrowserView Preload] requestAIEdit called');
    ipcRenderer.send('browserview-edit-request', { text, prompt });
  },

  // 번역 결과 수신
  onTranslationResult: (callback) => {
    console.log('[BrowserView Preload] onTranslationResult listener registered');
    ipcRenderer.on('browserview-translation-result', (_event, result) => {
      console.log('[BrowserView Preload] Translation result received:', result);
      callback(result);
    });
  },

  // AI 수정 결과 수신
  onEditResult: (callback) => {
    console.log('[BrowserView Preload] onEditResult listener registered');
    ipcRenderer.on('browserview-edit-result', (_event, result) => {
      console.log('[BrowserView Preload] Edit result received:', result);
      callback(result);
    });
  }
});

console.log('[BrowserView Preload] API exposed via contextBridge as window.__browserViewAPI');
