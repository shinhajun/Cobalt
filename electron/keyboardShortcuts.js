const { dialog, app } = require('electron');
const { zoomIn, zoomOut, zoomReset } = require('./zoomManager');

function registerWindowShortcuts(mainWindow, getActiveWebContents, getActiveView) {
  if (!mainWindow) return;

  // Mouse 4/5 back/forward on Windows
  mainWindow.on('app-command', (e, cmd) => {
    const wc = getActiveWebContents();
    if (!wc) return;
    if (cmd === 'browser-backward' && wc.canGoBack()) wc.goBack();
    if (cmd === 'browser-forward' && wc.canGoForward()) wc.goForward();
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const ctrlOrCmd = process.platform === 'darwin' ? input.meta : input.control;
    const shift = input.shift;
    const wc = getActiveWebContents();
    if (!wc) return;

    // DevTools: F12 or Ctrl+Shift+I
    if (input.key === 'F12' || (ctrlOrCmd && shift && (input.key.toLowerCase() === 'i'))) {
      event.preventDefault();
      if (wc.isDevToolsOpened()) wc.closeDevTools(); else wc.openDevTools({ mode: 'detach' });
      return;
    }

    // Reload
    if (input.key === 'F5' || (ctrlOrCmd && !shift && input.key.toLowerCase() === 'r')) {
      event.preventDefault();
      wc.reload();
      return;
    }
    if (ctrlOrCmd && shift && input.key.toLowerCase() === 'r') {
      event.preventDefault();
      wc.reloadIgnoringCache();
      return;
    }

    // Address bar focus: Ctrl+L
    if (ctrlOrCmd && !shift && input.key.toLowerCase() === 'l') {
      event.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('focus-address-bar');
      return;
    }

    // Find in page: Ctrl+F
    if (ctrlOrCmd && !shift && input.key.toLowerCase() === 'f') {
      event.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('open-find');
      return;
    }

    // Zoom
    if (ctrlOrCmd && (input.key === '=' || input.key === '+')) {
      event.preventDefault();
      zoomIn(wc);
      return;
    }
    if (ctrlOrCmd && input.key === '-') {
      event.preventDefault();
      zoomOut(wc);
      return;
    }
    if (ctrlOrCmd && input.key === '0') {
      event.preventDefault();
      zoomReset(wc);
      return;
    }

    // Fullscreen F11
    if (input.key === 'F11') {
      event.preventDefault();
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      return;
    }

    // Print Ctrl+P
    if (ctrlOrCmd && input.key.toLowerCase() === 'p') {
      event.preventDefault();
      wc.print({ printBackground: true });
      return;
    }

    // Open file Ctrl+O
    if (ctrlOrCmd && input.key.toLowerCase() === 'o') {
      event.preventDefault();
      dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
          { name: 'HTML Files', extensions: ['html', 'htm'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      }).then(async ({ canceled, filePaths }) => {
        if (!canceled && filePaths && filePaths[0]) {
          const view = getActiveView();
          if (view && view.webContents) {
            await view.webContents.loadFile(filePaths[0]).catch(() => {});
          }
        }
      });
      return;
    }
  });
}

function attachShortcutsToWebContents(wc, mainWindow) {
  if (!wc || wc.isDestroyed()) return;
  wc.on('before-input-event', (event, input) => {
    const ctrlOrCmd = process.platform === 'darwin' ? input.meta : input.control;
    const shift = input.shift;

    // DevTools inside the view
    if (input.key === 'F12' || (ctrlOrCmd && shift && (input.key.toLowerCase() === 'i'))) {
      event.preventDefault();
      if (wc.isDevToolsOpened()) wc.closeDevTools(); else wc.openDevTools({ mode: 'detach' });
      return;
    }

    // Reload when focus is inside BrowserView
    if (input.key === 'F5' || (ctrlOrCmd && !shift && input.key.toLowerCase() === 'r')) {
      event.preventDefault();
      wc.reload();
      return;
    }
    if (ctrlOrCmd && shift && input.key.toLowerCase() === 'r') {
      event.preventDefault();
      wc.reloadIgnoringCache();
      return;
    }
  });
}

module.exports = { registerWindowShortcuts, attachShortcutsToWebContents };
