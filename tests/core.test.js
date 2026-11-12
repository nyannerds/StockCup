// Acceptance tests mapped to PRD requirements. Run: node tests/core.test.js
const assert = require('assert');
const SC = require('../src/core.js');
const SCP = require('../src/parse.js');

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n       ') : e)); } }
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= (tol === undefined ? 1e-6 : tol), (msg || '') + ' expected ' + b + ' got ' + a);
const TODAY = '2026-11-12';

function fresh() { return SC.defaultState(); }
function add(state, over) {
  const base = { category: 'matcha', brand: 'Brand A', name: 'Matcha', size: 30, sealed: 1, openMode: 'none' };
  const r = SC.addProduct(state, Object.assign(base, over), TODAY);
  assert.ok(r.ok, JSON.stringify(r.errors)); return r.product;
}
const recipe = (s, id) => s.recipes.find((r) => r.id === id);
function logDraft(s, rid, mod) {
  const d = SC.emptyDraft(s, recipe(s, rid), 1, 'p_me', TODAY + 'T09:00'); if (mod) mod(d); return d;
}

console.log('R1 inventory');
test('cannot save without brand, name, category, size, unit', () => {
  const s = fresh();
  assert.ok(!SC.addProduct(s, { category: 'matcha', brand: '', name: 'x', size: 30 }, TODAY).ok);
  assert.ok(!SC.addProduct(s, { category: 'matcha', brand: 'b', name: '', size: 30 }, TODAY).ok);
  assert.ok(!SC.addProduct(s, { category: '', brand: 'b', name: 'x', size: 30 }, TODAY).ok);
  assert.ok(!SC.addProduct(s, { category: 'matcha', brand: 'b', name: 'x', size: '' }, TODAY).ok);
  assert.strictEqual(s.products.length, 0);
});
test('one product per category saves; total = sealed + open', () => {
  const s = fresh();
  Object.keys(SC.CATEGORIES).forEach((c) => {
    const C = SC.CATEGORIES[c];
    const f = { category: c, brand: 'B', name: c, size: C.size, sealed: 2, openMode: 'half', unit: C.unit, system: 'original', intensity: 5, sleeves: 2, loose: 3 };
    const r = SC.addProduct(s, f, TODAY); assert.ok(r.ok, c + JSON.stringify(r.errors));
    const st = SC.stockOf(r.product);
    if (c === 'capsule') assert.strictEqual(st.amount, 23); else near(st.amount, 2 * C.size + C.size / 2);
  });
});
test('fill levels convert to 100/50/25/10 %', () => {
  const s = fresh();
  [['full', 1], ['half', 0.5], ['quarter', 0.25], ['almost', 0.1]].forEach(([m, f]) => {
    const p = add(s, { size: 40, sealed: 0, openMode: m }); near(SC.stockOf(p).amount, 40 * f);
  });
});
test('unknown amount is "unknown", never 0', () => {
  const s = fresh(); const p = add(s, { sealed: 0, openMode: 'unknown' });
  const st = SC.stockOf(p); assert.strictEqual(st.unknown, true); assert.strictEqual(p.open.amount, null);
});
test('bought N packs', () => { const s = fresh(); const p = add(s, { sealed: 4 }); assert.strictEqual(SC.stockOf(p).amount, 120); });
test('survives export + import (reload)', () => {
  const s = fresh(); SC.loadSample(s, TODAY);
  const t = SC.importData(SC.exportData(s)); assert.deepStrictEqual(t, JSON.parse(JSON.stringify(s)));
});

console.log('R2 units');
test('reference conversions', () => {
  near(SC.convert(1, 'tsp', 'ml'), 5); near(SC.convert(1, 'tbsp', 'ml'), 15); near(SC.convert(1, 'cup', 'ml'), 240);
  near(SC.convert(3, 'tsp', 'tbsp'), 1); near(SC.convert(1, 'cup', 'tbsp'), 16); near(SC.convert(2, 'tbsp', 'tsp'), 6);
});
test('weight-volume within 2% of density', () => {
  const cases = [[240, 'ml', 'g', 1.03], [250, 'g', 'ml', 1.03], [100, 'g', 'ml', 0.4], [1, 'tbsp', 'g', 0.4], [2, 'cup', 'g', 1.3], [50, 'ml', 'g', 0.55], [5, 'tsp', 'g', 1.0], [30, 'g', 'tsp', 1.3], [1, 'cup', 'g', 0.5], [7, 'tbsp', 'g', 1.03]];
  cases.forEach(([a, f, t, d]) => {
    const got = SC.convert(a, f, t, d);
    const ml = f === 'g' ? a / d : a * SC.VOL_ML[f];
    const exp = t === 'g' ? ml * d : ml / SC.VOL_ML[t];
    assert.ok(Math.abs(got - exp) / exp < 0.02);
  });
  // two milks with different densities
  near(SC.convert(100, 'ml', 'g', 1.03), 103); near(SC.convert(100, 'ml', 'g', 0.99), 99);
  near(SC.convert(103, 'g', 'ml', 1.03), 100);
});

console.log('R3 freshness');
test('thresholds: sealed none, 31d warn, 41d past (40-day life)', () => {
  const s = fresh();
  const sealed = add(s, { shelfLifeDays: 40, sealed: 1 });
  assert.strictEqual(SC.freshness(sealed, TODAY).state, 'sealed');
  const p = add(s, { shelfLifeDays: 40, sealed: 0, openMode: 'half', openDate: SC.addDays(TODAY, -31) });
  assert.strictEqual(SC.freshness(p, TODAY).state, 'warn');
  assert.strictEqual(SC.freshness({ ...p, open: { amount: 5, openedAt: SC.addDays(TODAY, -29) } }, TODAY).state, 'fresh');
  assert.strictEqual(SC.freshness({ ...p, open: { amount: 5, openedAt: SC.addDays(TODAY, -30) } }, TODAY).state, 'warn');
  assert.strictEqual(SC.freshness({ ...p, open: { amount: 5, openedAt: SC.addDays(TODAY, -41) } }, TODAY).state, 'past');
  assert.strictEqual(SC.freshness({ ...p, open: { amount: 5, openedAt: SC.addDays(TODAY, -40) } }, TODAY).state, 'past');
});
test('capsules have no freshness', () => {
  const s = fresh(); const c = add(s, { category: 'capsule', size: 10, sleeves: 1, system: 'original', intensity: 5 }); assert.strictEqual(SC.freshness(c, TODAY), null);
});
test('use-it-up lists only makeable recipes, most aged first', () => {
  const s = fresh();
  add(s, { category: 'matcha', shelfLifeDays: 40, sealed: 0, openMode: 'half', openDate: SC.addDays(TODAY, -35), size: 30 });
  add(s, { category: 'milk', name: 'Oat', size: 1000, sealed: 0, openMode: 'half', openDate: SC.addDays(TODAY, -6), shelfLifeDays: 7, dairy: false });
  const out = SC.suggest(s, {}, TODAY);
  assert.ok(out.useItUp.length > 0);
  const readyIds = new Set(out.ready.concat(out.maybe).map((a) => a.recipe.id));
  out.useItUp.forEach((u) => assert.ok(readyIds.has(u.analysis.recipe.id)));
  for (let i = 1; i < out.useItUp.length; i++) assert.ok(out.useItUp[i - 1].score >= out.useItUp[i].score);
  // nothing aged -> nothing listed
  const s2 = fresh(); add(s2, { category: 'matcha', sealed: 2 }); add(s2, { category: 'milk', name: 'W', size: 1000, sealed: 1 });
  assert.strictEqual(SC.suggest(s2, {}, TODAY).useItUp.length, 0);
});

