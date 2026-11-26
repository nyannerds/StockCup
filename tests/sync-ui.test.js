// Two phones (two browser contexts) syncing through a mock cloud, driving the real screens. Run: node build.js && node tests/sync-ui.test.js
const { chromium } = require('playwright'); const path = require('path'); const assert = require('assert');
const SYNC = require('../src/sync.js'); const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
let failed = 0; async function test(n, fn) { try { await fn(); console.log('  ok   ' + n); } catch (e) { failed++; console.log('  FAIL ' + n + '\n       ' + String(e.stack || e).split('\n').slice(0, 5).join('\n       ')); } }

// ---- the mock cloud (what Supabase does, in Node) ----
class Cloud {
  constructor() { this.hh = {}; this.rows = []; this.seq = {}; this.codes = {}; this.down = new Set(); this.pages = []; this.n = 0; }
  handler(user) {
    return async (m, a) => {
      if (this.down.has(user)) throw new Error('Failed to fetch');
      const member = (h) => this.hh[h] && this.hh[h].members.find((x) => x.user_id === user);
      switch (m) {
        case 'create': { const id = 'h' + (++this.n); this.hh[id] = { name: a[0], members: [{ user_id: user, role: 'owner', label: a[1] }] }; const code = ('C0DE' + this.n + 'ABCDEF01').slice(0, 12); this.codes[code] = id; return { id: id, code: code }; }
        case 'join': { const code = String(a[0]).toUpperCase().replace(/[^A-Z0-9]/g, ''); const id = this.codes[code]; if (!id) return { error: 'invalid_or_expired_code' }; if (!member(id)) this.hh[id].members.push({ user_id: user, role: 'member', label: a[1] }); return { id: id, name: this.hh[id].name }; }
        case 'invite': { if (!member(a[0]) || member(a[0]).role !== 'owner') throw new Error('only the owner can create invites'); const code = ('F00D' + (++this.n) + 'ABCDEF01').slice(0, 12); this.codes[code] = a[0]; return code; }
        case 'members': return member(a[0]) ? this.hh[a[0]].members : [];
        case 'remove': { if (!member(a[0]) || member(a[0]).role !== 'owner') throw new Error('only the owner can remove members'); this.hh[a[0]].members = this.hh[a[0]].members.filter((x) => x.user_id !== a[1]); return null; }
        case 'leave': { if (this.hh[a[0]]) this.hh[a[0]].members = this.hh[a[0]].members.filter((x) => x.user_id !== user); return null; }
        case 'destroy': { delete this.hh[a[0]]; return null; }
        case 'push': { if (!member(a[0])) throw new Error('new row violates row-level security policy for table "ops"'); a[1].forEach((r) => { if (!this.rows.some((x) => x.op_id === r.op_id)) { this.seq[a[0]] = (this.seq[a[0]] || 0) + 1; this.rows.push(Object.assign({}, r, { household_id: a[0], server_seq: this.seq[a[0]] })); } }); setTimeout(() => this.notify(), 20); return null; }
        case 'pull': return member(a[0]) ? this.rows.filter((r) => r.household_id === a[0] && r.server_seq > a[1]).slice(0, a[2]) : [];
        default: throw new Error('unknown ' + m);
      }
    };
  }
  notify() { this.pages.forEach((p) => p.evaluate(() => window.__srvCb && window.__srvCb()).catch(() => {})); }
}
(async () => {
  const b = await chromium.launch(); const cloud = new Cloud(); const errors = [];
  async function phone(user) {
    const ctx = await b.newContext({ viewport: { width: 360, height: 740 } }); await ctx.exposeFunction('__cloud', cloud.handler(user));
    await ctx.addInitScript((u) => { window.STOCKCUP_TRANSPORT_FACTORY = () => { const c = (m, ...a) => window.__cloud(m, a); return { userId: async () => u, create: (n, l) => c('create', n, l), join: (k, l) => c('join', k, l), invite: (h) => c('invite', h), members: (h) => c('members', h), remove: (h, x) => c('remove', h, x), leave: (h) => c('leave', h), destroy: (h) => c('destroy', h), transport: { push: (h, r) => c('push', h, r), pull: (h, s, l) => c('pull', h, s, l), subscribe: (h, cb) => { window.__srvCb = cb; return () => { window.__srvCb = null; }; } } }; }; }, user);
    const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(user + ': ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(user + ': ' + m.text()); });
    await page.goto(URL); await page.click('[data-act=gSkip]'); cloud.pages.push(page); return { ctx, page, user };
  }
  const state = (p) => p.page.evaluate(() => { const s = JSON.parse(JSON.stringify(window.__stockcup.state)); s.settings = { currency: s.settings.currency }; return s; });
  const same = async (x, y) => assert.strictEqual(SYNC.canon(await state(x)), SYNC.canon(await state(y)), 'phones hold the same pantry');
  const pill = (p) => p.page.locator('.syncpill').first().innerText();
  const waitPill = (p, re) => p.page.waitForFunction((src) => { const e = document.querySelector('.syncpill'); return e && new RegExp(src).test(e.textContent); }, re.source, { timeout: 8000 });
  const addPreset = async (p, id) => { await p.page.click('nav [data-page=pantry]'); await p.page.click('[data-act=addMenu]'); await p.page.click('[data-act=addPreset]'); await p.page.click('#overlay [data-act=pickPreset][data-id=' + id + ']'); await p.page.click('[data-act=saveProduct]'); };
  const toProfile = (p) => p.page.click('nav [data-page=more]');

  const A = await phone('userA'), B = await phone('userB'); let code;
  console.log('household sync, two phones');
  await test('sync is off until a household exists; the Profile card offers create and join', async () => {
    await toProfile(A); const t = await A.page.locator('#syncCard').innerText(); assert.ok(/Create a household/.test(t) && /Join with an invite code/.test(t)); assert.strictEqual(await A.page.locator('.syncpill').count(), 0);
  });
  await test('A builds a pantry, creates a household and gets an invite code', async () => {
    await addPreset(A, 'pre_matcha_cer'); await addPreset(A, 'pre_milk_oat'); await toProfile(A); await A.page.click('[data-act=syncCreate]'); await A.page.fill('#f-hname', 'Our Kitchen'); await A.page.fill('#f-label', 'Dad'); await A.page.click('[data-act=syncDoCreate]');
    await A.page.waitForSelector('#inviteCode'); code = (await A.page.locator('#inviteCode').innerText()).trim(); assert.match(code, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/); await A.page.click('[data-act=closeSheet]');
    await waitPill(A, /Synced/); assert.ok(/Our Kitchen/.test(await A.page.locator('#syncCard').innerText())); assert.ok(cloud.rows.some((r) => r.type === 'snapshot'));
  });
  await test('B tries a wrong code (friendly error), then joins with the real one and receives A\'s pantry', async () => {
    await toProfile(B); await B.page.click('[data-act=syncJoin]'); await B.page.fill('#f-code', 'WRONGWRONG12'); await B.page.fill('#f-label', 'Mum'); await B.page.click('[data-act=syncDoJoin]');
    await B.page.waitForSelector('#overlay .errbox'); assert.ok(/did not work/.test(await B.page.locator('#overlay .errbox').innerText()));
    await B.page.fill('#f-code', code.toLowerCase()); await B.page.click('[data-act=syncDoJoin]'); await waitPill(B, /Synced/);
    const s = await state(B); assert.deepStrictEqual(s.products.map((p) => p.name).sort(), ['Ceremonial matcha', 'Oat milk (barista)']); await same(A, B);
  });
  await test('a drink logged on A shows up on B within a moment, with the same stock', async () => {
    await A.page.click('nav [data-page=home]'); await A.page.click('[data-act=logPick]'); await A.page.click('#overlay [data-act=logRecipe][data-id=r_matcha_latte]'); await A.page.click('[data-act=logSubmit]');
    await B.page.waitForFunction(() => window.__stockcup.state.logs.length === 1, null, { timeout: 8000 }); await same(A, B);
    const m = (await state(B)).products.find((p) => p.name === 'Ceremonial matcha'); assert.strictEqual(m.sealed * m.size + (m.open ? m.open.amount : 0), 28);
  });
  await test('B goes offline: changes queue ("waiting"), A keeps working, and everything merges on reconnect', async () => {
    cloud.down.add('userB'); await B.page.click('nav [data-page=home]'); await B.page.click('[data-act=logPick]'); await B.page.click('#overlay [data-act=logRecipe][data-id=r_matcha_latte]'); await B.page.click('[data-act=logSubmit]');
    await B.page.click('nav [data-page=pantry]'); await B.page.click('[data-act=viewProduct] >> nth=0'); await B.page.click('[data-act=pvAddPack]'); await B.page.click('[data-act=closeSheet]');
    await waitPill(B, /Offline · \d+ waiting/); assert.ok(/waiting/.test(await pill(B)));
    await A.page.click('nav [data-page=home]'); await A.page.click('[data-act=logPick]'); await A.page.click('#overlay [data-act=logRecipe][data-id=r_matcha_latte]'); await A.page.click('[data-act=logSubmit]');
    cloud.down.delete('userB'); await B.page.evaluate(() => window.dispatchEvent(new Event('online'))); await waitPill(B, /^Synced/);
    await A.page.waitForFunction(() => window.__stockcup.state.logs.length === 3, null, { timeout: 8000 }); await B.page.waitForFunction(() => window.__stockcup.state.logs.length === 3, null, { timeout: 8000 }); await same(A, B);
    const m = (await state(A)).products.find((p) => p.name === 'Ceremonial matcha'); assert.strictEqual(m.sealed * m.size + (m.open ? m.open.amount : 0), 30 - 2 - 2 + 30 - 2, 'start 30 g, three drinks of 2 g, one restocked 30 g pack');
  });
  await test('data survives a reload and the phone stays connected', async () => {
    await A.page.reload(); await A.page.waitForSelector('.syncpill'); await waitPill(A, /Synced/); await same(A, B);
    await toProfile(A); assert.ok(/Our Kitchen/.test(await A.page.locator('#syncCard').innerText())); assert.ok(/Mum/.test(await A.page.locator('#syncCard').innerText()), 'member list loads');
  });
  await test('the owner can create a new invite and remove a member; the removed phone stops syncing but keeps its copy', async () => {
    await A.page.click('[data-act=syncInvite]'); await A.page.waitForSelector('#inviteCode'); await A.page.click('[data-act=closeSheet]');
    await A.page.click('[data-act=syncRemove]'); await A.page.click('[data-act=confirmYes]'); await A.page.waitForFunction(() => !/Mum/.test(document.getElementById('syncCard').innerText), null, { timeout: 8000 });
    const before = (await state(B)).logs.length; await B.page.click('nav [data-page=home]'); await B.page.click('[data-act=logPick]'); await B.page.click('#overlay [data-act=logRecipe][data-id=r_matcha_latte]'); await B.page.click('[data-act=logSubmit]');
    await waitPill(B, /Sync problem|Syncing/); assert.strictEqual((await state(B)).logs.length, before + 1, 'B still has its local copy'); assert.ok((await state(A)).logs.length === before, 'A did not receive B\'s change');
    await toProfile(B); assert.ok(/row-level security/.test(await B.page.locator('#syncCard').innerText()), 'B is told why');
  });
  await test('leaving keeps the local pantry and shows the join/create options again; signed-out use is unchanged', async () => {
    await B.page.click('[data-act=syncLeave]'); await B.page.click('[data-act=confirmYes]'); await B.page.waitForSelector('[data-act=syncCreate]'); assert.strictEqual(await B.page.locator('.syncpill').count(), 0); assert.ok((await state(B)).products.length === 2);
    await B.page.reload(); await B.page.waitForSelector('[data-act=logPick], nav'); assert.strictEqual(await B.page.evaluate(() => !!window.__stockcup.state.products.length), true);
  });
  await test('no page errors during the run (other than the expected removed-member rejection)', async () => { const unexpected = errors.filter((e) => !/row-level security|Failed to load resource/.test(e)); assert.deepStrictEqual(unexpected, []); });
  await b.close(); console.log(failed ? failed + ' failed' : 'sync UI checks passed'); process.exit(failed ? 1 : 0);
})();
