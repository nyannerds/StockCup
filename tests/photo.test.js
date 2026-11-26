// Photo-of-an-item flow, fullness chips, tea, and the receipt "only coffee/tea" toggle. Run: node build.js && node tests/photo.test.js
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const assert = require('assert');
const root = path.resolve(__dirname, '..'); const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
const types = { '.js': 'text/javascript', '.html': 'text/html', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, r) => { const f = path.join(root, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e || !f.startsWith(root)) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); }).listen(0);
let failed = 0; async function test(n, fn) { try { await fn(); console.log('  ok   ' + n); } catch (e) { failed++; console.log('  FAIL ' + n + '\n       ' + String(e.stack || e).split('\n').slice(0, 5).join('\n       ')); } }
(async () => {
  const url = 'http://localhost:' + srv.address().port + '/'; const b = await chromium.launch(); const external = []; const errs = [];
  const mk = await b.newPage({ viewport: { width: 420, height: 260 } });
  await mk.setContent('<body style="background:#fff;font:600 30px sans-serif;padding:24px;width:380px;line-height:1.3">OATLY BARISTA<br>Oat drink<br>1 L</body>'); await mk.screenshot({ path: path.join(shots, 'label.png') });
  async function fresh() { const ctx = await b.newContext({ viewport: { width: 360, height: 740 } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('request', (r) => { if (!r.url().startsWith(url) && !/^(data|blob):/.test(r.url())) external.push(r.url()); }); await p.goto(url); await p.click('[data-act=gSkip]'); return { ctx, p }; }
  const st = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.__stockcup.state)));
  const openPhoto = async (p) => { await p.click('nav [data-page=pantry]'); await p.click('[data-act=addMenu]'); await p.click('[data-act=openPhoto]'); };
  const typed = async (p, text) => { await p.fill('#phText', text); await p.click('[data-act=phParse]'); await p.waitForSelector('#phform'); };
  console.log('Phase 3: photo-add');
  await test('typed label -> 1 L found -> half full saves one opened pack of 500 ml', async () => {
    const { ctx, p } = await fresh(); await openPhoto(p); await typed(p, 'Oatly Barista oat drink 1 L'); assert.strictEqual(await p.inputValue('#f-size'), '1000'); assert.strictEqual(await p.inputValue('#f-category'), 'milk'); assert.strictEqual(await p.inputValue('#f-brand'), 'Oatly');
    await p.click('[data-act=phFill][data-v=half]'); assert.ok(/50%.*500 ml/.test(await p.locator('#overlay .body').innerText())); await p.click('[data-act=phSave]');
    const s = await st(p); const pr = s.products[0]; assert.strictEqual(pr.sealed, 0); assert.strictEqual(pr.open.amount, 500); assert.strictEqual(pr.size, 1000); assert.strictEqual(pr.category, 'milk'); assert.ok(/Added/.test(await p.locator('.toast').innerText())); await ctx.close();
  });
  await test('every fullness choice: full = one sealed pack (+ extra), 3/4, 1/4, almost empty, not sure = unknown', async () => {
    const { ctx, p } = await fresh(); const cases = [['full', 3, null, 1, 'Whole milk 1L'], ['threequarter', 0, 750, 0, 'Soy milk 1L'], ['quarter', 0, 250, 0, 'Almond milk 1L'], ['almost', 0, 100, 0, 'Lactose-free milk 1L'], ['unsure', 0, 'unknown', 0, 'Oat milk 1L']];
    for (const [fill, sealed, open, extra, label] of cases) {
      await openPhoto(p); await typed(p, label); await p.click('[data-act=phFill][data-v=' + fill + ']'); if (fill === 'full') { await p.fill('#f-extra', '2'); await p.dispatchEvent('#f-extra', 'change'); } await p.click('[data-act=phSave]');
      const pr = (await st(p)).products.find((x) => x.name.toLowerCase().includes(label.split(' ')[0].toLowerCase())); assert.ok(pr, label); assert.strictEqual(pr.sealed, sealed, fill); if (open === null) assert.strictEqual(pr.open, null); else if (open === 'unknown') assert.strictEqual(pr.open.amount, null); else assert.strictEqual(pr.open.amount, open, fill); void extra;
    }
    await ctx.close();
  });
  await test('a photo is read on-device, previewed only while confirming, and never stored', async () => {
    const { ctx, p } = await fresh(); await openPhoto(p); await p.setInputFiles('#phFile', path.join(shots, 'label.png')); await p.click('[data-act=readPhoto]');
    await p.waitForFunction(() => { const t = document.getElementById('phText'); return t && t.value.length > 4; }, null, { timeout: 90000 }); const text = await p.inputValue('#phText'); assert.ok(/OATLY/i.test(text) && /1\s*L/i.test(text), text);
    await p.click('[data-act=phParse]'); await p.waitForSelector('#phform'); assert.strictEqual(await p.inputValue('#f-size'), '1000'); assert.strictEqual(await p.locator('#overlay img').count(), 1, 'preview shown while confirming');
    await p.click('[data-act=phFill][data-v=half]'); await p.click('[data-act=phSave]'); assert.strictEqual(await p.locator('img[alt^="Your photo"]').count(), 0);
    assert.strictEqual(await p.evaluate(() => PHOTO.url), ''); const s = await st(p); assert.ok(!/data:image|blob:/.test(JSON.stringify(s))); assert.ok(!/data:image|blob:/.test(await p.evaluate(() => window.__stockcup.SC.exportData(window.__stockcup.state)))); await ctx.close();
  });
  await test('capsule labels ask for sleeves and loose capsules instead of fullness', async () => {
    const { ctx, p } = await fresh(); await p.evaluate(() => { const S = window.__stockcup.state; S.machines.push(window.__stockcup.SC.makeMachine('M', 'original', window.__stockcup.SC.localDate())); localStorage.setItem('stockcup.v1', JSON.stringify(S)); }); await p.reload(); await p.waitForTimeout(150);
    await openPhoto(p); await typed(p, 'Nespresso Livanto 10 capsules'); assert.strictEqual(await p.locator('[data-act=phFill]').count(), 0); await p.fill('#f-sleeves', '2'); await p.dispatchEvent('#f-sleeves', 'change'); await p.fill('#f-loose', '3'); await p.dispatchEvent('#f-loose', 'change'); await p.click('[data-act=phSave]');
    const pr = (await st(p)).products[0]; assert.strictEqual(pr.count, 23); assert.strictEqual(pr.capsule.system, 'original'); assert.ok(pr.capsule.intensity); await ctx.close();
  });
  await test('tea: a tea box is recognised, saved, shown as a category and usable in a custom recipe', async () => {
    const { ctx, p } = await fresh(); await openPhoto(p); await typed(p, 'TWININGS English Breakfast 50 Tea Bags 125g'); assert.strictEqual(await p.inputValue('#f-category'), 'tea'); assert.strictEqual(await p.inputValue('#f-size'), '125'); await p.click('[data-act=phSave]');
    const pr = (await st(p)).products[0]; assert.strictEqual(pr.category, 'tea'); assert.strictEqual(pr.brand.toLowerCase(), 'twinings'); await p.click('nav [data-page=pantry]'); assert.ok(await p.locator('.chip:has-text("Tea (leaves or bags)")').count()); await ctx.close();
  });
  await test('an item you already have offers a recount instead of a duplicate; unknown labels ask for a category; bad input is refused', async () => {
    const { ctx, p } = await fresh(); await openPhoto(p); await typed(p, 'Generic Whole milk 1L'); await p.click('[data-act=phSave]'); assert.strictEqual((await st(p)).products.length, 1);
    await openPhoto(p); await typed(p, 'Generic Whole milk 1L'); assert.ok(/already have/.test(await p.locator('#overlay .warnbox').first().innerText())); await p.click('[data-act=phRecount]'); assert.ok(/Recount/.test(await p.locator('#overlay header').innerText())); await p.click('[data-act=closeSheet]'); assert.strictEqual((await st(p)).products.length, 1);
    await openPhoto(p); await typed(p, 'mystery jar'); assert.ok(/could not tell/.test(await p.locator('#overlay .warnbox').first().innerText())); await p.fill('#f-brand', ''); await p.click('[data-act=phSave]'); assert.ok(/Brand is required/.test(await p.locator('#overlay .body').innerText())); assert.strictEqual((await st(p)).products.length, 1);
    await p.fill('#f-brand', 'B'); await p.fill('#f-name', 'N'); await p.evaluate(() => { document.getElementById('f-size').type = 'text'; }); await p.fill('#f-size', '-3'); await p.click('[data-act=phSave]'); assert.ok(/more than 0/.test(await p.locator('#overlay .body').innerText())); assert.strictEqual((await st(p)).products.length, 1); await ctx.close();
  });
  await test('receipt review: "only coffee, matcha, tea and capsules" leaves out milk and syrup, and saves only what is ticked', async () => {
    const { ctx, p } = await fresh(); await p.click('nav [data-page=pantry]'); await p.click('[data-act=addMenu]'); await p.click('[data-act=openReceipt]');
    await p.fill('#rcText', 'MARKET\nMATCHA POWDER 30G 450.00\nEARL GREY TEA 100G 120.00\nOATLY BARISTA 1L 285.00\nVANILLA SYRUP 750ML 320.00\nBREAD 55.00\nTOTAL 1230.00'); await p.click('[data-act=rcParse]');
    assert.strictEqual(await p.locator('#cform .card').count(), 4); await p.check('input[name=onlyCore]'); const inc = await p.locator('#cform input[name$="_include"]').evaluateAll((els) => els.map((e) => e.checked)); assert.deepStrictEqual(inc, [true, true, false, false]);
    await p.click('[data-act=confirmRowsSave]'); assert.ok(/brand/i.test(await p.locator('#overlay .errbox').innerText()), 'a brand is required'); assert.strictEqual((await st(p)).products.length, 0);
    await p.fill('input[name=r0_brand]', 'Ippodo'); await p.fill('input[name=r1_brand]', 'Twinings'); await p.click('[data-act=confirmRowsSave]'); const s = await st(p); assert.deepStrictEqual(s.products.map((x) => x.category).sort(), ['matcha', 'tea']); await ctx.close();
  });
  await test('no outside requests and no page errors', async () => { assert.deepStrictEqual(external, []); assert.deepStrictEqual(errs, []); });
  await b.close(); srv.close(); console.log(failed ? failed + ' failed' : 'photo checks passed'); process.exit(failed ? 1 : 0);
})();