console.log('R4 shopping');
test('matcha 20 g + 15 g with a 40 g threshold is listed; restock clears; undo works', () => {
  const s = fresh(); s.thresholds.matcha = 40;
  const a = add(s, { name: 'A', sealed: 0, openMode: 'half', size: 40 }); // 20
  const b = add(s, { brand: 'Brand B', name: 'B', sealed: 0, openMode: 'half', size: 30 }); // 15
  assert.strictEqual(SC.stockOf(a).amount + SC.stockOf(b).amount, 35);
  let low = SC.lowStock(s); assert.ok(low.find((x) => x.type === 'matcha' && x.total === 35));
  const adj = SC.restock(s, SC.usualProduct(s, 'matcha').id, 1, TODAY + 'T10:00');
  assert.ok(!SC.lowStock(s).find((x) => x.type === 'matcha'));
  assert.ok(SC.undoAdjustment(s, adj.id));
  assert.ok(SC.lowStock(s).find((x) => x.type === 'matcha'));
});
test('categories you never added are not on the list', () => {
  const s = fresh(); assert.strictEqual(SC.lowStock(s).length, 0);
});

console.log('R5/R6 capsules and machines');
function capState() {
  const s = fresh(); s.machines.push(SC.makeMachine('Orig', 'original', TODAY));
  return s;
}
test('3 sleeves of 10 = 30; 3 sleeves + 4 loose = 34', () => {
  const s = capState();
  const a = add(s, { category: 'capsule', brand: 'N', name: 'A', size: 10, sleeves: 3, loose: 0, system: 'original', intensity: 9 });
  const b = add(s, { category: 'capsule', brand: 'N', name: 'B', size: 10, sleeves: 3, loose: 4, system: 'original', intensity: 4 });
  assert.strictEqual(a.count, 30); assert.strictEqual(b.count, 34);
});
test('2 shots with 1-shot capsules deducts 2 and doubles caffeine', () => {
  const s = capState();
  const c = add(s, { category: 'capsule', brand: 'N', name: 'A', size: 10, sleeves: 1, system: 'original', intensity: 4, shots: 1 });
  add(s, { category: 'milk', name: 'M', size: 1000, sealed: 1 });
  const one = SC.commitLog(s, logDraft(s, 'r_espresso_tonic')); assert.ok(!one.ok); // no tonic -> error
  add(s, { category: 'tonic', name: 'T', size: 500, sealed: 2 });
  const l1 = SC.commitLog(s, logDraft(s, 'r_espresso_tonic')); assert.ok(l1.ok, JSON.stringify(l1.errors));
  assert.strictEqual(c.count, 9); near(l1.log.caffeine, 63);
  const l2 = SC.commitLog(s, logDraft(s, 'r_flat_white')); assert.ok(l2.ok, JSON.stringify(l2.errors));
  assert.strictEqual(c.count, 7); near(l2.log.caffeine, 126);
});
test('capsule suggestions follow intensity (high for dirty matcha, low for flat white)', () => {
  const s = capState();
  const hi = add(s, { category: 'capsule', brand: 'N', name: 'Hi', size: 10, sleeves: 1, system: 'original', intensity: 12 });
  const lo = add(s, { category: 'capsule', brand: 'N', name: 'Lo', size: 10, sleeves: 1, system: 'original', intensity: 4 });
  add(s, { category: 'matcha', sealed: 1 }); add(s, { category: 'milk', name: 'M', size: 1000, sealed: 1 });
  const dm = SC.emptyDraft(s, recipe(s, 'r_dirty_matcha'), 1, 'p_me', TODAY + 'T09:00');
  assert.strictEqual(dm.slots.find((x) => x.type === 'espresso').parts[0].productId, hi.id);
  const fw = SC.emptyDraft(s, recipe(s, 'r_flat_white'), 1, 'p_me', TODAY + 'T09:00');
  assert.strictEqual(fw.slots.find((x) => x.type === 'espresso').parts[0].productId, lo.id);
});
test('2-shot capsule covers a 2-shot recipe with 1 capsule', () => {
  const s = capState(); const c = add(s, { category: 'capsule', brand: 'N', name: 'D', size: 10, sleeves: 1, system: 'original', intensity: 6, shots: 2 });
  add(s, { category: 'milk', name: 'M', size: 1000, sealed: 1 });
  const r = SC.commitLog(s, logDraft(s, 'r_flat_white')); assert.ok(r.ok); assert.strictEqual(c.count, 9); near(r.log.caffeine, 126);
});
test('machines: none hides capsule supply; Original-only never sees Vertuo', () => {
  const s = fresh();
  const o = add(s, { category: 'capsule', brand: 'N', name: 'O', size: 10, sleeves: 1, system: 'original', intensity: 5 });
  const v = add(s, { category: 'capsule', brand: 'N', name: 'V', size: 10, sleeves: 1, system: 'vertuo', intensity: 5 });
  add(s, { category: 'tonic', name: 'T', size: 500, sealed: 1 });
  assert.strictEqual(SC.suggest(s, {}, TODAY).ready.find((a) => a.recipe.id === 'r_espresso_tonic'), undefined);
  s.machines.push(SC.makeMachine('Orig', 'original', TODAY));
  assert.ok(SC.suggest(s, {}, TODAY).ready.find((a) => a.recipe.id === 'r_espresso_tonic'));
  const d = SC.emptyDraft(s, recipe(s, 'r_espresso_tonic'), 1, 'p_me', TODAY + 'T09:00');
  assert.strictEqual(d.slots[0].parts[0].productId, o.id);
  const cands = SC.slotCandidates(s, d.slots[0], true).map((p) => p.id); assert.ok(cands.includes(o.id) && !cands.includes(v.id));
  s.machines = [SC.makeMachine('Vert', 'vertuo', TODAY)];
  assert.strictEqual(SC.slotCandidates(s, d.slots[0], true).map((p) => p.id).includes(o.id), false);
  // forcing an incompatible capsule into a log is rejected
  s.machines = [SC.makeMachine('Orig', 'original', TODAY)];
  d.slots[0].parts = [{ productId: v.id, qty: 1 }]; assert.ok(!SC.evaluateLog(s, d).ok);
});
test('descale reminder only for the machine past its limit; logging counts capsules; undo reverses', () => {
  const s = fresh(); const m1 = SC.makeMachine('A', 'original', TODAY), m2 = SC.makeMachine('B', 'vertuo', TODAY);
  m1.descaleCaps = 2; s.machines.push(m1, m2);
  const c = add(s, { category: 'capsule', brand: 'N', name: 'O', size: 10, sleeves: 1, system: 'original', intensity: 5 });
  add(s, { category: 'tonic', name: 'T', size: 500, sealed: 2 });
  assert.ok(!SC.descaleStatus(m1, TODAY).due);
  const a = SC.commitLog(s, logDraft(s, 'r_espresso_tonic')); const b = SC.commitLog(s, logDraft(s, 'r_espresso_tonic'));
  assert.strictEqual(m1.caps, 2); assert.ok(SC.descaleStatus(m1, TODAY).due); assert.ok(!SC.descaleStatus(m2, TODAY).due);
  SC.undoLog(s, b.log.id); assert.strictEqual(m1.caps, 1); assert.ok(!SC.descaleStatus(m1, TODAY).due);
  assert.ok(SC.descaleStatus(m2, SC.addDays(TODAY, 95)).due); // 3 months
  void a; void c;
});

