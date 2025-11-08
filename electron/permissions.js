const { dialog, session } = require('electron');
const { getDecision, setDecision } = require('./permissionsStore');

// In-memory decisions: key = origin|permission -> 'allow' | 'deny'
const decisions = new Map();

function keyOf(origin, permission) {
  return `${origin}|${permission}`;
}

function topLevelOrigin(wc) {
  try { const url = new URL(wc.getURL()); return `${url.protocol}//${url.host}`; } catch { return 'unknown'; }
}

function registerPermissionHandler(electronSession, mainWindow) {
  if (!electronSession || typeof electronSession.setPermissionRequestHandler !== 'function') return;

  try {
    // Quick check handler: auto-allow if previously allowed, auto-deny if denied
    if (typeof electronSession.setPermissionCheckHandler === 'function') {
      electronSession.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
        try {
          const origin = topLevelOrigin(wc);
          const stored = decisions.get(`${origin}|${permission}`) || getDecision(origin, permission);
          if (stored === 'allow') return true;
          if (stored === 'deny') return false;
          return false; // unknown => not auto-allowed
        } catch { return false; }
      });
    }

    electronSession.setPermissionRequestHandler(async (wc, permission, callback, details) => {
      try {
        // Always use top-level origin for a consistent decision per site
        const origin = topLevelOrigin(wc);

        const k = keyOf(origin, permission);
        let memo = decisions.get(k);
        if (!memo) {
          memo = getDecision(origin, permission);
          if (memo) decisions.set(k, memo);
        }
        if (memo) {
          const allow = memo === 'allow';
          callback(allow);
          return;
        }

        // Prompt the user
        const res = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          buttons: ['Allow', 'Deny'],
          defaultId: 0,
          cancelId: 1,
          title: 'Site permission request',
          message: `${origin} requests permission: ${permission}`,
          checkboxLabel: 'Remember for this site',
          checkboxChecked: true,
        });

        const allow = res.response === 0;
        const decision = allow ? 'allow' : 'deny';
        if (res.checkboxChecked) {
          decisions.set(k, decision);
          setDecision(origin, permission, decision);
        }
        callback(allow);
      } catch (_) {
        callback(false);
      }
    });
  } catch (_) {
    // Ignore if API shape differs
  }
}

module.exports = { registerPermissionHandler };
