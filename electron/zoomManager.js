const zoomState = new Map(); // webContents.id -> number

function getZoom(wc) {
  try {
    const cur = wc.getZoomFactor();
    return cur || 1.0;
  } catch (_) {
    return 1.0;
  }
}

function setZoom(wc, factor) {
  if (!wc || wc.isDestroyed()) return;
  const clamped = Math.max(0.25, Math.min(5.0, factor));
  wc.setZoomFactor(clamped);
  zoomState.set(wc.id, clamped);
  return clamped;
}

function zoomIn(wc) {
  const cur = zoomState.get(wc.id) ?? getZoom(wc);
  return setZoom(wc, cur + 0.1);
}

function zoomOut(wc) {
  const cur = zoomState.get(wc.id) ?? getZoom(wc);
  return setZoom(wc, cur - 0.1);
}

function zoomReset(wc) {
  return setZoom(wc, 1.0);
}

function applyInitialZoom(wc) {
  const saved = zoomState.get(wc.id);
  if (saved) wc.setZoomFactor(saved);
}

module.exports = {
  zoomIn,
  zoomOut,
  zoomReset,
  applyInitialZoom,
  setZoom,
  getZoom,
};