console.log('R7 recipes');
test('8 built-in recipes complete, generic (no brand names)', () => {
  const s = fresh(); assert.strictEqual(s.recipes.length, 8);
  const names = s.recipes.map((r) => r.name).sort();
  assert.deepStrictEqual(names, ['Affogato', 'Cold brew', 'Dirty matcha', 'Espresso tonic', 'Flat white', 'Hojicha latte', 'Iced matcha', 'Matcha latte']);
  s.recipes.forEach((r) => {
    assert.ok(r.serve === 'hot' || r.serve === 'iced'); assert.ok(r.ingredients.length >= 2); assert.ok(r.steps.length >= 2); assert.ok(r.note);
    r.ingredients.forEach((i) => { assert.ok(SC.SLOT_TYPES.includes(i.type)); assert.ok(i.amount > 0); assert.ok(SC.RECIPE_UNITS.includes(i.unit)); assert.ok(!i.brand); });
    assert.ok(!/nespresso|oatly|brand/i.test(JSON.stringify(r)));
    if (r.serve === 'iced') assert.ok(r.ice);
  });
  assert.ok(s.recipes.filter((r) => r.water).every((r) => r.water.ml > 0));
  assert.ok(s.recipes.filter((r) => r.water && r.water.tempC === 80).length >= 3);
});
test('custom recipe works in suggestions, scaling and logging', () => {
  const s = fresh(); add(s, { category: 'matcha', sealed: 1 }); add(s, { category: 'syrup', name: 'S', size: 750, sealed: 1 });
  const parsed = SCP.draftToRecipe({ name: 'Sweet matcha', serve: 'iced', servings: 1, ingredients: [{ type: 'matcha', amount: 3, unit: 'g' }, { type: 'syrup', amount: 1, unit: 'tbsp' }], waterMl: 60, waterTemp: 80, ice: true, steps: ['Whisk'] });
  assert.ok(parsed.ok); s.recipes.push(parsed.recipe);
  assert.ok(SC.suggest(s, {}, TODAY).ready.find((a) => a.recipe.name === 'Sweet matcha'));
  const sc = SC.scaleRecipe(s, parsed.recipe, 'have', { slot: 0, amount: 30, unit: 'g' }); near(sc.servings, 10);
  const r = SC.commitLog(s, SC.emptyDraft(s, parsed.recipe, 1, 'p_me', TODAY + 'T09:00')); assert.ok(r.ok, JSON.stringify(r.errors));
  // 1 tbsp syrup = 15 ml -> density 1.3 -> stock in ml
  near(SC.stockOf(s.products.find((p) => p.category === 'syrup')).amount, 735);
});

console.log('R8 suggestions');
function pantry(items) { const s = fresh(); items.forEach((it) => add(s, it)); return s; }
test('combined brands that only suffice together count', () => {
  const s = pantry([{ category: 'matcha', brand: 'A', name: 'm', size: 30, sealed: 0, openMode: 'quarter' }, { category: 'matcha', brand: 'B', name: 'm', size: 30, sealed: 0, openMode: 'quarter' },
    { category: 'milk', brand: 'A', name: 'm', size: 100, sealed: 1 }, { category: 'milk', brand: 'B', name: 'm', size: 100, sealed: 1 }]);
  // matcha 7.5 + 7.5 ; milk 100+100: 3 matcha lattes need 6 g, 450 ml -> only 1 latte (200 ml)
  const a = SC.analyzeRecipe(s, SC.buildIndex(s), recipe(s, 'r_matcha_latte'), 1, {}); assert.strictEqual(a.status, 'ready');
  const two = SC.analyzeRecipe(s, SC.buildIndex(s), recipe(s, 'r_matcha_latte'), 1.3, {}); assert.strictEqual(two.status, 'ready'); // 195 ml needs both brands
  const t = SC.analyzeRecipe(s, SC.buildIndex(s), recipe(s, 'r_matcha_latte'), 2, {}); assert.strictEqual(t.status, 'almost'); assert.strictEqual(t.shortSlots[0].slot.type, 'milk');
});
test('almost there + hints', () => {
  const s = pantry([{ category: 'matcha', sealed: 1 }]);
  const out = SC.suggest(s, {}, TODAY);
  assert.ok(out.almost.find((a) => a.recipe.id === 'r_matcha_latte'));
  assert.ok(out.hints.find((h) => h.type === 'milk' && h.recipes.includes('Matcha latte')));
  assert.ok(!out.ready.length);
});
test('iced filter, caffeine filter, intersection; water/ice never block', () => {
  const s = pantry([{ category: 'matcha', sealed: 1 }, { category: 'milk', name: 'M', size: 1000, sealed: 1 }, { category: 'hojicha', name: 'H', size: 50, sealed: 1 }, { category: 'syrup', name: 'S', size: 750, sealed: 1 }]);
  const ids = (o) => o.ready.map((a) => a.recipe.id).sort();
  assert.deepStrictEqual(ids(SC.suggest(s, {}, TODAY)), ['r_hojicha_latte', 'r_iced_matcha', 'r_matcha_latte']);
  assert.deepStrictEqual(ids(SC.suggest(s, { serve: 'iced' }, TODAY)), ['r_iced_matcha']);
  assert.deepStrictEqual(ids(SC.suggest(s, { caf: 'low' }, TODAY)), ['r_hojicha_latte']);
  assert.deepStrictEqual(ids(SC.suggest(s, { serve: 'iced', caf: 'low' }, TODAY)), []);
  assert.deepStrictEqual(ids(SC.suggest(s, { serve: 'iced', caf: 'medium' }, TODAY)), ['r_iced_matcha']);
});
test('unknown amount goes under "maybe"', () => {
  const s = pantry([{ category: 'matcha', sealed: 0, openMode: 'unknown' }, { category: 'milk', name: 'M', size: 1000, sealed: 1 }]);
  const o = SC.suggest(s, {}, TODAY); assert.ok(o.maybe.find((a) => a.recipe.id === 'r_matcha_latte')); assert.ok(!o.ready.find((a) => a.recipe.id === 'r_matcha_latte'));
});
test('wrong-machine capsules do not make drinks', () => {
  const s = fresh(); s.machines.push(SC.makeMachine('V', 'vertuo', TODAY));
  add(s, { category: 'capsule', brand: 'N', name: 'O', size: 10, sleeves: 3, system: 'original', intensity: 9 }); add(s, { category: 'tonic', name: 'T', size: 500, sealed: 1 });
  const o = SC.suggest(s, {}, TODAY); assert.ok(!o.ready.find((a) => a.recipe.id === 'r_espresso_tonic')); assert.ok(o.almost.find((a) => a.recipe.id === 'r_espresso_tonic'));
});
test('beans make espresso drinks when there is no machine', () => {
  const s = pantry([{ category: 'coffee', name: 'Beans', size: 250, sealed: 1 }, { category: 'tonic', name: 'T', size: 500, sealed: 1 }]);
  assert.ok(SC.suggest(s, {}, TODAY).ready.find((a) => a.recipe.id === 'r_espresso_tonic'));
  const r = SC.commitLog(s, logDraft(s, 'r_espresso_tonic')); assert.ok(r.ok, JSON.stringify(r.errors));
  near(SC.stockOf(s.products[0]).amount, 241); near(r.log.caffeine, 63);
});

