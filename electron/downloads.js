const { dialog, shell } = require('electron');
const path = require('path');

function registerDownloadHandlers(sessionObj, mainWindow) {
  if (!sessionObj) return;
  if (sessionObj.__downloadHandlersRegistered) return; // guard
  sessionObj.__downloadHandlersRegistered = true;

  sessionObj.on('will-download', async (event, item, wc) => {
    try {
      const url = item.getURL();
      const fileName = item.getFilename();

      // Ask where to save
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Save file',
        defaultPath: path.join(process.env.HOME || process.env.USERPROFILE || process.cwd(), fileName),
      });
      if (canceled || !filePath) {
        item.cancel();
        return;
      }
      item.setSavePath(filePath);

      item.on('updated', (_e, state) => {
        if (state === 'interrupted') {
          if (mainWindow) mainWindow.webContents.send('download-status', { state, fileName });
        } else if (state === 'progressing') {
          if (!item.isPaused()) {
            const progress = item.getReceivedBytes() / item.getTotalBytes();
            if (mainWindow) mainWindow.webContents.send('download-status', { state, fileName, progress });
          }
        }
      });

      item.once('done', async (_e, state) => {
        if (mainWindow) mainWindow.webContents.send('download-status', { state, fileName, savedTo: item.getSavePath() });
        if (state === 'completed') {
          // Optionally reveal in folder
          try { await shell.showItemInFolder(item.getSavePath()); } catch (_) {}
        }
      });
    } catch (err) {
      if (mainWindow) mainWindow.webContents.send('download-status', { state: 'failed', error: String(err && err.message || err) });
    }
  });
}

module.exports = { registerDownloadHandlers };
