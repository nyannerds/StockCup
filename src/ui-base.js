/* StockCup UI base: state, storage, router, sheets, helpers. */
'use strict';
const $ = (sel, root) => (root || document).querySelector(sel);
const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d) => SC.fmtNum(n, d);
const today = () => SC.localDate();
const KEY = 'stockcup.v1';

let S = null;               // application state (see SC.defaultState)
let storageNote = '';       // shown when the browser blocks or rejects saving
const UI = { page: 'home', pantryCat: 'all', pantryQ: '', rview: 'make', rf: { serve: '', caf: '', dairyFree: false, fav: false, q: '' }, hwho: 'all', hmonth: today().slice(0, 7), lastLogId: null };
const ACT = {}, CHG = {}, SUB = {}, INP = {}, VIEWS = {}, SHEETS = {};
let SHEET = null; let pendingConfirm = null; let toastTimer = null; let SYNC_CLIENT = null;

// ---------- storage ----------
function loadState() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) { storageNote = 'This browser is blocking storage, so changes will be lost when you close the page. Use Export in More to keep a copy.'; return SC.defaultState(); }
  if (!raw) return SC.defaultState();
  try { return SC.sanitizeState(JSON.parse(raw)); } catch (e) {
    try { localStorage.setItem(KEY + '.corrupt', raw); } catch (e2) { /* ignore */ }
    storageNote = 'Your saved data could not be read (' + e.message + '). A copy was kept aside and the app started fresh. Importing an export file will restore it.';
    return SC.defaultState();
  }
}
function saveRaw() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); if (storageNote.indexOf('full') >= 0) storageNote = ''; return true; } catch (e) {
    storageNote = 'Could not save: browser storage is full or blocked. Export your data now from Profile.'; return false;
  }
}
function save() { const ok = saveRaw(); syncAfterSave(); return ok; }
function mutate(fn) { fn(S); save(); render(); }
function applyTheme() {
  const t = S.settings.theme; const r = document.documentElement;
  if (t === 'dark' || t === 'light') r.setAttribute('data-theme', t); else r.removeAttribute('data-theme');
  try { if (t === 'dark' || t === 'light') localStorage.setItem('stockcup.theme', t); else localStorage.removeItem('stockcup.theme'); } catch (e) { /* ignore */ }
}

// ---------- formatting ----------
function money(v) { return (S.settings.currency || '$') + (Math.round(v * 100) / 100).toFixed(2); }
function fmtDT(ts) {
  const m = String(ts).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/); if (!m) return ts;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + (m[4] ? ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');
}
function temp(c) { if (c === null || c === undefined) return 'cold'; return S.settings.tempUnit === 'F' ? Math.round(c * 9 / 5 + 32) + ' °F' : c + ' °C'; }
function amt(v, unit) {
  const u = unit === 'shot' ? (v === 1 ? 'shot' : 'shots') : unit === 'capsule' ? (v === 1 ? 'capsule' : 'capsules') : unit;
  let s = fmt(v) + ' ' + u;
  if (S.settings.imperial && (unit === 'ml' || unit === 'g')) s += ' (≈ ' + (unit === 'ml' ? fmt(v / 29.5735, 1) + ' fl oz' : fmt(v / 28.3495, 1) + ' oz') + ')';
  return s;
}
const slotName = (s) => (s.type === 'other' && s.label ? s.label : SC.SLOT_LABEL[s.type]);
const personName = (id) => { const p = S.people.find((x) => x.id === id); return p ? p.name : 'Unassigned'; };
const activePerson = () => S.people.find((p) => p.id === S.settings.activePerson) || S.people[0];
const catLabel = (c) => SC.CATEGORIES[c].label;
function stockText(p) {
  if (p.category === 'capsule') return p.count + (p.count === 1 ? ' capsule' : ' capsules');
  const parts = [];
  if (p.sealed) parts.push(p.sealed + ' sealed × ' + fmt(p.size) + ' ' + p.unit);
  if (p.open) parts.push(p.open.amount === null ? 'open pack: unknown amount' : 'open: ' + fmt(p.open.amount) + ' ' + p.unit);
  return parts.length ? parts.join(' + ') : 'Empty';
}
function totalText(p) {
  const st = SC.stockOf(p);
  if (p.category === 'capsule') return fmt(st.amount) + ' caps';
  if (st.unknown) return st.amount > 0 ? '≥ ' + fmt(st.amount) + ' ' + p.unit + ' + unknown' : 'unknown';
  return fmt(st.amount) + ' ' + p.unit;
}
function freshBadge(p) {
  const f = SC.freshness(p, today()); if (!f) return '';
  if (f.state === 'sealed') return '<span class="badge">Sealed</span>';
  if (f.state === 'none') return '<span class="badge">Open</span>';
  if (f.state === 'past') return '<span class="badge bad">Past best · open ' + f.days + ' d</span>';
  if (f.state === 'warn') return '<span class="badge warn">Use soon · open ' + f.days + ' d</span>';
  return '<span class="badge ok">Fresh · open ' + f.days + ' d</span>';
}
const levelLabel = { none: 'No caffeine', low: 'Low caffeine', medium: 'Medium caffeine', high: 'High caffeine' };

