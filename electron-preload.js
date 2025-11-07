const { contextBridge, ipcRenderer } = require('electron');

// Electron API를 안전하게 노출
contextBridge.exposeInMainWorld('electronAPI', {
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
});

console.log('[Preload] Electron API exposed');
