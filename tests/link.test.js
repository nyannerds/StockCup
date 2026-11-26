// "Recipe from a video link": the serverless function (URL guard, redirects, extraction, limits) and the app flow end to end.
// The real function code runs behind a local server; only the outbound fetch to YouTube/TikTok/Instagram is faked.
// Run: node build.js && node tests/link.test.js
const assert = require('assert'); const http = require('http'); const fs = require('fs'); const path = require('path');
const L = require('../api/_lib.js'); const handler = require('../api/recipe-from-link.js'); const SCP = require('../src/parse.js');
let passed = 0, failed = 0; async function test(n, fn) { try { await fn(); passed++; console.log('  ok   ' + n); } catch (e) { failed++; console.log('  FAIL ' + n + '\n       ' + String(e.stack || e).split('\n').slice(0, 4).join('\n       ')); } }

const YT = '<html><head><meta property="og:title" content="Iced Dirty Matcha &amp; Espresso - YouTube"><title>Iced Dirty Matcha - YouTube</title></head><body><script>var ytInitialPlayerResponse = {"videoDetails":{"shortDescription":"Iced dirty matcha \\u2615\\n\\nIngredients:\\n- 2 tsp matcha\\n- 1 double espresso\\n- 150ml oat milk\\n- ice\\n\\nSteps:\\n1. Whisk matcha with 40ml water\\n2. Pour over ice and milk\\n3. Top with espresso\\n\\n#matcha #recipe"}};</script></body></html>';
const TT = '<html><head><meta property="og:title" content="Hojicha latte | TikTok"><meta property="og:description" content="Easy hojicha latte! 2 tsp hojicha, 1 cup oat milk, 1/2 tbsp honey. Whisk &amp; pour."></head><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">{"desc":"Easy hojicha latte!\\n2 tsp hojicha\\n1 cup oat milk\\n1/2 tbsp honey\\nWhisk and pour #hojicha"}</script></body></html>';
const IG = '<html><head><meta property="og:title" content="cafe on Instagram"><meta property="og:description" content="1,234 likes, 56 comments - cafe on March 3, 2024: &quot;Espresso tonic: 1 shot espresso, 150 ml tonic water, ice. Pour over ice.&quot;."></head></html>';
const THIN = '<html><head><meta property="og:title" content="cool video - YouTube"><meta property="og:description" content="subscribe!"></head></html>';

// ---- fake outbound fetch ----
function resp(status, body, headers) { return { status: status, headers: { get: (k) => (headers || {})[k.toLowerCase()] || null }, text: async () => body, body: undefined }; }
let seen = []; let routes = {};
function fakeFetch(url, opts) { seen.push({ url: String(url), opts }); const r = routes[String(url)]; if (r instanceof Error) return Promise.reject(r); if (typeof r === 'function') return r(opts); return Promise.resolve(r || resp(404, 'no')); }
global.fetch = fakeFetch;
const reset = () => { seen = []; routes = {}; };
const call = (method, headers, body) => new Promise((resolve) => { const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, body: b ? JSON.parse(b) : null, headers: this.headers }); } }; handler({ method, headers: headers || {}, body }, res); });
const OK_H = { 'content-type': 'application/json', 'x-stockcup': '1' };