// ---------- router ----------
const PAGES = { home: 'home', pantry: 'pantry', recipes: 'recipes', history: 'more', more: 'more', shopping: 'more', plan: 'more' };
function go(page) {
  UI.page = page; closeSheet(); render(); window.scrollTo(0, 0);
  if (location.hash !== '#/' + page) { try { history.pushState(null, '', '#/' + page); } catch (e) { location.hash = '#/' + page; } }
}
function routeFromHash() { const m = location.hash.match(/^#\/(\w+)/); UI.page = m && VIEWS[m[1]] ? m[1] : 'home'; }
window.addEventListener('popstate', () => { routeFromHash(); closeSheet(); render(); window.scrollTo(0, 0); });
window.addEventListener('hashchange', () => { routeFromHash(); closeSheet(); render(); window.scrollTo(0, 0); });

const ICON = {
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M10 20v-5.5h4V20"/></svg>',
  pantry: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="9" width="14" height="12" rx="3"/><path d="M8 9V6h8v3"/><path d="M5 14.5h14"/><path d="M9 3.5h6"/></svg>',
  recipes: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/><path d="M9 8h6M9 11.5h4"/></svg>',
  profile: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.8-3.6 4-5.5 7.5-5.5s6.7 1.9 7.5 5.5"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>',
  bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21h4"/></svg>',
  filter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
  cup: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h12v5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z"/><path d="M17 10.500h1.500a2.5 2.5 0 0 1 0 5H16.5"/><path d="M9 3.500c-1 1 1 2-.1 3.500M13 3.500c-1 1 1 2-.1 3.5"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14-4.500L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14 4.500L20 15"/><path d="M20 20v-5h-5"/></svg>',
  logo: '<svg viewBox="0 0 44 38" aria-hidden="true"><path d="M8 14h24v8a11 11 0 0 1-11 11h-2A11 11 0 0 1 8 22z" fill="#fffaea" stroke="#fffaea"/><path d="M32 16h2.500a4.5 4.5 0 0 1 0 9H31" fill="none" stroke="#fffaea" stroke-width="2.5"/><path d="M15 6c-2 2 2 4 0 6M22 6c-2 2 2 4 0 6" fill="none" stroke="#ffb347" stroke-width="2.2" stroke-linecap="round"/><circle cx="16" cy="23" r="1.3" fill="#4f7339"/><circle cx="25" cy="23" r="1.3" fill="#4f7339"/><path d="M18.5 26q2 2 4 0" fill="none" stroke="#4f7339" stroke-width="1.4" stroke-linecap="round"/></svg>',
};
function navHtml() {
  const low = SC.lowStock(S).length + S.shopping.length;
  const tabs = [['home', 'home', 'Home'], ['pantry', 'pantry', 'Pantry'], ['recipes', 'recipes', 'Recipes'], ['more', 'profile', 'Profile']];
  return '<nav class="nav" aria-label="Main"><div>' + tabs.map((t) => '<button data-act="go" data-page="' + t[0] + '"' + (PAGES[UI.page] === t[0] ? ' aria-current="page"' : '') + '>' + ICON[t[1]] + t[2] + (t[0] === 'more' && low ? '<span class="dot" aria-label="' + low + ' to buy">' + low + '</span>' : '') + '</button>').join('') + '</div></nav>';
}
function avatarBtn() {
  const p = activePerson();
  return '<button class="avatar" data-act="nextPerson" aria-label="Active person: ' + esc(p.name) + (S.people.length > 1 ? '. Tap to switch.' : '. Open profile.') + '">' + esc((p.name.trim().charAt(0) || '?').toUpperCase()) + '</button>';
}
// Page header. home=true gives the full header (logo, search, welcome, bell); otherwise a compact title bar.
function hero(title, extra, home) {
  const notes = (storageNote ? '<div class="alert bad" role="alert">' + esc(storageNote) + '</div>' : '') + timerHtml();
  if (home) {
    const n = alertCount();
    return '<header class="hero"><div class="hero-top"><div class="logo">' + ICON.logo + '<span>StockCup</span></div><button class="searchbar" data-act="openSearch" aria-label="Search pantry and recipes"><span>Search here …</span>' + ICON.search + '</button></div>' +
      '<div class="welcome">' + avatarBtn() + '<div class="who grow"><b>Welcome!</b><span>' + esc(activePerson().name) + '</span> ' + syncPill() + '</div><button class="iconbtn" data-act="openBell" aria-label="Notifications' + (n ? ', ' + n + ' need attention' : ', none') + '">' + ICON.bell + (n ? '<span class="count">' + n + '</span>' : '') + '</button></div></header>' + notes;
  }
  return '<header class="hero"><div class="hero-top"><h1>' + esc(title) + '</h1>' + (extra || '') + avatarBtn() + '</div>' + (connected() ? '<div class="hero-sub">' + syncPill() + '</div>' : '') + '</header>' + notes;
}

// In-place DOM reconciliation: keeps the same elements (and focus) so a tap is never lost to a re-render.
function patchChildren(oldP, newP) {
  const olds = Array.prototype.slice.call(oldP.childNodes), news = Array.prototype.slice.call(newP.childNodes);
  for (let i = 0; i < Math.max(olds.length, news.length); i++) {
    const o = olds[i], n = news[i];
    if (!n) oldP.removeChild(o); else if (!o) oldP.appendChild(n.cloneNode(true)); else patchNode(o, n);
  }
}
function patchNode(o, n) {
  if (o.nodeType !== n.nodeType || (o.nodeType === 1 && o.tagName !== n.tagName)) { o.parentNode.replaceChild(n.cloneNode(true), o); return; }
  if (o.nodeType !== 1) { if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue; return; }
  Array.prototype.slice.call(o.attributes).forEach((a) => { if (!n.hasAttribute(a.name)) o.removeAttribute(a.name); });
  Array.prototype.slice.call(n.attributes).forEach((a) => { if (o.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value); });
  const tag = o.tagName, active = document.activeElement === o;
  if (tag === 'INPUT') {
    if (o.type === 'checkbox' || o.type === 'radio') o.checked = n.hasAttribute('checked');
    else if (!active) { const v = n.getAttribute('value') || ''; if (o.value !== v) o.value = v; }
    return;
  }
  patchChildren(o, n);
  if (tag === 'SELECT') { if (o.value !== n.value) o.value = n.value; } else if (tag === 'TEXTAREA' && !active) { if (o.value !== n.value) o.value = n.value; }
}
function paint(container, html, fresh) {
  if (fresh) { container.innerHTML = html; return; }
  const t = document.createElement('div'); t.innerHTML = html; patchChildren(container, t);
}
let rendering = false, lastPage = null;
function render(keepSheet) {
  if (!S) return;
  if (rendering) { setTimeout(() => render(keepSheet), 0); return; }
  rendering = true;
  try {
    const view = VIEWS[UI.page] || VIEWS.home; const y = window.scrollY; const fresh = lastPage !== UI.page; lastPage = UI.page;
    paint($('#app'), view() + navHtml(), fresh);
    if (fresh) window.scrollTo(0, y);
    if (!keepSheet) renderSheet(); // a remote update must not reset a form that is being filled in
  } finally { rendering = false; }
}

// ---------- sheets ----------
function openSheet(name, data) { SHEET = { name: name, data: data || {} }; clearTimeout(toastTimer); $('#toast-root').innerHTML = ''; renderSheet(); const b = $('#overlay .body'); if (b) b.scrollTop = 0; }
function closeSheet() { SHEET = null; lastSheet = null; $('#overlay').innerHTML = ''; }
let lastSheet = null;
function renderSheet() {
  const ov = $('#overlay');
  if (!SHEET) { ov.innerHTML = ''; lastSheet = null; return; }
  const def = SHEETS[SHEET.name](SHEET.data); if (!def) { closeSheet(); return; }
  const html = '<div class="scrim"><div class="sheet' + (def.full ? ' full' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(def.title) + '"><header><h2>' + esc(def.title) + '</h2>' +
    (def.noClose ? '' : '<button data-act="closeSheet" aria-label="Close">✕</button>') + '</header><div class="body">' + def.body + '</div>' + (def.footer ? '<footer>' + def.footer + '</footer>' : '') + '</div></div>';
  const fresh = lastSheet !== SHEET.name || !ov.firstChild; lastSheet = SHEET.name;
  paint(ov, html, fresh);
}
function confirmDialog(message, okLabel, fn, danger) {
  pendingConfirm = fn;
  const prev = SHEET; SHEET = { name: 'confirm', data: { message: message, okLabel: okLabel, danger: danger, prev: prev } }; renderSheet();
}
SHEETS.confirm = (d) => ({ title: 'Are you sure?', body: '<p>' + esc(d.message) + '</p>', footer: '<button data-act="confirmNo">Cancel</button><button class="' + (d.danger ? 'danger' : 'primary') + '" data-act="confirmYes">' + esc(d.okLabel || 'OK') + '</button>' });
ACT.confirmNo = () => { const p = SHEET && SHEET.data.prev; pendingConfirm = null; if (p) { SHEET = p; renderSheet(); } else closeSheet(); };
ACT.confirmYes = () => { const f = pendingConfirm; const p = SHEET && SHEET.data.prev; pendingConfirm = null; if (p) SHEET = p; else SHEET = null; renderSheet(); if (f) f(); };
ACT.closeSheet = () => closeSheet();
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && SHEET && !(SHEETS[SHEET.name](SHEET.data) || {}).noClose) closeSheet(); });

