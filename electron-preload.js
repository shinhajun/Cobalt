const { ipcRenderer } = require('electron');

// contextIsolation: false 이므로 window 객체에 직접 노출
window.electronAPI = {
  // 작업 실행 (task, model, settings)
  runTask: (taskPlan, model, settings) => ipcRenderer.invoke('run-task', { taskPlan, model, settings }),

  // 작업 중단
  stopTask: () => ipcRenderer.invoke('stop-task'),

  // Quick actions (navigate, screenshot, refresh)
  quickAction: (action, data) => ipcRenderer.invoke('quick-action', { action, data }),

  // 이벤트 리스너
  onAgentStarted: (callback) => {
    ipcRenderer.on('agent-started', (event, data) => callback(data));
  },

  onAgentStopped: (callback) => {
    ipcRenderer.on('agent-stopped', (event, data) => callback(data));
  },

  onAgentScreenshot: (callback) => {
    ipcRenderer.on('agent-screenshot', (event, data) => callback(data));
  },

  onAgentLog: (callback) => {
    ipcRenderer.on('agent-log', (event, data) => callback(data));
  }
};

console.log('[Preload] Electron API exposed to window.electronAPI');
