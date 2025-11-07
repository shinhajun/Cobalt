(() => {
  if (window.__autofillInjected) return; window.__autofillInjected = true;

  const API = window.__browserViewAPI;
  if (!API) return;

  const DROPDOWN_ID = '__autofill_dropdown__';
  const SAVE_PROMPT_ID = '__autofill_save_prompt__';

  function classifyHintFromEl(el){
    return {
      autocomplete: el.getAttribute('autocomplete') || '',
      name: el.getAttribute('name') || '',
      id: el.id || '',
      placeholder: el.getAttribute('placeholder') || '',
      type: (el.getAttribute('type') || '').toLowerCase(),
    };
  }

  function rectBelow(el){
    const r = el.getBoundingClientRect();
    return { left: r.left + window.scrollX, top: r.bottom + window.scrollY, width: r.width };
  }

  function removeDropdown(){ const dd = document.getElementById(DROPDOWN_ID); if (dd) dd.remove(); }
  function removeSavePrompt(){ const p = document.getElementById(SAVE_PROMPT_ID); if (p) p.remove(); }

  function createDropdown(el, suggestions){
    removeDropdown();
    if (!Array.isArray(suggestions) || suggestions.length === 0) return;
    const pos = rectBelow(el);
    const dd = document.createElement('div');
    dd.id = DROPDOWN_ID;
    dd.style.cssText = 'position:absolute; z-index:999999; background:#fff; border:1px solid #dadce0; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.12); font:13px -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif; overflow:hidden;';
    dd.style.left = pos.left + 'px';
    dd.style.top = pos.top + 'px';
    dd.style.minWidth = Math.max(160, Math.floor(pos.width)) + 'px';

    suggestions.slice(0,6).forEach((sug, idx) => {
      const item = document.createElement('div');
      item.textContent = sug.label + (sug.primary ? ` — ${sug.primary}` : '');
      item.setAttribute('data-profile-id', sug.id);
      item.style.cssText = 'padding:8px 10px; cursor:pointer; color:#202124;';
      item.onmouseenter = () => item.style.background = '#f1f3f4';
      item.onmouseleave = () => item.style.background = 'transparent';
      item.onclick = async (e) => {
        try{
          fillFromSuggestion(el, sug);
          removeDropdown();
          await API.autofillMarkUsed && API.autofillMarkUsed(sug.id);
        }catch{}
      };
      dd.appendChild(item);
    });

    document.body.appendChild(dd);

    const reposition = () => {
      const r = rectBelow(el);
      dd.style.left = r.left + 'px'; dd.style.top = r.top + 'px'; dd.style.minWidth = Math.max(160, Math.floor(r.width)) + 'px';
    };
    const onScroll = () => reposition();
    const onResize = () => reposition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    dd.__cleanup = () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onResize); };
  }

  function fillFromSuggestion(focusedEl, sug){
    // Try fill current field from primary; also fill siblings by field type heuristic
    const form = focusedEl.closest('form') || document;
    const controls = Array.from(form.querySelectorAll('input,textarea,select'));
    const getHint = (el) => classifyHintFromEl(el);
    const mapType = (h) => {
      const hay = `${(h.name||'')} ${(h.id||'')} ${(h.placeholder||'')}`.toLowerCase();
      if (/(email|메일)/.test(hay) || h.type==='email') return 'email';
      if (/(tel|phone|휴대|전화)/.test(hay) || h.type==='tel') return 'phone';
      if (/(name|fullname|성명|이름)/.test(hay)) return 'name';
      if (/(company|org|회사)/.test(hay)) return 'company';
      if (/(address|주소)/.test(hay)) return 'address-line1';
      if (/(address2|상세)/.test(hay)) return 'address-line2';
      if (/(city|구|군|시)/.test(hay)) return 'city';
      if (/(state|도)/.test(hay)) return 'state';
      if (/(zip|post|우편)/.test(hay)) return 'postal';
      if (/(country|국가)/.test(hay)) return 'country';
      return '';
    };
    const setVal = (el, val) => { try { el.focus(); el.value = val || ''; el.dispatchEvent(new Event('input', { bubbles:true })); el.dispatchEvent(new Event('change', { bubbles:true })); } catch{} };

    // Fill current
    setVal(focusedEl, sug.primary || '');
    // Fill siblings where clear type matches
    controls.forEach(el => {
      if (el === focusedEl) return;
      const t = mapType(getHint(el));
      if (t && sug.values && sug.values[t]) setVal(el, sug.values[t]);
    });
  }

  async function onFocus(el){
    try {
      const hints = classifyHintFromEl(el);
      const res = await (API.autofillQuery && API.autofillQuery({ fieldHints: hints }));
      if (!res || !res.success) return;
      const { fieldType, suggestions } = res;
      if (!Array.isArray(suggestions) || suggestions.length === 0) { removeDropdown(); return; }
      createDropdown(el, suggestions);
    } catch {}
  }

  function installFocusHandlers(){
    document.addEventListener('focusin', (e) => {
      const el = e.target;
      if (!el || !(el instanceof HTMLElement)) return;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        const type = (el.getAttribute('type')||'text').toLowerCase();
        if (['text','email','tel','search',''].includes(type)) {
          onFocus(el);
        }
      }
    }, true);
    document.addEventListener('click', (e) => {
      const dd = document.getElementById(DROPDOWN_ID);
      if (!dd) return;
      if (!dd.contains(e.target)) { if (dd.__cleanup) dd.__cleanup(); removeDropdown(); }
    }, true);
  }

  function showSavePrompt(profile, origin){
    removeSavePrompt();
    const bar = document.createElement('div');
    bar.id = SAVE_PROMPT_ID;
    bar.style.cssText = 'position:fixed; top:80px; right:16px; z-index:1000000; background:#fff; border:1px solid #dadce0; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.12); padding:8px; font:13px -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif; display:flex; gap:6px; align-items:center;';
    const label = document.createElement('div');
    label.textContent = 'Save profile for autofill?';
    const saveBtn = document.createElement('button'); saveBtn.textContent='Save'; saveBtn.style.cssText='border:none; background:#e8f0fe; color:#1967d2; border-radius:6px; padding:6px 10px; cursor:pointer;';
    const neverBtn = document.createElement('button'); neverBtn.textContent='Never for this site'; neverBtn.style.cssText='border:none; background:#fde7e9; color:#b00020; border-radius:6px; padding:6px 10px; cursor:pointer;';
    const closeBtn = document.createElement('button'); closeBtn.textContent='✕'; closeBtn.style.cssText='border:none; background:transparent; color:#5f6368; border-radius:6px; padding:6px 8px; cursor:pointer;';
    bar.appendChild(label); bar.appendChild(saveBtn); bar.appendChild(neverBtn); bar.appendChild(closeBtn);

    saveBtn.onclick = async () => {
      try { await API.autofillSaveProfile && API.autofillSaveProfile({ profile }); toast('Profile saved'); } catch {}
      removeSavePrompt();
    };
    neverBtn.onclick = async () => {
      try { await API.autofillNeverForSite && API.autofillNeverForSite({ origin }); toast('Will not offer to save for this site'); } catch {}
      removeSavePrompt();
    };
    closeBtn.onclick = () => removeSavePrompt();

    document.body.appendChild(bar);
  }

  function toast(message){
    const note = document.createElement('div');
    note.style.cssText = 'position:fixed; top:80px; right:16px; background:#f0f9eb; color:#1e4620; border:1px solid #d3f9d8; border-radius:6px; padding:8px 12px; z-index:1000000;';
    note.textContent = message;
    document.body.appendChild(note);
    setTimeout(() => { try { note.remove(); } catch{} }, 2000);
  }

  function installSubmitHandlers(){
    const collectProfile = (form) => {
      const data = { name:'', email:'', phone:'', company:'', address_line1:'', address_line2:'', city:'', state:'', postal:'', country:'' };
      const fields = [];
      const controls = Array.from((form || document).querySelectorAll('input,textarea,select'));
      controls.forEach(el => {
        const type = (el.getAttribute('type')||'text').toLowerCase();
        if (!['text','email','tel','search',''].includes(type) && el.tagName!=='TEXTAREA' && el.tagName!=='SELECT') return;
        const val = (el.value || '').trim(); if (!val) return;
        const hint = classifyHintFromEl(el);
        fields.push({ fieldType: (hint.autocomplete||hint.name||hint.id||'').toLowerCase(), value: val });
        const hay = `${(hint.name||'')} ${(hint.id||'')} ${(hint.placeholder||'')}`.toLowerCase();
        if (/(email|메일)/.test(hay) || type==='email') data.email = val;
        else if (/(tel|phone|휴대|전화)/.test(hay) || type==='tel') data.phone = val;
        else if (/(name|fullname|성명|이름)/.test(hay)) data.name = val;
        else if (/(company|org|회사)/.test(hay)) data.company = val;
        else if (/(address2|상세)/.test(hay)) data.address_line2 = val;
        else if (/(address|주소)/.test(hay)) data.address_line1 = data.address_line1 || val;
        else if (/(city|구|군|시)/.test(hay)) data.city = val;
        else if (/(state|도)/.test(hay)) data.state = val;
        else if (/(zip|post|우편)/.test(hay)) data.postal = val;
        else if (/(country|국가)/.test(hay)) data.country = val;
      });
      return { profile: data, fields };
    };

    const handler = async (e) => {
      try {
        const origin = location.origin;
        const { profile, fields } = collectProfile(e.target || document);
        const hasAny = Object.values(profile).some(v => v && String(v).trim());
        if (!hasAny) return;
        const res = await (API.autofillReportSubmit && API.autofillReportSubmit({ origin, fields }));
        if (res && res.offerSave) {
          showSavePrompt(profile, origin);
        }
      } catch {}
    };

    document.addEventListener('submit', handler, true);
  }

  try { installFocusHandlers(); installSubmitHandlers(); } catch {}
})();