// ---------- toast ----------
function toast(msg, actionLabel, fn, ms) {
  const root = $('#toast-root'); window.__toastFn = fn || null;
  root.innerHTML = '<div class="toast" role="status"><span class="grow">' + esc(msg) + '</span>' + (actionLabel ? '<button data-act="toastAction">' + esc(actionLabel) + '</button>' : '') + '</div>';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { root.innerHTML = ''; }, ms || (actionLabel ? 8000 : 3500));
}
ACT.toastAction = () => { const f = window.__toastFn; $('#toast-root').innerHTML = ''; if (f) f(); };

// ---------- timer ----------
let TIMER = null; let timerInt = null;
function timerHtml() {
  if (!TIMER) return '';
  const left = Math.max(0, Math.ceil((TIMER.end - Date.now()) / 1000));
  return '<div class="timerbar" role="timer" id="timerbar"><span aria-hidden="true">⏱</span><span id="timerval">' + clock(left) + '</span><span class="small">' + esc(TIMER.label) + '</span><button class="small" data-act="timerStop">' + (left === 0 ? 'Dismiss' : 'Cancel') + '</button></div>';
}
const clock = (s) => (s >= 3600 ? Math.floor(s / 3600) + ':' + SC.pad(Math.floor((s % 3600) / 60)) : Math.floor(s / 60)) + ':' + SC.pad(s % 60);
function startTimer(seconds, label) {
  TIMER = { end: Date.now() + seconds * 1000, label: label, done: false }; clearInterval(timerInt);
  timerInt = setInterval(() => {
    if (!TIMER) { clearInterval(timerInt); return; }
    const left = Math.max(0, Math.ceil((TIMER.end - Date.now()) / 1000)); const el = $('#timerval'); if (el) el.textContent = clock(left);
    if (left === 0 && !TIMER.done) { TIMER.done = true; clearInterval(timerInt); beep(); render(); }
  }, 500);
  render();
}
function beep() {
  try { if (navigator.vibrate) navigator.vibrate([300, 150, 300]); const C = window.AudioContext || window.webkitAudioContext; if (!C) return; const ctx = new C(); [0, 0.35, 0.7].forEach((t) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2); }); } catch (e) { /* ignore */ }
}
ACT.timerStop = () => { TIMER = null; clearInterval(timerInt); render(); };

