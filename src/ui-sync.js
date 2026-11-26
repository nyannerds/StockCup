/* Household sync in the app: backend (Supabase, or a test double), storage, Profile card, sheets, timers.
   The engine itself (operations, merging) lives in sync.js. Everything here is optional: with no household
   connected the app behaves exactly as before. */
'use strict';
const SYNCUI = { store: null, deviceId: '', backend: null, members: [], myId: '', timersOn: false };

// ---------- storage for the sync copy (IndexedDB, falls back to localStorage) ----------
function makeStore() {
  const lsKey = (k) => 'stockcup.' + k;
  const ls = { get: async (k) => { try { const v = localStorage.getItem(lsKey(k)); return v ? JSON.parse(v) : null; } catch (e) { return null; } }, set: async (k, v) => { try { if (v === null) localStorage.removeItem(lsKey(k)); else localStorage.setItem(lsKey(k), JSON.stringify(v)); } catch (e) { throw new Error('storage full'); } } };
  if (typeof indexedDB === 'undefined') return ls;
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open('stockcup', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const run = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('kv', mode); const req = fn(t.objectStore('kv')); t.oncomplete = () => res(req ? req.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
  return { get: (k) => run('readonly', (s) => s.get(k)).then((v) => (v === undefined ? null : v)).catch(() => ls.get(k)), set: (k, v) => run('readwrite', (s) => (v === null ? s.delete(k) : s.put(v, k))).catch(() => ls.set(k, v)) };
}

// ---------- backend: Supabase (real) ----------
const SB = { client: null, loading: null, myId: '' };
function loadScriptOnce(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Failed to load ' + src)); document.head.appendChild(s); }); }
async function sbClient() {
  if (SB.client) return SB.client; if (SB.loading) return SB.loading;
  SB.loading = (async () => {
    const cfg = window.STOCKCUP_CONFIG || {};
    if (!window.supabase) await loadScriptOnce('vendor/supabase/supabase.js');
    const c = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'stockcup.auth' } });
    let got = await c.auth.getSession(); let session = got.data && got.data.session;
    if (!session) { const r = await c.auth.signInAnonymously(); if (r.error) throw new Error(/anonymous/i.test(r.error.message) ? 'Anonymous sign-ins are switched off in your Supabase project (Authentication → Sign In / Providers).' : r.error.message); session = r.data.session; }
    SB.myId = session.user.id; SB.client = c; return c;
  })();
  try { return await SB.loading; } finally { SB.loading = null; }
}
function supabaseBackend() {
  const call = async (fn) => { const c = await sbClient(); const r = await fn(c); if (r.error) throw new Error(r.error.message); return r.data; };
  return {
    userId: async () => { await sbClient(); return SB.myId; },
    create: async (name, label) => { const d = await call((c) => c.rpc('create_household', { p_name: name, p_label: label })); return { id: d[0].household_id, code: d[0].invite_code }; },
    join: async (code, label) => { const d = await call((c) => c.rpc('join_household', { p_code: code, p_label: label })); const r = d[0]; return r.error ? { error: r.error } : { id: r.household_id, name: r.household_name }; },
    invite: (hid) => call((c) => c.rpc('new_invite', { p_household: hid })),
    members: (hid) => call((c) => c.from('members').select('user_id,role,label,joined_at').eq('household_id', hid).order('joined_at', { ascending: true })),
    remove: (hid, uid) => call((c) => c.rpc('remove_member', { p_household: hid, p_user: uid })),
    leave: (hid) => call((c) => c.rpc('leave_household', { p_household: hid })),
    destroy: (hid) => call((c) => c.rpc('delete_household', { p_household: hid })),
    transport: {
      async push(hid, rows) { await call((c) => c.from('ops').upsert(rows.map((r) => Object.assign({ household_id: hid }, r)), { onConflict: 'op_id', ignoreDuplicates: true })); },
      async pull(hid, since, limit) { return call((c) => c.from('ops').select('server_seq,op_id,device_id,type,v,payload').eq('household_id', hid).gt('server_seq', since).order('server_seq', { ascending: true }).limit(limit)); },
      subscribe(hid, cb) {
        let ch = null, dead = false;
        sbClient().then((c) => { if (dead) return; ch = c.channel('ops-' + hid).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ops', filter: 'household_id=eq.' + hid }, () => cb()).subscribe(); }).catch(() => {});
        return () => { dead = true; if (ch && SB.client) SB.client.removeChannel(ch); };
      },
    },
  };
}
function getBackend() { if (!SYNCUI.backend) SYNCUI.backend = window.STOCKCUP_TRANSPORT_FACTORY ? window.STOCKCUP_TRANSPORT_FACTORY() : supabaseBackend(); return SYNCUI.backend; }
const lazyTransport = { push: (h, r) => getBackend().transport.push(h, r), pull: (h, s, l) => getBackend().transport.pull(h, s, l), subscribe: (h, cb) => getBackend().transport.subscribe(h, cb) };
function syncAvailable() { const c = window.STOCKCUP_CONFIG || {}; return !!(window.STOCKCUP_TRANSPORT_FACTORY || (c.SUPABASE_URL && c.SUPABASE_ANON_KEY)); }
const connected = () => !!(SYNC_CLIENT && SYNC_CLIENT.household);

// ---------- hooks used by the rest of the app ----------
function syncAfterSave() { if (SYNC_CLIENT) SYNC_CLIENT.localChanged(S); }
function emitOp(type, payload) { if (SYNC_CLIENT) SYNC_CLIENT.emit(type, payload); }
function opRestock(productId, packs) { const adj = SC.restock(S, productId, packs); emitOp('adj.restock', { id: adj.id, productId: productId, packs: packs, ts: adj.ts }); return adj; }
function opRecount(productId, v) { const adj = SC.applyRecount(S, productId, v); emitOp('adj.recount', { id: adj.id, productId: productId, v: v, ts: adj.ts }); return adj; }
function opUndoAdj(id) { const ok = SC.undoAdjustment(S, id); emitOp('adj.undo', { id: id }); return ok; }
function opUndoLog(id) { const ok = SC.undoLog(S, id); emitOp('log.undo', { id: id }); return ok; }
// Replace the whole pantry (import). When connected this replaces the shared pantry for everyone.
function replaceAllState(data) { S = data; if (connected()) SYNC_CLIENT.snapshotAll(S); saveRaw(); }

// ---------- startup, timers, status ----------
async function syncInit() {
  try { let d = localStorage.getItem('stockcup.device'); if (!d) { d = SYNC.uuid(); localStorage.setItem('stockcup.device', d); } SYNCUI.deviceId = d; } catch (e) { SYNCUI.deviceId = SYNC.uuid(); }
  SYNCUI.store = makeStore();
  SYNC_CLIENT = SYNC.createClient({ transport: lazyTransport, store: SYNCUI.store, getState: () => S, setState: (s) => { S = s; saveRaw(); render(true); }, deviceId: SYNCUI.deviceId, onChange: syncChanged });
  let had = false; try { had = await SYNC_CLIENT.load(); } catch (e) { had = false; }
  if (had) {
    SYNC_CLIENT.start(); startSyncTimers(); refreshMembers(); render(true);
    if (!S.settings.profileChosen) { if (S.people.length < 2) { S.settings.profileChosen = true; saveRaw(); } else openSheet('whoAmI', { forced: true }); }
  }
}
function startSyncTimers() {
  if (SYNCUI.timersOn) return; SYNCUI.timersOn = true;
  setInterval(() => { if (!document.hidden && connected()) SYNC_CLIENT.sync(); }, 30000);
  window.addEventListener('online', () => { if (connected()) SYNC_CLIENT.sync(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && connected()) SYNC_CLIENT.sync(); });
}
function statusLabel(c) {
  const n = c.pendingCount();
  if (c.status === 'offline') return 'Offline' + (n ? ' · ' + n + ' waiting' : '');
  if (c.status === 'error') return 'Sync problem';
  if (c.status === 'syncing' || c.status === 'connecting') return n ? 'Syncing · ' + n + ' waiting' : 'Syncing…';
  return 'Synced';
}
function syncPill() { return connected() ? '<span class="syncpill ' + SYNC_CLIENT.status + '" role="status">' + esc(statusLabel(SYNC_CLIENT)) + '</span>' : ''; }
function syncChanged() {
  document.querySelectorAll('.syncpill').forEach((el) => { el.className = 'syncpill ' + SYNC_CLIENT.status; el.textContent = statusLabel(SYNC_CLIENT); });
  const card = $('#syncCard'); if (card) card.innerHTML = syncCardInner();
}
async function refreshMembers() {
  if (!connected()) { SYNCUI.members = []; return; }
  try { const b = getBackend(); SYNCUI.myId = await b.userId(); SYNCUI.members = await b.members(SYNC_CLIENT.household.id); const card = $('#syncCard'); if (card) card.innerHTML = syncCardInner(); } catch (e) { /* offline: keep the old list */ }
}
function friendly(e) {
  const m = String((e && e.message) || e);
  if (/Failed to fetch|NetworkError|network|Failed to load|offline/i.test(m)) return 'No connection. Try again when you are online.';
  if (/invalid_or_expired_code/.test(m)) return 'That code did not work. Check it, or ask for a new one (codes last 7 days).';
  if (/too_many_attempts/.test(m)) return 'Too many tries. Please wait 10 minutes and try again.';
  if (/too many households/i.test(m)) return 'You already have the maximum of 3 households.';
  return m;
}
const fmtCode = (c) => String(c).replace(/(.{4})(?=.)/g, '$1-');

// ---------- Profile card ----------
function syncCardHtml() { return '<h2>Household</h2><div class="card stack" id="syncCard">' + syncCardInner() + '</div>'; }
function syncCardInner() {
  if (!syncAvailable()) return '<p class="small muted">Share one pantry between phones with a household. This needs a free Supabase project, set up once by whoever runs the app (see <b>README → Household sync</b>). Until then StockCup works on this device only.</p>';
  if (!connected()) return '<p class="small muted">Share one pantry with the people you live with. Stock, drinks and recipes stay in step on every phone, and each phone still works offline.</p><button class="primary big" data-act="syncCreate">Create a household</button><button class="big" data-act="syncJoin">Join with an invite code</button>';
  const hh = SYNC_CLIENT.household; const mine = SYNCUI.members.find((m) => m.user_id === SYNCUI.myId); const owner = !!(mine && mine.role === 'owner');
  const skipped = SYNC_CLIENT.skipped.length;
  return '<div class="row"><div class="grow"><b>' + esc(hh.name) + '</b><div class="small muted">' + (mine ? 'You are ' + esc(mine.label) + (owner ? ' (owner)' : '') : 'Connected') + '</div></div>' + syncPill() + '</div>' +
    (SYNC_CLIENT.status === 'error' ? '<div class="errbox">' + esc(SYNC_CLIENT.error) + '</div>' : '') +
    (SYNCUI.members.length ? '<div>' + SYNCUI.members.map((m) => '<div class="row" style="margin:4px 0"><div class="grow">' + esc(m.label) + (m.role === 'owner' ? ' <span class="badge acc">owner</span>' : '') + (m.user_id === SYNCUI.myId ? ' <span class="badge">you</span>' : '') + '</div>' + (owner && m.user_id !== SYNCUI.myId ? '<button class="small danger" data-act="syncRemove" data-id="' + esc(m.user_id) + '" data-label="' + esc(m.label) + '" aria-label="Remove ' + esc(m.label) + '">Remove</button>' : '') + '</div>').join('') + '</div>' : '') +
    (owner ? '<button class="big" data-act="syncInvite">Invite someone</button>' : '') +
    (skipped ? '<div class="small muted">' + skipped + ' change' + (skipped > 1 ? 's' : '') + ' from other phones could not be applied (for example a drink using a product that was deleted).</div>' : '') +
    '<button class="big" data-act="syncLeave">Leave household</button>' + (owner ? '<button class="big danger" data-act="syncDestroy">Delete household for everyone</button>' : '');
}

// ---------- sheets ----------
const nameDefault = () => (activePerson().name || '').slice(0, 40);
// The creator's name becomes their profile (renaming the starter "Me" if that is all there is), the other names are added, and this phone is set to the creator.
function prepareHouseholdPeople(label, names) {
  let mine = null;
  if (S.people.length === 1 && S.people[0].name === 'Me') { mine = S.people[0]; mine.name = label; }
  else { mine = S.people.find((p) => p.name.toLowerCase() === label.toLowerCase()); if (!mine) { mine = { id: SC.uid(), name: label }; S.people.push(mine); } }
  names.forEach((n) => { if (!S.people.some((p) => p.name.toLowerCase() === n.toLowerCase())) S.people.push({ id: SC.uid(), name: n }); });
  S.settings.activePerson = mine.id; S.settings.profileChosen = true; saveRaw();
}
ACT.syncCreate = () => {
  if (S.settings.sampleLoaded) { toast('Clear the sample pantry first (Profile → Your data).'); return; }
  openSheet('syncCreate', { hname: 'Home', label: nameDefault(), err: '' });
};
SHEETS.syncCreate = (d) => ({ title: 'Create a household', body: '<p class="muted">Your current pantry on this phone becomes the household pantry. Then you get an invite code to give to the others.</p>' + (d.err ? '<div class="errbox">' + esc(d.err) + '</div>' : '') + field('hname', 'Household name', d.hname) + field('label', 'Your name', d.label, { hint: 'This becomes your profile.' }) + '<label class="f" for="f-members">Who else is in the household? (optional, one name per line)</label><textarea id="f-members" rows="3" placeholder="Mum&#10;Sam" autocomplete="off">' + esc(d.members || '') + '</textarea><div class="small muted">Each person picks their own profile when they join. You can add more later in Profile.</div>', footer: footBtns('closeSheet', 1, 'Create', 'syncDoCreate') });
ACT.syncDoCreate = async () => {
  const d = SHEET.data; d.hname = $('#f-hname').value.trim(); d.label = $('#f-label').value.trim(); d.members = $('#f-members').value;
  if (!d.hname || d.hname.length > 60) { d.err = 'Enter a household name (up to 60 characters).'; renderSheet(); return; }
  if (!d.label || d.label.length > 40) { d.err = 'Enter a name for yourself (up to 40 characters).'; renderSheet(); return; }
  const names = []; const seen = new Set([d.label.toLowerCase()]);
  for (const raw of d.members.split(/[\n,;]+/)) { const n = raw.trim(); if (!n) continue; if (n.length > 40) { d.err = '“' + n.slice(0, 20) + '…” is too long (40 characters at most).'; renderSheet(); return; } if (!seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); names.push(n); } }
  if (names.length > 12) { d.err = 'Add up to 12 other people now; you can add more later in Profile.'; renderSheet(); return; }
  const keep = { hname: d.hname, label: d.label, members: d.members }; openSheet('syncBusy', { msg: 'Creating your household…' });
  try {
    const r = await getBackend().create(keep.hname, keep.label); prepareHouseholdPeople(keep.label, names); await SYNC_CLIENT.attach({ id: r.id, name: keep.hname }, false, true); startSyncTimers(); await SYNC_CLIENT.start(); await refreshMembers();
    render(true); openSheet('syncInvite', { code: r.code, name: keep.hname, fresh: true });
  } catch (e) { openSheet('syncCreate', Object.assign(keep, { err: friendly(e) })); }
};
ACT.syncJoin = () => openSheet('syncJoin', { code: '', label: nameDefault(), err: '' });
SHEETS.syncJoin = (d) => ({ title: 'Join a household', body: '<div class="warnbox"><b>This replaces the pantry on this phone</b> with the household’s pantry. If you want to keep what is here, export it first. Next you will choose which person you are.</div><button class="small" data-act="exportData">⬇ Export my pantry first</button>' + (d.err ? '<div class="errbox">' + esc(d.err) + '</div>' : '') + field('code', 'Invite code', d.code, { ph: 'XXXX-XXXX-XXXX', auto: 'off' }) + field('label', 'What should others see you as?', d.label), footer: footBtns('closeSheet', 1, 'Join', 'syncDoJoin') });
ACT.syncDoJoin = async () => {
  const d = SHEET.data; d.code = $('#f-code').value.trim(); d.label = $('#f-label').value.trim();
  if (d.code.replace(/[^A-Za-z0-9]/g, '').length < 8) { d.err = 'Type the whole invite code.'; renderSheet(); return; }
  if (!d.label || d.label.length > 40) { d.err = 'Enter a name for yourself (up to 40 characters).'; renderSheet(); return; }
  const keep = { code: d.code, label: d.label }; openSheet('syncBusy', { msg: 'Joining…' });
  try {
    const r = await getBackend().join(keep.code, keep.label); if (r.error) throw new Error(r.error);
    await SYNC_CLIENT.attach({ id: r.id, name: r.name }, true, false); startSyncTimers(); await SYNC_CLIENT.start(); await refreshMembers(); render(true); openSheet('whoAmI', { forced: true, joined: r.name });
  } catch (e) { openSheet('syncJoin', Object.assign(keep, { err: friendly(e) })); }
};
SHEETS.syncBusy = (d) => ({ title: 'One moment', noClose: true, body: '<div class="empty"><div class="big-ic">⏳</div><p>' + esc(d.msg) + '</p></div>' });
ACT.syncInvite = async () => {
  openSheet('syncBusy', { msg: 'Making an invite code…' });
  try { const code = await getBackend().invite(SYNC_CLIENT.household.id); openSheet('syncInvite', { code: code, name: SYNC_CLIENT.household.name }); } catch (e) { closeSheet(); toast(friendly(e)); }
};
SHEETS.syncInvite = (d) => ({ title: 'Invite code', body: (d.fresh ? '<div class="okbox">“' + esc(d.name) + '” is ready and your pantry is uploading.</div>' : '') + '<p class="muted">Give this code to the person joining. It works for 7 days and up to 5 people.</p><div class="codebox" id="inviteCode" aria-label="Invite code">' + esc(fmtCode(d.code)) + '</div><div class="grid2" style="margin-top:10px"><button data-act="syncCopy" data-code="' + esc(d.code) + '">Copy</button><button data-act="syncShare" data-code="' + esc(d.code) + '" data-name="' + esc(d.name) + '">Share…</button></div><p class="small muted">Anyone with the code can join, so only share it with people you trust. You can remove anyone later.</p>', footer: '<button class="primary" data-act="closeSheet">Done</button>' });
ACT.syncCopy = (el) => { const c = fmtCode(el.dataset.code); (navigator.clipboard ? navigator.clipboard.writeText(c) : Promise.reject()).then(() => toast('Code copied.'), () => toast('Select the code and copy it by hand.')); };
ACT.syncShare = (el) => { const text = 'Join our StockCup household “' + el.dataset.name + '” with this code: ' + fmtCode(el.dataset.code); if (navigator.share) navigator.share({ title: 'StockCup', text: text }).catch(() => {}); else ACT.syncCopy(el); };
ACT.syncRemove = (el) => confirmDialog('Remove ' + el.dataset.label + ' from the household? They keep a copy on their phone but stop syncing.', 'Remove', async () => { try { await getBackend().remove(SYNC_CLIENT.household.id, el.dataset.id); await refreshMembers(); toast('Removed.'); } catch (e) { toast(friendly(e)); } }, true);
ACT.syncLeave = () => confirmDialog('Leave this household? You keep a copy of the pantry on this phone, but it stops syncing with the others.', 'Leave', async () => {
  const id = SYNC_CLIENT.household.id; let note = '';
  try { await getBackend().leave(id); } catch (e) { note = ' (You were offline, so the household may still list you until an owner removes you.)'; }
  await SYNC_CLIENT.detach(); SYNCUI.members = []; render(); toast('Left the household.' + note);
}, true);
ACT.syncDestroy = () => confirmDialog('Delete this household for everyone? Everyone keeps their own copy, but nothing will sync any more. This cannot be undone.', 'Delete household', async () => {
  const id = SYNC_CLIENT.household.id; try { await getBackend().destroy(id); await SYNC_CLIENT.detach(); SYNCUI.members = []; render(); toast('Household deleted.'); } catch (e) { toast(friendly(e)); }
}, true);

// ---------- "Who's drinking?": the profile picker ----------
const AV_COLORS = ['#4f7339', '#9a5a22', '#6f4f82', '#2a6f7d', '#a03f55', '#66662a', '#8a5a1e', '#3f6f6a']; // all keep white initials above 5:1
function avColor(id) { let h = 0; String(id).split('').forEach((c) => { h = (h * 31 + c.charCodeAt(0)) >>> 0; }); return AV_COLORS[h % AV_COLORS.length]; }
const initialOf = (name) => (String(name).trim().charAt(0) || '?').toUpperCase();
ACT.openProfiles = () => openSheet('whoAmI', { forced: false });
SHEETS.whoAmI = (d) => {
  const cur = S.settings.activePerson; const forced = !!d.forced;
  const tiles = S.people.map((p) => '<button class="profile' + (!forced && p.id === cur ? ' on' : '') + '" data-act="pickPerson" data-id="' + esc(p.id) + '" aria-label="I am ' + esc(p.name) + '"><span class="pfc" style="background:' + avColor(p.id) + '">' + esc(initialOf(p.name)) + '</span><span class="pfn">' + esc(p.name) + '</span></button>').join('') +
    '<button class="profile" data-act="pickNew" aria-label="I am someone new"><span class="pfc add">＋</span><span class="pfn">Someone new</span></button>';
  let b = (d.joined ? '<div class="okbox">You joined “' + esc(d.joined) + '”.</div>' : '') + '<p class="muted" style="text-align:center">' + (d.adding ? 'Type the name you want others to see. It will be added to the household.' : forced ? 'Choose who you are. Your drinks will be saved under this profile on this phone.' : 'Choose who is drinking. You can switch any time.') + '</p>';
  b += d.adding ? '<form data-submit="pickAddForm" id="pnform" novalidate>' + field('pname', 'Your name', d.pname || '', { err: d.perr, auto: 'off' }) + '</form>' : '<div class="profiles">' + tiles + '</div>';
  return { title: 'Who’s drinking?', noClose: forced, body: b, footer: d.adding ? '<button data-act="pickBack">Back</button><button class="primary" data-act="pickAdd">Continue</button>' : (forced ? '' : '<button data-act="closeSheet">Cancel</button>') };
};
function chooseProfile(id) {
  const d = SHEET && SHEET.data ? SHEET.data : {}; const p = S.people.find((x) => x.id === id); if (!p) return;
  mutate((s) => { s.settings.activePerson = id; s.settings.profileChosen = true; }); closeSheet(); toast('You are ' + p.name + '.');
  void d;
}
ACT.pickPerson = (el) => chooseProfile(el.dataset.id);
ACT.pickNew = () => { SHEET.data.adding = true; SHEET.data.perr = ''; renderSheet(); const i = $('#f-pname'); if (i) i.focus(); };
ACT.pickBack = () => { SHEET.data.adding = false; renderSheet(); };
ACT.pickAdd = () => {
  const d = SHEET.data; d.pname = $('#f-pname').value.trim();
  if (!d.pname || d.pname.length > 40) { d.perr = 'Enter a name (up to 40 characters).'; renderSheet(); return; }
  const dup = S.people.find((p) => p.name.toLowerCase() === d.pname.toLowerCase()); if (dup) { d.perr = '“' + dup.name + '” is already in the household. Go back and tap it.'; renderSheet(); return; }
  const person = { id: SC.uid(), name: d.pname }; mutate((s) => { s.people.push(person); s.settings.activePerson = person.id; s.settings.profileChosen = true; }); closeSheet(); toast('Welcome, ' + person.name + '.');
};
SUB.pickAddForm = () => ACT.pickAdd();
