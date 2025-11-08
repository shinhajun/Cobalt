const { contextBridge, ipcRenderer } = require('electron');

console.log('[BrowserView Preload] Starting preload script');

// Setup IPC listeners and forward to window
ipcRenderer.on('browserview-translation-result', (_event, result) => {
  console.log('[BrowserView Preload] Translation result received via IPC:', result);
  // Forward to injected script via custom event
  window.postMessage({
    type: '__translation-result',
    payload: result
  }, '*');
});

ipcRenderer.on('browserview-edit-result', (_event, result) => {
  console.log('[BrowserView Preload] Edit result received via IPC:', result);
  // Forward to injected script via custom event
  window.postMessage({
    type: '__edit-result',
    payload: result
  }, '*');
});

// contextIsolation이 true일 때 사용하는 방식
contextBridge.exposeInMainWorld('__browserViewAPI', {
  // 번역 요청
  requestTranslation: (text) => {
    console.log('[BrowserView Preload] requestTranslation called with text:', text.substring(0, 30) + '...');
    ipcRenderer.send('browserview-translate-request', text);
  },

  // AI 수정 요청
  requestAIEdit: (text, prompt) => {
    console.log('[BrowserView Preload] requestAIEdit called');
    ipcRenderer.send('browserview-edit-request', { text, prompt });
  },

  // 홈 검색 실행
  executeHomeSearch: (query) => {
    console.log('[BrowserView Preload] executeHomeSearch called');
    console.log('[BrowserView Preload] Query:', query);
    console.log('[BrowserView Preload] Query type:', typeof query);
    console.log('[BrowserView Preload] Query length:', query.length);
    console.log('[BrowserView Preload] Query charCodes:', Array.from(query).map(c => c.charCodeAt(0)));

    // Send with explicit UTF-8 encoding
    const utf8Query = query.toString();
    console.log('[BrowserView Preload] Sending query via IPC:', utf8Query);
    ipcRenderer.send('execute-home-search', utf8Query);
  }
});

console.log('[BrowserView Preload] API exposed via contextBridge as window.__browserViewAPI');