(async () => {
  console.log('recipe from a video link: the function');
  await test('only plain https links to YouTube, TikTok and Instagram are accepted', async () => {
    ['https://www.youtube.com/watch?v=abc', 'https://youtu.be/abc', 'https://m.youtube.com/watch?v=1', 'https://www.tiktok.com/@a/video/1', 'https://vm.tiktok.com/ZM123/', 'https://www.instagram.com/reel/abc/'].forEach((u) => assert.ok(L.parseTarget(u).ok, u));
    ['http://youtube.com/x', 'https://evil.com/youtube.com', 'https://youtube.com@evil.com/x', 'https://youtube.com.evil.com/x', 'https://127.0.0.1/', 'https://[::1]/', 'https://169.254.169.254/latest', 'https://localhost/', 'https://www.tiktok.com:8443/x', 'javascript:alert(1)', 'file:///etc/passwd', 'ftp://youtube.com/x', '', 'not a url', 'https://' + 'a'.repeat(600) + '.com', 'https://user:pw@www.youtube.com/x', 'https://www.youtube.com.attacker.io/', 'https://notyoutube.com/'].forEach((u) => assert.strictEqual(L.parseTarget(u).ok, false, u));
    assert.strictEqual(L.parseTarget('https://youtube.com\\@evil.com/').url, 'https://youtube.com/@evil.com/', 'a backslash trick is normalised to the real host (youtube.com), which is what gets fetched'); assert.strictEqual(L.parseTarget(12345).ok, false); assert.strictEqual(L.parseTarget(null).ok, false); assert.strictEqual(L.parseTarget('https://youtu.be/a#frag').url.includes('#'), false);
  });
  await test('captions are extracted from YouTube, TikTok and Instagram pages (entities and escapes decoded)', async () => {
    const y = L.extract('youtube', YT); assert.strictEqual(y.title, 'Iced Dirty Matcha & Espresso'); assert.ok(/Ingredients:\n- 2 tsp matcha\n- 1 double espresso/.test(y.text)); assert.ok(y.text.includes('☕'));
    const t = L.extract('tiktok', TT); assert.ok(/2 tsp hojicha\n1 cup oat milk/.test(t.text)); assert.strictEqual(t.title, 'Hojicha latte');
    const i = L.extract('instagram', IG); assert.strictEqual(i.text, 'Espresso tonic: 1 shot espresso, 150 ml tonic water, ice. Pour over ice.'); assert.deepStrictEqual(L.extract('youtube', '<html></html>'), { title: '', text: '' });
  });
  await test('captions from each site become usable recipe drafts with the existing text parser', async () => {
    const need = (txt, list) => { const out = SCP.parseRecipeText(txt); list.forEach(([type, amt, unit]) => assert.ok(out.ingredients.find((x) => x.type === type && Math.abs(x.amount - amt) < 0.01 && x.unit === unit), type + ' in ' + JSON.stringify(out.ingredients.map((x) => [x.type, x.amount, x.unit])))); return out; };
    const y = L.extract('youtube', YT); const o = need(y.title + '\n' + y.text, [['matcha', 2, 'tsp'], ['espresso', 2, 'shot'], ['milk', 150, 'ml']]); assert.ok(o.ice); assert.ok(o.steps.length >= 3);
    const t = L.extract('tiktok', TT); need(t.title + '\n' + t.text, [['hojicha', 2, 'tsp'], ['milk', 1, 'cup']]);
    const i = L.extract('instagram', IG); need(i.text, [['espresso', 1, 'shot'], ['tonic', 150, 'ml']]);
  });
  await test('redirects are followed by hand and only to allowed https sites', async () => {
    reset(); routes['https://youtu.be/abc'] = resp(301, '', { location: 'https://www.youtube.com/watch?v=abc' }); routes['https://www.youtube.com/watch?v=abc'] = resp(200, YT);
    const r = await L.lookup('https://youtu.be/abc', fakeFetch); assert.ok(r.ok && r.site === 'youtube' && /2 tsp matcha/.test(r.text)); assert.ok(seen.every((s) => s.opts.redirect === 'manual'));
    for (const loc of ['https://evil.com/x', 'http://www.youtube.com/x', 'https://169.254.169.254/latest', 'https://www.youtube.com@evil.com/x', '//evil.com/x']) { reset(); routes['https://youtu.be/abc'] = resp(302, '', { location: loc }); const x = await L.lookup('https://youtu.be/abc', fakeFetch); assert.strictEqual(x.ok, false, loc); assert.strictEqual(x.error, 'redirect', loc); assert.strictEqual(seen.length, 1, 'never fetched ' + loc); }
    reset(); routes['https://youtu.be/a'] = resp(302, '', { location: 'https://youtu.be/a' }); const loop = await L.lookup('https://youtu.be/a', fakeFetch); assert.strictEqual(loop.error, 'redirect'); assert.ok(seen.length <= L.MAX_HOPS + 1);
  });
  await test('requests carry no cookies or credentials, only a plain identifying user agent', async () => {
    reset(); routes['https://www.youtube.com/watch?v=1'] = resp(200, YT); await L.lookup('https://www.youtube.com/watch?v=1', fakeFetch); const h = seen[0].opts.headers; assert.deepStrictEqual(Object.keys(h).sort(), ['Accept', 'Accept-Language', 'User-Agent']); assert.ok(/StockCup/.test(h['User-Agent'])); assert.ok(seen[0].opts.signal);
  });
  await test('blocked, missing, slow, failing and empty pages give plain messages (never a crash)', async () => {
    const cases = [[resp(403, ''), 'blocked'], [resp(429, ''), 'blocked'], [resp(404, ''), 'not_found'], [resp(500, ''), 'http_500'], [new Error('boom'), 'network'], [Object.assign(new Error('x'), { name: 'AbortError' }), 'timeout'], [resp(200, '<html><body>nothing</body></html>'), 'empty']];
    for (const [r, code] of cases) { reset(); routes['https://www.youtube.com/watch?v=9'] = r; const x = await L.lookup('https://www.youtube.com/watch?v=9', fakeFetch); assert.strictEqual(x.ok, false, code); assert.strictEqual(x.error, code); assert.ok(x.message && x.message.length > 10); }
  });
  await test('a thin caption is returned but flagged so the app can say the recipe may be in the video', async () => {
    reset(); routes['https://www.youtube.com/watch?v=t'] = resp(200, THIN); const x = await L.lookup('https://www.youtube.com/watch?v=t', fakeFetch); assert.ok(x.ok && x.thin && /video/.test(x.message));
  });
  await test('huge pages are cut off at the size limit', async () => {
    let produced = 0; const big = { status: 200, headers: { get: () => null }, body: { getReader: () => ({ read: async () => { produced += 100000; return produced > 50000000 ? { done: true } : { done: false, value: new Uint8Array(100000).fill(97) }; }, cancel: async () => {} }) } };
    reset(); routes['https://www.youtube.com/watch?v=big'] = big; const p = await L.fetchPage('https://www.youtube.com/watch?v=big', fakeFetch); assert.ok(p.ok); assert.ok(p.html.length <= L.MAX_BYTES); assert.ok(produced < 3000000, 'stopped reading early: ' + produced);
  });
  await test('endpoint: POST + JSON + app header only; bad input refused; success shape; rate limited', async () => {
    reset(); routes['https://www.youtube.com/watch?v=ok'] = resp(200, YT);
    assert.strictEqual((await call('GET', OK_H)).status, 405); assert.strictEqual((await call('POST', { 'content-type': 'application/json' }, { url: 'https://youtu.be/x' })).status, 400); assert.strictEqual((await call('POST', { 'x-stockcup': '1', 'content-type': 'text/plain' }, '{}')).status, 400);
    assert.strictEqual((await call('POST', OK_H, { url: 5 })).status, 400); assert.strictEqual((await call('POST', OK_H, '{bad json')).status, 400); assert.strictEqual((await call('POST', OK_H, { url: 'https://evil.com' })).status, 400); assert.strictEqual(seen.length, 0, 'nothing fetched for refused requests');
    const ok = await call('POST', Object.assign({ 'x-forwarded-for': '9.9.9.9' }, OK_H), { url: 'https://www.youtube.com/watch?v=ok' }); assert.strictEqual(ok.status, 200); assert.ok(ok.body.ok && ok.body.title && ok.body.text && ok.body.site === 'youtube'); assert.strictEqual(ok.headers['Cache-Control'], 'no-store'); assert.ok(!('Access-Control-Allow-Origin' in ok.headers), 'no CORS: only the app itself can call it');
    let last; for (let i = 0; i < 14; i++) last = await call('POST', Object.assign({ 'x-forwarded-for': '8.8.8.8' }, OK_H), { url: 'https://www.youtube.com/watch?v=ok' }); assert.strictEqual(last.status, 429);
    routes['https://www.youtube.com/watch?v=boom'] = new Error('x'); const e = await call('POST', Object.assign({ 'x-forwarded-for': '7.7.7.7' }, OK_H), { url: 'https://www.youtube.com/watch?v=boom' }); assert.strictEqual(e.status, 502); assert.strictEqual(e.body.ok, false);
  });

  // ---- the app, end to end: real function behind a local server, fake outbound fetch ----
  console.log('recipe from a video link: in the app');
  const { chromium } = require('playwright'); const root = path.resolve(__dirname, '..');
  const types = { '.js': 'text/javascript', '.html': 'text/html', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
  const srv = http.createServer((q, r) => {
    if (q.url.split('?')[0] === '/api/recipe-from-link') { let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => { try { q.body = JSON.parse(b); } catch (e) { q.body = null; } handler(q, Object.assign(r, { setHeader: r.setHeader.bind(r) })); }); return; }
    const f = path.join(root, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e || !f.startsWith(root)) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); } });
  }).listen(0); const base = 'http://localhost:' + srv.address().port + '/';
  const b = await chromium.launch(); const errs = [];
  async function open(url) { const ctx = await b.newContext({ viewport: { width: 360, height: 740 } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); await p.goto(url); await p.click('[data-act=gSkip]'); await p.click('nav [data-page=recipes]'); await p.click('[data-act=importRecipe]'); await p.click('[data-act=irTab][data-v=link]'); return { ctx, p }; }
  await test('paste a YouTube link -> caption appears -> draft recipe -> saved with the link as a note', async () => {
    reset(); routes['https://www.youtube.com/watch?v=ok'] = resp(200, YT); const { ctx, p } = await open(base);
    await p.fill('#irUrl', 'https://www.youtube.com/watch?v=ok'); await p.click('[data-act=irFetch]'); await p.waitForFunction(() => /2 tsp matcha/.test(document.getElementById('irText').value), null, { timeout: 8000 });
    assert.ok(/Caption found/.test(await p.locator('#ocrStatus').innerText())); assert.ok((await p.inputValue('#irText')).includes('https://www.youtube.com/watch?v=ok'));
    await p.click('[data-act=irParse]'); assert.ok(/Check the imported recipe/.test(await p.locator('#overlay header').innerText())); assert.ok((await p.locator('#rform input[name$="_amount"]').count()) >= 3);
    await p.click('[data-act=rfSave]'); const r = await p.evaluate(() => { const s = window.__stockcup.state; return s.recipes[s.recipes.length - 1]; });
    assert.ok(r.ingredients.find((i) => i.type === 'espresso' && i.amount === 2)); assert.strictEqual(r.sourceLink, 'https://www.youtube.com/watch?v=ok'); assert.ok(r.ice); assert.ok(!/data:image|blob:/.test(JSON.stringify(r))); await ctx.close();
  });
  await test('unsupported sites, blocked pages and thin captions each explain what to do instead', async () => {
    const { ctx, p } = await open(base); const status = () => p.locator('#ocrStatus').innerText();
    await p.fill('#irUrl', 'https://example.com/recipe'); await p.click('[data-act=irFetch]'); await p.waitForFunction(() => /Only YouTube, TikTok and Instagram/.test(document.getElementById('ocrStatus').textContent)); 
    await p.fill('#irUrl', 'not a link'); await p.click('[data-act=irFetch]'); assert.ok(/https:\/\//.test(await status()));
    reset(); routes['https://www.tiktok.com/@a/video/1'] = resp(403, ''); await p.fill('#irUrl', 'https://www.tiktok.com/@a/video/1'); await p.click('[data-act=irFetch]'); await p.waitForFunction(() => /Paste the caption/.test(document.getElementById('ocrStatus').textContent)); assert.strictEqual(await p.inputValue('#irText'), '');
    routes['https://www.youtube.com/watch?v=thin'] = resp(200, THIN); await p.fill('#irUrl', 'https://www.youtube.com/watch?v=thin'); await p.click('[data-act=irFetch]'); await p.waitForFunction(() => /video/.test(document.getElementById('ocrStatus').textContent)); assert.ok((await p.inputValue('#irText')).length > 0); await ctx.close();
  });
  await test('opened as a plain file, or offline, the Link tab says what to do (the rest of the app is unaffected)', async () => {
    const f = await open('file://' + path.join(root, 'index.html')); await f.p.fill('#irUrl', 'https://www.youtube.com/watch?v=ok'); await f.p.click('[data-act=irFetch]'); assert.ok(/hosted app/.test(await f.p.locator('#ocrStatus').innerText())); await f.ctx.close();
    const o = await open(base); await o.ctx.setOffline(true); await o.p.evaluate(() => { Object.defineProperty(navigator, 'onLine', { get: () => false }); }); await o.p.fill('#irUrl', 'https://www.youtube.com/watch?v=ok'); await o.p.click('[data-act=irFetch]'); assert.ok(/offline/i.test(await o.p.locator('#ocrStatus').innerText())); await o.ctx.close();
  });
  await test('pasting the caption by hand still works with no link at all', async () => {
    const { ctx, p } = await open(base); await p.click('[data-act=irTab][data-v=text]'); await p.fill('#irText', 'Iced matcha\n2 tsp matcha\n150 ml milk\nice'); await p.click('[data-act=irParse]'); assert.ok(/Check the imported recipe/.test(await p.locator('#overlay header').innerText())); await ctx.close();
  });
  await test('no page errors', async () => assert.deepStrictEqual(errs, []));
  await b.close(); srv.close(); console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})();
