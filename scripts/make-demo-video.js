#!/usr/bin/env node
/* Silent demo video (a short pitch of the key features) of StockCup: drives the real built app (index.html) in Chromium at phone size, records it,
   and lays it out with captions on a 1920x1080 canvas with ffmpeg. No audio narration.
   Run: node build.js && node scripts/make-demo-video.js [output.mp4]
   Needs: playwright (Chromium), ffmpeg, the Carlito font. The household-sync scene uses the same in-memory stand-in for
   Supabase as tests/sync-ui.test.js (it never talks to a real project), so that part of the footage is simulated. */
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os'); const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..'); const URL = 'file://' + path.join(ROOT, 'index.html');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'docs', 'StockCup-demo.mp4'));
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'stockcup-demo-'));
const PEOPLE = ['Yanna', 'Dad', 'Mom', 'Niko'];
const FONT = ['/usr/share/fonts/truetype/crosextra/Carlito-Bold.ttf'].find((f) => fs.existsSync(f)); const FONT_SERIF = ['/usr/share/fonts/truetype/crosextra/Caladea-Bold.ttf'].find((f) => fs.existsSync(f)) || FONT;
if (!FONT) throw new Error('Carlito font not found');
const PACE = Number(process.env.DEMO_PACE || 0.55); // 1 = slow walkthrough (about 3 minutes); 0.55 = pitch (about 1.5 minutes)
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.round(ms * PACE)));

// ---- stand-in cloud (the class and transport factory are read from the sync UI test so there is one copy) ----
const testSrc = fs.readFileSync(path.join(ROOT, 'tests', 'sync-ui.test.js'), 'utf8');
const Cloud = new Function(testSrc.match(/class Cloud \{[\s\S]*?\n\}\n/)[0] + '; return Cloud;')();
const initFn = testSrc.match(/addInitScript\((\(u\) => \{ window\.STOCKCUP_TRANSPORT_FACTORY[\s\S]*?\}), user\);/)[1];

const TAP_JS = `(() => { const css = document.createElement('style'); css.textContent = '.demo-tap{position:fixed;z-index:99999;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(255,179,71,.55);border:3px solid #ffb347;pointer-events:none;animation:demotap .55s ease-out forwards}@keyframes demotap{from{transform:scale(.4);opacity:1}to{transform:scale(1.5);opacity:0}}'; const add = () => (document.head || document.documentElement).appendChild(css); if (document.head) add(); else document.addEventListener('DOMContentLoaded', add);
  addEventListener('pointerdown', (e) => { const d = document.createElement('div'); d.className = 'demo-tap'; d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px'; document.body.appendChild(d); setTimeout(() => d.remove(), 700); }, true); })();`;