console.log('R9 dairy');
test('oat + dairy pantry: latte ready; dairy only: needs dairy-free product', () => {
  const base = [{ category: 'matcha', sealed: 1 }];
  const oat = { category: 'milk', brand: 'O', name: 'Oat', size: 1000, sealed: 1, dairy: false };
  const dairy = { category: 'milk', brand: 'D', name: 'Whole', size: 1000, sealed: 1, dairy: true };
  const get = (items) => { const s = pantry(base.concat(items)); return SC.suggest(s, { dairyFree: true }, TODAY); };
  let o = get([oat, dairy]); assert.ok(o.ready.find((a) => a.recipe.id === 'r_matcha_latte'));
  o = get([dairy]); assert.ok(o.needsDF.find((a) => a.recipe.id === 'r_matcha_latte')); assert.ok(!o.ready.find((a) => a.recipe.id === 'r_matcha_latte'));
  o = get([oat]); assert.ok(o.ready.find((a) => a.recipe.id === 'r_matcha_latte'));
  // recipes with no dairy slot are dairy-free by nature
  const s = pantry([{ category: 'tonic', name: 'T', size: 500, sealed: 1 }, { category: 'coffee', name: 'B', size: 250, sealed: 1 }]);
  assert.ok(SC.suggest(s, { dairyFree: true }, TODAY).ready.find((a) => a.recipe.id === 'r_espresso_tonic'));
});
test('a split of oat and dairy is not dairy-free; oat only is', () => {
  const s = pantry([{ category: 'matcha', sealed: 1 }, { category: 'milk', brand: 'O', name: 'Oat', size: 1000, sealed: 1, dairy: false }, { category: 'milk', brand: 'D', name: 'Whole', size: 1000, sealed: 1, dairy: true }]);
  const oat = s.products.find((p) => p.name === 'Oat'), whole = s.products.find((p) => p.name === 'Whole');
  let d = logDraft(s, 'r_matcha_latte', (x) => { x.slots[1].parts = [{ productId: oat.id, qty: 100 }, { productId: whole.id, qty: 50 }]; });
  let r = SC.commitLog(s, d); assert.ok(r.ok, JSON.stringify(r.errors)); assert.strictEqual(r.log.dairyFree, false);
  d = logDraft(s, 'r_matcha_latte', (x) => { x.slots[1].parts = [{ productId: oat.id, qty: 150 }]; });
  r = SC.commitLog(s, d); assert.strictEqual(r.log.dairyFree, true);
  d = logDraft(s, 'r_matcha_latte', (x) => { x.slots[1].parts = [{ productId: whole.id, qty: 150 }]; });
  r = SC.commitLog(s, d); assert.strictEqual(r.log.dairyFree, false);
});

console.log('R10 scaling');
test('hand-calculated scaling (20 inputs) within 1%', () => {
  const s = pantry([{ category: 'matcha', sealed: 1 }, { category: 'milk', name: 'M', size: 1000, sealed: 1, density: 1.03 }]);
  const r = recipe(s, 'r_matcha_latte');
  const cases = [[0, 2, 'g', 1], [0, 20, 'g', 10], [0, 7, 'g', 3.5], [0, 1, 'tsp', 0.4 * 5 / 2], [0, 1, 'tbsp', 0.4 * 15 / 2], [1, 150, 'ml', 1], [1, 300, 'ml', 2], [1, 1, 'cup', 240 / 150], [1, 1000, 'ml', 1000 / 150],
    [1, 515, 'g', (515 / 1.03) / 150], [0, 18, 'ml', (18 * 0.4) / 2], [0, 100, 'g', 50], [0, 0.5, 'g', 0.25], [1, 75, 'ml', 0.5], [1, 2, 'tbsp', 30 / 150], [1, 1, 'tsp', 5 / 150], [0, 3, 'tsp', (3 * 5 * 0.4) / 2], [0, 1, 'cup', (240 * 0.4) / 2], [1, 450, 'ml', 3], [0, 4, 'g', 2]];
  cases.forEach(([slot, amt, unit, exp]) => { const out = SC.scaleRecipe(s, r, 'have', { slot, amount: amt, unit }); assert.ok(Math.abs(out.servings - exp) / exp < 0.01, slot + ' ' + amt + unit + ' got ' + out.servings + ' exp ' + exp); });
  const w = SC.scaleRecipe(s, r, 'want', { servings: 4 }); near(w.rows[0].amount, 8); near(w.rows[1].amount, 600); near(w.water.ml, 160);
});
test('7 capsules, 2-shot recipe -> 3 servings; shows limiting ingredient', () => {
  const s = capState(); add(s, { category: 'capsule', brand: 'N', name: 'A', size: 10, sleeves: 0, loose: 7, system: 'original', intensity: 5 }); add(s, { category: 'milk', name: 'M', size: 1000, sealed: 5 });
  const out = SC.scaleRecipe(s, recipe(s, 'r_flat_white'), 'have', { slot: 0, amount: 7, unit: 'capsule', shotsPerCapsule: 1 });
  assert.strictEqual(out.servings, 3);
  assert.strictEqual(out.pantryServings, 3); assert.strictEqual(out.limiting.type, 'espresso');
});

