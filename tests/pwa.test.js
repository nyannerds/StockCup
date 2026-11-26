// PWA checks: service worker, offline reload, offline OCR after first use, installability. Run: node build.js && node tests/pwa.test.js
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const assert = require('assert');
const root = path.resolve(__dirname, '..'); const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
const types = { '.js': 'text/javascript', '.html': 'text/html', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.gz': 'application/octet-stream' };
const srv = http.createServer((q, r) => { const f = path.join(root, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e || !f.startsWith(root)) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }); r.end(d); } }); }).listen(0);
let failed = 0; async function test(n, fn) { try { await fn(); console.log('  ok   ' + n); } catch (e) { failed++; console.log('  FAIL ' + n + '\n       ' + String(e.stack || e).split('\n').slice(0, 4).join('\n       ')); } }
(async () => {
  const url = 'http://localhost:' + srv.address().port + '/'; const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 360, height: 740 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const mk = await b.newPage({ viewport: { width: 420, height: 400 } });
  await mk.setContent('<body style="background:#fff;font:22px monospace;padding:20px;width:380px">SM SUPERMARKET<br>OATLY BARISTA 1L &nbsp; 285.00<br>2 x MATCHA POWDER 30G 450.00<br>TOTAL 1185.00</body>'); await mk.screenshot({ path: path.join(shots, 'receipt.png') });
  await p.goto(url); await p.click('[data-act=gSkip]');
  await test('manifest is valid and icons load at the declared sizes', async () => {
    const m = await (await p.request.get(url + 'manifest.webmanifest')).json(); assert.strictEqual(m.display, 'standalone'); assert.ok(m.name && m.short_name && m.start_url && m.theme_color && m.background_color);
    for (const i of m.icons) { const res = await p.request.get(url + i.src); assert.strictEqual(res.status(), 200, i.src); const dim = await p.evaluate(async (u) => { const im = new Image(); im.src = u; await im.decode(); return im.naturalWidth + 'x' + im.naturalHeight; }, url + i.src); assert.strictEqual(dim, i.sizes, i.src); }
    assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  });
  await test('service worker installs and takes control; app is installable', async () => {
    await p.evaluate(() => navigator.serviceWorker.ready); await p.reload(); await p.waitForFunction(() => navigator.serviceWorker.controller);
    const cdp = await ctx.newCDPSession(p); const r = await cdp.send('Page.getInstallabilityErrors'); assert.deepStrictEqual(r.installabilityErrors.map((e) => e.errorId), []);
  });
  await test('app opens and logs a drink with the network OFF', async () => {
    await p.click('[data-act=loadSample]'); await ctx.setOffline(true); await p.reload(); await p.waitForSelector('[data-act=logPick]');
    const n = await p.evaluate(() => window.__stockcup.state.logs.length); await p.click('[data-act=logSame]'); await p.click('[data-act=logSubmit]'); assert.strictEqual(await p.evaluate(() => window.__stockcup.state.logs.length), n + 1);
    await p.click('nav [data-page=more]'); assert.ok(/Ready to use offline/.test(await p.locator('#app').innerText())); await ctx.setOffline(false);
  });
  await test('receipt reader works once online, then again fully offline', async () => {
    const scan = async () => { await p.click('nav [data-page=pantry]'); await p.click('[data-act=addMenu]'); await p.click('[data-act=openReceipt]'); await p.setInputFiles('#rcFile', path.join(shots, 'receipt.png')); await p.click('[data-act=readReceipt]');
      await p.waitForFunction(() => { const t = document.getElementById('rcText'); return t && t.value.length > 5; }, null, { timeout: 90000 }); const t = await p.inputValue('#rcText'); await p.click('[data-act=closeSheet]'); return t; };
    const online = await scan(); assert.ok(/MATCHA/i.test(online), online); await ctx.setOffline(true); const offline = await scan(); assert.ok(/MATCHA/i.test(offline), offline); await ctx.setOffline(false);
  });
  await test('no page errors during the run', async () => assert.deepStrictEqual(errs, []));
  await b.close(); srv.close(); console.log(failed ? failed + ' failed' : 'pwa checks passed'); process.exit(failed ? 1 : 0);
})();
