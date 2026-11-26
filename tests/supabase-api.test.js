// Checks that the app's Supabase calls match supabase/schema.sql (function names, parameter names, columns),
// using a recording fake of supabase-js. Needs no network. Run: node build.js && node tests/supabase-api.test.js
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path'); const assert = require('assert');
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
let failed = 0; async function test(n, fn) { try { await fn(); console.log('  ok   ' + n); } catch (e) { failed++; console.log('  FAIL ' + n + '\n       ' + String(e.stack || e).split('\n').slice(0, 4).join('\n       ')); } }
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext(); const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => {
    window.__calls = [];
    const builder = (table) => { const rec = { table, ops: [] }; const b = new Proxy({}, { get: (_, k) => { if (k === 'then') return (res) => { window.__calls.push(rec); res({ data: rec.table === 'members' ? [{ user_id: 'u', role: 'owner', label: 'x', joined_at: 'now' }] : [], error: null }); }; return (...a) => { rec.ops.push([k, a]); return b; }; } }); return b; };
    window.supabase = { createClient: (url, key, opts) => { window.__calls.push({ createClient: [url, key, opts] }); return {
      auth: { getSession: async () => ({ data: { session: null } }), signInAnonymously: async () => ({ data: { session: { user: { id: 'anon-user-1' } } }, error: null }) },
      rpc: async (name, args) => { window.__calls.push({ rpc: name, args }); const out = { create_household: [{ household_id: 'h', invite_code: 'ABCDEF012345' }], join_household: [{ household_id: 'h', household_name: 'Home', error: null }], new_invite: 'ABCDEF012345' }; return { data: out[name] === undefined ? null : out[name], error: null }; },
      from: (t) => builder(t), channel: (n) => { const c = { on: (...a) => { window.__calls.push({ channel: n, on: a }); return c; }, subscribe: () => c }; return c; }, removeChannel: () => {} }; } };
  });
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.STOCKCUP_CONFIG = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon-key' };" }));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html')); await page.click('[data-act=gSkip]');
  const calls = () => page.evaluate(() => window.__calls); const reset = () => page.evaluate(() => { window.__calls.length = 0; });
  const run = (fn, ...a) => page.evaluate(async ([src, args]) => { const f = new Function('b', 'args', 'return (' + src + ')(b, ...args)'); return f(getBackend(), args); }, [fn.toString(), a]);
  console.log('supabase client layer vs schema.sql');
  await test('signs in anonymously (no email) with a persistent session, using the configured project', async () => {
    await run(async (b) => b.userId()); const c = await calls(); const cc = c.find((x) => x.createClient).createClient; assert.strictEqual(cc[0], 'https://example.supabase.co'); assert.strictEqual(cc[1], 'anon-key'); assert.strictEqual(cc[2].auth.persistSession, true);
    assert.strictEqual(await run(async (b) => b.userId()), 'anon-user-1');
  });
  const rpcs = [['create', ['Home', 'Dad'], 'create_household', ['p_name', 'p_label']], ['join', ['ABCD-EF01-2345', 'Mum'], 'join_household', ['p_code', 'p_label']], ['invite', ['h'], 'new_invite', ['p_household']], ['remove', ['h', 'u'], 'remove_member', ['p_household', 'p_user']], ['leave', ['h'], 'leave_household', ['p_household']], ['destroy', ['h'], 'delete_household', ['p_household']]];
  for (const [method, args, fn, params] of rpcs) {
    await test(method + ' calls ' + fn + ' with the parameters the SQL function declares', async () => {
      await reset(); await run(async (b, m, a) => b[m](...a), method, args); const c = (await calls()).find((x) => x.rpc); assert.strictEqual(c.rpc, fn); assert.deepStrictEqual(Object.keys(c.args), params);
      const decl = sql.match(new RegExp('function public\\.' + fn + '\\(([^)]*)\\)')); assert.ok(decl, fn + ' exists in schema.sql'); params.forEach((p) => assert.ok(decl[1].indexOf(p + ' ') >= 0, p + ' declared in ' + fn));
    });
  }
  await test('members read uses the members table and its real columns', async () => {
    await reset(); await run(async (b) => b.members('h')); const t = (await calls()).find((x) => x.table === 'members'); const sel = t.ops.find((o) => o[0] === 'select')[1][0].split(','); const tbl = sql.match(/create table if not exists public\.members \(([\s\S]*?)\n\);/)[1]; sel.forEach((col) => assert.ok(tbl.indexOf(col + ' ') >= 0, col)); assert.deepStrictEqual(t.ops.find((o) => o[0] === 'eq')[1], ['household_id', 'h']);
  });
  await test('sending operations is an idempotent insert into ops by op_id, with real columns', async () => {
    await reset(); const row = { op_id: 'o1', device_id: 'd', type: 'put', v: 1, payload: { a: 1 } }; await run(async (b, r) => b.transport.push('h', [r]), row); const t = (await calls()).find((x) => x.table === 'ops'); const up = t.ops.find((o) => o[0] === 'upsert')[1];
    assert.strictEqual(up[1].onConflict, 'op_id'); assert.strictEqual(up[1].ignoreDuplicates, true); assert.strictEqual(up[0][0].household_id, 'h');
    const tbl = sql.match(/create table if not exists public\.ops \(([\s\S]*?)\n\);/)[1]; Object.keys(up[0][0]).forEach((col) => assert.ok(new RegExp('\\b' + col + ' ').test(tbl), col + ' is a column of ops'));
  });
  await test('pulling asks for everything after the last sequence, in order, in pages', async () => {
    await reset(); await run(async (b) => b.transport.pull('h', 41, 500)); const t = (await calls()).find((x) => x.table === 'ops'); const names = t.ops.map((o) => o[0]); assert.deepStrictEqual(names, ['select', 'eq', 'gt', 'order', 'limit']);
    assert.deepStrictEqual(t.ops[1][1], ['household_id', 'h']); assert.deepStrictEqual(t.ops[2][1], ['server_seq', 41]); assert.deepStrictEqual(t.ops[3][1], ['server_seq', { ascending: true }]); assert.deepStrictEqual(t.ops[4][1], [500]);
    t.ops[0][1][0].split(',').forEach((col) => assert.ok(sql.indexOf(col) >= 0, col));
  });
  await test('live updates listen for inserts on ops for this household only', async () => {
    await reset(); await run(async (b) => { b.transport.subscribe('h', () => {}); await new Promise((r) => setTimeout(r, 50)); }); const ch = (await calls()).find((x) => x.channel); const spec = ch.on[1]; assert.strictEqual(spec.event, 'INSERT'); assert.strictEqual(spec.table, 'ops'); assert.strictEqual(spec.filter, 'household_id=eq.h');
    assert.ok(/alter publication supabase_realtime add table public\.ops/.test(sql), 'schema publishes ops to realtime');
  });
  await test('a successful join returns the household id and name', async () => {
    const r = await run(async (b) => { return b.join('x', 'y'); }); assert.ok(r.id === 'h');
  });
  await test('no page errors', async () => assert.deepStrictEqual(errs, []));
  await b.close(); console.log(failed ? failed + ' failed' : 'supabase API checks passed'); process.exit(failed ? 1 : 0);
})();