console.log('R11 planning');
test('6 lattes with 10 g matcha / 1000 ml milk over two brands: matcha short 2 g, milk covered, stock unchanged', () => {
  const s = pantry([{ category: 'matcha', brand: 'A', name: 'm', size: 30, sealed: 0, openMode: 'half' }, { category: 'matcha', brand: 'B', name: 'm', size: 25, sealed: 0, openMode: 'unknown' }].slice(0, 1).concat([{ category: 'matcha', brand: 'B', name: 'm2', size: 5, sealed: 1 }, { category: 'milk', brand: 'A', name: 'a', size: 600, sealed: 1 }, { category: 'milk', brand: 'B', name: 'b', size: 400, sealed: 1 }]));
  // matcha: 15 + 5 = 20? adjust to exactly 10
  s.products.find((p) => p.name === 'm').open.amount = 5;
  const before = JSON.stringify(s.products);
  const res = SC.planCheck(s, [{ recipeId: 'r_matcha_latte', servings: 6 }]);
  const m = res.find((x) => x.type === 'matcha'), k = res.find((x) => x.type === 'milk');
  near(m.need, 12); near(m.have, 10); near(m.short, 2); assert.ok(!m.covered); assert.ok(k.covered); near(k.need, 900);
  assert.strictEqual(JSON.stringify(s.products), before);
});
test('plan with wrong-machine capsules is short; mixed recipes aggregate', () => {
  const s = fresh(); s.machines.push(SC.makeMachine('V', 'vertuo', TODAY));
  add(s, { category: 'capsule', brand: 'N', name: 'O', size: 10, sleeves: 3, system: 'original', intensity: 9 }); add(s, { category: 'milk', name: 'M', size: 1000, sealed: 1 });
  const res = SC.planCheck(s, [{ recipeId: 'r_flat_white', servings: 2 }, { recipeId: 'r_dirty_matcha', servings: 1 }]);
  const e = res.find((x) => x.type === 'espresso'); near(e.need, 5); near(e.have, 0); near(e.short, 5);
  const milk = res.find((x) => x.type === 'milk'); near(milk.need, 2 * 120 + 120);
});

console.log('R12/R13 logging');
function latteState() {
  return pantry([{ category: 'matcha', brand: 'A', name: 'Ceremonial', size: 30, sealed: 1, openMode: 'none' },
    { category: 'milk', brand: 'A', name: 'Oat', size: 1000, sealed: 1, openMode: 'none', dairy: false }]);
}
test('chosen products fall by exactly the recipe amounts', () => {
  const s = latteState(); const r = SC.commitLog(s, logDraft(s, 'r_matcha_latte')); assert.ok(r.ok);
  near(SC.stockOf(s.products[0]).amount, 28); near(SC.stockOf(s.products[1]).amount, 850);
  assert.strictEqual(r.log.parts.length, 2);
});
test('150 ml need with 100 ml left: uses 100, opens new pack, takes 50, sets open date; undo restores everything', () => {
  const s = pantry([{ category: 'matcha', sealed: 1 }, { category: 'milk', brand: 'A', name: 'Oat', size: 1000, sealed: 1, openMode: 'none' }]);
  const milk = s.products[1]; milk.open = { amount: 100, openedAt: '2026-11-01' };
  s.products[0].sealed = 0; s.products[0].open = { amount: 20, openedAt: '2026-11-01' }; // matcha already open, so only milk opens a pack
  const before = JSON.stringify(s.products);
  const d = logDraft(s, 'r_matcha_latte'); const ev = SC.evaluateLog(s, d); assert.strictEqual(ev.opens.length, 1);
  const r = SC.commitLog(s, d); assert.ok(r.ok);
  assert.strictEqual(milk.sealed, 0); near(milk.open.amount, 950); assert.strictEqual(milk.open.openedAt, TODAY);
  assert.ok(SC.undoLog(s, r.log.id));
  assert.strictEqual(JSON.stringify(s.products), before);
});
test('log with insufficient stock: rejected unless allowed; never below zero', () => {
  const s = pantry([{ category: 'matcha', sealed: 0, openMode: 'almost', size: 30 }, { category: 'milk', name: 'M', size: 1000, sealed: 1 }]);
  const m = s.products[0]; // 3 g
  const d = logDraft(s, 'r_matcha_latte', (x) => { x.servings = 2; for (let i = 0; i < x.slots.length; i++) SC.refillSlot(s, x, x.slots[i]); });
  assert.ok(!SC.evaluateLog(s, d).ok); assert.ok(SC.evaluateLog(s, d).errors.join(' ').includes('short by'));
  const d1 = logDraft(s, 'r_matcha_latte', (x) => { x.servings = 1; });
  SC.commitLog(s, d1); near(SC.stockOf(m).amount, 1);
  const d2 = logDraft(s, 'r_matcha_latte'); assert.ok(!SC.evaluateLog(s, d2).ok);
  d2.allowShort = true; const r = SC.commitLog(s, d2); assert.ok(r.ok); assert.strictEqual(SC.stockOf(m).amount, 0);
  s.products.forEach((p) => { assert.ok(SC.stockOf(p).amount >= 0 && !Number.isNaN(SC.stockOf(p).amount)); });
});
test('split across brands deducts each exactly; bad total rejected; undo restores both', () => {
  const s = pantry([{ category: 'matcha', sealed: 1 }, { category: 'milk', brand: 'A', name: 'a', size: 1000, sealed: 1 }, { category: 'milk', brand: 'B', name: 'b', size: 1000, sealed: 1 }]);
  const [, a, b] = s.products; const before = JSON.stringify(s.products);
  const mk = (qa, qb) => logDraft(s, 'r_matcha_latte', (x) => { x.slots[1].parts = [{ productId: a.id, qty: qa }, { productId: b.id, qty: qb }]; });
  assert.ok(!SC.evaluateLog(s, mk(100, 40)).ok); assert.ok(SC.evaluateLog(s, mk(100, 40)).errors.join('').includes('150'));
  const r = SC.commitLog(s, mk(100, 50)); assert.ok(r.ok);
  near(SC.stockOf(a).amount, 900); near(SC.stockOf(b).amount, 950);
  SC.undoLog(s, r.log.id); assert.strictEqual(JSON.stringify(s.products), before);
});
test('capsule split of 1 + 1 works (two brands) and undo restores both', () => {
  const s = capState(); const a = add(s, { category: 'capsule', brand: 'A', name: 'a', size: 10, sleeves: 0, loose: 1, system: 'original', intensity: 5 }); const b = add(s, { category: 'capsule', brand: 'B', name: 'b', size: 10, sleeves: 0, loose: 4, system: 'original', intensity: 5 });
  add(s, { category: 'milk', name: 'M', size: 1000, sealed: 1 });
  const d = logDraft(s, 'r_flat_white', (x) => { x.slots[0].parts = [{ productId: a.id, qty: 1 }, { productId: b.id, qty: 1 }]; });
  const r = SC.commitLog(s, d); assert.ok(r.ok, JSON.stringify(r.errors)); assert.strictEqual(a.count, 0); assert.strictEqual(b.count, 3);
  SC.undoLog(s, r.log.id); assert.strictEqual(a.count, 1); assert.strictEqual(b.count, 4);
  const bad = logDraft(s, 'r_flat_white', (x) => { x.slots[0].parts = [{ productId: a.id, qty: 1.5 }]; }); assert.ok(!SC.evaluateLog(s, bad).ok);
});
test('"same as last time" repeats the last drink', () => {
  const s = latteState(); const r = SC.commitLog(s, logDraft(s, 'r_matcha_latte'));
  const last = SC.lastLogFor(s, 'p_me'); assert.strictEqual(last.id, r.log.id);
  const d = SC.draftFromLog(s, last, 'p_me', TODAY + 'T10:00'); const r2 = SC.commitLog(s, d); assert.ok(r2.ok);
  near(SC.stockOf(s.products[0]).amount, 26);
});
test('unknown-amount product: drink logs, stock stays unknown, warning shown', () => {
  const s = pantry([{ category: 'matcha', sealed: 0, openMode: 'unknown' }, { category: 'milk', name: 'M', size: 1000, sealed: 1 }]);
  const ev = SC.evaluateLog(s, logDraft(s, 'r_matcha_latte')); assert.ok(ev.ok); assert.ok(ev.warnings.join(' ').includes('unknown'));
  const r = SC.commitLog(s, logDraft(s, 'r_matcha_latte')); assert.ok(r.ok); assert.strictEqual(SC.stockOf(s.products[0]).unknown, true);
});
test('low-stock warning is raised when a drink crosses the threshold', () => {
  const s = pantry([{ category: 'matcha', sealed: 0, openMode: 'half', size: 30 }, { category: 'milk', name: 'M', size: 1000, sealed: 1 }]); s.thresholds.matcha = 14;
  const ev = SC.evaluateLog(s, logDraft(s, 'r_matcha_latte')); assert.ok(ev.warnings.join(' ').includes('Low stock after this drink'));
});

