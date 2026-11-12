// End-to-end checks in a real browser (Chromium via Playwright) at phone width.
// Run: node build.js && node tests/ui.test.js
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String(e.stack || e).split('\n').slice(0, 5).join('\n       ')); } }

(async () => {
  const browser = await chromium.launch();
  const errors = []; const external = [];
  async function fresh(opts) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, acceptDownloads: true }, opts || {}));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('request', (r) => { const u = r.url(); if (!/^(file|data|blob):/.test(u)) external.push(u); });
    await page.goto(URL); await page.waitForTimeout(150);
    return { ctx, page, taps: 0 };
  }
  const tap = async (w, sel) => { w.taps++; await w.page.click(sel); };
  const state = (w) => w.page.evaluate(() => JSON.parse(JSON.stringify(window.__stockcup.state)));
  const skipGuide = async (w) => { await w.page.click('[data-act=gSkip]'); };
  const stockOf = (s, brandName) => { const p = s.products.find((x) => (x.brand + ' ' + x.name).includes(brandName)); return p; };

  console.log('R19 first run');
  await test('guide reaches a first result in 3 taps with 3 products', async () => {
    const w = await fresh(); const t0 = Date.now();
    await tap(w, '[data-act=gNext]'); await tap(w, '[data-act=gNext]');
    assert.strictEqual((await w.page.locator('#overlay input[name=pick]:checked').count()), 3);
    await tap(w, '[data-act=gNext]');
    const txt = await w.page.locator('#overlay .body').innerText(); assert.ok(/You can make this now/.test(txt) && /Matcha latte/.test(txt), txt);
    assert.strictEqual(w.taps, 3); const s = await state(w); assert.strictEqual(s.products.length, 3);
    console.log('       ' + w.taps + ' taps, ' + (Date.now() - t0) + ' ms to first result'); await w.page.screenshot({ path: path.join(SHOTS, 'guide-result.png') });
    await w.page.click('[data-act=gDone]'); assert.ok((await state(w)).settings.onboarded); await w.ctx.close();
  });
  await test('skipping the guide leaves a usable app; sample loads and clears leaving real data', async () => {
    const w = await fresh(); await skipGuide(w);
    assert.ok(await w.page.locator('text=Your pantry is empty').count());
    await w.page.click('nav [data-page=pantry]'); await w.page.click('[data-act=addMenu]'); await w.page.click('[data-act=addPreset]');
    await w.page.click('#overlay [data-act=pickPreset][data-id=pre_matcha_cer]'); await w.page.click('[data-act=saveProduct]');
    assert.strictEqual((await state(w)).products.length, 1);
    await w.page.click('nav [data-page=more]'); await w.page.click('[data-act=loadSample]'); assert.ok((await state(w)).products.length > 5);
    await w.page.click('[data-act=clearSample]'); await w.page.click('[data-act=confirmYes]');
    const s = await state(w); assert.strictEqual(s.products.length, 1); assert.strictEqual(s.products[0].name, 'Ceremonial matcha'); assert.strictEqual(s.logs.length, 0); await w.ctx.close();
  });

  console.log('R12/R23 logging taps');
  await test('default drink logs in 3 taps, stock falls, toast undo restores', async () => {
    const w = await fresh(); await skipGuide(w); await w.page.click('[data-act=loadSample]'); await w.page.waitForTimeout(100);
    const before = await state(w); const matchaBefore = require('../src/core.js').stockOf(stockOf(before, 'Ceremonial matcha')).amount;
    w.taps = 0; await tap(w, '[data-act=logPick]'); await tap(w, '#overlay [data-act=logRecipe][data-id=r_matcha_latte]'); await tap(w, '[data-act=logSubmit]'); assert.strictEqual(w.taps, 3);
    const after = await state(w); assert.strictEqual(after.logs.length, before.logs.length + 1);
    const SC = require('../src/core.js'); assert.ok(Math.abs(SC.stockOf(stockOf(after, 'Ceremonial matcha')).amount - (matchaBefore - 2)) < 1e-6);
    assert.ok(await w.page.locator('.toast').innerText().then((t) => /Logged Matcha latte/.test(t) && /estimate|est\./.test(t)));
    await w.page.click('[data-act=toastAction]'); const undone = await state(w); assert.deepStrictEqual(undone.products, before.products); assert.strictEqual(undone.logs.length, before.logs.length); await w.ctx.close();
  });
  await test('"same as last time" takes 2 taps', async () => {
    const w = await fresh(); await skipGuide(w); await w.page.click('[data-act=loadSample]'); await w.page.waitForTimeout(100); const n = (await state(w)).logs.length;
    w.taps = 0; await tap(w, '[data-act=logSame]'); await tap(w, '[data-act=logSubmit]'); assert.strictEqual(w.taps, 2); assert.strictEqual((await state(w)).logs.length, n + 1); await w.ctx.close();
  });
  await test('splitting a slot across two brands deducts each exactly', async () => {
    const w = await fresh(); await skipGuide(w); await w.page.click('[data-act=loadSample]'); await w.page.waitForTimeout(100);
    const before = await state(w); const SC = require('../src/core.js');
    await w.page.click('[data-act=logPick]'); await w.page.click('#overlay [data-act=logRecipe][data-id=r_matcha_latte]');
    // milk slot is the second card: click its split button
    await w.page.click('#overlay [data-act=logSplit][data-s="1"]');
    const rows = await w.page.locator('#overlay input[name^="q-1-"]').evaluateAll((els) => els.map((e) => e.value)); assert.strictEqual(rows.length, 2); assert.strictEqual(Number(rows[0]) + Number(rows[1]), 150);
    await w.page.fill('#overlay input[name="q-1-0"]', '100'); await w.page.dispatchEvent('#overlay input[name="q-1-0"]', 'change');
    await w.page.fill('#overlay input[name="q-1-1"]', '40'); await w.page.dispatchEvent('#overlay input[name="q-1-1"]', 'change');
    assert.ok(await w.page.locator('#overlay .err').innerText().then((t) => /150/.test(t)), 'bad split warns'); assert.ok(await w.page.locator('[data-act=logSubmit]').isDisabled());
    await w.page.fill('#overlay input[name="q-1-1"]', '50'); await w.page.dispatchEvent('#overlay input[name="q-1-1"]', 'change'); assert.ok(!(await w.page.locator('[data-act=logSubmit]').isDisabled()));
    await w.page.click('[data-act=logSubmit]'); const after = await state(w);
    const ids = after.logs[after.logs.length - 1].parts.filter((p) => p.slotType === 'milk'); assert.strictEqual(ids.length, 2);
    ids.forEach((pt) => { const b = before.products.find((p) => p.id === pt.productId), a = after.products.find((p) => p.id === pt.productId); assert.ok(Math.abs(SC.stockOf(b).amount - SC.stockOf(a).amount - pt.qty) < 1e-6); });
    await w.page.click('[data-act=toastAction]'); assert.deepStrictEqual((await state(w)).products, before.products); await w.ctx.close();
  });
  await test('crossing a pack boundary asks to open a new pack (button label) and undo restores', async () => {
    const w = await fresh(); await skipGuide(w);
    await w.page.evaluate(() => { const S = window.__stockcup.state; const SC = window.__stockcup.SC; [['matcha', 'Matcha', 30], ['milk', 'Oat', 1000]].forEach(([c, n, size]) => SC.addProduct(S, { category: c, brand: 'B', name: n, size: size, sealed: 1, openMode: 'none', dairy: false }, SC.localDate())); S.products[1].open = { amount: 100, openedAt: SC.localDate() }; S.products[0].sealed = 0; S.products[0].open = { amount: 10, openedAt: SC.localDate() }; localStorage.setItem('stockcup.v1', JSON.stringify(S)); });
    await w.page.reload(); await w.page.waitForTimeout(150); const before = await state(w);
    await w.page.click('[data-act=logPick]'); await w.page.click('#overlay [data-act=logRecipe][data-id=r_matcha_latte]');
    assert.ok(/Open pack & log/.test(await w.page.locator('[data-act=logSubmit]').innerText())); assert.ok(/opens a new sealed pack/i.test(await w.page.locator('#overlay .warnbox').first().innerText()));
    await w.page.click('[data-act=logSubmit]'); const a = await state(w); const milk = a.products[1]; assert.strictEqual(milk.sealed, 0); assert.strictEqual(milk.open.amount, 950);
    await w.page.click('[data-act=toastAction]'); assert.deepStrictEqual((await state(w)).products, before.products); await w.ctx.close();
  });

  console.log('R1/R24 forms and validation');
  await test('product form rejects invalid entries with messages and no data change', async () => {
    const w = await fresh(); await skipGuide(w); await w.page.click('nav [data-page=pantry]'); await w.page.click('[data-act=addMenu]'); await w.page.click('[data-act=newProduct]');
    await w.page.click('[data-act=saveProduct]'); const t = await w.page.locator('#overlay .body').innerText(); assert.ok(/Brand is required/.test(t) && /Name is required/.test(t));
    const tries = [['abc', /Enter a number/], ['-5', /more than 0/], ['0', /more than 0/], ['NaN', /Enter a number/], ['', /Required/], ['1e5', /Enter a number/]];
    await w.page.fill('#f-brand', 'B'); await w.page.fill('#f-name', 'N');
    // number inputs refuse letters in the browser; also exercise the validator with text that slips through (paste, autofill) by switching the field to text
    await w.page.evaluate(() => { document.getElementById('f-size').type = 'text'; });
    for (const [v, re] of tries) { await w.page.fill('#f-size', v); await w.page.click('[data-act=saveProduct]'); assert.ok(re.test(await w.page.locator('#overlay .body').innerText()), 'size ' + v); await w.page.evaluate(() => { document.getElementById('f-size').type = 'text'; }); }
    await w.page.fill('#f-size', '30'); await w.page.fill('#f-sealed', '-1'); await w.page.click('[data-act=saveProduct]'); assert.ok(/or more/.test(await w.page.locator('#overlay .body').innerText()));
    await w.page.fill('#f-sealed', '1.5'); await w.page.click('[data-act=saveProduct]'); assert.ok(/Whole numbers/.test(await w.page.locator('#overlay .body').innerText()));
    assert.strictEqual((await state(w)).products.length, 0);
    await w.page.fill('#f-sealed', '2'); await w.page.selectOption('#f-openMode', 'unknown'); await w.page.click('[data-act=saveProduct]');
    const s = await state(w); assert.strictEqual(s.products.length, 1); assert.strictEqual(s.products[0].open.amount, null);
    assert.ok(/unknown/.test(await w.page.locator('#plist').innerText())); await w.ctx.close();
  });
  await test('recount shows the difference before saving, saves an adjustment (not a drink), and undoes', async () => {
    const w = await fresh(); await skipGuide(w);
    await w.page.evaluate(() => { const S = window.__stockcup.state; const SC = window.__stockcup.SC; SC.addProduct(S, { category: 'matcha', brand: 'B', name: 'M', size: 40, sealed: 1, openMode: 'none' }, SC.localDate()); S.products[0].open = { amount: 2, openedAt: SC.localDate() }; localStorage.setItem('stockcup.v1', JSON.stringify(S)); });
    await w.page.reload(); await w.page.waitForTimeout(150); await w.page.click('nav [data-page=pantry]'); await w.page.click('[data-act=viewProduct]'); await w.page.click('[data-act=pvRecount]');
    await w.page.fill('#f-sealed', '0'); await w.page.dispatchEvent('#f-sealed', 'change'); await w.page.selectOption('#f-openMode', 'amount'); await w.page.fill('#f-openAmount', '30'); await w.page.dispatchEvent('#f-openAmount', 'change');
    const t = await w.page.locator('#overlay .body').innerText(); assert.ok(/−12|-12/.test(t.replace('−', '-')), t); await w.page.click('[data-act=saveRecount]');
    let s = await state(w); assert.strictEqual(s.products[0].open.amount, 30); assert.strictEqual(s.logs.length, 0); assert.strictEqual(s.adjustments.length, 1);
    await w.page.click('[data-act=toastAction]'); s = await state(w); assert.strictEqual(s.products[0].sealed, 1); assert.strictEqual(s.products[0].open.amount, 2); assert.strictEqual(s.adjustments.length, 0); await w.ctx.close();
  });

  console.log('R20/R21 stretch import flows');
  await test('quick add: nothing saved before confirm; Back leaves data untouched; Save adds', async () => {
    const w = await fresh(); await skipGuide(w); await w.page.click('nav [data-page=pantry]'); await w.page.click('[data-act=addMenu]'); await w.page.click('[data-act=openQuickAdd]');
    await w.page.fill('#qa', 'Brand A matcha 30g x2\nOatly barista oat milk 1L'); await w.page.click('[data-act=qaParse]');
    assert.ok(/Check before saving/.test(await w.page.locator('#overlay header').innerText())); assert.strictEqual((await state(w)).products.length, 0);
    await w.page.click('[data-act=confirmRowsBack]'); assert.strictEqual((await state(w)).products.length, 0); await w.page.click('[data-act=qaParse]');
    await w.page.click('[data-act=confirmRowsSave]'); const s = await state(w); assert.strictEqual(s.products.length, 2); const m = s.products.find((p) => p.brand === 'Brand A'); assert.strictEqual(m.sealed, 2); assert.strictEqual(m.size, 30); await w.ctx.close();
  });
  await test('quick add rejects a row with no brand and saves nothing', async () => {
    const w = await fresh(); await skipGuide(w); await w.page.click('nav [data-page=pantry]'); await w.page.click('[data-act=addMenu]'); await w.page.click('[data-act=openQuickAdd]');
    await w.page.fill('#qa', 'matcha 30g'); await w.page.click('[data-act=qaParse]'); await w.page.click('[data-act=confirmRowsSave]');
    assert.ok(/brand/i.test(await w.page.locator('#overlay .errbox').innerText())); assert.strictEqual((await state(w)).products.length, 0); await w.ctx.close();
  });
  await test('receipt flow works from pasted text; photo reading degrades gracefully when no reader is bundled', async () => {
    const w = await fresh(); await skipGuide(w); await w.page.click('nav [data-page=pantry]'); await w.page.click('[data-act=addMenu]'); await w.page.click('[data-act=openReceipt]');
    await w.page.fill('#rcText', 'SM MARKET\nOATLY BARISTA 1L 285.00\n2 x MATCHA POWDER 30G 450.00 900.00\nTOTAL 1185.00'); await w.page.click('[data-act=rcParse]');
    assert.ok((await w.page.locator('#cform .card').count()) === 2); assert.strictEqual((await state(w)).products.length, 0); await w.ctx.close();
  });
  await test('recipe import: vague amount blocks saving until a number is given; no image data stored', async () => {
    const w = await fresh(); await skipGuide(w); await w.page.click('nav [data-page=recipes]'); await w.page.click('[data-act=importRecipe]');
    await w.page.fill('#irText', 'Iced dirty matcha\n2 tsp matcha\n1 double espresso\n150ml oat milk\na splash of vanilla syrup\nice\nhttps://example.com/v/1'); await w.page.click('[data-act=irParse]');
    assert.ok(/Check the imported recipe/.test(await w.page.locator('#overlay header').innerText()));
    await w.page.click('[data-act=rfSave]'); assert.ok(/Needs a number/.test(await w.page.locator('#overlay .body').innerText())); const n0 = (await state(w)).recipes.length;
    const idx = await w.page.locator('#rform input[name$="_amount"]').evaluateAll((els) => els.findIndex((e) => e.value === ''));
    await w.page.fill('#rform input[name="i' + idx + '_amount"]', '10'); await w.page.click('[data-act=rfSave]');
    const s = await state(w); assert.strictEqual(s.recipes.length, n0 + 1); const r = s.recipes[s.recipes.length - 1];
    assert.strictEqual(r.ingredients.find((i) => i.type === 'espresso').amount, 2); assert.strictEqual(r.sourceLink, 'https://example.com/v/1'); assert.ok(!/data:image|blob:/.test(JSON.stringify(s))); await w.ctx.close();
  });

  console.log('R22 data');
  await test('export, erase, import restores identical data; corrupt file rejected', async () => {
    const w = await fresh(); await skipGuide(w); await w.page.click('[data-act=loadSample]'); await w.page.click('nav [data-page=more]'); const before = await state(w);
    const [dl] = await Promise.all([w.page.waitForEvent('download'), w.page.click('[data-act=exportData]')]); const file = path.join(SHOTS, 'export.json'); await dl.saveAs(file);
    const text = fs.readFileSync(file, 'utf8'); assert.ok(!/data:image|blob:/.test(text));
    await w.page.click('[data-act=wipeAll]'); await w.page.click('[data-act=confirmYes]'); assert.strictEqual((await state(w)).products.length, 0);
    await w.page.setInputFiles('#importFile', file); await w.page.waitForSelector('[data-act=confirmYes]'); await w.page.click('[data-act=confirmYes]'); await w.page.waitForTimeout(100);
    assert.deepStrictEqual(await state(w), before);
    const bad = path.join(SHOTS, 'bad.json'); fs.writeFileSync(bad, text.slice(0, text.length - 40)); await w.page.setInputFiles('#importFile', bad); await w.page.waitForTimeout(150);
    assert.ok(/Import failed/.test(await w.page.locator('.toast').innerText())); assert.deepStrictEqual(await state(w), before);
    fs.writeFileSync(bad, '{"app":"stockcup","version":1,"checksum":"x","data":{}}'); await w.page.setInputFiles('#importFile', bad); await w.page.waitForTimeout(150); assert.ok(/Import failed/.test(await w.page.locator('.toast').innerText()));
    fs.unlinkSync(bad); await w.ctx.close();
  });
  await test('data survives a reload', async () => {
    const w = await fresh(); await skipGuide(w); await w.page.click('[data-act=loadSample]'); const s1 = await state(w); await w.page.reload(); await w.page.waitForTimeout(150); assert.deepStrictEqual(await state(w), s1); await w.ctx.close();
  });
  await test('works with the network off and makes no outside requests', async () => {
    const w = await fresh(); await w.ctx.setOffline(true); await skipGuide(w); await w.page.click('[data-act=loadSample]');
    for (const pg of ['pantry', 'recipes', 'history', 'more', 'home']) { await w.page.click('nav [data-page=' + pg + ']'); }
    await w.page.click('[data-act=logSame]'); await w.page.click('[data-act=logSubmit]'); assert.ok((await state(w)).logs.length > 6);
    assert.strictEqual(external.length, 0, external.join(',')); await w.ctx.close();
  });

  console.log('R6 machines');
  await test('capsule features hidden with no machine; only compatible capsules offered', async () => {
    const w = await fresh(); await skipGuide(w);
    await w.page.evaluate(() => { const S = window.__stockcup.state; const SC = window.__stockcup.SC; const T = SC.localDate(); SC.addProduct(S, { category: 'capsule', brand: 'N', name: 'OrigCap', size: 10, sleeves: 2, system: 'original', intensity: 6 }, T); SC.addProduct(S, { category: 'capsule', brand: 'N', name: 'VertCap', size: 10, sleeves: 2, system: 'vertuo', intensity: 6 }, T); SC.addProduct(S, { category: 'tonic', brand: 'T', name: 'Tonic', size: 500, sealed: 1 }, T); localStorage.setItem('stockcup.v1', JSON.stringify(S)); });
    await w.page.reload(); await w.page.waitForTimeout(150); await w.page.click('nav [data-page=pantry]'); let t = await w.page.locator('#plist').innerText(); assert.ok(!/OrigCap|VertCap/.test(t)); assert.ok(!(await w.page.locator('[data-cat=capsule]').count()));
    await w.page.click('nav [data-page=more]'); await w.page.click('[data-act=editMachine]'); await w.page.fill('#f-name', 'Orig'); await w.page.click('[data-act=machineSave]');
    await w.page.click('nav [data-page=pantry]'); t = await w.page.locator('#plist').innerText(); assert.ok(/OrigCap/.test(t) && /Not for your machines/.test(t));
    await w.page.click('nav [data-page=recipes]'); assert.ok(/Espresso tonic/.test(await w.page.locator('#app').innerText())); await w.page.click('nav [data-page=home]'); await w.page.click('[data-act=logPick]');
    await w.page.click('#overlay [data-act=logRecipe][data-id=r_espresso_tonic]'); const opts = await w.page.locator('#overlay select[name="p-0-0"] option').allInnerTexts(); assert.ok(opts.some((o) => /OrigCap/.test(o)) && !opts.some((o) => /VertCap/.test(o))); await w.ctx.close();
  });
  await test('descale reminder appears for the machine past its limit and clears with Done', async () => {
    const w = await fresh(); await skipGuide(w); await w.page.click('[data-act=loadSample]'); assert.ok(/Descale Sample Original machine/.test(await w.page.locator('#app').innerText()));
    await w.page.click('[data-act=descaled]'); assert.ok(!/Descale Sample Original machine/.test(await w.page.locator('#app').innerText())); await w.ctx.close();
  });

  console.log('R23 mobile layout and dark mode');
  const pages = ['home', 'pantry', 'recipes', 'history', 'more', 'shopping', 'plan'];
  async function audit(w, label) {
    return w.page.evaluate((label) => {
      const bad = []; const root = document.documentElement;
      if (root.scrollWidth > root.clientWidth + 1) bad.push(label + ': horizontal scroll ' + root.scrollWidth + ' > ' + root.clientWidth);
      document.querySelectorAll('button, select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not(.sr), textarea, summary, nav button').forEach((el) => {
        const r = el.getBoundingClientRect(); if (!r.width || !r.height) return; if (el.closest('[hidden]')) return;
        if (r.height < 43.5 || (el.tagName === 'BUTTON' && r.width < 43.5)) bad.push(label + ': ' + el.tagName + ' ' + (el.dataset.act || el.name || el.textContent.trim().slice(0, 20)) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      });
      document.querySelectorAll('input[type=checkbox], input[type=radio]').forEach((el) => { const l = el.closest('label'); const r = (l || el).getBoundingClientRect(); if (r.height < 43.5) bad.push(label + ': checkbox row ' + Math.round(r.height)); });
      return bad;
    }, label);
  }
  await test('no horizontal scroll and 44px targets on every page and sheet at 360 px', async () => {
    const w = await fresh(); await skipGuide(w); await w.page.click('[data-act=loadSample]'); let bad = [];
    for (const pg of pages) { await w.page.click('nav [data-page=' + (pg === 'shopping' || pg === 'plan' ? 'more' : pg) + ']'); if (pg === 'shopping' || pg === 'plan') await w.page.click('[data-act=go][data-page=' + pg + ']'); await w.page.waitForTimeout(80); bad = bad.concat(await audit(w, pg)); await w.page.screenshot({ path: path.join(SHOTS, 'page-' + pg + '.png'), fullPage: true }); }
    const sheets = [['recipes', '[data-act=viewRecipe]', 'recipe'], ['pantry', '[data-act=viewProduct]', 'product detail'], ['home', '[data-act=logPick]', 'log picker']];
    for (const [pg, sel, label] of sheets) { await w.page.click('nav [data-page=' + pg + ']'); await w.page.click(sel + ':visible >> nth=0'); await w.page.waitForTimeout(250); bad = bad.concat(await audit(w, label)); await w.page.screenshot({ path: path.join(SHOTS, 'sheet-' + label.replace(/ /g, '-') + '.png') }); await w.page.click('[data-act=closeSheet]'); }
    await w.page.click('nav [data-page=home]'); await w.page.click('[data-act=logPick]'); await w.page.click('#overlay [data-act=logRecipe][data-id=r_flat_white]'); await w.page.waitForTimeout(250); bad = bad.concat(await audit(w, 'log sheet')); await w.page.screenshot({ path: path.join(SHOTS, 'sheet-log.png') }); await w.page.click('[data-act=closeSheet]');
    await w.page.click('nav [data-page=pantry]'); await w.page.click('[data-act=addMenu]'); await w.page.click('[data-act=newProduct]'); await w.page.waitForTimeout(250); bad = bad.concat(await audit(w, 'product form')); await w.page.screenshot({ path: path.join(SHOTS, 'sheet-product-form.png') });
    assert.deepStrictEqual(bad, []); await w.ctx.close();
  });
  await test('dark mode persists across reload and applies to all pages', async () => {
    const w = await fresh(); await skipGuide(w); await w.page.click('[data-act=loadSample]'); await w.page.click('nav [data-page=more]'); await w.page.selectOption('select[name=theme]', 'dark');
    assert.strictEqual(await w.page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark'); await w.page.reload(); await w.page.waitForTimeout(100);
    assert.strictEqual(await w.page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
    const bg = await w.page.evaluate(() => getComputedStyle(document.body).backgroundColor); const rgb = bg.match(/\d+/g).map(Number); assert.ok(rgb[0] < 60 && rgb[1] < 60, bg);
    for (const pg of ['home', 'pantry', 'recipes', 'history', 'more']) { await w.page.click('nav [data-page=' + pg + ']'); await w.page.screenshot({ path: path.join(SHOTS, 'dark-' + pg + '.png') }); }
    await w.ctx.close();
    const lw = await fresh({ colorScheme: 'dark' }); await skipGuide(lw); assert.ok((await lw.page.evaluate(() => getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number)[0])) < 60, 'follows OS dark'); await lw.ctx.close();
  });

  console.log('R10/R11/R4 screens');
  await test('scale sheet and guest plan show hand-calculable numbers; plan leaves stock unchanged', async () => {
    const w = await fresh(); await skipGuide(w);
    await w.page.evaluate(() => { const S = window.__stockcup.state; const SC = window.__stockcup.SC; const T = SC.localDate(); SC.addProduct(S, { category: 'matcha', brand: 'A', name: 'm', size: 30, sealed: 0, openMode: 'half' }, T); S.products[0].open.amount = 10; SC.addProduct(S, { category: 'milk', brand: 'A', name: 'a', size: 600, sealed: 1, dairy: false }, T); SC.addProduct(S, { category: 'milk', brand: 'B', name: 'b', size: 400, sealed: 1, dairy: false }, T); localStorage.setItem('stockcup.v1', JSON.stringify(S)); });
    await w.page.reload(); await w.page.waitForTimeout(150); const before = await state(w);
    await w.page.click('nav [data-page=more]'); await w.page.click('[data-act=go][data-page=plan]'); await w.page.selectOption('select[name=recipe]', 'r_matcha_latte'); await w.page.fill('#f-n', '6'); await w.page.click('[data-act=planAdd], form[data-submit=planAdd] button.primary');
    const t = await w.page.locator('#app').innerText(); assert.ok(/Short 2 g/.test(t), t); assert.ok(/Covered/.test(t)); assert.deepStrictEqual((await state(w)).products, before.products);
    await w.page.click('[data-act=planToShop]'); assert.ok((await state(w)).shopping.length === 1);
    await w.page.click('nav [data-page=recipes]'); await w.page.click('[data-act=viewRecipe][data-id=r_matcha_latte]'); await w.page.click('[data-act=openScale]'); await w.page.fill('#f-amount', '20'); await w.page.dispatchEvent('#f-amount', 'change');
    const st = await w.page.locator('#overlay .body').innerText(); assert.ok(/10 servings/.test(st), st); await w.ctx.close();
  });
  await test('low-stock shopping list: threshold, Bought it, Undo', async () => {
    const w = await fresh(); await skipGuide(w);
    await w.page.evaluate(() => { const S = window.__stockcup.state; const SC = window.__stockcup.SC; const T = SC.localDate(); SC.addProduct(S, { category: 'matcha', brand: 'A', name: 'm', size: 40, sealed: 0, openMode: 'half' }, T); SC.addProduct(S, { category: 'matcha', brand: 'B', name: 'n', size: 30, sealed: 0, openMode: 'half' }, T); S.thresholds.matcha = 40; localStorage.setItem('stockcup.v1', JSON.stringify(S)); });
    await w.page.reload(); await w.page.waitForTimeout(150); await w.page.click('nav [data-page=more]'); await w.page.click('[data-act=go][data-page=shopping]'); assert.ok(/Matcha powder/.test(await w.page.locator('#app').innerText()) && /35 g left/.test(await w.page.locator('#app').innerText()));
    await w.page.click('[data-act=bought]'); assert.ok(!/35 g left/.test(await w.page.locator('#app').innerText())); await w.page.click('[data-act=toastAction]'); assert.ok(/35 g left/.test(await w.page.locator('#app').innerText())); await w.ctx.close();
  });
  await test('people: switching in one tap, deleting moves drinks to Unassigned', async () => {
    const w = await fresh(); await skipGuide(w); await w.page.click('[data-act=loadSample]'); await w.page.click('nav [data-page=more]');
    await w.page.fill('input[name=name][placeholder="Add a person"]', 'Sam'); await w.page.click('form[data-submit=addPerson] button'); assert.strictEqual((await state(w)).people.length, 3);
    w.taps = 0; await tap(w, '[data-act=nextPerson]'); assert.strictEqual(w.taps, 1); assert.ok((await state(w)).settings.activePerson !== 'p_me');
    await w.page.click('[data-act=delPerson][data-id=p_sample]'); await w.page.click('[data-act=confirmYes]'); const s = await state(w); assert.ok(!s.people.some((p) => p.id === 'p_sample')); assert.ok(s.logs.some((l) => l.personId === null)); await w.ctx.close();
  });
  await test('speed check button reports under 1 second', async () => {
    const w = await fresh(); await skipGuide(w); await w.page.click('nav [data-page=more]'); await w.page.click('[data-act=speedCheck]'); await w.page.waitForFunction(() => /took \d+ ms/.test(document.getElementById('speedOut').textContent), null, { timeout: 30000 });
    const ms = Number((await w.page.locator('#speedOut').innerText()).match(/took (\d+) ms/)[1]); console.log('       in-browser calc time: ' + ms + ' ms'); assert.ok(ms < 1000); await w.ctx.close();
  });
  await test('built-in recipes can be edited, flagged Edited, reset to original, and deleted/restored', async () => {
    const w = await fresh(); await skipGuide(w); await w.page.click('nav [data-page=recipes]'); await w.page.click('[data-act=rview][data-v=all]');
    await w.page.click('[data-act=viewRecipe][data-id=r_matcha_latte]'); await w.page.click('[data-act=rvEdit]');
    await w.page.fill('input[name=i0_amount]', '3'); await w.page.click('[data-act=rfSave]');
    let s = await state(w); let r = s.recipes.find((x) => x.id === 'r_matcha_latte'); assert.strictEqual(r.ingredients[0].amount, 3); assert.ok(r.builtin && r.edited); assert.strictEqual(s.recipes.length, 8);
    assert.ok(/Edited/.test(await w.page.locator('#app').innerText()));
    await w.page.click('[data-act=viewRecipe][data-id=r_matcha_latte]'); await w.page.click('[data-act=rvReset]'); await w.page.click('[data-act=confirmYes]');
    r = (await state(w)).recipes.find((x) => x.id === 'r_matcha_latte'); assert.strictEqual(r.ingredients[0].amount, 2); assert.ok(!r.edited);
    await w.page.click('[data-act=rvDel]'); await w.page.click('[data-act=confirmYes]'); assert.strictEqual((await state(w)).recipes.length, 7);
    await w.page.click('nav [data-page=more]'); await w.page.click('[data-act=restoreBuiltins]'); assert.strictEqual((await state(w)).recipes.length, 8); await w.ctx.close();
  });
  await test('step timer starts and shows a countdown bar', async () => {
    const w = await fresh(); await skipGuide(w); await w.page.click('nav [data-page=recipes]'); await w.page.click('[data-act=rview][data-v=all]'); await w.page.click('[data-act=viewRecipe][data-id=r_matcha_latte]'); await w.page.click('[data-act=stepTimer] >> nth=0'); await w.page.click('[data-act=closeSheet]');
    assert.ok(await w.page.locator('#timerbar').count()); assert.ok(/\d:\d\d/.test(await w.page.locator('#timerval').innerText())); await w.page.click('[data-act=timerStop]'); assert.strictEqual(await w.page.locator('#timerbar').count(), 0); await w.ctx.close();
  });

  console.log('\nconsole/page errors during run: ' + errors.length); errors.forEach((e) => console.log('   ' + e));
  console.log(passed + ' passed, ' + failed + ' failed'); await browser.close(); process.exit(failed || errors.length ? 1 : 0);
})();
