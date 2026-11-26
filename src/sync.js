/* StockCup household sync engine (no DOM, no network code; the transport is injected).

   Idea: every change a person makes becomes an OPERATION with a unique id. All devices apply the same
   operations in the same order (the server's sequence number), so shared stock converges instead of one
   phone overwriting another. Drinks, restocks and recounts replay through the existing functions in core.js.

   Two copies of the pantry are kept on each device:
     serverState = every server-confirmed operation applied in server order (identical on all devices)
     state (S)   = serverState + this device's not-yet-confirmed operations replayed on top (what you see)
*/
const SYNC = (function (SC) {
  'use strict';
  const OP_VERSION = 1;
  const LOCAL_SETTINGS = ['theme', 'tempUnit', 'imperial', 'onboarded', 'activePerson', 'recountMark', 'lastUsed', 'sampleLoaded'];
  const SHARED_SETTINGS = ['currency'];
  const STOCK_KEYS = ['sealed', 'count', 'open'];
  const COLLS = ['people', 'machines', 'recipes', 'shopping', 'products'];

  const clone = (o) => JSON.parse(JSON.stringify(o));
  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    const r = () => Math.floor(Math.random() * 16).toString(16);
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => (c === 'x' ? r() : (8 + Math.floor(Math.random() * 4)).toString(16)));
  }
  function canon(o) {
    if (Array.isArray(o)) return '[' + o.map(canon).join(',') + ']';
    if (o && typeof o === 'object') return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}';
    return JSON.stringify(o === undefined ? null : o);
  }
  const omit = (o, keys) => { const r = {}; Object.keys(o).forEach((k) => { if (keys.indexOf(k) < 0) r[k] = o[k]; }); return r; };
  const isInt = (v, min, max) => typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= min && v <= max;
  const isNum = (v, min) => typeof v === 'number' && isFinite(v) && v >= min;
  const str = (v, max) => typeof v === 'string' && v.length <= max;
  const OK = { ok: true };
  const fail = (reason) => ({ ok: false, reason: reason });

  function makeOp(type, payload, deviceId) { return { id: uuid(), v: OP_VERSION, type: type, payload: payload, deviceId: deviceId }; }
  const rowOf = (op) => ({ op_id: op.id, device_id: op.deviceId, type: op.type, v: op.v, payload: op.payload });
  const opOf = (row) => ({ id: row.op_id, deviceId: row.device_id, type: row.type, v: row.v, payload: row.payload });

  // ---------- applying one operation to a state ----------
  function validItem(coll, it, full) {
    if (!it || typeof it !== 'object' || !str(it.id, 80) || !it.id) return false;
    if (coll === 'products') return !!SC.CATEGORIES[it.category] && str(it.brand, 80) && str(it.name, 100) && isNum(it.size, 1e-9) && ['g', 'ml', 'capsule'].indexOf(it.unit) >= 0 && (!full || isNum(it.sealed, 0)) && isNum(it.density, 1e-9)
      && (it.category !== 'capsule' || (it.capsule && (it.capsule.system === 'original' || it.capsule.system === 'vertuo')));
    if (coll === 'people') return str(it.name, 60) && it.name.length > 0;
    if (coll === 'machines') return str(it.name, 60) && (it.system === 'original' || it.system === 'vertuo') && isNum(it.descaleCaps, 1) && isNum(it.descaleMonths, 1);
    if (coll === 'recipes') return str(it.name, 100) && (it.serve === 'hot' || it.serve === 'iced') && Array.isArray(it.ingredients) && it.ingredients.length > 0 && Array.isArray(it.steps) && it.ingredients.every((i) => SC.SLOT_TYPES.indexOf(i.type) >= 0 && isNum(i.amount, 1e-9) && SC.RECIPE_UNITS.indexOf(i.unit) >= 0);
    if (coll === 'shopping') return str(it.label, 200);
    return false;
  }
  function replaceKeep(ex, item, keepKeys) {
    const keep = {}; keepKeys.forEach((k) => { if (ex[k] !== undefined) keep[k] = ex[k]; });
    Object.keys(ex).forEach((k) => { delete ex[k]; }); Object.assign(ex, clone(item), keep);
  }
  function mergeLocalSettings(next, current) {
    const local = {}; LOCAL_SETTINGS.forEach((k) => { if (current && current.settings && current.settings[k] !== undefined) local[k] = clone(current.settings[k]); });
    next.settings = Object.assign({}, next.settings, local);
    if (!next.people.some((p) => p.id === next.settings.activePerson)) next.settings.activePerson = next.people[0].id;
    return next;
  }

  function apply(state, op) {
    try {
      if (!op || typeof op.type !== 'string') return fail('malformed operation');
      if (op.v && op.v > OP_VERSION) return fail('newer operation version');
      const p = op.payload || {};
      switch (op.type) {
        case 'snapshot': {
          const s = SC.sanitizeState(clone(p.state));
          const cur = clone(state);
          Object.keys(state).forEach((k) => { delete state[k]; }); Object.assign(state, s); mergeLocalSettings(state, cur);
          return OK;
        }
        case 'put': {
          if (COLLS.indexOf(p.coll) < 0 || !p.item) return fail('invalid ' + p.coll + ' item');
          const arr = state[p.coll]; const i = arr.findIndex((x) => x.id === p.item.id);
          const whole = !!p.full || i < 0; // an edit (no stock fields) of something that no longer exists cannot be applied
          if (!validItem(p.coll, p.item, whole && (p.coll === 'products'))) return fail('invalid ' + p.coll + ' item');
          if (i < 0 && !p.full && (p.coll === 'products' || p.coll === 'machines')) return fail(p.coll.slice(0, -1) + ' no longer exists');
          if (i < 0) arr.push(clone(p.item));
          else if (p.full) arr[i] = clone(p.item);
          else if (p.coll === 'products') replaceKeep(arr[i], p.item, STOCK_KEYS);
          else if (p.coll === 'machines') replaceKeep(arr[i], p.item, ['caps', 'lastDescaled']);
          else arr[i] = clone(p.item);
          return OK;
        }
        case 'del': {
          if (COLLS.indexOf(p.coll) < 0 || !str(p.id, 80)) return fail('invalid delete');
          if (p.coll === 'people') { if (state.people.some((x) => x.id === p.id)) { if (!SC.deletePerson(state, p.id)) return fail('cannot delete the last person'); } return OK; }
          state[p.coll] = state[p.coll].filter((x) => x.id !== p.id); return OK;
        }
        case 'thr': {
          if (!SC.CATEGORIES[p.cat] || !(p.value === null || isNum(p.value, 0))) return fail('invalid limit'); state.thresholds[p.cat] = p.value; return OK;
        }
        case 'set': {
          if (SHARED_SETTINGS.indexOf(p.key) < 0 || !str(p.value, 3)) return fail('invalid setting'); state.settings[p.key] = p.value; return OK;
        }
        case 'log.edit': {
          const l = state.logs.find((x) => x.id === p.id); if (!l) return fail('drink no longer exists');
          if (!(p.rating === null || isInt(p.rating, 1, 5)) || !str(p.note || '', 200)) return fail('invalid edit');
          if (!(p.personId === null || state.people.some((x) => x.id === p.personId))) return fail('person no longer exists');
          l.rating = p.rating; l.note = p.note || ''; l.personId = p.personId; return OK;
        }
        case 'log.commit': {
          const d = p.draft; if (!d || typeof d !== 'object' || !str(d.id, 80) || !Array.isArray(d.slots)) return fail('invalid drink');
          if (state.logs.some((x) => x.id === d.id)) return OK; // already applied
          const draft = clone(d); draft.allowShort = true; delete draft.sample;
          if (draft.personId && !state.people.some((x) => x.id === draft.personId)) draft.personId = null;
          const r = SC.commitLog(state, draft); return r.ok ? OK : fail(String((r.errors || [])[0] || 'drink could not be applied').slice(0, 140));
        }
        case 'log.undo': { SC.undoLog(state, p.id); return OK; }
        case 'adj.recount': {
          if (state.adjustments.some((x) => x.id === p.id)) return OK;
          const prod = state.products.find((x) => x.id === p.productId); if (!prod) return fail('product no longer exists');
          const v = p.v; if (!v || typeof v !== 'object') return fail('invalid recount');
          if (prod.category === 'capsule') { if (!isInt(v.count, 0, 1e6)) return fail('invalid recount'); }
          else { if (!isInt(v.sealed, 0, 1e5) || !(v.open === null || (v.open && (v.open.amount === null || isNum(v.open.amount, 0)) && SC.validDate(v.open.openedAt)))) return fail('invalid recount'); }
          SC.applyRecount(state, p.productId, v, p.ts, p.id); return OK;
        }
        case 'adj.restock': {
          if (state.adjustments.some((x) => x.id === p.id)) return OK;
          if (!state.products.some((x) => x.id === p.productId)) return fail('product no longer exists'); if (!isInt(p.packs, 1, 1000)) return fail('invalid restock');
          SC.restock(state, p.productId, p.packs, p.ts, p.id); return OK;
        }
        case 'adj.undo': { SC.undoAdjustment(state, p.id); return OK; }
        case 'stock.add': {
          const prod = state.products.find((x) => x.id === p.productId); if (!prod) return fail('product no longer exists');
          if (p.packs !== undefined) { if (!isInt(p.packs, 1, 1000)) return fail('invalid stock'); SC.addPacks(prod, p.packs); return OK; }
          if (prod.category !== 'capsule' || !isInt(p.count, 1, 1e5)) return fail('invalid stock'); prod.count += p.count; return OK;
        }
        case 'product.open': {
          const prod = state.products.find((x) => x.id === p.productId); if (!prod) return fail('product no longer exists');
          SC.openAPack(prod, SC.validDate(p.date) ? String(p.date).slice(0, 10) : SC.localDate()); return OK;
        }
        case 'machine.reset': {
          const m = state.machines.find((x) => x.id === p.id); if (!m) return fail('machine no longer exists');
          if (!isInt(p.caps, 0, 1e7) || !SC.validDate(p.lastDescaled)) return fail('invalid machine update'); m.caps = p.caps; m.lastDescaled = String(p.lastDescaled).slice(0, 10); return OK;
        }
        default: return fail('unknown operation type');
      }
    } catch (e) { return fail('error: ' + (e && e.message)); }
  }

  // ---------- turning local edits into operations ----------
  // Compares the state at the last save with the current one. Stock numbers are NOT diffed (they change only via
  // explicit operations: drinks, restocks, recounts), so editing a product name can never overwrite someone's stock.
  function diff(prev, cur) {
    const ops = []; const real = (a) => (a || []).filter((x) => !x.sample);
    COLLS.forEach((coll) => {
      const a = new Map(real(prev[coll]).map((x) => [x.id, x])); const b = new Map(real(cur[coll]).map((x) => [x.id, x]));
      b.forEach((item, id) => {
        const old = a.get(id);
        if (!old) ops.push({ type: 'put', payload: { coll: coll, item: clone(item), full: true } });
        else if (coll === 'products') { if (canon(omit(old, STOCK_KEYS)) !== canon(omit(item, STOCK_KEYS))) ops.push({ type: 'put', payload: { coll: coll, item: clone(omit(item, STOCK_KEYS)) } }); }
        else if (coll === 'machines') { if (canon(omit(old, ['caps', 'lastDescaled'])) !== canon(omit(item, ['caps', 'lastDescaled']))) ops.push({ type: 'put', payload: { coll: coll, item: clone(omit(item, ['caps', 'lastDescaled'])) } }); }
        else if (canon(old) !== canon(item)) ops.push({ type: 'put', payload: { coll: coll, item: clone(item) } });
      });
      a.forEach((item, id) => { if (!b.has(id)) ops.push({ type: 'del', payload: { coll: coll, id: id } }); });
    });
    Object.keys(Object.assign({}, prev.thresholds, cur.thresholds)).forEach((k) => {
      const x = prev.thresholds[k] === undefined ? null : prev.thresholds[k], y = cur.thresholds[k] === undefined ? null : cur.thresholds[k];
      if (x !== y) ops.push({ type: 'thr', payload: { cat: k, value: y } });
    });
    SHARED_SETTINGS.forEach((k) => { if ((prev.settings || {})[k] !== (cur.settings || {})[k] && (cur.settings || {})[k] !== undefined) ops.push({ type: 'set', payload: { key: k, value: cur.settings[k] } }); });
    const before = new Map((prev.logs || []).map((l) => [l.id, l]));
    (cur.logs || []).forEach((l) => {
      const o = before.get(l.id); if (!o || l.sample) return;
      let person = l.personId || null; const oldPerson = o.personId || null;
      if (person === null && oldPerson !== null && !(cur.people || []).some((x) => x.id === oldPerson)) person = oldPerson; // a deleted person is handled by the delete operation
      if ((o.rating || null) !== (l.rating || null) || (o.note || '') !== (l.note || '') || oldPerson !== person)
        ops.push({ type: 'log.edit', payload: { id: l.id, rating: l.rating || null, note: l.note || '', personId: l.personId || null } });
    });
    return ops;
  }

  // ---------- the client: outbox, pulling, rebuilding ----------
  // opts: { transport, store:{get,set}, getState(), setState(s), deviceId, onChange() }
  function createClient(opts) {
    const c = { household: null, lastSeq: 0, serverState: null, pending: [], prev: null, queue: [], skipped: [], status: 'off', error: '', busy: false, again: false, sub: null };
    const T = opts.transport;
    const setStatus = (s, err) => { c.status = s; c.error = err || ''; if (opts.onChange) opts.onChange(c); };
    const persist = () => opts.store.set('sync', { household: c.household, lastSeq: c.lastSeq, serverState: c.serverState, pending: c.pending, skipped: c.skipped.slice(-50) }).catch(() => {});
    c.pendingCount = () => c.pending.length;

    c.load = async function () {
      const d = await opts.store.get('sync'); if (!d || !d.household) return false;
      c.household = d.household; c.lastSeq = d.lastSeq || 0; c.serverState = d.serverState || SC.defaultState(); c.pending = d.pending || []; c.skipped = d.skipped || [];
      c.prev = clone(opts.getState()); return true;
    };
    // Begin syncing a household. fresh=true starts from an empty server copy (join); the local pantry is then replaced.
    c.attach = async function (household, fresh, snapshotOfLocal) {
      c.household = household; c.lastSeq = 0; c.serverState = SC.defaultState(); c.pending = []; c.queue = []; c.skipped = [];
      if (snapshotOfLocal) c.pending.push(makeOp('snapshot', { state: clone(opts.getState()) }, opts.deviceId));
      c.prev = clone(opts.getState()); await persist(); void fresh;
    };
    c.detach = async function () {
      if (c.sub) { try { c.sub(); } catch (e) { /* ignore */ } c.sub = null; }
      c.household = null; c.pending = []; c.queue = []; c.serverState = null; c.lastSeq = 0; c.prev = null; await opts.store.set('sync', null); setStatus('off');
    };
    c.emit = function (type, payload) { if (c.household) c.queue.push({ type: type, payload: payload }); };
    c.localChanged = function (S) {
      if (!c.household) return;
      const ops = diff(c.prev || S, S).concat(c.queue); c.queue = [];
      if (!ops.length) { c.prev = clone(S); return; }
      ops.forEach((o) => c.pending.push(makeOp(o.type, o.payload, opts.deviceId)));
      c.prev = clone(S); persist(); setStatus('syncing'); Promise.resolve().then(() => c.sync());
    };
    c.snapshotAll = function (S) { if (!c.household) return; c.queue = []; c.pending.push(makeOp('snapshot', { state: clone(S) }, opts.deviceId)); c.prev = clone(S); persist(); Promise.resolve().then(() => c.sync()); };

    c.flush = async function () {
      if (!c.household || !c.pending.length) return;
      await T.push(c.household.id, c.pending.map(rowOf)); // idempotent: the server ignores operation ids it already has
    };
    c.pull = async function () {
      if (!c.household) return;
      let newSkips = 0, foreign = false, applied = 0;
      for (;;) {
        const rows = await T.pull(c.household.id, c.lastSeq, 500); if (!rows.length) break;
        const mine = new Set(c.pending.map((o) => o.id));
        rows.forEach((row) => {
          const op = opOf(row); const res = apply(c.serverState, op); applied++;
          if (!res.ok) { newSkips++; c.skipped.push({ type: op.type, reason: res.reason }); }
          if (!mine.has(op.id)) foreign = true; c.lastSeq = Math.max(c.lastSeq, row.server_seq);
        });
        const seen = new Set(rows.map((row) => row.op_id)); c.pending = c.pending.filter((o) => !seen.has(o.id));
        if (rows.length < 500) break;
      }
      if (applied) { persist(); if (foreign || newSkips) c.rebuild(); }
    };
    c.rebuild = function () {
      const next = clone(c.serverState); c.pending.forEach((op) => { apply(next, op); });
      mergeLocalSettings(next, opts.getState()); c.prev = clone(next); opts.setState(next);
    };
    // One full round: send what is pending, then fetch everything new. Safe to call at any time.
    c.sync = async function () {
      if (!c.household) return; if (c.busy) { c.again = true; return; }
      c.busy = true;
      try {
        do { c.again = false; setStatus(c.pending.length ? 'syncing' : c.status === 'off' ? 'connecting' : 'syncing'); await c.flush(); await c.pull(); } while (c.again);
        setStatus(c.pending.length ? 'syncing' : 'synced');
      } catch (e) {
        const offline = (typeof navigator !== 'undefined' && navigator.onLine === false) || /fetch|network|Failed to|offline/i.test(String(e && e.message));
        setStatus(offline ? 'offline' : 'error', String((e && e.message) || e));
      } finally { c.busy = false; }
    };
    c.start = async function () {
      if (!c.household) return; await c.sync();
      if (T.subscribe && !c.sub) c.sub = T.subscribe(c.household.id, () => { c.sync(); });
    };
    return c;
  }

  return { OP_VERSION, LOCAL_SETTINGS, uuid, canon, clone, makeOp, rowOf, opOf, apply, diff, createClient, mergeLocalSettings };
})(typeof module !== 'undefined' ? require('./core.js') : SC);
if (typeof module !== 'undefined') module.exports = SYNC;