console.log('R14 water & ice');
test('no stock entry for water/ice; no category for them; recipes available regardless', () => {
  assert.ok(!('water' in SC.CATEGORIES) && !('ice' in SC.CATEGORIES)); assert.ok(!SC.SLOT_TYPES.includes('water') && !SC.SLOT_TYPES.includes('ice'));
  const s = pantry([{ category: 'matcha', sealed: 1 }, { category: 'milk', name: 'M', size: 1000, sealed: 1 }, { category: 'syrup', name: 'S', size: 750, sealed: 1 }]);
  assert.ok(SC.suggest(s, { serve: 'iced' }, TODAY).ready.find((a) => a.recipe.id === 'r_iced_matcha'));
  for (let i = 0; i < 20; i++) SC.commitLog(s, logDraft(s, 'r_iced_matcha'));
  assert.ok(s.products.every((p) => ['matcha', 'milk', 'syrup'].includes(p.category)));
  assert.ok(!/water|ice/i.test(JSON.stringify(s.logs.map((l) => l.parts.map((p) => p.label + p.slotType)))));
});

console.log('R15 caffeine');
test('daily totals = sum of the person\'s drinks; labelled values from product or default', () => {
  const s = pantry([{ category: 'matcha', sealed: 3 }, { category: 'milk', name: 'M', size: 1000, sealed: 3 }]);
  s.people.push({ id: 'p_dad', name: 'Dad' });
  const l1 = SC.commitLog(s, logDraft(s, 'r_matcha_latte')); near(l1.log.caffeine, 60); // 2 g * 30
  s.products[0].caffeine = 35; const d2 = logDraft(s, 'r_matcha_latte'); d2.personId = 'p_dad'; const l2 = SC.commitLog(s, d2); near(l2.log.caffeine, 70);
  const d3 = logDraft(s, 'r_matcha_latte'); const l3 = SC.commitLog(s, d3);
  near(SC.dayCaffeine(s, 'p_me', TODAY), 60 + 70); near(SC.dayCaffeine(s, 'p_dad', TODAY), 70); near(SC.dayCaffeine(s, 'all', TODAY), 200);
  void l3;
});
test('a split carries each product\'s own caffeine', () => {
  const s = pantry([{ category: 'matcha', brand: 'A', name: 'a', size: 30, sealed: 1, caffeine: 20 }, { category: 'matcha', brand: 'B', name: 'b', size: 30, sealed: 1, caffeine: 40 }, { category: 'milk', name: 'M', size: 1000, sealed: 1 }]);
  const d = logDraft(s, 'r_matcha_latte', (x) => { x.slots[0].parts = [{ productId: s.products[0].id, qty: 1 }, { productId: s.products[1].id, qty: 1 }]; });
  near(SC.commitLog(s, d).log.caffeine, 20 + 40);
});

console.log('R16 cost');
test('cost per cup within 1%; unpriced flagged, not zero', () => {
  const s = pantry([{ category: 'matcha', sealed: 1, price: 600, size: 30 }, { category: 'milk', name: 'M', size: 1000, sealed: 1, price: 85 }]);
  const r = SC.commitLog(s, logDraft(s, 'r_matcha_latte')); const exp = 2 * 600 / 30 + 150 * 85 / 1000;
  assert.ok(Math.abs(r.log.cost - exp) / exp < 0.01); assert.strictEqual(r.log.costUnknown, false);
  const s2 = pantry([{ category: 'matcha', sealed: 1, price: 600, size: 30 }, { category: 'milk', name: 'M', size: 1000, sealed: 1 }]);
  const r2 = SC.commitLog(s2, logDraft(s2, 'r_matcha_latte')); assert.strictEqual(r2.log.costUnknown, true); near(r2.log.cost, 40);
  const m = SC.monthSummary(s2, 'all', TODAY.slice(0, 7)); assert.strictEqual(m.cups, 1); assert.strictEqual(m.unknownCost, 1);
});
test('monthly summary matches the log (spend, cups, favorite)', () => {
  const s = pantry([{ category: 'matcha', sealed: 3, price: 300, size: 30 }, { category: 'milk', name: 'M', size: 1000, sealed: 3, price: 100 }, { category: 'hojicha', name: 'H', size: 50, sealed: 1, price: 250 }]);
  let spend = 0;
  for (let i = 0; i < 3; i++) spend += SC.commitLog(s, logDraft(s, 'r_matcha_latte')).log.cost;
  spend += SC.commitLog(s, logDraft(s, 'r_hojicha_latte')).log.cost;
  const old = logDraft(s, 'r_matcha_latte', (x) => { x.ts = '2026-10-01T09:00'; }); SC.commitLog(s, old);
  const m = SC.monthSummary(s, 'all', '2026-11'); assert.strictEqual(m.cups, 4); near(m.spend, SC.round(spend, 2), 0.011); assert.strictEqual(m.favorite.name, 'Matcha latte');
});