(async () => {
  const browser = await chromium.launch(); const cloud = new Cloud(); const errors = [];
  // 1) seed state: the app's own sample pantry, an Original and a Vertuo machine, and the four people
  const seedCtx = await browser.newContext({ viewport: { width: 360, height: 740 } }); const sp = await seedCtx.newPage();
  await sp.goto(URL); await sp.click('[data-act=gSkip]');
  await sp.evaluate((people) => { const S = window.__stockcup.state, SC = window.__stockcup.SC; SC.loadSample(S, SC.localDate()); S.machines.push(SC.makeMachine('Original machine', 'original', SC.localDate()), SC.makeMachine('Vertuo machine', 'vertuo', SC.localDate()));
    const me = S.people.find((p) => p.id === 'p_me'); me.name = people[0]; const dad = S.people.find((p) => p.id === 'p_sample'); if (dad) { dad.name = people[1]; delete dad.sample; }
    S.people.push({ id: 'p_mom', name: people[2] }, { id: 'p_niko', name: people[3] }); S.settings.activePerson = 'p_me'; S.settings.sampleLoaded = false; /* the pantry stays; only the sample flag (which blocks creating a household) is cleared */ localStorage.setItem('stockcup.v1', JSON.stringify(S)); }, PEOPLE);
  const seed = await sp.evaluate(() => localStorage.getItem('stockcup.v1')); await seedCtx.close();

  // 2) the recorded phone (A)
  const VW = 360, VH = 740;
  async function newPhone(user, withSeed) {
    const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2, recordVideo: { dir: path.join(WORK, user), size: { width: VW, height: VH } } });
    await ctx.exposeFunction('__cloud', cloud.handler(user)); await ctx.addInitScript(new Function('return ' + initFn)(), user); await ctx.addInitScript(TAP_JS);
    if (withSeed) await ctx.addInitScript((s) => { if (!localStorage.getItem('stockcup.v1')) localStorage.setItem('stockcup.v1', s); }, seed);
    const page = await ctx.newPage(); const t0 = Date.now(); page.on('pageerror', (e) => errors.push(user + ': ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(user + ': ' + m.text()); });
    await page.goto(URL); cloud.pages.push(page); await page.addStyleTag({ content: 'html{scroll-behavior:smooth}' }); return { ctx, page, t0, user };
  }
  const A = await newPhone('A', true); const pa = A.page; const T0 = A.t0; let B = null;
  const now = () => (Date.now() - T0) / 1000;
  // scene markers: { t, kind: 'title'|'phone'|'end', text, sub, two }
  const marks = []; const scene = (kind, text, sub) => marks.push({ t: now(), kind, text, sub: sub || '', two: false });
  const showTwo = () => { marks.push({ t: now(), kind: 'phone', text: marks[marks.length - 1].text, sub: marks[marks.length - 1].sub, two: true }); };
  async function tap(page, sel, o = {}) { const loc = page.locator(sel).first(); await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 }); await sleep(o.pre === undefined ? 250 : o.pre); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(o.post === undefined ? 900 : o.post); }
  async function type(page, sel, text, o = {}) { await tap(page, sel, { post: 150 }); await page.locator(sel).first().fill(''); await page.locator(sel).first().pressSequentially(text, { delay: Math.round((o.delay || 70) * PACE) }); if (o.blur) await page.keyboard.press('Tab'); await sleep(o.post === undefined ? 600 : o.post); }
  async function pick(page, sel, v, o = {}) { const loc = page.locator(sel); const b = await loc.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 }); await sleep(300); await loc.selectOption(v); await sleep(o.post === undefined ? 1300 : o.post); }
  async function scrollBy(page, sel, y) { await page.evaluate(([s, dy]) => { const e = document.querySelector(s) || window; (e === window ? window : e).scrollBy({ top: dy, behavior: 'smooth' }); }, [sel, y]); await sleep(1100); }
  const closeSheet = async (page) => { await tap(page, '#overlay [data-act=closeSheet]', { post: 700 }); };

  await sleep(500);
  // ---- 1 title ----
  scene('title', 'StockCup', 'Home coffee and matcha pantry'); await sleep(6500);
  // ---- 2 home ----
  scene('phone', 'See what you can make right now', 'Ready-now recipes, daily insights and alerts');
  await sleep(3200); await scrollBy(pa, null, 330); await sleep(1500); await scrollBy(pa, null, -330);
  // ---- 3 pantry ----
  scene('phone', 'Every product, by brand and pack size', 'Sealed and open packs tracked separately, with freshness');
  await tap(pa, 'nav [data-page=pantry]', { post: 6000 });
  // ---- 4 add by brand ----
  scene('phone', 'Add products from brand lists', 'Brand, product, pack size. “Other” lets you type your own');
  await tap(pa, '[data-act=addMenu]', { post: 1200 }); await tap(pa, '[data-act=newProduct]', { post: 1200 });
  await pick(pa, '#f-pk_brand', 'Marukyu Koyamaen'); await pick(pa, '#f-pk_product', { label: 'Wako' }); await pick(pa, '#f-pk_size', '40');
  await type(pa, '#f-sealed', '2', { post: 500 }); await sleep(900); await tap(pa, '[data-act=saveProduct]', { post: 1600 });
  // ---- 5 nespresso ----
  scene('phone', 'Nespresso: Original or Vertuo first', 'Then only the flavours for that machine');
  await tap(pa, '[data-act=addMenu]', { post: 1000 }); await tap(pa, '[data-act=newProduct]', { post: 1000 }); await pick(pa, '#f-category', 'capsule', { post: 1000 }); await pick(pa, '#f-pk_brand', 'Nespresso', { post: 1500 });
  await pick(pa, '#f-pk_system', 'original', { post: 1700 }); await pick(pa, '#f-pk_product', { label: 'Livanto' }, { post: 1800 });
  await pick(pa, '#f-pk_system', 'vertuo', { post: 1800 }); await pick(pa, '#f-pk_product', { label: 'Melozio' }, { post: 1800 }); await closeSheet(pa);
  // ---- 6 photo ----
  scene('phone', 'Add from a photo of the label', 'Read on the phone; you say how full it is. Photos are never saved');
  await tap(pa, '[data-act=addMenu]', { post: 1000 }); await tap(pa, '[data-act=openPhoto]', { post: 1200 }); await type(pa, '#phText', 'Oatly Barista oat drink 1 L', { delay: 60, post: 800 }); await tap(pa, '[data-act=phParse]', { post: 1700 });
  await tap(pa, '[data-act=phFill][data-v=half]', { post: 1700 }); await tap(pa, '[data-act=phSave]', { post: 1800 });
  // ---- 7 log a drink ----
  scene('phone', 'Log a drink: stock deducts for you', 'Pick the recipe and brands, even split one ingredient between two');
  await tap(pa, 'nav [data-page=home]', { post: 1200 }); await tap(pa, '[data-act=logPick]', { post: 1200 }); await tap(pa, '#overlay [data-act=logRecipe][data-id=r_matcha_latte]', { post: 1500 });
  const split = pa.locator('#overlay [data-act=logSplit]').first(); if (await split.count()) { await tap(pa, '#overlay [data-act=logSplit]', { post: 1800 }); }
  await scrollBy(pa, '#overlay .body', 260); await sleep(1500); await scrollBy(pa, '#overlay .body', -260); await sleep(500);
  await tap(pa, '[data-act=logSubmit]', { post: 2300 });
  // ---- 8 undo ----
  scene('phone', 'Made a mistake? Undo restores the stock', 'Every drink, restock and recount can be undone');
  if (await pa.locator('[data-act=toastAction]').count()) await tap(pa, '[data-act=toastAction]', { post: 6000 }); else await sleep(6000);
  // ---- 9 recipes + scaling ----
  scene('phone', 'Recipes: what can I make, and how much?', 'Scale to what you have or to the servings you want');
  await tap(pa, 'nav [data-page=recipes]', { post: 1800 });
  await tap(pa, (await pa.locator('[data-act=viewRecipe][data-id=r_matcha_latte]').count()) ? '[data-act=viewRecipe][data-id=r_matcha_latte]' : '[data-act=viewRecipe]', { post: 1500 }); await tap(pa, '#overlay [data-act=openScale]', { post: 1300 });
  await pick(pa, '#overlay #f-mode', 'want', { post: 900 }); await type(pa, '#overlay #f-servings', '6', { blur: true, post: 1800 }); await scrollBy(pa, '#overlay .body', 260); await sleep(2200); await closeSheet(pa);
  // ---- 11 household sync (two phones) ----
  scene('phone', 'Share one pantry with your household', 'Create it, then share an invite code. No emails or passwords');
  await tap(pa, 'nav [data-page=more]', { post: 1300 }); await sleep(300); const gotoProfileTop = async () => { await pa.evaluate(() => window.scrollTo(0, 0)); };
  await scrollBy(pa, null, 460); await tap(pa, '[data-act=syncCreate]', { post: 1100 }); await type(pa, '#f-hname', 'Our Kitchen', { post: 300 }); await type(pa, '#f-label', 'Yanna', { post: 300 }); await type(pa, '#f-members', 'Dad\nMom\nNiko', { delay: 60, post: 700 });
  await tap(pa, '[data-act=syncDoCreate]', { post: 1800 }); await pa.waitForSelector('#inviteCode'); const code = (await pa.locator('#inviteCode').innerText()).trim(); await sleep(2200); await tap(pa, '#overlay [data-act=closeSheet]', { post: 1200 });
  // phone B joins
  B = await newPhone('B', false); await B.page.click('[data-act=gSkip]'); const tB = (B.t0 - T0) / 1000;
  showTwo(); marks[marks.length - 1].text = 'A second phone joins with the code'; marks[marks.length - 1].sub = 'Then each person picks who they are';
  const pb = B.page; await sleep(800); await tap(pb, 'nav [data-page=more]', { post: 1200 }); await scrollBy(pb, null, 420); await tap(pb, '[data-act=syncJoin]', { post: 1000 }); await type(pb, '#f-code', code, { delay: 70, post: 400 }); await type(pb, '#f-label', 'Mom', { post: 500 });
  await tap(pb, '[data-act=syncDoJoin]', { post: 1800 }); await pb.waitForSelector('#overlay .profiles', { timeout: 15000 }); await sleep(2200); await tap(pb, '#overlay [data-act=pickPerson][aria-label="I am Mom"]', { post: 1500 });
  marks.push({ t: now(), kind: 'phone', text: 'Changes appear on every phone', sub: 'A drink logged on one phone updates the stock on the other', two: true });
  await tap(pb, 'nav [data-page=more]', { post: 1200 }); await tap(pb, '[data-act=go][data-page=history]', { post: 1800 }); const n0 = await pb.evaluate(() => window.__stockcup.state.logs.length); await tap(pa, 'nav [data-page=home]', { post: 1200 }); await tap(pa, '[data-act=logPick]', { post: 1000 }); await tap(pa, '#overlay [data-act=logRecipe][data-id=r_flat_white]', { post: 1200 }); await tap(pa, '[data-act=logSubmit]', { post: 800 });
  await pb.waitForFunction((n) => window.__stockcup.state.logs.length > n, n0, { timeout: 15000 }); await sleep(1800); await scrollBy(pb, null, 430); await sleep(3200);
  const tEndTwo = now();
  // ---- 12 profiles + dark mode ----
  marks.push({ t: now(), kind: 'phone', text: 'Who is drinking?', sub: 'Drinks, caffeine and cost are tracked per person, and it works offline', two: false });
  await tap(pa, 'nav [data-page=more]', { post: 1300 }); await pa.evaluate(() => window.scrollTo(0, 0)); await sleep(600); await tap(pa, '[data-act=openProfiles]', { post: 2200 }); await tap(pa, '#overlay [data-act=pickPerson][aria-label="I am Dad"]', { post: 1600 });
  await tap(pa, '[data-act=go][data-page=history]', { post: 3200 });
  // ---- end ----
  scene('end', 'Try StockCup', 'stockcup.vercel.app'); await sleep(6500); const tEnd = now();
  await A.ctx.close(); await B.ctx.close(); await browser.close();
  if (errors.length) console.log('page errors during recording:\n' + errors.join('\n'));

  // 3) compose with ffmpeg
  const vid = (u) => path.join(WORK, u, fs.readdirSync(path.join(WORK, u)).find((f) => f.endsWith('.webm')));
  const vA = vid('A'), vB = vid('B'); const CALIB = Number(process.env.DEMO_OFFSET || 0); // seconds the video lags the Date.now() clock
  const W = 1920, H = 1080, PH = 880, PW = Math.round(PH * VW / VH), BEZ = 14, CAP_Y = 960; const IW = PW - 2 * BEZ, IH = PH - 2 * BEZ;
  const tf = (name, text) => { const f = path.join(WORK, name); fs.writeFileSync(f, text); return f.replace(/\\/g, '/').replace(/:/g, '\\:'); };
  const intervals = marks.map((m, i) => ({ m, a: m.t + CALIB, b: (i + 1 < marks.length ? marks[i + 1].t : tEnd) + CALIB }));
  let chain = 'color=c=0xfdf4d8:s=' + W + 'x' + H + ':r=30[bg0]'; let n = 0; let cur = 'bg0';
  const phoneBase = `[0:v]scale=${IW}:${IH}:flags=lanczos,pad=${PW}:${PH}:${BEZ}:${BEZ}:color=0x33381f[pa];`; const phoneB = `[1:v]setpts=PTS+${(tB + CALIB).toFixed(3)}/TB,scale=${IW}:${IH}:flags=lanczos,pad=${PW}:${PH}:${BEZ}:${BEZ}:color=0x33381f[pb];`;
  let f = chain + ';' + phoneBase + phoneB + '[pa]split=2[pa1][pa2];';
  const phoneIv = intervals.filter((x) => x.m.kind === 'phone'); const oneIv = phoneIv.filter((x) => !x.m.two); const twoIv = phoneIv.filter((x) => x.m.two);
  const en = (ivs) => ivs.map((x) => `between(t,${x.a.toFixed(3)},${x.b.toFixed(3)})`).join('+') || '0';
  f += `[bg0][pa1]overlay=x=${(W - PW) / 2}:y=30:enable='${en(oneIv)}':eof_action=pass[l1];`; f += `[l1][pa2]overlay=x=${W / 2 - PW - 60}:y=30:enable='${en(twoIv)}':eof_action=pass[l2];`; f += `[l2][pb]overlay=x=${W / 2 + 60}:y=30:enable='${en(twoIv)}':eof_action=pass[l3];`; cur = 'l3';
  const dt = (extra) => `drawtext=fontfile=${FONT}:${extra}`;
  const parts = [];
  intervals.forEach((x, i) => { const e = `enable='between(t,${x.a.toFixed(3)},${x.b.toFixed(3)})'`;
    if (x.m.kind === 'phone') {
      const cap = tf('c' + i + '.txt', x.m.text), sub = tf('s' + i + '.txt', x.m.sub);
      parts.push(`drawbox=x=0:y=${CAP_Y - 14}:w=${W}:h=${H - CAP_Y + 14}:color=0x2e4a2c@1:t=fill:${e}`); parts.push(dt(`textfile='${cap}':fontcolor=0xfdf4d8:fontsize=44:x=(w-text_w)/2:y=${CAP_Y + 6}:${e}`)); if (x.m.sub) parts.push(dt(`textfile='${sub}':fontcolor=0xe0e9c9:fontsize=28:x=(w-text_w)/2:y=${CAP_Y + 64}:${e}`));
    } else { const big = tf('c' + i + '.txt', x.m.text), sub = tf('s' + i + '.txt', x.m.sub); parts.push(`drawbox=x=0:y=0:w=${W}:h=${H}:color=0x2e4a2c@1:t=fill:${e}`);
      parts.push(`drawtext=fontfile=${FONT_SERIF}:textfile='${big}':fontcolor=0xfdf4d8:fontsize=150:x=(w-text_w)/2:y=(h/2)-150:${e}`); parts.push(dt(`textfile='${sub}':fontcolor=0xffb347:fontsize=56:x=(w-text_w)/2:y=(h/2)+60:${e}`)); }
  });
  f += `[${cur}]${parts.join(',')},format=yuv420p[v]`;
  fs.writeFileSync(path.join(WORK, 'graph.txt'), f); fs.mkdirSync(path.dirname(OUT), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', vA, '-i', vB, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-filter_complex_script', path.join(WORK, 'graph.txt'), '-map', '[v]', '-map', '2:a', '-t', (tEnd + CALIB + 0.3).toFixed(2), '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', OUT], { stdio: 'inherit' });
  fs.writeFileSync(path.join(WORK, 'marks.json'), JSON.stringify({ marks, tB, tEnd, tEndTwo }, null, 1)); console.log('wrote ' + OUT + ' (work dir ' + WORK + ')');
})().catch((e) => { console.error(e); process.exit(1); });
