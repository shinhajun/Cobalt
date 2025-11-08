const { ipcMain } = require('electron');
const { loadStore, saveStore, upsertProfile, setSitePref, getSitePref, querySuggestions, markUsed } = require('./store');
const { classifyField } = require('./heuristics');

let storeCache = null;
function ensureStore() {
  if (!storeCache) storeCache = loadStore();
  return storeCache;
}

function flush() { if (storeCache) saveStore(storeCache); }

function registerAutofillIPC(getActiveURL) {
  // Query suggestions for a focused field
  ipcMain.handle('autofill-query', async (_event, { fieldHints }) => {
    try {
      const store = ensureStore();
      const url = (typeof getActiveURL === 'function' && getActiveURL()) || '';
      const fieldType = classifyField(fieldHints || {}) || 'name';
      const suggestions = querySuggestions(store, url, fieldType);
      return { success: true, fieldType, suggestions };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  // Report a submit and ask whether to offer save
  ipcMain.handle('autofill-report-submit', async (_event, { origin, fields }) => {
    try {
      const store = ensureStore();
      const prefs = getSitePref(store, origin);
      if (prefs.neverSave) return { success: true, offerSave: false };
      // Offer save if we have at least name or email
      const hasName = !!(fields || []).find(f => String(f.fieldType||'').includes('name') && f.value && String(f.value).trim());
      const hasEmail = !!(fields || []).find(f => String(f.fieldType||'').includes('email') && f.value && String(f.value).trim());
      const offerSave = hasName || hasEmail;
      return { success: true, offerSave };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  // Save a profile
  ipcMain.handle('autofill-save-profile', async (_event, { profile }) => {
    try {
      const store = ensureStore();
      const saved = upsertProfile(store, profile || {});
      flush();
      return { success: true, profile: saved };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('autofill-never-for-site', async (_event, { origin }) => {
    try {
      const store = ensureStore();
      setSitePref(store, origin, { neverSave: true, neverSuggest: false });
      flush();
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('autofill-mark-used', async (_event, { profileId }) => {
    try {
      const store = ensureStore();
      markUsed(store, profileId);
      flush();
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });
}

module.exports = { registerAutofillIPC };
