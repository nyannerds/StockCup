// Household sync engine tests against an in-memory server. Run: node tests/sync.test.js
const assert = require('assert');
const SC = require('../src/core.js'); const SYNC = require('../src/sync.js');
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String(e.stack || e).split('\n').slice(0, 5).join('\n       ')); } }
const TODAY = '2026-11-12';

// ---- mock server: per-household gap-free sequence, idempotent inserts, optional outage ----
class Server {
  constructor() { this.rows = []; this.seq = {}; this.subs = []; this.down = false; }
  transport() {
    const me = this;
    return {
      async push(hid, rows) { if (me.down) throw new Error('Failed to fetch'); rows.forEach((r) => { if (!me.rows.some((x) => x.op_id === r.op_id)) { me.seq[hid] = (me.seq[hid] || 0) + 1; me.rows.push(Object.assign({}, r, { household_id: hid, server_seq: me.seq[hid] })); } }); me.subs.slice().forEach((f) => f(hid)); },
      async pull(hid, since, limit) { if (me.down) throw new Error('Failed to fetch'); return me.rows.filter((r) => r.household_id === hid && r.server_seq > since).slice(0, limit).map((r) => JSON.parse(JSON.stringify(r))); },
      subscribe(hid, cb) { const f = (h) => { if (h === hid) cb(); }; me.subs.push(f); return () => { me.subs = me.subs.filter((x) => x !== f); }; },
    };
  }
}
const memStore = () => { const m = {}; return { get: async (k) => (m[k] === undefined ? null : JSON.parse(JSON.stringify(m[k]))), set: async (k, v) => { m[k] = v === null ? undefined : JSON.parse(JSON.stringify(v)); }, raw: m }; };
function device(server, name, startState) {
  const d = { name: name, S: startState || SC.defaultState(), store: memStore() };
  d.client = SYNC.createClient({ transport: server.transport(), store: d.store, getState: () => d.S, setState: (s) => { d.S = s; }, deviceId: name });
  return d;
}
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
async function syncAll(devs) { for (let i = 0; i < 3; i++) for (const d of devs) await d.client.sync(); await settle(); }
const shared = (S) => { const c = JSON.parse(JSON.stringify(S)); c.settings = { currency: S.settings.currency }; return SYNC.canon(c); };
function addProd(d, f) { const r = SC.addProduct(d.S, Object.assign({ category: 'matcha', brand: 'B', name: 'M', size: 30, sealed: 1, openMode: 'none' }, f), TODAY); assert.ok(r.ok, JSON.stringify(r.errors)); d.client.localChanged(d.S); return r.product; }
// the same steps the app performs for a drink: assign an id, commit locally, queue the operation, then save
function logDrink(d, recipeId, who) {
  const r = d.S.recipes.find((x) => x.id === recipeId); const draft = SC.emptyDraft(d.S, r, 1, who || 'p_me', TODAY + 'T09:00'); draft.id = SYNC.uuid();
  const res = SC.commitLog(d.S, draft); assert.ok(res.ok, JSON.stringify(res.errors)); d.client.emit('log.commit', { draft: JSON.parse(JSON.stringify(draft)) }); d.client.localChanged(d.S); return res.log;
}
function undoDrink(d, id) { SC.undoLog(d.S, id); d.client.emit('log.undo', { id: id }); d.client.localChanged(d.S); }
function restock(d, productId, packs) { const adj = SC.restock(d.S, productId, packs, TODAY + 'T10:00'); d.client.emit('adj.restock', { id: adj.id, productId: productId, packs: packs, ts: adj.ts }); d.client.localChanged(d.S); return adj; }
function recount(d, productId, form) { const v = SC.validateRecount(d.S.products.find((p) => p.id === productId), form, TODAY); assert.ok(v.ok, JSON.stringify(v.errors)); const adj = SC.applyRecount(d.S, productId, v.value, TODAY + 'T11:00'); d.client.emit('adj.recount', { id: adj.id, productId: productId, v: v.value, ts: adj.ts }); d.client.localChanged(d.S); return adj; }
const total = (d, name) => SC.stockOf(d.S.products.find((p) => p.name === name)).amount;

