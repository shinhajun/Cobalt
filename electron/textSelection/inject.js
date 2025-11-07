(() => {
  if (window.__textSelectionInjected) return; window.__textSelectionInjected = true;

  const API = window.__browserViewAPI;
  if (!API) return;

  let popup = null;
  let lastSelRect = null; // {x,y}
  let translateToast = null;

  function cleanupPopup() { if (popup && popup.parentNode) popup.remove(); popup = null; }

  function makePopup(x, y, selectedText, ctx) {
    cleanupPopup();
    popup = document.createElement('div');
    popup.style.cssText = 'position:fixed; left:0; top:0; z-index:999999;';

    const container = document.createElement('div');
    container.style.cssText = 'position:absolute; left:'+x+'px; top:'+y+'px; background:#fff; border:1px solid #dadce0; border-radius:6px; padding:4px; box-shadow:0 2px 8px rgba(0,0,0,0.15); display:flex; gap:4px; align-items:center; font:13px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;';

    const translateBtn = document.createElement('button');
    translateBtn.textContent = 'AI Translate';
    translateBtn.style.cssText = 'background:#f9fafb; color:#374151; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; max-width:420px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';
    // Prevent selection collapse on click
    translateBtn.addEventListener('mousedown', (e) => { try { e.preventDefault(); e.stopPropagation(); } catch {} }, true);
    translateBtn.onclick = () => {
      try {
        translateBtn.disabled = true; translateBtn.textContent = 'Translating...';
        window.__pendingTranslateButton = translateBtn;
        API.requestTranslation && API.requestTranslation(selectedText);
      } catch(_) {}
    };

    const editBtn = document.createElement('button');
    editBtn.textContent = 'AI Edit';
    editBtn.style.cssText = 'background:#f9fafb; color:#374151; border:none; padding:6px 10px; border-radius:4px; cursor:pointer;';
    editBtn.onclick = () => {
      try {
        const input = document.createElement('input');
        input.type = 'text'; input.placeholder = 'How to edit?'; input.value = 'Fix grammar';
        input.style.cssText = 'background:#fff; color:#374151; border:1px solid #d1d5db; padding:6px 10px; border-radius:4px; outline:none; width:200px;';
        editBtn.replaceWith(input);
        input.focus(); input.select();

        const sel = window.getSelection();
        const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        const el = ctx.editableEl || null;
        const selStart = ctx.selStart ?? null;
        const selEnd = ctx.selEnd ?? null;

        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const prompt = (input.value||'').trim(); if (!prompt) return;
            const loading = document.createElement('div'); loading.textContent='Editing...'; loading.style.cssText='background:#fef3c7;color:#92400e;padding:6px 10px;border-radius:4px;font-weight:500;';
            container.replaceChildren(loading);
            window.__pendingEditRange = range; window.__pendingEditElement = el; window.__pendingEditSelStart = selStart; window.__pendingEditSelEnd = selEnd; window.__pendingEditPopup = container;
            API.requestAIEdit && API.requestAIEdit(selectedText, prompt);
          } else if (e.key === 'Escape') { cleanupPopup(); }
        });
      } catch(_) {}
    };

    if (ctx && ctx.isEditable) {
      // Input/textarea/contenteditable: show AI Edit only
      container.appendChild(editBtn);
    } else {
      // General text: show AI Translate only
      container.appendChild(translateBtn);
    }
    popup.appendChild(container);
    document.body.appendChild(popup);
  }

  function clamp(val, min, max){ return Math.max(min, Math.min(max, val)); }

  function showTranslateBubble(message, isLoading=false, isError=false){
    try {
      if (!translateToast) {
        translateToast = document.createElement('div');
        translateToast.style.cssText = 'position:fixed; z-index:1000000; background:#fff; border:1px solid #dadce0; border-radius:8px; padding:6px 10px; box-shadow:0 2px 8px rgba(0,0,0,0.12); font:13px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif; max-width:420px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';
        document.body.appendChild(translateToast);
      }
      translateToast.textContent = String(message || '');
      translateToast.style.background = isError ? '#fee2e2' : (isLoading ? '#fef3c7' : '#dcfce7');
      translateToast.style.color = isError ? '#991b1b' : (isLoading ? '#92400e' : '#166534');

      // Position near last selection if known, else top-right
      const margin = 8;
      let x = window.innerWidth - translateToast.offsetWidth - margin - 12;
      let y = 80;
      if (lastSelRect) {
        x = clamp(lastSelRect.x - 100, margin, window.innerWidth - 220);
        y = clamp(lastSelRect.y - 45, 50, window.innerHeight - 80);
      }
      translateToast.style.left = x + 'px';
      translateToast.style.top = y + 'px';

      if (!isLoading) {
        setTimeout(() => { try { translateToast && translateToast.remove(); translateToast = null; } catch{} }, 3000);
      }
    } catch {}
  }

  function selectionCenter() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const x = Math.max(10, Math.min((rect.left+rect.right)/2, window.innerWidth-120));
    const y = rect.top - 45;
    return { x, y, range };
  }

  function detectEditable() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return { isEditable:false };
    const anchor = sel.anchorNode && sel.anchorNode.parentElement;
    const el = anchor && anchor.closest && anchor.closest('input,textarea,[contenteditable]');
    if (!el) return { isEditable:false };
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      return { isEditable:true, editableEl:el, selStart: el.selectionStart, selEnd: el.selectionEnd };
    }
    if (el.isContentEditable) return { isEditable:true, editableEl: el };
    return { isEditable: true, editableEl: el };
  }

  function onMouseUp() {
    try {
      const ctx = detectEditable();
      let selectedText = '';
      let pos = null;

      if (ctx.isEditable && ctx.editableEl) {
        // For input/textarea selection
        const el = ctx.editableEl;
        if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
          const s = el.selectionStart ?? 0; const e = el.selectionEnd ?? 0;
          if (e > s) {
            selectedText = String(el.value || '').substring(s, e).trim();
            const r = el.getBoundingClientRect();
            pos = { x: (r.left + r.right) / 2, y: r.top - 10 };
          }
        } else if (el.isContentEditable) {
          const sel = window.getSelection();
          selectedText = sel ? String(sel.toString()).trim() : '';
          pos = selectionCenter();
        }
      } else {
        // General DOM selection
        const sel = window.getSelection();
        selectedText = sel ? String(sel.toString()).trim() : '';
        pos = selectionCenter();
      }

      if (!selectedText) { cleanupPopup(); return; }
      if (!pos) return;
      const yAdjusted = pos.y < 60 ? (pos.y + 60) : pos.y;
      lastSelRect = { x: pos.x, y: yAdjusted };
      makePopup(pos.x, yAdjusted, selectedText, ctx);
    } catch {}
  }

  document.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    try { if (popup && popup.contains(e.target)) return; } catch {}
    setTimeout(onMouseUp, 0);
  }, true);
  document.addEventListener('keyup', (e) => { if (e.key === 'Escape') cleanupPopup(); }, true);

  // Handle results forwarded by preload via window.postMessage
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data || {};
    if (data.type === '__translation-start') {
      showTranslateBubble('Translating...', true, false);
      return;
    }
    if (data.type === '__translation-result') {
      const result = data.payload || {};
      const btn = window.__pendingTranslateButton;
      if (btn) {
        btn.disabled = false;
        if (result.translation) { btn.textContent = result.translation; btn.style.background = '#dcfce7'; btn.style.color = '#166534'; }
        else { btn.textContent = 'Translation failed'; btn.style.background = '#fee2e2'; btn.style.color = '#991b1b'; }
        delete window.__pendingTranslateButton;
      } else {
        // No pending button (e.g., from context menu). Show bubble near selection.
        if (result.translation) showTranslateBubble(result.translation, false, false);
        else showTranslateBubble('Translation failed', false, true);
      }
    }
    if (data.type === '__edit-result') {
      const result = data.payload || {};
      try {
        if (result && result.editedText) {
          const element = window.__pendingEditElement;
          const range = window.__pendingEditRange;
          const selStart = window.__pendingEditSelStart;
          const selEnd = window.__pendingEditSelEnd;
          if (element) {
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
              const originalValue = element.value || '';
              const startPos = selStart != null ? selStart : element.selectionStart;
              const endPos = selEnd != null ? selEnd : element.selectionEnd;
              element.value = originalValue.substring(0, startPos) + result.editedText + originalValue.substring(endPos);
              const newCursorPos = startPos + result.editedText.length;
              element.selectionStart = newCursorPos; element.selectionEnd = newCursorPos;
              element.focus();
              try { element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); } catch {}
            } else if (element.isContentEditable && range) {
              range.deleteContents();
              range.insertNode(document.createTextNode(result.editedText));
              try {
                const target = element;
                if (target) target.dispatchEvent(new Event('input', { bubbles: true }));
              } catch {}
            }
          } else if (range) {
            range.deleteContents();
            range.insertNode(document.createTextNode(result.editedText));
            try {
              const target = (range.commonAncestorContainer && range.commonAncestorContainer.nodeType === 1)
                ? range.commonAncestorContainer
                : (range.commonAncestorContainer && range.commonAncestorContainer.parentElement);
              if (target) target.dispatchEvent(new Event('input', { bubbles: true }));
            } catch {}
          }
          // Clear pending refs
          delete window.__pendingEditRange; delete window.__pendingEditElement; delete window.__pendingEditSelStart; delete window.__pendingEditSelEnd;
          const p = window.__pendingEditPopup; if (p && p.parentNode) { p.textContent = 'Text replaced'; p.style.background = '#dcfce7'; p.style.color = '#166534'; setTimeout(()=>{ try{ p.remove(); }catch{} }, 1500); }
          delete window.__pendingEditPopup;
        } else if (result && result.error) {
          const p = window.__pendingEditPopup; if (p && p.parentNode) { p.textContent = 'Edit failed'; p.style.background = '#fee2e2'; p.style.color = '#991b1b'; setTimeout(()=>{ try{ p.remove(); }catch{} }, 1500); }
          delete window.__pendingEditPopup;
        }
      } catch(_) {}
    }
  });
})();
