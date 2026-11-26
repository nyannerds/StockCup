// Brand -> product -> size dropdowns in the add-product form, in a real browser at phone width. Run: node build.js && node tests/catalog-ui.test.js
const { chromium } = require('playwright'); const path = require('path'); const assert = require('assert');
const URL = 'file://' + path.resolve(__dirname, '..', 'index.html'); let failed = 0; const errs = [];
async function test(n, fn) { try { await fn(); console.log('  ok   ' + n); } catch (e) { failed++; console.log('  FAIL ' + n + '\n       ' + String(e.stack || e).split('\n').slice(0, 5).join('\n       ')); } }
(async () => {
  const b = await chromium.launch();
  async function fresh(machines) {
    const ctx = await b.newContext({ viewport: { width: 360, height: 740 } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(URL); await p.click('[data-act=gSkip]');
    if (machines && machines.length) { await p.evaluate((ms) => { const S = window.__stockcup.state, SC = window.__stockcup.SC; ms.forEach((m) => S.machines.push(SC.makeMachine(m, m, SC.localDate()))); localStorage.setItem('stockcup.v1', JSON.stringify(S)); }, machines); await p.reload(); await p.waitForTimeout(150); }
    return { ctx, p };
  }
  const open = async (p, cat) => { await p.click('nav [data-page=pantry]'); await p.click('[data-act=addMenu]'); await p.click('[data-act=newProduct]'); if (cat) await p.selectOption('#f-category', cat); };
  const val = (p, id) => p.inputValue('#f-' + id); const state = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.__stockcup.state)));
  const opts = (p, id) => p.locator('#f-' + id + ' option').allInnerTexts(); const groups = (p, id) => p.locator('#f-' + id + ' optgroup').evaluateAll((g) => g.map((x) => x.label));
  console.log('add-product dropdowns');
  await test('matcha: Marukyu Koyamaen -> Wako -> 40 g fills the form and saves; the typed fields stay editable', async () => {
    const { ctx, p } = await fresh(); await open(p);
    assert.ok((await opts(p, 'pk_brand')).includes('Marukyu Koyamaen') && (await opts(p, 'pk_brand')).includes('Other (type it)')); await p.selectOption('#f-pk_brand', 'Marukyu Koyamaen');
    assert.deepStrictEqual((await opts(p, 'pk_product')).slice(1, 7), ['Isuzu', 'Aoarashi', 'Yugen', 'Wako', 'Kinrin', 'Chigi no Shiro']); await p.selectOption('#f-pk_product', { label: 'Wako' });
    assert.deepStrictEqual([await val(p, 'brand'), await val(p, 'name'), await val(p, 'size')], ['Marukyu Koyamaen', 'Wako', '']); assert.ok(/typical/.test(await p.locator('.pickbox').innerText()));
    await p.selectOption('#f-pk_size', '40'); assert.strictEqual(await val(p, 'size'), '40'); await p.fill('#f-name', 'Wako (my tin)'); await p.fill('#f-sealed', '2'); await p.click('[data-act=saveProduct]');
    const pr = (await state(p)).products[0]; assert.deepStrictEqual([pr.brand, pr.name, pr.size, pr.sealed, pr.category], ['Marukyu Koyamaen', 'Wako (my tin)', 40, 2, 'matcha']); await ctx.close();
  });
  await test('a product picked without choosing a size cannot be saved (no silent default size)', async () => {
    const { ctx, p } = await fresh(); await open(p); await p.selectOption('#f-pk_brand', 'Ippodo'); await p.selectOption('#f-pk_product', { label: 'Sayaka-no-mukashi' }); assert.strictEqual(await val(p, 'size'), '');
    await p.click('[data-act=saveProduct]'); assert.ok(/Required/.test(await p.locator('#overlay .body').innerText())); assert.strictEqual((await state(p)).products.length, 0);
    await p.selectOption('#f-pk_size', '100'); await p.click('[data-act=saveProduct]'); assert.strictEqual((await state(p)).products[0].size, 100); await ctx.close();
  });
  await test('Other (type it) at every level leaves the fields free; a typed brand shows up under "Your brands" next time', async () => {
    const { ctx, p } = await fresh(); await open(p); await p.selectOption('#f-pk_brand', 'Marukyu Koyamaen'); await p.selectOption('#f-pk_product', { label: 'Isuzu' }); await p.selectOption('#f-pk_product', '__other'); assert.strictEqual(await val(p, 'name'), '');
    await p.selectOption('#f-pk_brand', '__other'); assert.strictEqual(await val(p, 'brand'), ''); assert.strictEqual(await p.locator('#f-pk_product').count(), 0, 'no product list for a typed brand');
    await p.fill('#f-brand', 'Kettl'); await p.fill('#f-name', 'Uji matcha'); await p.fill('#f-size', '30'); await p.fill('#f-sealed', '1'); await p.click('[data-act=saveProduct]'); assert.strictEqual((await state(p)).products[0].brand, 'Kettl');
    await open(p); assert.ok((await groups(p, 'pk_brand')).includes('Your brands')); assert.ok((await opts(p, 'pk_brand')).includes('Kettl')); await p.selectOption('#f-pk_brand', 'Kettl'); assert.strictEqual(await val(p, 'brand'), 'Kettl'); assert.strictEqual(await p.locator('#f-pk_product').count(), 0); await ctx.close();
  });
  await test('changing the category clears the old pick; categories without a list still show "Other"-style typing', async () => {
    const { ctx, p } = await fresh(); await open(p); await p.selectOption('#f-pk_brand', 'Marukyu Koyamaen'); await p.selectOption('#f-pk_product', { label: 'Wako' }); await p.selectOption('#f-category', 'coffee');
    assert.strictEqual(await val(p, 'brand'), ''); assert.strictEqual(await val(p, 'name'), ''); assert.strictEqual(await p.inputValue('#f-pk_brand'), ''); assert.ok((await opts(p, 'pk_brand')).includes('Lavazza') && !(await opts(p, 'pk_brand')).includes('Marukyu Koyamaen'));
    await p.selectOption('#f-category', 'milk'); assert.strictEqual(await p.locator('#f-pk_brand').count(), 0, 'no catalogue for milk yet: plain typing'); assert.ok(await p.locator('#f-brand').count()); await ctx.close();
  });
  await test('coffee and tea brands work the same way (sizes in grams)', async () => {
    const { ctx, p } = await fresh(); await open(p, 'coffee'); await p.selectOption('#f-pk_brand', 'illy'); await p.selectOption('#f-pk_product', { label: 'Intenso' }); await p.selectOption('#f-pk_size', '250'); await p.fill('#f-sealed', '1'); await p.click('[data-act=saveProduct]');
    await open(p, 'tea'); await p.selectOption('#f-pk_brand', 'Twinings'); await p.selectOption('#f-pk_product', { label: 'Pure Camomile' }); await p.selectOption('#f-pk_size', '40'); await p.click('[data-act=saveProduct]');
    const s = await state(p); assert.deepStrictEqual(s.products.map((x) => [x.brand, x.name, x.size, x.category]), [['illy', 'Intenso', 250, 'coffee'], ['Twinings', 'Pure Camomile', 40, 'tea']]); assert.strictEqual(s.products[1].caffeine, 0); await ctx.close();
  });
  await test('syrups: Top Creamery -> TOP Series Classique -> Hazelnut (750 ml filled in) and Caramel (choose 750 or 250 ml)', async () => {
    const { ctx, p } = await fresh(); await open(p, 'syrup'); assert.deepStrictEqual((await opts(p, 'pk_brand')).slice(1, 2), ['Top Creamery']); await p.selectOption('#f-pk_brand', 'Top Creamery'); assert.deepStrictEqual(await groups(p, 'pk_product'), ['TOP Series', 'TOP Series Classique', 'TOP Series Sugar Syrups']);
    await p.selectOption('#f-pk_product', { label: 'Hazelnut' }); assert.deepStrictEqual([await val(p, 'brand'), await val(p, 'name'), await val(p, 'size')], ['Top Creamery', 'Hazelnut', '750']); assert.strictEqual(await p.locator('#f-pk_size').count(), 0, 'single confirmed size: no extra dropdown'); await p.fill('#f-sealed', '1'); await p.click('[data-act=saveProduct]');
    await open(p, 'syrup'); await p.selectOption('#f-pk_brand', 'Top Creamery'); await p.selectOption('#f-pk_product', { label: 'Caramel' }); assert.strictEqual(await val(p, 'size'), ''); assert.deepStrictEqual((await opts(p, 'pk_size')).slice(1, 3), ['750 ml', '250 ml']); await p.selectOption('#f-pk_size', '250'); await p.click('[data-act=saveProduct]');
    const s = await state(p); assert.deepStrictEqual(s.products.map((x) => [x.brand, x.name, x.size, x.unit, x.category]), [['Top Creamery', 'Hazelnut', 750, 'ml', 'syrup'], ['Top Creamery', 'Caramel', 250, 'ml', 'syrup']]); await ctx.close();
  });
  await test('Yamamasa Koyamaen is listed with matcha, and Marukyu Koyamaen products are not mixed into it', async () => {
    const { ctx, p } = await fresh(); await open(p); assert.ok((await opts(p, 'pk_brand')).includes('Yamamasa Koyamaen')); await p.selectOption('#f-pk_brand', 'Yamamasa Koyamaen'); assert.deepStrictEqual((await opts(p, 'pk_product')).slice(1, 7), ['Matsukaze', 'Ogurayama', 'Samidori', 'Yomo no Kaori', 'Tennouzan', 'Wakakusa']);
    await p.selectOption('#f-pk_product', { label: 'Matsukaze' }); assert.deepStrictEqual((await opts(p, 'pk_size')).slice(1, 3), ['30 g', '100 g']); assert.ok(!/typical/.test(await p.locator('.pickbox').innerText()), 'Matsukaze sizes were seen in a listing'); await ctx.close();
  });
  await test('Kumatcha lists its 26 cultivars and blends; picking one fills the form and a size must be chosen', async () => {
    const { ctx, p } = await fresh(); await open(p); await p.selectOption('#f-pk_brand', 'Kumatcha'); const names = (await opts(p, 'pk_product')).slice(1, -1); assert.strictEqual(names.length, 26); assert.ok(names.includes('Okumidori 2.0') && names.includes('Wet Market Exclusive') && names.includes('Kirari 31'));
    await p.selectOption('#f-pk_product', { label: 'Okumidori 2.0' }); assert.deepStrictEqual([await val(p, 'brand'), await val(p, 'name'), await val(p, 'size')], ['Kumatcha', 'Okumidori 2.0', '']); await p.selectOption('#f-pk_size', '30'); await p.fill('#f-sealed', '1'); await p.click('[data-act=saveProduct]');
    const pr = (await state(p)).products[0]; assert.deepStrictEqual([pr.brand, pr.name, pr.size, pr.category], ['Kumatcha', 'Okumidori 2.0', 30, 'matcha']); await ctx.close();
  });
  console.log('capsules and machines');
  await test('with an Original machine only Original flavours are offered; Livanto fills system, intensity and sleeve size', async () => {
    const { ctx, p } = await fresh(['original']); await open(p, 'capsule'); assert.deepStrictEqual((await opts(p, 'pk_brand')).filter((o) => /Nespresso/.test(o)), ['Nespresso']); await p.selectOption('#f-pk_brand', 'Nespresso');
    const g = await groups(p, 'pk_product'); assert.ok(g.length >= 4 && g.every((x) => /^Original/.test(x)), g.join('|')); assert.ok(!(await opts(p, 'pk_product')).includes('Melozio'));
    await p.selectOption('#f-pk_product', { label: 'Livanto' }); assert.deepStrictEqual([await val(p, 'name'), await val(p, 'system'), await val(p, 'intensity'), await val(p, 'size')], ['Original Livanto', 'original', '6', '10']); assert.ok(/approximate/.test(await p.locator('.pickbox').innerText()));
    await p.fill('#f-sleeves', '2'); await p.fill('#f-loose', '3'); await p.click('[data-act=saveProduct]'); const pr = (await state(p)).products[0]; assert.strictEqual(pr.count, 23); assert.strictEqual(pr.capsule.intensity, 6); await ctx.close();
  });
  await test('with a Vertuo machine only Vertuo flavours show; unknown intensity and size must be filled in, never guessed', async () => {
    const { ctx, p } = await fresh(['vertuo']); await open(p, 'capsule'); await p.selectOption('#f-pk_brand', 'Nespresso'); const g = await groups(p, 'pk_product'); assert.ok(g.length >= 4 && g.every((x) => /^Vertuo/.test(x)), g.join('|'));
    await p.selectOption('#f-pk_product', { label: 'Melozio' }); assert.deepStrictEqual([await val(p, 'system'), await val(p, 'intensity'), await val(p, 'size')], ['vertuo', '', '']); assert.deepStrictEqual((await opts(p, 'pk_size')).slice(1, 3), ['8 capsules', '10 capsules']);
    await p.click('[data-act=saveProduct]'); const t = await p.locator('#overlay .body').innerText(); assert.ok(/Required/.test(t)); assert.ok(/Printed on the sleeve/.test(t)); assert.strictEqual((await state(p)).products.length, 0);
    await p.selectOption('#f-pk_size', '10'); await p.fill('#f-intensity', '7'); await p.fill('#f-sleeves', '1'); await p.click('[data-act=saveProduct]'); const pr = (await state(p)).products[0]; assert.deepStrictEqual([pr.name, pr.capsule.system, pr.capsule.intensity, pr.count], ['Vertuo Melozio', 'vertuo', 7, 10]); await ctx.close();
  });
  await test('double-espresso capsules carry 2 shots; with both machines both families are listed', async () => {
    const { ctx, p } = await fresh(['original', 'vertuo']); await open(p, 'capsule'); await p.selectOption('#f-pk_brand', 'Nespresso'); const g = await groups(p, 'pk_product'); assert.ok(g.some((x) => /^Original/.test(x)) && g.some((x) => /^Vertuo/.test(x)));
    await p.selectOption('#f-pk_product', { label: 'Double Espresso Scuro' }); assert.deepStrictEqual([await val(p, 'shots'), await val(p, 'cupSize')], ['2', '80']); await ctx.close();
  });
  await test('quick-add of a catalogue capsule asks for the intensity instead of guessing, then saves', async () => {
    const { ctx, p } = await fresh(['vertuo']); await p.click('nav [data-page=pantry]'); await p.click('[data-act=addMenu]'); await p.click('[data-act=openQuickAdd]'); await p.fill('#qa', 'Nespresso Vertuo Melozio 10 caps x2'); await p.click('[data-act=qaParse]');
    assert.strictEqual(await p.inputValue('input[name=r0_intensity]'), ''); await p.click('[data-act=confirmRowsSave]'); assert.ok(/intensity/i.test(await p.locator('#overlay .errbox').innerText())); assert.strictEqual((await state(p)).products.length, 0);
    await p.fill('input[name=r0_intensity]', '8'); await p.click('[data-act=confirmRowsSave]'); const pr = (await state(p)).products[0]; assert.deepStrictEqual([pr.name, pr.count, pr.capsule.intensity], ['Vertuo Melozio', 20, 8]); await ctx.close();
  });
  await test('a typed line for a catalogue matcha lands on the right brand and product', async () => {
    const { ctx, p } = await fresh(); await p.click('nav [data-page=pantry]'); await p.click('[data-act=addMenu]'); await p.click('[data-act=openQuickAdd]'); await p.fill('#qa', 'Marukyu Koyamaen Wako 40g x2'); await p.click('[data-act=qaParse]'); await p.click('[data-act=confirmRowsSave]');
    const pr = (await state(p)).products[0]; assert.deepStrictEqual([pr.brand, pr.name, pr.size, pr.sealed], ['Marukyu Koyamaen', 'Wako', 40, 2]); await ctx.close();
  });
  console.log('phone layout');
  await test('the open form with all three dropdowns has no horizontal scroll and 44 px targets (light and dark)', async () => {
    for (const scheme of ['light', 'dark']) {
      const ctx = await b.newContext({ viewport: { width: 360, height: 740 }, colorScheme: scheme }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); await p.goto(URL); await p.click('[data-act=gSkip]'); await open(p);
      await p.selectOption('#f-pk_brand', 'Marukyu Koyamaen'); await p.selectOption('#f-pk_product', { label: 'Wako' }); await p.waitForTimeout(300);
      const bad = await p.evaluate(() => { const o = []; if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) o.push('horizontal scroll'); document.querySelectorAll('#overlay select, #overlay input:not([type=hidden]):not([type=checkbox]), #overlay button').forEach((e) => { const r = e.getBoundingClientRect(); if (r.width && r.height < 43.5) o.push(e.name || e.dataset.act || e.tagName); }); return o; });
      assert.deepStrictEqual(bad, [], scheme); await ctx.close();
    }
  });
  await test('no page errors', async () => assert.deepStrictEqual(errs, []));
  await b.close(); console.log(failed ? failed + ' failed' : 'catalogue UI checks passed'); process.exit(failed ? 1 : 0);
})();
