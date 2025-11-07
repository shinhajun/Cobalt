const { Menu, clipboard, shell, dialog } = require('electron');
const path = require('path');

function buildMenu({ wc, mainWindow, createNewTab }) {
  return (event, params) => {
    const template = [];

    // Link items
    if (params.linkURL) {
      template.push({
        label: 'Open link in new tab',
        click: () => createNewTab(params.linkURL),
      });
      template.push({
        label: 'Copy link address',
        click: () => clipboard.writeText(params.linkURL),
      });
      template.push({ type: 'separator' });
    }

    // Image items
    if (params.hasImageContents && params.srcURL) {
      template.push({
        label: 'Open image in new tab',
        click: () => createNewTab(params.srcURL),
      });
      template.push({
        label: 'Copy image address',
        click: () => clipboard.writeText(params.srcURL),
      });
      template.push({
        label: 'Save image as...',
        click: () => wc.downloadURL(params.srcURL),
      });
      template.push({ type: 'separator' });
    }

    // Selection items
    if (params.selectionText && params.selectionText.trim().length > 0) {
      const text = params.selectionText;

      // Avoid duplicate copy when editable block also adds it
      if (!params.isEditable) {
        template.push({ label: 'Copy', role: 'copy' });
      }

      template.push({
        label: `Search Google for "${(text.length > 32 ? text.slice(0, 32) + '...' : text)}"`,
        click: () => {
          const url = 'https://www.google.com/search?q=' + encodeURIComponent(text);
          shell.openExternal(url);
        },
      });

      // Keep AI Translate only for non-editable selection to match overlay behavior
      if (!params.isEditable) {
        template.push({
          label: 'AI Translate selection',
          click: () => {
            try {
              const payload = JSON.stringify({ text });
              // Notify page to show loading bubble, then request translation
              wc.executeJavaScript(`window.postMessage({type:'__translation-start', payload:${payload}}, '*');`).catch(()=>{});
              wc.executeJavaScript(`window.__browserViewAPI && window.__browserViewAPI.requestTranslation(${JSON.stringify(text)})`).catch(()=>{});
            } catch(_) {}
          },
        });
      }

      template.push({ type: 'separator' });
    }

    // Edit items for inputs
    if (params.isEditable) {
      template.push({ role: 'undo' });
      template.push({ role: 'redo' });
      template.push({ type: 'separator' });
      template.push({ role: 'cut' });
      template.push({ role: 'copy' });
      template.push({ role: 'paste' });
      template.push({ role: 'selectAll' });
      template.push({ type: 'separator' });
    }

    // Navigation
    template.push({ label: 'Back', enabled: wc.canGoBack(), click: () => wc.goBack() });
    template.push({ label: 'Forward', enabled: wc.canGoForward(), click: () => wc.goForward() });
    template.push({ label: 'Reload', click: () => wc.reload() });
    template.push({ label: 'Hard Reload (Ignore Cache)', click: () => wc.reloadIgnoringCache() });
    template.push({ type: 'separator' });

    // Inspect
    template.push({
      label: 'Inspect',
      click: () => {
        wc.inspectElement(params.x, params.y);
        if (!wc.isDevToolsOpened()) wc.openDevTools({ mode: 'detach' });
      },
    });

    // Tab audio mute toggle
    template.push({
      label: wc.isAudioMuted() ? 'Unmute tab' : 'Mute tab',
      click: () => wc.setAudioMuted(!wc.isAudioMuted()),
    });

    // Picture-in-Picture for video
    if (params.mediaType === 'video' || (params.srcURL && /\.(mp4|webm|mov)(\?|$)/i.test(params.srcURL))) {
      template.push({
        label: 'Picture in Picture',
        click: async () => {
          try {
            const code = `(() => { try { const el = document.elementFromPoint(${params.x}, ${params.y}); const v = el && (el.closest('video') || (el.tagName==='VIDEO'?el:null)); if (!v) return 'no-video'; if (document.pictureInPictureElement) { document.exitPictureInPicture(); return 'exit'; } else { v.requestPictureInPicture(); return 'enter'; } } catch(e){ return 'error'; } })()`;
            await wc.executeJavaScript(code);
          } catch {}
        },
      });
    }

    template.push({ type: 'separator' });

    // Save page as...
    template.push({
      label: 'Save page as...',
      click: async () => {
        try {
          const suggested = (wc.getTitle() || 'page') + '.html';
          const { canceled, filePath } = await dialog.showSaveDialog({
            title: 'Save page',
            defaultPath: path.join(process.env.HOME || process.env.USERPROFILE || process.cwd(), suggested),
            filters: [{ name: 'Webpage, Complete', extensions: ['html'] }],
          });
          if (canceled || !filePath) return;
          await wc.savePage(filePath, 'HTMLComplete');
        } catch {}
      },
    });

    // View page source
    template.push({
      label: 'View page source',
      click: () => {
        const url = wc.getURL();
        if (!url || url.startsWith('view-source:')) return;
        createNewTab('view-source:' + url);
      }
    });

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: mainWindow });
  };
}

function registerContextMenuForWebContents(wc, mainWindow, createNewTab) {
  if (!wc || wc.isDestroyed()) return;
  const handler = buildMenu({ wc, mainWindow, createNewTab });
  wc.on('context-menu', (event, params) => {
    try { console.log('[ContextMenu] event', { x: params.x, y: params.y, link: params.linkURL, img: params.srcURL, isEditable: params.isEditable }); } catch {}
    handler(event, params);
  });
}

module.exports = { registerContextMenuForWebContents };

