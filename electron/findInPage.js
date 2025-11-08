const { ipcMain } = require('electron');

function setupFindInPageIPC(mainWindow, getActiveWebContents) {
  ipcMain.handle('find-in-page', async (_event, { query, forward = true, findNext = false, matchCase = false }) => {
    const wc = getActiveWebContents();
    if (!wc) return { success: false };
    try {
      const res = await wc.findInPage(query || '', { forward, findNext, matchCase });
      return { success: true, requestId: res.requestId };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('stop-find-in-page', async () => {
    const wc = getActiveWebContents();
    if (!wc) return { success: false };
    wc.stopFindInPage('clearSelection');
    return { success: true };
  });

  // Consumer module should attach 'found-in-page' events per BrowserView
}

function attachFoundInPageForwarder(wc, mainWindow) {
  if (!wc || wc.isDestroyed()) return;
  wc.on('found-in-page', (_e, result) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('find-results', result);
    }
  });
}

module.exports = { setupFindInPageIPC, attachFoundInPageForwarder };

