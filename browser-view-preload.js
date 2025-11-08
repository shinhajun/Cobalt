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
  },

  // 새 탭 열기 요청
  openInNewTab: (url) => {
    if (!url) return;
    ipcRenderer.send('bv-open-in-new-tab', url);
  },

  // Autofill APIs
  autofillQuery: (payload) => ipcRenderer.invoke('autofill-query', payload),
  autofillReportSubmit: (payload) => ipcRenderer.invoke('autofill-report-submit', payload),
  autofillSaveProfile: (payload) => ipcRenderer.invoke('autofill-save-profile', payload),
  autofillNeverForSite: (payload) => ipcRenderer.invoke('autofill-never-for-site', payload),
  autofillMarkUsed: (profileId) => ipcRenderer.invoke('autofill-mark-used', { profileId }),
});

console.log('[BrowserView Preload] API exposed via contextBridge as window.__browserViewAPI');

// Handle middle-click on links and Ctrl/Cmd+Click for new tab behavior
window.addEventListener('auxclick', (e) => {
  try {
    if (e.button !== 1) return; // middle only
    const el = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (el && el.href) {
      e.preventDefault();
      e.stopPropagation();
      if (window.__browserViewAPI && typeof window.__browserViewAPI.openInNewTab === 'function') {
        window.__browserViewAPI.openInNewTab(el.href);
      }
    }
  } catch {}
}, true);

window.addEventListener('click', (e) => {
  try {
    const isAccel = navigator.platform.includes('Mac') ? e.metaKey : e.ctrlKey;
    if (!isAccel) return;
    const el = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (el && el.href) {
      e.preventDefault();
      e.stopPropagation();
      if (window.__browserViewAPI && typeof window.__browserViewAPI.openInNewTab === 'function') {
        window.__browserViewAPI.openInNewTab(el.href);
      }
    }
  } catch {}
}, true);