// Household with a matcha + oat milk pantry, created by A and joined by B
async function household() {
  const server = new Server(); const A = device(server, 'A'); const hid = 'h1';
  addProd(A, { name: 'Matcha', size: 30, sealed: 2 }); addProd(A, { category: 'milk', name: 'Milk', size: 1000, sealed: 2, dairy: false });
  await A.client.attach({ id: hid, name: 'Home' }, true, true); await A.client.start();
  const B = device(server, 'B'); await B.client.attach({ id: hid, name: 'Home' }, true, false); await B.client.start();
  await syncAll([A, B]); return { server, A, B };
}

(async () => {
  console.log('household sync engine');
  await test('creating uploads the pantry as a snapshot; joining reproduces it exactly', async () => {
    const { A, B } = await household(); assert.strictEqual(shared(A.S), shared(B.S)); assert.strictEqual(B.S.products.length, 2); assert.strictEqual(total(B, 'Matcha'), 60); assert.strictEqual(A.client.pendingCount(), 0);
  });
  await test('a drink logged on A appears on B with the same stock, in real time', async () => {
    const { A, B } = await household(); logDrink(A, 'r_matcha_latte'); await settle(); await syncAll([A, B]);
    assert.strictEqual(total(B, 'Matcha'), 58); assert.strictEqual(B.S.logs.length, 1); assert.strictEqual(shared(A.S), shared(B.S));
  });
  await test('offline on both phones: drinks, restock and recount merge without losing anything', async () => {
    const { server, A, B } = await household(); server.down = true;
    logDrink(A, 'r_matcha_latte'); await settle();                       // A: -2 g matcha, -150 ml milk
    restock(B, B.S.products[0].id, 1); recount(B, B.S.products[1].id, { sealed: 1, openMode: 'amount', openAmount: 500 }); logDrink(B, 'r_matcha_latte'); await settle();
    assert.strictEqual(A.client.status, 'offline'); assert.ok(A.client.pendingCount() >= 1 && B.client.pendingCount() >= 3);
    server.down = false; await syncAll([A, B]);
    assert.strictEqual(shared(A.S), shared(B.S)); assert.strictEqual(A.client.pendingCount() + B.client.pendingCount(), 0);
    assert.strictEqual(total(A, 'Matcha'), 60 - 2 - 2 + 30);              // two drinks and one restocked pack
    assert.strictEqual(A.S.logs.length, 2); assert.strictEqual(A.S.adjustments.length, 2);
  });
  await test('both phones use the last grams: stock stops at 0, never negative, and both agree', async () => {
    const { server, A, B } = await household(); recount(A, A.S.products[0].id, { sealed: 0, openMode: 'amount', openAmount: 3 }); await syncAll([A, B]);
    server.down = true; logDrink(A, 'r_matcha_latte'); logDrink(B, 'r_matcha_latte'); await settle(); server.down = false; await syncAll([A, B]);
    assert.strictEqual(shared(A.S), shared(B.S)); assert.strictEqual(total(A, 'Matcha'), 0); A.S.products.forEach((p) => assert.ok(SC.stockOf(p).amount >= 0));
    assert.strictEqual(A.S.logs.length, 2);
  });
  await test("one phone undoes the other's drink and stock is restored everywhere", async () => {
    const { A, B } = await household(); const log = logDrink(A, 'r_matcha_latte'); await syncAll([A, B]); undoDrink(B, log.id); await syncAll([A, B]);
    assert.strictEqual(A.S.logs.length, 0); assert.strictEqual(total(A, 'Matcha'), 60); assert.strictEqual(shared(A.S), shared(B.S));
  });
  await test('sending twice and pulling twice never double-applies', async () => {
    const { server, A, B } = await household(); logDrink(A, 'r_matcha_latte'); await A.client.flush(); await A.client.flush(); await syncAll([A, B]); await syncAll([A, B]);
    assert.strictEqual(server.rows.filter((r) => r.type === 'log.commit').length, 1); assert.strictEqual(total(B, 'Matcha'), 58);
  });
  await test('editing a product on one phone never overwrites stock changed on the other', async () => {
    const { server, A, B } = await household(); server.down = true;
    A.S.products[0].name = 'Ceremonial Matcha'; A.S.products[0].price = 650; A.client.localChanged(A.S); logDrink(B, 'r_matcha_latte'); await settle(); server.down = false; await syncAll([A, B]);
    assert.strictEqual(A.S.products[0].name, 'Ceremonial Matcha'); assert.strictEqual(total(A, 'Ceremonial Matcha'), 58); assert.strictEqual(shared(A.S), shared(B.S));
  });
  await test('recipes, people, machines, limits, shopping and currency sync', async () => {
    const { A, B } = await household();
    A.S.people.push({ id: 'p_sam', name: 'Sam' }); A.S.machines.push(SC.makeMachine('Kitchen', 'original', TODAY)); A.S.thresholds.matcha = 55; A.S.shopping.push({ id: 's1', label: 'filters', note: '' }); A.S.settings.currency = '₱';
    A.S.recipes.push({ id: 'r_x', name: 'X', builtin: false, fav: false, serve: 'hot', ingredients: [{ type: 'matcha', amount: 1, unit: 'g' }], water: null, ice: false, steps: ['go'], note: '' }); A.client.localChanged(A.S); await syncAll([A, B]);
    assert.ok(B.S.people.some((p) => p.name === 'Sam')); assert.strictEqual(B.S.machines.length, 1); assert.strictEqual(B.S.thresholds.matcha, 55); assert.strictEqual(B.S.shopping.length, 1); assert.strictEqual(B.S.settings.currency, '₱'); assert.ok(B.S.recipes.some((r) => r.id === 'r_x'));
    B.S.people = B.S.people.filter((p) => p.id !== 'p_sam'); B.S.shopping = []; B.client.localChanged(B.S); await syncAll([A, B]); assert.ok(!A.S.people.some((p) => p.id === 'p_sam')); assert.strictEqual(A.S.shopping.length, 0);
  });
  await test('deleting a person on one phone moves their drinks to Unassigned on both', async () => {
    const { A, B } = await household(); A.S.people.push({ id: 'p_sam', name: 'Sam' }); A.client.localChanged(A.S); await syncAll([A, B]);
    logDrink(B, 'r_matcha_latte', 'p_sam'); await syncAll([A, B]); SC.deletePerson(A.S, 'p_sam'); A.client.localChanged(A.S); await syncAll([A, B]);
    assert.strictEqual(B.S.logs[0].personId, null); assert.ok(!B.S.people.some((p) => p.id === 'p_sam')); assert.strictEqual(shared(A.S), shared(B.S));
  });
  await test('a drink that uses a product deleted elsewhere is skipped, reported, and both phones still agree', async () => {
    const { server, A, B } = await household(); server.down = true;
    B.S.products = B.S.products.filter((p) => p.name !== 'Matcha'); B.client.localChanged(B.S); logDrink(A, 'r_matcha_latte'); await settle(); server.down = false; await B.client.sync(); await syncAll([A, B]); // the delete reaches the server first
    assert.strictEqual(shared(A.S), shared(B.S)); assert.strictEqual(A.S.logs.length, 0); assert.ok(A.client.skipped.length + B.client.skipped.length >= 1, 'skipped operation recorded');
  });
  await test('if the drink reaches the server before the delete, the drink stays in history', async () => {
    const { server, A, B } = await household(); server.down = true; B.S.products = B.S.products.filter((p) => p.name !== 'Matcha'); B.client.localChanged(B.S); logDrink(A, 'r_matcha_latte'); await settle(); server.down = false; await A.client.sync(); await syncAll([A, B]);
    assert.strictEqual(shared(A.S), shared(B.S)); assert.strictEqual(A.S.logs.length, 1); assert.ok(!A.S.products.some((p) => p.name === 'Matcha'));
  });
  await test('an imported snapshot replaces the shared pantry for everyone', async () => {
    const { A, B } = await household(); const other = SC.defaultState(); SC.addProduct(other, { category: 'tonic', brand: 'T', name: 'Tonic', size: 500, sealed: 3, openMode: 'none' }, TODAY);
    A.S = SYNC.mergeLocalSettings(other, A.S); A.client.snapshotAll(A.S); await syncAll([A, B]); assert.deepStrictEqual(B.S.products.map((p) => p.name), ['Tonic']); assert.strictEqual(shared(A.S), shared(B.S));
  });
  await test("device-only settings (theme, units, who I am) stay on each phone", async () => {
    const { A, B } = await household(); A.S.settings.theme = 'dark'; B.S.settings.activePerson = 'p_me'; B.S.settings.tempUnit = 'F'; A.S.people.push({ id: 'p2', name: 'Two' }); A.S.settings.activePerson = 'p2'; A.client.localChanged(A.S); await syncAll([A, B]);
    A.S.settings.profileChosen = true; A.client.localChanged(A.S); await syncAll([A, B]); assert.ok(!B.S.settings.profileChosen, 'which profile a phone is using is never copied to the others'); assert.ok(SYNC.LOCAL_SETTINGS.includes('profileChosen') && SYNC.LOCAL_SETTINGS.includes('activePerson'));
    assert.strictEqual(B.S.settings.theme, 'auto'); assert.strictEqual(B.S.settings.tempUnit, 'F'); assert.strictEqual(A.S.settings.theme, 'dark'); assert.strictEqual(A.S.settings.activePerson, 'p2');
  });
  await test('pending changes survive an app restart and are sent afterwards', async () => {
    const { server, A, B } = await household(); server.down = true; logDrink(A, 'r_matcha_latte'); await settle();
    const A2 = { name: 'A', S: JSON.parse(JSON.stringify(A.S)), store: A.store }; A2.client = SYNC.createClient({ transport: server.transport(), store: A2.store, getState: () => A2.S, setState: (s) => { A2.S = s; }, deviceId: 'A' });
    assert.ok(await A2.client.load()); assert.strictEqual(A2.client.pendingCount(), 1); server.down = false; await A2.client.start(); await syncAll([A2, B]); assert.strictEqual(total(B, 'Matcha'), 58); assert.strictEqual(shared(A2.S), shared(B.S));
  });
  await test('rebuilds are deterministic: a phone that joins late gets the same pantry as the others', async () => {
    const { server, A, B } = await household(); logDrink(A, 'r_matcha_latte'); restock(B, B.S.products[1].id, 1); await syncAll([A, B]); logDrink(B, 'r_matcha_latte'); await syncAll([A, B]);
    const C = device(server, 'C'); await C.client.attach({ id: 'h1', name: 'Home' }, true, false); await C.client.start(); await syncAll([A, B, C]); assert.strictEqual(shared(C.S), shared(A.S)); assert.strictEqual(shared(A.S), shared(B.S));
  });
  await test('bad or unknown operations are skipped, never thrown, and never corrupt stock', async () => {
    const S = SC.defaultState(); SC.addProduct(S, { category: 'matcha', brand: 'B', name: 'M', size: 30, sealed: 1, openMode: 'none' }, TODAY); const before = SYNC.canon(S);
    const bad = [null, {}, { type: 5 }, { type: 'wat', payload: {} }, { type: 'put', payload: { coll: 'products', item: { id: 'x', category: 'matcha', size: -5 } } }, { type: 'put', payload: { coll: 'nope', item: {} } }, { type: 'log.commit', payload: {} },
      { type: 'log.commit', payload: { draft: { id: 'l', slots: 'x' } } }, { type: 'adj.recount', payload: { id: 'a', productId: S.products[0].id, v: { sealed: -1, open: null } } }, { type: 'adj.restock', payload: { id: 'a', productId: S.products[0].id, packs: 'lots' } },
      { type: 'stock.add', payload: { productId: S.products[0].id, packs: 1e9 } }, { type: 'thr', payload: { cat: 'matcha', value: -4 } }, { type: 'set', payload: { key: 'theme', value: 'x' } }, { type: 'snapshot', payload: { state: { app: 'other' } } }, { type: 'put', v: 99, payload: {} }];
    bad.forEach((op) => { const r = SYNC.apply(S, op); assert.strictEqual(r.ok, false, JSON.stringify(op)); }); assert.strictEqual(SYNC.canon(S), before);
  });
  await test('1,500 operations rebuild in well under a second', async () => {
    const { A, B } = await household(); for (let i = 0; i < 1500; i++) { A.client.pending.push(SYNC.makeOp('adj.restock', { id: 'r' + i, productId: A.S.products[0].id, packs: 1, ts: TODAY + 'T10:00' }, 'A')); }
    await A.client.sync(); const t0 = Date.now(); B.client.serverState = null; B.client.lastSeq = 0; B.client.serverState = SC.defaultState(); await B.client.sync(); const ms = Date.now() - t0; console.log('       replay of ~1,500 ops: ' + ms + ' ms');
    assert.ok(ms < 1000); assert.strictEqual(B.S.adjustments.length, 1500);
  });
  await test('leaving stops syncing but keeps the local pantry', async () => {
    const { server, A, B } = await household(); await B.client.detach(); const mine = SYNC.canon(B.S); logDrink(A, 'r_matcha_latte'); await syncAll([A]); assert.strictEqual(SYNC.canon(B.S), mine); assert.strictEqual(B.client.household, null); assert.strictEqual(B.S.products.length, 2); void server;
  });
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})();