// ---------- event delegation ----------
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  const f = ACT[el.dataset.act]; if (f) { f(el, e); }
});
document.addEventListener('change', (e) => { const el = e.target.closest('[data-change]'); if (el && CHG[el.dataset.change]) CHG[el.dataset.change](el, e); });
document.addEventListener('input', (e) => { const el = e.target.closest('[data-input]'); if (el && INP[el.dataset.input]) INP[el.dataset.input](el, e); });
document.addEventListener('submit', (e) => { const f = e.target.closest('form[data-submit]'); if (f) { e.preventDefault(); if (SUB[f.dataset.submit]) SUB[f.dataset.submit](f, e); } });
function formData(form) {
  const o = {};
  Array.prototype.forEach.call(form.elements, (el) => {
    if (!el.name) return;
    if (el.type === 'checkbox') o[el.name] = el.checked; else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; } else o[el.name] = el.value;
  });
  return o;
}
ACT.go = (el) => go(el.dataset.page);
ACT.nextPerson = () => {
  if (S.people.length < 2) { go('more'); return; }
  const i = S.people.findIndex((p) => p.id === S.settings.activePerson); const n = S.people[(i + 1) % S.people.length];
  mutate((s) => { s.settings.activePerson = n.id; }); toast('Now logging as ' + n.name);
};

