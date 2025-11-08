const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const STORE_FILE = 'autofill.json';

function getStorePath() {
  try {
    const dir = app.getPath('userData');
    return path.join(dir, STORE_FILE);
  } catch (_) {
    return path.join(process.cwd(), STORE_FILE);
  }
}

function loadStore() {
  const p = getStorePath();
  try {
    if (!fs.existsSync(p)) return { profiles: [], sitePrefs: {} };
    const raw = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return { profiles: [], sitePrefs: {} };
    data.profiles = Array.isArray(data.profiles) ? data.profiles : [];
    data.sitePrefs = data.sitePrefs && typeof data.sitePrefs === 'object' ? data.sitePrefs : {};
    return data;
  } catch (_) {
    return { profiles: [], sitePrefs: {} };
  }
}

function saveStore(store) {
  try {
    const p = getStorePath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(store, null, 2), 'utf8');
  } catch (_) {
    // ignore
  }
}

function originOf(url) {
  try { const u = new URL(url); return `${u.protocol}//${u.host}`; } catch { return 'unknown'; }
}

function nowTs() { return Date.now(); }

// Create or update a profile
function upsertProfile(store, profile) {
  // Simple merge by email if available, else by name+phone
  const keyEmail = (profile.email || '').toLowerCase().trim();
  let idx = -1;
  if (keyEmail) idx = store.profiles.findIndex(p => (p.email || '').toLowerCase().trim() === keyEmail);
  if (idx === -1 && profile.name) {
    idx = store.profiles.findIndex(p => (p.name || '').trim().toLowerCase() === (profile.name || '').trim().toLowerCase() && (p.phone || '') === (profile.phone || ''));
  }
  const base = {
    id: profile.id || `prof_${Math.random().toString(36).slice(2)}`,
    name: profile.name || '',
    email: profile.email || '',
    phone: profile.phone || '',
    company: profile.company || '',
    address_line1: profile.address_line1 || '',
    address_line2: profile.address_line2 || '',
    city: profile.city || '',
    state: profile.state || '',
    postal: profile.postal || '',
    country: profile.country || '',
    useCount: profile.useCount || 0,
    lastUsedAt: profile.lastUsedAt || nowTs(),
  };
  if (idx >= 0) {
    store.profiles[idx] = { ...store.profiles[idx], ...base, id: store.profiles[idx].id };
    return store.profiles[idx];
  }
  store.profiles.push(base);
  return base;
}

function markUsed(store, profileId) {
  const p = store.profiles.find(x => x.id === profileId);
  if (p) { p.useCount = (p.useCount || 0) + 1; p.lastUsedAt = nowTs(); }
}

function setSitePref(store, origin, pref) {
  store.sitePrefs[origin] = { ...(store.sitePrefs[origin] || {}), ...pref };
}

function getSitePref(store, origin) {
  return store.sitePrefs[origin] || { neverSave: false, neverSuggest: false };
}

function rankProfilesForField(store, fieldType) {
  // Simple ranking: most recently used first
  const list = store.profiles.slice().sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
  return list.map(p => ({ profile: p, value: extractValueByType(p, fieldType) })).filter(x => x.value && String(x.value).trim().length > 0);
}

function extractValueByType(profile, fieldType) {
  switch ((fieldType || '').toLowerCase()) {
    case 'name': return profile.name;
    case 'email': return profile.email;
    case 'phone': return profile.phone;
    case 'company': return profile.company;
    case 'address-line1': return profile.address_line1;
    case 'address-line2': return profile.address_line2;
    case 'city': return profile.city;
    case 'state': return profile.state;
    case 'postal': return profile.postal;
    case 'country': return profile.country;
    default: return '';
  }
}

function buildSuggestion(profile, primaryFieldType) {
  const label = profile.name || profile.email || profile.phone || 'Profile';
  const values = {
    name: profile.name,
    email: profile.email,
    phone: profile.phone,
    company: profile.company,
    'address-line1': profile.address_line1,
    'address-line2': profile.address_line2,
    city: profile.city,
    state: profile.state,
    postal: profile.postal,
    country: profile.country,
  };
  return { id: profile.id, label, primary: extractValueByType(profile, primaryFieldType), values };
}

function querySuggestions(store, url, primaryFieldType) {
  const origin = originOf(url);
  const prefs = getSitePref(store, origin);
  if (prefs.neverSuggest) return [];
  const ranked = rankProfilesForField(store, primaryFieldType);
  return ranked.map(({ profile }) => buildSuggestion(profile, primaryFieldType));
}

module.exports = {
  loadStore,
  saveStore,
  upsertProfile,
  markUsed,
  setSitePref,
  getSitePref,
  querySuggestions,
  extractValueByType,
};