console.log('R17 people');
test('deleting a person moves logs to Unassigned; household = sum of people + unassigned', () => {
  const s = pantry([{ category: 'matcha', sealed: 5 }, { category: 'milk', name: 'M', size: 1000, sealed: 5 }]);
  s.people.push({ id: 'p_b', name: 'B' }, { id: 'p_c', name: 'C' });
  [['p_me', 1], ['p_b', 2], ['p_c', 3]].forEach(([who, n]) => { for (let i = 0; i < n; i++) { const d = logDraft(s, 'r_matcha_latte'); d.personId = who; assert.ok(SC.commitLog(s, d).ok); } });
  const total = () => SC.dayCaffeine(s, 'all', TODAY); near(total(), 6 * 60);
  SC.deletePerson(s, 'p_c'); assert.strictEqual(SC.logsFor(s, 'none').length, 3);
  near(SC.dayCaffeine(s, 'p_me', TODAY) + SC.dayCaffeine(s, 'p_b', TODAY) + SC.dayCaffeine(s, 'none', TODAY), total());
  assert.ok(!SC.deletePerson(fresh(), 'p_me')); // cannot delete the last person
});
test('same drink by two people deducts identical stock', () => {
  const s = latteState(); s.people.push({ id: 'p_b', name: 'B' });
  const d1 = logDraft(s, 'r_matcha_latte'); SC.commitLog(s, d1); const a = SC.stockOf(s.products[0]).amount;
  const d2 = logDraft(s, 'r_matcha_latte'); d2.personId = 'p_b'; SC.commitLog(s, d2); near(a - SC.stockOf(s.products[0]).amount, 2);
});

console.log('R18 recount');
test('42 g recounted to 30 g shows -12 and stock becomes 30; caffeine/cost unchanged; undo restores 42', () => {
  const s = pantry([{ category: 'matcha', size: 40, sealed: 1, openMode: 'none', price: 400 }, { category: 'milk', name: 'M', size: 1000, sealed: 1 }]);
  const p = s.products[0]; p.open = { amount: 2, openedAt: TODAY }; near(SC.stockOf(p).amount, 42);
  const log = SC.commitLog(s, logDraft(s, 'r_matcha_latte')).log; near(SC.stockOf(p).amount, 40);
  p.open = { amount: 4, openedAt: TODAY }; near(SC.stockOf(p).amount, 44); // pretend 42 after log: set deterministic below
  p.sealed = 1; p.open = { amount: 2, openedAt: TODAY };
  const v = SC.validateRecount(p, { sealed: 0, openMode: 'amount', openAmount: 30 }, TODAY); assert.ok(v.ok);
  const pv = SC.recountPreview(p, v.value); near(pv.diff, -12);
  const cafBefore = log.caffeine, costBefore = log.cost;
  const adj = SC.applyRecount(s, p.id, v.value, TODAY + 'T10:00'); near(SC.stockOf(p).amount, 30);
  assert.strictEqual(log.caffeine, cafBefore); assert.strictEqual(log.cost, costBefore); assert.strictEqual(s.logs.length, 1);
  assert.strictEqual(s.adjustments.length, 1);
  assert.ok(SC.undoAdjustment(s, adj.id)); near(SC.stockOf(p).amount, 42); assert.strictEqual(s.adjustments.length, 0);
});
test('recount each product type; capsule; unknown -> known', () => {
  const s = capState(); const c = add(s, { category: 'capsule', brand: 'N', name: 'a', size: 10, sleeves: 2, system: 'original', intensity: 5 });
  let v = SC.validateRecount(c, { count: 7 }, TODAY); assert.ok(v.ok); near(SC.recountPreview(c, v.value).diff, -13); SC.applyRecount(s, c.id, v.value); assert.strictEqual(c.count, 7);
  const u = add(s, { category: 'matcha', sealed: 0, openMode: 'unknown' }); v = SC.validateRecount(u, { sealed: 0, openMode: 'half' }, TODAY); assert.ok(v.ok);
  assert.strictEqual(SC.recountPreview(u, v.value).diff, null); SC.applyRecount(s, u.id, v.value); near(SC.stockOf(u).amount, 15); assert.ok(!SC.stockOf(u).unknown);
  assert.ok(!SC.validateRecount(u, { sealed: 0, openMode: 'amount', openAmount: 31 }, TODAY).ok);
  assert.ok(!SC.validateRecount(u, { sealed: -1, openMode: 'none' }, TODAY).ok);
});
test('undo of a recount after later drinks keeps the net change correct', () => {
  const s = pantry([{ category: 'matcha', size: 40, sealed: 0, openMode: 'half' }, { category: 'milk', name: 'M', size: 1000, sealed: 1 }]);
  const p = s.products[0]; const v = SC.validateRecount(p, { sealed: 0, openMode: 'amount', openAmount: 10 }, TODAY);
  const adj = SC.applyRecount(s, p.id, v.value); SC.commitLog(s, logDraft(s, 'r_matcha_latte')); near(SC.stockOf(p).amount, 8);
  SC.undoAdjustment(s, adj.id); near(SC.stockOf(p).amount, 18);
});

console.log('R19 setup');
test('sample pantry loads and clearing leaves real data', () => {
  const s = fresh(); const real = add(s, { category: 'matcha', brand: 'Mine', name: 'Real', size: 30, sealed: 2 });
  assert.ok(SC.loadSample(s, TODAY)); assert.ok(s.products.length > 5); assert.ok(s.logs.length > 0);
  assert.ok(!SC.loadSample(s, TODAY));
  SC.clearSample(s); assert.strictEqual(s.products.length, 1); assert.strictEqual(s.products[0].id, real.id); assert.strictEqual(s.logs.length, 0); assert.strictEqual(s.machines.length, 0); assert.strictEqual(s.people.length, 1);
  assert.ok(!s.settings.sampleLoaded); assert.strictEqual(SC.stockOf(real).amount, 60);
});
test('sample pantry has stale products, unknown amount and a descale due', () => {
  const s = fresh(); SC.loadSample(s, TODAY);
  assert.ok(s.products.some((p) => { const f = SC.freshness(p, TODAY); return f && f.state === 'warn'; }));
  assert.ok(s.products.some((p) => SC.stockOf(p).unknown)); assert.ok(s.machines.some((m) => SC.descaleStatus(m, TODAY).due));
});
test('preset capsules carry system, intensity, size and caffeine', () => {
  SC.PRESETS.filter((p) => p.category === 'capsule').forEach((p) => { const f = SC.presetToForm(p); const r = SC.validateProductInput(f, { withStock: true }); assert.ok(r.ok, JSON.stringify(r.errors)); assert.ok(f.system && f.intensity && f.cupSize && f.caffeine > 0); });
  SC.PRESETS.filter((p) => p.category !== 'capsule').forEach((p) => { assert.ok(SC.validateProductInput(SC.presetToForm(p), { withStock: true }).ok, p.id); });
});

