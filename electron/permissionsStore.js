const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const FILE_NAME = 'permissions.json';

function getFilePath() {
  try {
    return path.join(app.getPath('userData'), FILE_NAME);
  } catch (_) {
    return path.join(process.cwd(), FILE_NAME);
  }
}

function loadAll() {
  const p = getFilePath();
  try {
    if (!fs.existsSync(p)) return {};
    const raw = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(raw);
    return typeof data === 'object' && data ? data : {};
  } catch (_) {
    return {};
  }
}

function saveAll(data) {
  try {
    const p = getFilePath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  } catch (_) {}
}

function key(origin, permission) {
  return `${origin}__${permission}`;
}

function getDecision(origin, permission) {
  const store = loadAll();
  const val = store[key(origin, permission)];
  return val; // 'allow' | 'deny' | undefined
}

function setDecision(origin, permission, decision) {
  const store = loadAll();
  store[key(origin, permission)] = decision; // 'allow' | 'deny'
  saveAll(store);
}

module.exports = { getDecision, setDecision };

