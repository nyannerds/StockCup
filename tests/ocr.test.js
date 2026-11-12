// OCR check (R20/R21/R22): bundled Tesseract reads a generated receipt image with no outside network.
// Needs http(s) because browsers block Web Workers on file://. Run: node tests/ocr.test.js
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const assert = require('assert');
const root = path.resolve(__dirname, '..'); const img = path.join(__dirname, 'shots', 'receipt.png'); fs.mkdirSync(path.dirname(img), { recursive: true });
const srv = http.createServer((q, r) => { const f = path.join(root, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(d); } }); }).listen(0);
(async () => {
  const port = srv.address().port; const b = await chromium.launch(); const external = [];
  const mk = await b.newPage({ viewport: { width: 420, height: 400 } });
  await mk.setContent('<body style="background:#fff;font:22px monospace;padding:20px;width:380px">SM SUPERMARKET<br>OATLY BARISTA 1L &nbsp; 285.00<br>2 x MATCHA POWDER 30G 450.00<br>TOTAL 1185.00</body>'); await mk.screenshot({ path: img });
  const ctx = await b.newContext({ viewport: { width: 360, height: 740 } }); const p = await ctx.newPage();
  p.on('request', (r) => { if (!r.url().startsWith('http://localhost:' + port) && !/^(data|blob):/.test(r.url())) external.push(r.url()); });
  await p.goto('http://localhost:' + port + '/'); await p.click('[data-act=gSkip]'); await p.click('nav [data-page=pantry]'); await p.click('[data-act=addMenu]'); await p.click('[data-act=openReceipt]');
  await p.setInputFiles('#rcFile', img); await p.click('[data-act=readReceipt]');
  await p.waitForFunction(() => { const t = document.getElementById('rcText'); return t && t.value.length > 5; }, null, { timeout: 90000 });
  await p.click('[data-act=rcParse]'); const rows = await p.locator('#cform .card').count();
  assert.strictEqual(rows, 2, 'two relevant items found'); assert.strictEqual((await p.evaluate(() => window.__stockcup.state.products.length)), 0, 'nothing saved before confirm');
  assert.deepStrictEqual(external, [], 'no outside requests'); console.log('ocr ok: receipt read on-device, 2 items found, nothing saved before confirm, no outside requests');
  await b.close(); srv.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