console.log('R22 export / import');
test('export then import gives identical data; corrupt files rejected', () => {
  const s = fresh(); SC.loadSample(s, TODAY); const txt = SC.exportData(s);
  assert.deepStrictEqual(SC.importData(txt), JSON.parse(JSON.stringify(s)));
  assert.ok(!/data:image|blob:/.test(txt));
  assert.throws(() => SC.importData('not json {'), /damaged|not a StockCup/);
  assert.throws(() => SC.importData(txt.slice(0, txt.length - 50)), /damaged/);
  assert.throws(() => SC.importData(txt.replace('"sealed":1', '"sealed":2')), /checksum|damaged/);
  assert.throws(() => SC.importData('{"app":"other","data":{}}'), /not a StockCup/);
  // well-formed checksum but invalid content
  const o = JSON.parse(txt); o.data.products[0].size = -5; o.checksum = SC.hash(JSON.stringify(o.data)); assert.throws(() => SC.importData(JSON.stringify(o)), /Invalid size/);
  const o2 = JSON.parse(txt); o2.data.products[0].category = 'wat'; o2.checksum = SC.hash(JSON.stringify(o2.data)); assert.throws(() => SC.importData(JSON.stringify(o2)), /Invalid category/);
  const o3 = JSON.parse(txt); o3.data.version = 99; o3.checksum = SC.hash(JSON.stringify(o3.data)); assert.throws(() => SC.importData(JSON.stringify(o3)), /version/);
});

console.log('R24 validation & performance');
test('20 invalid inputs are rejected and change no data', () => {
  const s = fresh(); const snap = JSON.stringify(s);
  const bad = [
    { category: 'matcha', brand: '', name: 'n', size: 30 }, { category: 'matcha', brand: 'b', name: '', size: 30 }, { category: 'matcha', brand: 'b', name: 'n', size: '' },
    { category: 'matcha', brand: 'b', name: 'n', size: -5 }, { category: 'matcha', brand: 'b', name: 'n', size: 0 }, { category: 'matcha', brand: 'b', name: 'n', size: 'abc' },
    { category: 'matcha', brand: 'b', name: 'n', size: 'NaN' }, { category: 'matcha', brand: 'b', name: 'n', size: 'Infinity' }, { category: 'matcha', brand: 'b', name: 'n', size: '1e5' },
    { category: 'matcha', brand: 'b', name: 'n', size: 30, sealed: -1 }, { category: 'matcha', brand: 'b', name: 'n', size: 30, sealed: 1.5 }, { category: 'matcha', brand: 'b', name: 'n', size: 30, sealed: 'x' },
    { category: 'matcha', brand: 'b', name: 'n', size: 30, price: -3 }, { category: 'matcha', brand: 'b', name: 'n', size: 30, price: 'free' }, { category: 'matcha', brand: 'b', name: 'n', size: 30, shelfLifeDays: 0 },
    { category: 'matcha', brand: 'b', name: 'n', size: 30, density: -1 }, { category: 'matcha', brand: 'b', name: 'n', size: 30, openMode: 'half', openDate: '2999-01-01' },
    { category: 'capsule', brand: 'b', name: 'n', size: 10, system: 'original', intensity: 99 }, { category: 'capsule', brand: 'b', name: 'n', size: 10, system: '', intensity: 5 },
    { category: 'capsule', brand: 'b', name: 'n', size: 10.5, system: 'original', intensity: 5 }, { category: 'nope', brand: 'b', name: 'n', size: 30 },
  ];
  assert.ok(bad.length >= 20);
  bad.forEach((f, i) => { const r = SC.addProduct(s, f, TODAY); assert.ok(!r.ok, 'case ' + i + ' ' + JSON.stringify(f)); assert.ok(Object.keys(r.errors).length > 0); });
  assert.strictEqual(JSON.stringify(s), snap);
  // log inputs
  const p = add(s, { category: 'milk', name: 'M', size: 1000, sealed: 1 }); add(s, { category: 'matcha', sealed: 1 });
  ['', '-5', 'abc', '0', 'NaN', '1e3x'].forEach((q) => { const d = logDraft(s, 'r_matcha_latte', (x) => { x.slots[1].parts[0].qty = q; }); assert.ok(!SC.evaluateLog(s, d).ok, 'qty ' + q); });
  const d = logDraft(s, 'r_matcha_latte', (x) => { x.servings = -1; }); assert.ok(!SC.evaluateLog(s, d).ok); void p;
  const before = JSON.stringify(s.products); SC.commitLog(s, logDraft(s, 'r_matcha_latte', (x) => { x.slots[1].parts[0].qty = 'abc'; })); assert.strictEqual(JSON.stringify(s.products), before);
});
test('stock never negative or NaN under random use', () => {
  const s = pantry([{ category: 'matcha', sealed: 1, size: 30 }, { category: 'milk', name: 'M', size: 1000, sealed: 1 }]);
  for (let i = 0; i < 300; i++) { const d = logDraft(s, 'r_matcha_latte'); d.allowShort = true; SC.commitLog(s, d); if (i % 7 === 0 && s.logs.length) SC.undoLog(s, s.logs[s.logs.length - 1].id); }
  s.products.forEach((p) => { const st = SC.stockOf(p); assert.ok(Number.isFinite(st.amount) && st.amount >= 0); assert.ok(p.sealed >= 0); });
});
test('500 products, 100 recipes, 1000 logs: calculations under 1 s', () => {
  const s = fresh(); const cats = ['matcha', 'milk', 'syrup', 'coffee', 'tonic', 'hojicha', 'icecream'];
  for (let i = 0; i < 500; i++) { const c = cats[i % cats.length]; const C = SC.CATEGORIES[c]; add(s, { category: c, brand: 'B' + i, name: c + i, size: C.size, sealed: 1 + (i % 4), openMode: i % 3 ? 'half' : 'none', openDate: SC.addDays(TODAY, -(i % 50)), price: 100 + i, dairy: i % 2 === 0 }); }
  s.machines.push(SC.makeMachine('O', 'original', TODAY));
  for (let i = 0; i < 40; i++) add(s, { category: 'capsule', brand: 'N' + i, name: 'c' + i, size: 10, sleeves: 5, system: 'original', intensity: 1 + (i % 12) });
  const base = s.recipes.slice(); for (let i = 0; i < 92; i++) { const r = SC.clone(base[i % 8]); r.id = 'x' + i; r.builtin = false; r.name = 'Copy ' + i; s.recipes.push(r); }
  assert.ok(s.recipes.length >= 100);
  s.people.push({ id: 'p2', name: 'Two' });
  const t0 = Date.now();
  for (let i = 0; i < 1000; i++) { const d = logDraft(s, base[i % 8].id); d.personId = i % 2 ? 'p2' : 'p_me'; d.ts = SC.addDays(TODAY, -(i % 60)) + 'T0' + (i % 10) + ':00'; d.allowShort = true; SC.commitLog(s, d); }
  const buildMs = Date.now() - t0;
  const t1 = Date.now();
  SC.suggest(s, {}, TODAY); SC.suggest(s, { dairyFree: true, serve: 'iced' }, TODAY); SC.lowStock(s); SC.monthSummary(s, 'all', TODAY.slice(0, 7)); SC.planCheck(s, s.recipes.slice(0, 20).map((r) => ({ recipeId: r.id, servings: 3 })));
  SC.evaluateLog(s, logDraft(s, 'r_flat_white')); SC.exportData(s);
  const ms = Date.now() - t1; console.log('       calc ' + ms + ' ms (building 1000 logs took ' + buildMs + ' ms), logs=' + s.logs.length);
  assert.ok(ms < 1000, 'took ' + ms);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
