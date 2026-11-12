// Parser accuracy checks (R20, R21). Run: node tests/parse.test.js
// NOTE: these corpora are synthetic, written to look like typed input / receipt OCR / video text.
// The PRD's real-world evidence (10 real receipts, 10 real screenshots) still has to be collected on a device.
const assert = require('assert');
const SC = require('../src/core.js');
const SCP = require('../src/parse.js');
let failed = 0;
function check(name, fn) { try { fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }
const state = SC.defaultState();

// ---- R20: quick-add lines (target >= 80%) ----
const quick = [
  ['Brand A matcha 30g x2', { category: 'matcha', size: 30, unit: 'g', packs: 2, brand: 'Brand A' }],
  ['Oatly Barista oat milk 1L', { category: 'milk', size: 1000, unit: 'ml', packs: 1, brand: 'Oatly' }],
  ['Nespresso Livanto 10 caps x3', { category: 'capsule', size: 10, packs: 3, brand: 'Nespresso' }],
  ['Nespresso Vertuo Forte 2 sleeves', { category: 'capsule', size: 10, packs: 2 }],
  ['Torani vanilla syrup 750ml @ 450', { category: 'syrup', size: 750, unit: 'ml', price: 450, brand: 'Torani' }],
  ['Generic whole milk 1L x2', { category: 'milk', size: 1000, unit: 'ml', packs: 2 }],
  ['Ippodo ceremonial matcha 40g', { category: 'matcha', size: 40, unit: 'g', brand: 'Ippodo' }],
  ['2 x Hojicha powder 50g', { category: 'hojicha', size: 50, unit: 'g', packs: 2 }],
  ['Espresso beans 250g', { category: 'coffee', size: 250, unit: 'g' }],
  ['Schweppes tonic water 1L', { category: 'tonic', size: 1000, unit: 'ml', brand: 'Schweppes' }],
  ['Nespresso Original Ristretto 3 sleeves and 4 loose', { category: 'capsule', sleeves: 3, loose: 4 }],
  ['Alpro soy milk 1 liter', { category: 'milk', size: 1000, unit: 'ml', brand: 'Alpro' }],
  ['Blue Bottle coffee beans 340g x1', { category: 'coffee', size: 340, unit: 'g', packs: 1, brand: 'Blue Bottle' }],
  ['vanilla ice cream 450 g', { category: 'icecream', size: 450, unit: 'g' }],
  ['Marukyu Koyamaen matcha 100g x3 @ 1200', { category: 'matcha', size: 100, packs: 3, price: 1200, brand: 'Marukyu Koyamaen' }],
  ['Almond milk 946ml', { category: 'milk', size: 946, unit: 'ml' }],
];
check('quick-add: at least 80% of typed lines fully correct', () => {
  let ok = 0; const bad = [];
  quick.forEach(([line, exp]) => {
    const r = SCP.parseProductLine(line, state); let good = !!r;
    if (r) Object.keys(exp).forEach((k) => { if (k === 'brand' ? String(r.brand).toLowerCase() !== exp.brand.toLowerCase() : r[k] !== exp[k]) good = false; });
    if (good) ok++; else bad.push(line + ' -> ' + JSON.stringify(r && [r.category, r.brand, r.size, r.unit, r.packs, r.sleeves, r.loose, r.price]));
  });
  console.log('       quick-add ' + ok + '/' + quick.length + (bad.length ? '\n       ' + bad.join('\n       ') : ''));
  assert.ok(ok / quick.length >= 0.8);
});
check('quick-add rows save only through validation; nothing saved by parsing', () => {
  const s = SC.defaultState(); const rows = SCP.parseQuickAdd('Brand A matcha 30g x2\nOatly oat milk 1L', s);
  assert.strictEqual(rows.length, 2); assert.strictEqual(s.products.length, 0);
  const f = SCP.rowToForm(rows[0]); const r = SC.addProduct(s, f, '2026-11-12'); assert.ok(r.ok, JSON.stringify(r.errors)); assert.strictEqual(SC.stockOf(r.product).amount, 60);
  const f2 = SCP.rowToForm(Object.assign({}, rows[1], { brand: '' })); assert.ok(!SC.addProduct(s, f2, '2026-11-12').ok);
  assert.strictEqual(s.products.length, 1);
});
check('a matched capsule preset fills system, intensity, caffeine', () => {
  const r = SCP.parseProductLine('Nespresso Vertuo Double Espresso Scuro 2 sleeves', state); const f = SCP.rowToForm(r);
  assert.strictEqual(f.system, 'vertuo'); assert.strictEqual(f.shots, 2); assert.ok(f.intensity); assert.strictEqual(f.caffeine, 126);
});

// ---- R20: receipts (target >= 70% of relevant items) ----
const receipts = [
  { text: 'SM SUPERMARKET\nOATLY BARISTA 1L          285.00\n2 x MATCHA POWDER 30G   450.00  900.00\nTOTAL   1185.00\nCASH 1200.00\nBREAD LOAF 55.00', items: [['milk', 1000, 1], ['matcha', 30, 2]] },
  { text: 'GROCERY MART\nFRESH MILK 1L 98.50\nNESPRESSO LIVANTO 10S 245.00\nTOTAL 343.50\nTHANK YOU', items: [['milk', 1000, 1], ['capsule', 10, 1]] },
  { text: 'Cafe Supplies Ltd\nHojicha powder 50g  $12.90\nVanilla syrup 750ml  $9.50\nSubtotal $22.40\nVAT $2.69', items: [['hojicha', 50, 1], ['syrup', 750, 1]] },
  { text: 'MARKET\nTONIC WATER 500ML 65.00\nEspresso beans 250g 420.00\nSOY MILK 1L 110.00\nCHANGE 0.00', items: [['tonic', 500, 1], ['coffee', 250, 1], ['milk', 1000, 1]] },
  { text: 'Tea Shop\nCeremonial matcha 40g x2  3,200.00\nBamboo whisk 650.00\nTotal 3,850.00', items: [['matcha', 40, 2]] },
  { text: 'FOODSTORE 22\n3 NESPRESSO VERTUO FORTE 10S 195.00\nVANILLA ICE CREAM 450G 189.00\nTOTAL 774.00', items: [['capsule', 10, 3], ['icecream', 450, 1]] },
  { text: 'DAILY MART\nOAT MILK 1L   175.00\nCARAMEL SYRUP 750ML   320.00\nCOFFEE GROUND 250G   280.00\nCARD **** 4421', items: [['milk', 1000, 1], ['syrup', 750, 1], ['coffee', 250, 1]] },
  { text: 'Whole Foods\nALMOND MILK 946ML 3.99\nMATCHA CULINARY 100G 14.99\nSubtotal 18.98\nTax 1.52\nTotal 20.50', items: [['milk', 946, 1], ['matcha', 100, 1]] },
  { text: 'SUPERMART\nGELATO VANILLA 500G 220.00\nHOJICHA TEA POWDER 40G 380.00\nCASH 600.00', items: [['icecream', 500, 1], ['hojicha', 40, 1]] },
  { text: 'KITCHEN CO\nLactose free milk 1 L 2 x 115.00 230.00\nNespresso Roma 10 caps 240.00\nDiscount -10.00\nTOTAL 460.00', items: [['milk', 1000, 2], ['capsule', 10, 1]] },
];
check('receipts: at least 70% of relevant items found with correct category, size and quantity', () => {
  let found = 0, total = 0, falsePos = 0; const miss = [];
  receipts.forEach((rc) => {
    const out = SCP.parseReceipt(rc.text, state); total += rc.items.length;
    const used = new Set();
    rc.items.forEach(([cat, size, qty]) => {
      const i = out.rows.findIndex((r, idx) => !used.has(idx) && r.category === cat && r.size === size && r.packs === qty);
      if (i >= 0) { used.add(i); found++; } else miss.push(cat + ' ' + size + ' x' + qty + ' in ' + JSON.stringify(rc.text.split('\n')[1]));
    });
    falsePos += out.rows.length - used.size;
  });
  console.log('       receipt items ' + found + '/' + total + ', false positives ' + falsePos + (miss.length ? '\n       missed: ' + miss.join('\n       missed: ') : ''));
  assert.ok(found / total >= 0.7);
});

// ---- R21: pasted recipe text (target >= 75% of lines) ----
const texts = [
  { t: 'Iced Dirty Matcha\nIngredients\n- 2 tsp matcha\n- 1 double espresso\n- 150ml oat milk\n- ice\n- 40 ml water (80°C)\nSteps\n1. Whisk matcha with water\n2. Pour over ice and milk\n3. Top with espresso\nhttps://www.tiktok.com/@x/video/1',
    ing: [['matcha', 2, 'tsp'], ['espresso', 2, 'shot'], ['milk', 150, 'ml']], ice: true, water: 40, steps: 3, link: true },
  { t: 'Strawberry matcha latte\n2 g matcha\n120 ml milk\n1 tbsp strawberry syrup\nice\nWhisk the matcha with hot water.\nAdd syrup and milk to a glass with ice.\nPour matcha on top.',
    ing: [['matcha', 2, 'g'], ['milk', 120, 'ml'], ['syrup', 1, 'tbsp']], ice: true, steps: 3 },
  { t: 'Ingredients: 1 shot espresso, 150 ml tonic water, ice\nMethod:\n1) Fill a glass with ice\n2) Add tonic\n3) Pour espresso on top', ing: [['espresso', 1, 'shot'], ['tonic', 150, 'ml']], ice: true, steps: 3 },
  { t: 'Hojicha latte\nIngredients:\n2 tsp hojicha powder\n1 cup oat milk\n1/2 tbsp honey\nInstructions:\nWhisk hojicha with 60ml hot water\nHeat the milk and pour over', ing: [['hojicha', 2, 'tsp'], ['milk', 1, 'cup'], ['syrup', 0.5, 'tbsp']], steps: 2 },
  { t: '2 tsp matcha\n1 1/2 cups milk\n2 tbsp vanilla syrup\nice', ing: [['matcha', 2, 'tsp'], ['milk', 1.5, 'cup'], ['syrup', 2, 'tbsp']], ice: true },
  { t: 'Affogato\nIngredients\n100 g vanilla ice cream\n1 single espresso\nSteps\nScoop ice cream into a glass\nPour hot espresso over it', ing: [['icecream', 100, 'g'], ['espresso', 1, 'shot']], steps: 2 },
  { t: 'Cold brew\n25 g coffee grounds\n300 ml cold water\nStir and steep 12 hours in the fridge\nStrain and serve over ice', ing: [['coffee', 25, 'g']], water: 300, ice: true, steps: 2 },
  { t: 'Makes 2\n4 g matcha\n300 ml oat milk\n2 espresso shots\nice', ing: [['matcha', 4, 'g'], ['milk', 300, 'ml'], ['espresso', 2, 'shot']], servings: 2, ice: true },
  { t: 'Ingredients\n3oz milk\n2 capsules espresso\n1 tsp sugar\nSteps\n1. Brew espresso\n2. Add steamed milk', ing: [['milk', 88.7, 'ml'], ['espresso', 2, 'shot'], ['syrup', 1, 'tsp']], steps: 2 },
  { t: '2 tsp\nmatcha powder\n150 ml\nalmond milk\nice cubes', ing: [['matcha', 2, 'tsp'], ['milk', 150, 'ml']], ice: true },
];
check('recipe text: at least 75% of lines parsed correctly', () => {
  let ok = 0, total = 0; const bad = [];
  texts.forEach((x, n) => {
    const out = SCP.parseRecipeText(x.t);
    x.ing.forEach(([type, amt, unit]) => {
      total++; const r = out.ingredients.find((i) => i.type === type && Math.abs((i.amount || 0) - amt) < 0.5 && i.unit === unit);
      if (r) ok++; else bad.push('#' + n + ' ' + type + ' ' + amt + unit + ' not found in ' + JSON.stringify(out.ingredients.map((i) => [i.type, i.amount, i.unit])));
    });
    if (x.ice !== undefined) { total++; if (out.ice === x.ice) ok++; else bad.push('#' + n + ' ice'); }
    if (x.water) { total++; if (out.water && out.water.ml === x.water) ok++; else bad.push('#' + n + ' water ' + JSON.stringify(out.water)); }
    if (x.steps) { total++; if (out.steps.length >= x.steps) ok++; else bad.push('#' + n + ' steps ' + out.steps.length); }
    if (x.link) { total++; if (out.link) ok++; else bad.push('#' + n + ' link'); }
    if (x.servings) { total++; if (out.servings === x.servings) ok++; else bad.push('#' + n + ' servings'); }
  });
  console.log('       recipe lines ' + ok + '/' + total + (bad.length ? '\n       ' + bad.join('\n       ') : ''));
  assert.ok(ok / total >= 0.75);
});
check('"Double espresso" becomes 2 shots', () => {
  const r = SCP.parseIngredientLine('1 double espresso'); assert.strictEqual(r.amount, 2); assert.strictEqual(r.unit, 'shot');
  const r2 = SCP.parseIngredientLine('double espresso'); assert.strictEqual(r2.amount, 2);
  const r3 = SCP.parseIngredientLine('single shot espresso'); assert.strictEqual(r3.amount, 1);
});
check('"A splash" cannot be saved without a number', () => {
  const d = SCP.parseRecipeText('Test drink\n2 g matcha\n150 ml milk\na splash of vanilla syrup\nWhisk and pour over the milk and serve it.');
  const splash = d.ingredients.find((i) => i.type === 'syrup'); assert.ok(splash.vague); assert.strictEqual(splash.amount, null);
  const draft = { name: 'Test drink', serve: 'hot', servings: 1, ingredients: d.ingredients.map((i) => ({ type: i.type, amount: i.amount, unit: i.unit })), steps: d.steps };
  const res = SCP.draftToRecipe(draft); assert.ok(!res.ok); assert.ok(res.errors.some((e) => /number/i.test(e.msg)));
  draft.ingredients[2].amount = 10; draft.ingredients[2].unit = 'ml'; assert.ok(SCP.draftToRecipe(draft).ok);
  ['', 'abc', '-3', '0', 'NaN'].forEach((v) => { draft.ingredients[2].amount = v; assert.ok(!SCP.draftToRecipe(draft).ok, 'amount ' + v); });
});
check('amounts convert to per-serving; link is kept only as a note; no image data anywhere', () => {
  const d = SCP.parseRecipeText('Makes 2\n4 g matcha\n300 ml oat milk\n2 espresso shots\nhttps://example.com/v/1');
  const res = SCP.draftToRecipe({ name: 'X', serve: 'iced', servings: d.servings, ingredients: d.ingredients.map((i) => ({ type: i.type, amount: i.amount, unit: i.unit, dairyPossible: i.dairyPossible })), sourceLink: d.link, steps: [] });
  assert.ok(res.ok, JSON.stringify(res.errors)); const r = res.recipe;
  assert.strictEqual(r.ingredients.find((i) => i.type === 'matcha').amount, 2); assert.strictEqual(r.ingredients.find((i) => i.type === 'milk').amount, 150); assert.strictEqual(r.ingredients.find((i) => i.type === 'espresso').amount, 1);
  assert.strictEqual(r.sourceLink, 'https://example.com/v/1'); assert.ok(!/data:image|blob:/.test(JSON.stringify(r)));
});
check('parsing speed is far below the 15 s per screenshot budget (text stage)', () => {
  const t0 = Date.now(); for (let i = 0; i < 200; i++) SCP.parseRecipeText(texts[i % texts.length].t); assert.ok(Date.now() - t0 < 2000);
});

console.log(failed ? '\n' + failed + ' failed' : '\nall parser checks passed'); process.exit(failed ? 1 : 0);