// ---------- form helpers ----------
function field(name, label, value, o) {
  o = o || {}; const err = o.err ? '<div class="err" id="e-' + name + '">' + esc(o.err) + '</div>' : '';
  const type = o.type || 'text';
  const attrs = (type === 'number' ? ' inputmode="' + (o.int ? 'numeric' : 'decimal') + '" step="any"' : '') + (o.change ? ' data-change="' + o.change + '"' : '') + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + (o.max ? ' max="' + o.max + '"' : '');
  return '<label class="f" for="f-' + name + '">' + esc(label) + '</label><input id="f-' + name + '" name="' + name + '" type="' + type + '" value="' + esc(value === null || value === undefined ? '' : value) + '"' + attrs + (o.err ? ' class="invalid" aria-invalid="true" aria-describedby="e-' + name + '"' : '') + (o.auto ? ' autocomplete="' + o.auto + '"' : ' autocomplete="off"') + '>' + (o.hint ? '<div class="small muted">' + esc(o.hint) + '</div>' : '') + err;
}
function selectField(name, label, options, value, o) {
  o = o || {}; const err = o.err ? '<div class="err">' + esc(o.err) + '</div>' : '';
  return (label ? '<label class="f" for="f-' + name + '">' + esc(label) + '</label>' : '') + '<select id="f-' + name + '" name="' + name + '"' + (o.change ? ' data-change="' + o.change + '"' : '') + '>' + options.map((x) => '<option value="' + esc(x[0]) + '"' + (String(x[0]) === String(value) ? ' selected' : '') + '>' + esc(x[1]) + '</option>').join('') + '</select>' + err;
}
function checkField(name, label, checked, o) { return '<label class="check"><input type="checkbox" name="' + name + '"' + (checked ? ' checked' : '') + (o && o.change ? ' data-change="' + o.change + '"' : '') + '> <span>' + esc(label) + '</span></label>'; }
