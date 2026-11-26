// Product catalogue: data integrity, helper behaviour, and parser matching. Run: node tests/catalog.test.js
const assert = require('assert'); const SC = require('../src/core.js'); const CAT = require('../src/catalog.js'); const SCP = require('../src/parse.js');
let passed = 0, failed = 0; function test(n, fn) { try { fn(); passed++; console.log('  ok   ' + n); } catch (e) { failed++; console.log('  FAIL ' + n + '\n       ' + String(e.stack || e).split('\n').slice(0, 4).join('\n       ')); } }
const E = CAT.entries; const byName = (n) => E.find((e) => e.name === n);
console.log('catalogue data (' + E.length + ' entries, ' + CAT.allBrandNames().length + ' brands)');
test('ids are unique and names are clean; no duplicate brand + line + name', () => {
  assert.strictEqual(new Set(E.map((e) => e.id)).size, E.length); const keys = E.map((e) => [e.brand, e.line, e.name].join('|')); assert.strictEqual(new Set(keys).size, keys.length);
  E.forEach((e) => { ['brand', 'name', 'line'].forEach((k) => { assert.ok(typeof e[k] === 'string' && e[k] === e[k].trim() && e[k].length > 0 && e[k].length <= 60, e.id + ' ' + k); }); assert.ok(SC.CATEGORIES[e.category], e.id + ' category'); });
});
test('every entry (and every size it offers) produces a form the real validator accepts', () => {
  E.forEach((e) => {
    (e.sizes && e.sizes.length ? e.sizes : [undefined]).forEach((sz) => {
      const f = CAT.toForm(e, sz); if (f.size === '') f.size = SC.CATEGORIES[e.category].size; if (e.category === 'capsule') { if (f.intensity === '') f.intensity = 7; f.sleeves = 1; f.loose = 0; } else { f.sealed = 1; f.openMode = 'none'; }
      const r = SC.validateProductInput(f, { withStock: true, today: '2026-11-12' }); assert.ok(r.ok, e.id + ' size ' + sz + ' ' + JSON.stringify(r.errors));
    });
  });
});
test('numbers are real or absent: no placeholder zeros, sensible ranges, shots and systems valid', () => {
  E.forEach((e) => {
    if (e.sizes) { assert.ok(Array.isArray(e.sizes) && e.sizes.length > 0); e.sizes.forEach((s) => assert.ok(Number.isInteger(s) && s > 0 && s <= 5000, e.id + ' size ' + s)); }
    if (e.intensity !== undefined) assert.ok(Number.isInteger(e.intensity) && e.intensity >= 1 && e.intensity <= 13, e.id + ' intensity');
    if (e.cupSize !== undefined) assert.ok(e.cupSize > 0 && e.cupSize <= 600, e.id + ' cupSize'); if (e.caffeine !== undefined) assert.ok(e.caffeine >= 0 && e.caffeine <= 400, e.id + ' caffeine');
    if (e.category === 'capsule') { assert.ok(e.system === 'original' || e.system === 'vertuo', e.id + ' system'); assert.ok(Number.isInteger(e.shots) && e.shots >= 1 && e.shots <= 4, e.id + ' shots'); assert.ok(e.sizes && e.sizes.length, e.id + ' sleeve sizes'); } else assert.ok(!e.system && !e.intensity && !e.cupSize, e.id + ' capsule-only fields');
  });
});
test('anything not confirmed is declared in est (so the form can say "check your box"); est only names fields that exist', () => {
  E.forEach((e) => (e.est || []).forEach((k) => { assert.ok(['intensity', 'cupSize', 'caffeine', 'name'].includes(k), e.id + ' ' + k); if (k !== 'name') assert.ok(e[k] !== undefined, e.id + ' est ' + k + ' but no value'); }));
  assert.ok(!byName('Capriccio').est && byName('Capriccio').intensity === 5, 'confirmed value has no est flag'); assert.strictEqual(byName('Ristretto').intensity, undefined, 'conflicting sources: left blank');
  assert.ok(E.filter((e) => e.category === 'capsule' && e.system === 'vertuo').every((e) => e.intensity === undefined), 'no invented Vertuo intensities');
  assert.ok(/approximate/.test(CAT.hint(byName('Livanto'))) && /typical/.test(CAT.hint(byName('Wako'))) && CAT.hint(byName('Capriccio')) === '' && CAT.hint(null) === '');
});
test('no brand alias contains a generic word (it would make unrelated text look like that brand)', () => {
  const generic = ['matcha', 'tea', 'coffee', 'syrup', 'capsule', 'capsules', 'beans', 'powder', 'hojicha']; CAT.allBrandNames().forEach((b) => [b].concat(CAT.brandInfo[b].aliases).forEach((a) => a.toLowerCase().split(/[^a-z]+/).forEach((w) => { assert.ok(!generic.includes(w), b + ' alias "' + a + '" contains "' + w + '"'); })));
});
test('every brand has entries and its categories match them', () => {
  CAT.allBrandNames().forEach((b) => { const es = E.filter((e) => e.brand === b); assert.ok(es.length, b); const cats = new Set(es.map((e) => e.category)); CAT.brandInfo[b].categories.forEach((c) => assert.ok(cats.has(c), b + ' declares ' + c + ' but has none')); cats.forEach((c) => assert.ok(CAT.brandInfo[b].categories.includes(c), b + ' has ' + c + ' undeclared')); });
  ['Nespresso', 'Marukyu Koyamaen', 'Yamamasa Koyamaen', 'Ippodo', 'Aiya', 'Lavazza', 'illy', 'Starbucks', 'Twinings', 'Top Creamery', 'Kumatcha'].forEach((b) => assert.ok(CAT.brandInfo[b], b));
  ['Isuzu', 'Aoarashi', 'Yugen', 'Wako', 'Kinrin', 'Chigi no Shiro'].forEach((n) => assert.strictEqual(byName(n).brand, 'Marukyu Koyamaen'));
});
test('Yamamasa Koyamaen and Top Creamery are present with only what was seen in listings or supplied by the user', () => {
  assert.deepStrictEqual(CAT.products('Yamamasa Koyamaen', 'matcha')[0].items.map((e) => e.name), ['Matsukaze', 'Ogurayama', 'Samidori', 'Yomo no Kaori', 'Tennouzan', 'Wakakusa']);
  assert.deepStrictEqual([byName('Matsukaze').sizes, byName('Matsukaze').sizesTypical], [[30, 100], false]); assert.strictEqual(byName('Samidori').sizesTypical, true);
  const top = CAT.products('Top Creamery', 'syrup'); assert.deepStrictEqual(top.map((g) => g.line), ['Classic and dessert', 'Sugar', 'Fruit', 'Tea, floral, herbal and spice', 'More']);
  // the shop's own price list (49 syrups, supplied by the user) must all be there, in 750 ml; three more were seen on their website
  const priceList = ['Creamy Coconut', 'Espresso', 'Jasmine Tea', 'Almond', 'Caramel', 'Creamy Vanilla', 'Cheesecake', 'Chocolate', 'Crème Brûlée', 'Cookie Dough', 'French Vanilla', 'Hazelnut', 'Salted Caramel', 'Tiramisu', 'White Chocolate', 'Brown Sugar', 'Muscovado', 'Sugar',
    'Banana', 'Blueberry', 'Cucumber', 'Green Apple', 'Hibiscus', 'Kiwi', 'Lemon', 'Lychee', 'Mango', 'Orange', 'Passion Fruit', 'Peach Mango', 'Peach', 'Philippine Mango', 'Raspberry', 'Strawberry', 'Sweet Grapes', 'Watermelon', 'Wintermelon', 'Yuzu',
    'Blue Curacao', 'Grenadine', 'Lavender', 'Lemongrass', 'Peppermint', 'Spearmint', 'Ube', 'Cinnamon', 'Pumpkin Spice', 'Rose', 'Yogurt'];
  const have = top.reduce((a, g) => a.concat(g.items), []); assert.strictEqual(priceList.length, 49); priceList.forEach((n) => assert.ok(have.some((e) => e.name === n), 'price list item ' + n));
  ['Green Mango', 'Macadamia Nut', 'Cane Sugar'].forEach((n) => assert.ok(have.some((e) => e.name === n), n)); assert.strictEqual(have.length, 52); assert.strictEqual(new Set(have.map((e) => e.name)).size, 52);
  assert.ok(have.every((e) => e.sizes.includes(750) && e.sizesConfirmed && !e.sizesTypical && e.category === 'syrup'));
  assert.deepStrictEqual(byName('Caramel').sizes, [750, 250]); assert.deepStrictEqual(byName('Hazelnut').sizes, [750]); assert.strictEqual(CAT.toForm(byName('Hazelnut')).size, 750, 'one confirmed size is filled in');
  assert.strictEqual(CAT.toForm(byName('Caramel')).size, '', 'two sizes: the user chooses'); assert.strictEqual(CAT.toForm(byName('Hazelnut')).unit, 'ml');
});
test('Kumatcha: exactly the 26 products from the shop, none matched on the name alone', () => {
  const names = ['Okashi', 'Honmei', 'Mitsu', 'Haru', 'Kanaya Midori', 'Okumidori 2.0', 'Okumidori', 'Aki', 'Kirei', 'Yugen', 'Koi', 'Asahi', 'Samidori', 'Uji Hikari', 'Kasumi', 'Oyatsu', 'Sayamakaori', 'Yutakamidori', 'Ren', 'Uji No Mukashi', 'Yabukita', 'Sora', 'Tsuki', 'Gokou', 'Kirari 31', 'Wet Market Exclusive'];
  const ks = E.filter((e) => e.brand === 'Kumatcha'); assert.deepStrictEqual(ks.map((e) => e.name), names); assert.ok(ks.every((e) => e.category === 'matcha' && !e.sizesTypical && e.sizesConfirmed && !e.distinct && !e.intensity));
  ks.forEach((e) => assert.deepStrictEqual(e.sizes, ['Honmei', 'Yabukita'].includes(e.name) ? [30, 100] : [30], e.name + ' sizes'));
  assert.strictEqual(CAT.toForm(ks.find((e) => e.name === 'Haru')).size, 30, 'the single 30 g tin is filled in'); assert.strictEqual(CAT.toForm(ks.find((e) => e.name === 'Honmei')).size, '', 'two sizes: the user chooses'); assert.strictEqual(CAT.hint(ks[0]), '', 'nothing to double-check');
  assert.strictEqual(E.filter((e) => e.name === 'Yugen').length, 2, 'shared with Marukyu Koyamaen, kept apart by brand');
});
console.log('dropdown helpers');
test('capsule brands and flavours follow the machines owned', () => {
  const o = new Set(['original']), v = new Set(['vertuo']), both = new Set(['original', 'vertuo']), none = new Set();
  assert.deepStrictEqual(CAT.brands('capsule', { systems: o }), ['Nespresso']); assert.deepStrictEqual(CAT.brands('capsule', { systems: none }), []);
  const lines = (s) => CAT.products('Nespresso', 'capsule', { systems: s }).map((g) => g.line);
  assert.ok(lines(o).length >= 4 && lines(o).every((l) => /^Original/.test(l))); assert.ok(lines(v).length >= 4 && lines(v).every((l) => /^Vertuo/.test(l))); assert.strictEqual(lines(both).length, lines(o).length + lines(v).length);
  const sys = (b, c, set) => CAT.systemsFor(b, c, set ? { systems: set } : {}).map((x) => x.system + ':' + x.label);
  assert.deepStrictEqual(sys('Nespresso', 'capsule', both), ['original:Original', 'vertuo:Vertuo']); assert.deepStrictEqual(sys('Nespresso', 'capsule', o), ['original:Original']); assert.deepStrictEqual(sys('Nespresso', 'capsule', v), ['vertuo:Vertuo']); assert.deepStrictEqual(sys('Nespresso', 'capsule', none), []); assert.deepStrictEqual(sys('Nespresso', 'capsule'), ['original:Original', 'vertuo:Vertuo']);
  assert.deepStrictEqual(sys('Marukyu Koyamaen', 'matcha', both), [], 'matcha has no machine step'); assert.deepStrictEqual(sys('Lavazza', 'coffee'), []);
  assert.deepStrictEqual(CAT.products('Nespresso', 'capsule', { systems: o }).map((g) => CAT.lineLabel(g.line)), ['Classics', 'Ispirazione', 'Master Origins', 'Decaffeinato']); assert.ok(CAT.products('Nespresso', 'capsule', { systems: v }).map((g) => CAT.lineLabel(g.line)).every((l) => !/^(Original|Vertuo)/.test(l)));
  assert.strictEqual(CAT.lineLabel('Vertuo · Mug (230 ml)'), 'Mug (230 ml)'); assert.strictEqual(CAT.lineLabel('Sugar'), 'Sugar');
  assert.deepStrictEqual(CAT.brands('matcha'), ['Aiya', 'Ippodo', 'Kumatcha', 'Marukyu Koyamaen', 'Yamamasa Koyamaen']); assert.deepStrictEqual(CAT.products('Marukyu Koyamaen', 'matcha')[0].items.map((e) => e.name), ['Isuzu', 'Aoarashi', 'Yugen', 'Wako', 'Kinrin', 'Chigi no Shiro']);
  assert.deepStrictEqual(CAT.products('Marukyu Koyamaen', 'milk'), []);
});
test('choosing a product fills the form but never pre-selects a size that is only "typical"', () => {
  const wako = CAT.toForm(byName('Wako')); assert.strictEqual(wako.brand, 'Marukyu Koyamaen'); assert.strictEqual(wako.name, 'Wako'); assert.strictEqual(wako.size, ''); assert.strictEqual(wako.category, 'matcha'); assert.strictEqual(CAT.toForm(byName('Wako'), 40).size, 40);
  assert.strictEqual(CAT.toForm(byName('Aiya') || E.find((e) => e.brand === 'Aiya' && /Culinary/.test(e.name))).size, 100, 'one confirmed size is filled in');
  const liv = CAT.toForm(byName('Livanto')); assert.deepStrictEqual([liv.name, liv.system, liv.size, liv.intensity, liv.shots], ['Original Livanto', 'original', 10, 6, 1]);
  const ris = CAT.toForm(byName('Ristretto')); assert.strictEqual(ris.intensity, ''); assert.strictEqual(ris.cupSize, 25); const mel = CAT.toForm(byName('Melozio')); assert.deepStrictEqual([mel.system, mel.size, mel.intensity], ['vertuo', '', '']);
  const dbl = CAT.toForm(byName('Double Espresso Scuro')); assert.strictEqual(dbl.shots, 2); assert.strictEqual(dbl.cupSize, 80); assert.strictEqual(CAT.toForm(byName('Pure Camomile')).caffeine, 0);
});
console.log('parsers use the catalogue');
const st = SC.defaultState(); const row = (l) => SCP.parseProductLine(l, st);
test('typed lines and labels find catalogue products, sizes and quantities', () => {
  const cases = [['Marukyu Koyamaen Wako 40g', ['matcha', 'Marukyu Koyamaen', 'Wako', 40, 1]], ['Wako matcha 40g', ['matcha', 'Marukyu Koyamaen', 'Wako', 40, 1]], ['Ippodo Ummon 40g x2', ['matcha', 'Ippodo', 'Ummon-no-mukashi', 40, 2]],
    ['Aiya organic ceremonial matcha 30g', ['matcha', 'Aiya', 'Organic Ceremonial Grade', 30, 1]], ['Nespresso Vertuo Melozio 10 caps', ['capsule', 'Nespresso', 'Vertuo Melozio', 10, 1]], ['Lavazza Super Crema 1kg', ['coffee', 'Lavazza', 'Super Crema', 1000, 1]],
    ['illy Classico beans 250g', ['coffee', 'illy', 'Classico', 250, 1]], ['Starbucks Pike Place 12oz', ['coffee', 'Starbucks', 'Pike Place Roast', 340, 1]], ['Twinings English Breakfast 50 bags', ['tea', 'Twinings', 'English Breakfast', 100, 1]]];
  cases.forEach(([line, exp]) => { const r = row(line); assert.deepStrictEqual([r.category, r.brand, r.name, r.size, r.packs], exp, line); });
  const p = SCP.parsePhotoLabel('Marukyu Koyamaen\nWAKO\nMatcha\nNet 40 g', st); assert.deepStrictEqual([p.category, p.brand, p.name, p.size], ['matcha', 'Marukyu Koyamaen', 'Wako', 40]);
});
test('Yamamasa and Top Creamery lines are recognised; generic flavour words are not claimed by a brand', () => {
  const cases = [['Yamamasa Koyamaen Matsukaze 30g', ['matcha', 'Yamamasa Koyamaen', 'Matsukaze', 30]], ['Matsukaze matcha 100g', ['matcha', 'Yamamasa Koyamaen', 'Matsukaze', 100]], ['Koyamaen Wako 40g', ['matcha', 'Marukyu Koyamaen', 'Wako', 40]],
    ['TOP Series Caramel Syrup 750ml', ['syrup', 'Top Creamery', 'Caramel', 750]], ['Top Creamery Peach Mango 750ml', ['syrup', 'Top Creamery', 'Peach Mango', 750]], ['Top Creamery Mango syrup 750ml', ['syrup', 'Top Creamery', 'Mango', 750]], ['Top Creamery Ube 750ml', ['syrup', 'Top Creamery', 'Ube', 750]], ['Top Creamery Crème Brûlée 750ml', ['syrup', 'Top Creamery', 'Crème Brûlée', 750]], ['Top Creamery Classique Hazelnut syrup 750ml', ['syrup', 'Top Creamery', 'Hazelnut', 750]], ['Top Creamery Creamy Vanilla 250ml', ['syrup', 'Top Creamery', 'Creamy Vanilla', 250]]];
  cases.forEach(([l, exp]) => { const r = row(l); assert.deepStrictEqual([r.category, r.brand, r.name, r.size], exp, l); });
  [['Kumatcha Haru 30g', ['Kumatcha', 'Haru', 30]], ['Kumatcha Okumidori 2.0 30g', ['Kumatcha', 'Okumidori 2.0', 30]], ['Kumatcha Okumidori 30g', ['Kumatcha', 'Okumidori', 30]], ['Kumatcha Haru', ['Kumatcha', 'Haru', 30]], ['Kumatcha Honmei 100g', ['Kumatcha', 'Honmei', 100]], ['Shop Kumatcha Yabukita 100g', ['Kumatcha', 'Yabukita', 100]],
    ['Kumatcha Yugen 30g', ['Kumatcha', 'Yugen', 30]], ['Marukyu Koyamaen Yugen 40g', ['Marukyu Koyamaen', 'Yugen', 40]], ['Kumatcha Kirari 31 30g', ['Kumatcha', 'Kirari 31', 30]]].forEach(([l, exp]) => { const r = row(l); assert.deepStrictEqual([r.brand, r.name, r.size], exp, l); });
  ['Haru matcha 30g', 'Yugen matcha 40g', 'Samidori matcha 30g', 'Koi matcha 20g', 'Hojicha tea 80g', 'Green tea 100g'].forEach((l) => assert.ok(!row(l).catalogId, l + ' is ambiguous or generic: no brand is assumed'));
  const g = row('Chocolate syrup 250ml'); assert.ok(!g.catalogId && g.brand !== 'Top Creamery', 'a plain chocolate syrup is not assumed to be Top Creamery'); assert.ok(!row('Mango syrup 750ml').catalogId, 'nor a plain mango syrup');
  assert.ok(row('Caramel syrup 750ml').presetId, 'the generic caramel preset still wins');
});
test('existing products and presets still win where they overlap (no behaviour change for what already worked)', () => {
  assert.ok(row('Nespresso Livanto 10 caps x3').presetId && !row('Nespresso Livanto 10 caps x3').catalogId); const s = SC.defaultState(); SC.addProduct(s, { category: 'matcha', brand: 'Marukyu Koyamaen', name: 'Wako', size: 40, sealed: 1, openMode: 'none' }, '2026-11-12');
  const r = SCP.parseProductLine('Marukyu Koyamaen Wako 40g', s); assert.ok(r.matchedProductId, 'your own product is matched first');
});
test('a capsule intensity is never guessed: blank when unknown, filled when known, and the confirm form reports it', () => {
  const f = SCP.rowToForm(row('Nespresso Vertuo Melozio 10 caps')); assert.strictEqual(f.intensity, ''); assert.ok(!SC.validateProductInput(f, { withStock: true, today: '2026-11-12' }).ok);
  const g = SCP.rowToForm(Object.assign(row('Nespresso Vertuo Melozio 10 caps'), { intensity: 7 })); assert.strictEqual(g.intensity, 7); assert.ok(SC.validateProductInput(g, { withStock: true, today: '2026-11-12' }).ok);
  assert.strictEqual(SCP.rowToForm(row('Nespresso Livanto 10 caps')).intensity, 6); assert.strictEqual(row('Nespresso Livanto 10 caps').intensity, 6);
  const typed = SCP.rowToForm(row('Nespresso Mystery 10 caps')); assert.strictEqual(typed.intensity, '', 'a capsule we know nothing about is not given a made-up intensity');
});
test('unrelated text is not mistaken for a catalogue product', () => {
  ['Bread loaf 55.00', 'Wako Bakery 3 for 100', 'India ink 100ml', 'Classic soap 250g', 'Colombia coffee beans 250g'].forEach((l) => { const r = row(l); assert.ok(!r.catalogId || /Colombia/.test(l) === false, l + ' -> ' + r.catalogId); });
  assert.strictEqual(row('Colombia coffee beans 250g').category, 'coffee'); assert.ok(!row('Colombia coffee beans 250g').catalogId, 'a coffee bean line is not the Nespresso Colombia capsule');
});
console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
