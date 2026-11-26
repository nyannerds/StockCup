// Runs supabase/schema.sql in a real Postgres (PGlite, in memory) and checks access rules, sequencing and invites.
// Supabase's auth.uid() and roles are stubbed. Run: node tests/schema.test.js   (needs: npm install)
const { PGlite } = require('@electric-sql/pglite'); const fs = require('fs'); const path = require('path'); const assert = require('assert');
let passed = 0, failed = 0; async function test(n, fn) { try { await fn(); passed++; console.log('  ok   ' + n); } catch (e) { failed++; console.log('  FAIL ' + n + '\n       ' + String(e.message || e).split('\n').slice(0, 3).join('\n       ')); } }
const U1 = '11111111-1111-1111-1111-111111111111', U2 = '22222222-2222-2222-2222-222222222222', U3 = '33333333-3333-3333-3333-333333333333', U4 = '44444444-4444-4444-4444-444444444444';
const uuid = () => crypto.randomUUID();
(async () => {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create publication supabase_realtime; grant usage on schema auth, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;`);
  await db.exec(fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8')); // must be re-runnable
  // act as a signed-in (anonymous) user, or as no one
  async function as(uid, fn, role) { await db.exec(`set role ${role || 'authenticated'}; select set_config('request.jwt.claim.sub', '${uid || ''}', false);`); try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); } }
  const q = (sql, params) => db.query(sql, params);
  const denied = async (uid, sql, params, role) => { let err = null; let rows = null; try { rows = (await as(uid, () => q(sql, params), role)).rows; } catch (e) { err = e; } return { err, rows }; };
  const row = (r) => ({ household_id: null, op_id: uuid(), device_id: 'dev', type: 'put', payload: JSON.stringify({ n: 1 }) });
  const addOp = (uid, hid, extra) => as(uid, () => q(`insert into public.ops (household_id, op_id, device_id, type, payload) values ($1,$2,'dev',$3,$4::jsonb) on conflict (op_id) do nothing returning server_seq`, [hid, (extra && extra.op_id) || uuid(), (extra && extra.type) || 'put', (extra && extra.payload) || '{"n":1}']));
  let H1, CODE1, H2;
  console.log('schema, access rules and invites (real Postgres)');
  await test('creating a household returns an id and a 12-character code; the creator is the owner', async () => {
    const r = await as(U1, () => q(`select * from public.create_household('Home', 'Dad')`)); H1 = r.rows[0].household_id; CODE1 = r.rows[0].invite_code; assert.match(CODE1, /^[0-9A-F]{12}$/);
    const m = await as(U1, () => q('select role, label from public.members where household_id=$1', [H1])); assert.deepStrictEqual(m.rows, [{ role: 'owner', label: 'Dad' }]);
  });
  await test('server_seq is assigned in order, per household, and re-sent operations are ignored', async () => {
    const id = uuid(); const a = await addOp(U1, H1, { op_id: id }); const b = await addOp(U1, H1); const dup = await addOp(U1, H1, { op_id: id });
    assert.strictEqual(Number(a.rows[0].server_seq), 1); assert.strictEqual(Number(b.rows[0].server_seq), 2); assert.strictEqual(dup.rows.length, 0);
    const other = await as(U4, () => q(`select * from public.create_household('Other', 'Z')`)); H2 = other.rows[0].household_id; const c = await addOp(U4, H2); assert.strictEqual(Number(c.rows[0].server_seq), 1);
    const all = await as(U1, () => q('select server_seq from public.ops where household_id=$1 order by server_seq', [H1])); assert.deepStrictEqual(all.rows.map((r) => Number(r.server_seq)), [1, 2, 3].slice(0, all.rows.length));
  });
  await test('a stranger can read nothing and write nothing', async () => {
    for (const t of ['ops', 'households', 'members']) { const r = await denied(U2, `select * from public.${t}`); assert.ok(r.err || r.rows.length === 0, t); }
    const w = await denied(U2, `insert into public.ops (household_id, op_id, device_id, type, payload) values ($1,$2,'d','put','{}')`, [H1, uuid()]); assert.ok(w.err, 'insert blocked');
    for (const sql of [`select public.new_invite('${H1}')`, `select public.remove_member('${H1}', '${U1}')`, `select public.delete_household('${H1}')`]) { const r = await denied(U2, sql); assert.ok(r.err, sql); }
  });
  await test('invite codes are required and work: wrong code is refused, right code joins', async () => {
    const bad = await as(U2, () => q(`select * from public.join_household('AAAAAAAAAAAA', 'Mum')`)); assert.strictEqual(bad.rows[0].error, 'invalid_or_expired_code'); assert.strictEqual(bad.rows[0].household_id, null);
    const ok = await as(U2, () => q(`select * from public.join_household($1, 'Mum')`, [CODE1.slice(0, 4) + '-' + CODE1.slice(4, 8).toLowerCase() + ' ' + CODE1.slice(8)])); assert.strictEqual(ok.rows[0].household_id, H1); assert.strictEqual(ok.rows[0].error, null); assert.strictEqual(ok.rows[0].household_name, 'Home');
  });
  await test('members read and add operations; they cannot forge the author, update or delete', async () => {
    const r = await addOp(U2, H1); assert.ok(r.rows.length === 1);
    const seen = await as(U2, () => q('select count(*)::int n from public.ops where household_id=$1', [H1])); assert.ok(seen.rows[0].n >= 3);
    const forge = await denied(U2, `insert into public.ops (household_id, op_id, device_id, type, payload, author) values ($1,$2,'d','put','{}',$3)`, [H1, uuid(), U1]); assert.ok(forge.err, 'author spoofing blocked');
    const upd = await denied(U2, `update public.ops set payload='{"x":1}' where household_id=$1`, [H1]); assert.ok(upd.err || upd.rows.length === 0);
    const del = await denied(U1, `delete from public.ops where household_id=$1`, [H1]); assert.ok(del.err, 'even the owner cannot delete operations');
    const still = await as(U1, () => q('select count(*)::int n from public.ops where household_id=$1', [H1])); assert.strictEqual(still.rows[0].n, 3, 'nothing was deleted');
  });
  await test('households are isolated from each other', async () => {
    const mine = await as(U4, () => q('select household_id from public.ops')); assert.ok(mine.rows.every((r) => r.household_id === H2)); const lists = await as(U1, () => q('select id from public.households')); assert.deepStrictEqual(lists.rows.map((r) => r.id), [H1]);
    const cross = await denied(U4, `insert into public.ops (household_id, op_id, device_id, type, payload) values ($1,$2,'d','put','{}')`, [H1, uuid()]); assert.ok(cross.err);
  });
  await test('nobody can edit households, members or invites directly, or read invite codes', async () => {
    for (const sql of [`insert into public.households (name, created_by) values ('x', '${U1}')`, `update public.households set name='hacked'`, `insert into public.members (household_id,user_id,role,label) values ('${H1}','${U3}','owner','x')`, `update public.members set role='owner'`, `delete from public.members`, `select * from public.invites`, `insert into public.invites (code, household_id, created_by) values ('ZZZZZZZZZZZZ','${H1}','${U3}')`, `select * from public.join_attempts`]) { const r = await denied(U1, sql); assert.ok(r.err || (r.rows && r.rows.length === 0), sql); }
    const member = await denied(U2, `update public.members set role='owner' where user_id='${U2}'`); assert.ok(member.err || member.rows.length === 0);
    const roles = await as(U1, () => q('select user_id, role from public.members where household_id=$1 order by role', [H1])); assert.strictEqual(roles.rows.filter((r) => r.role === 'owner').length, 1);
  });
  await test('the anon role (not signed in) can do nothing', async () => {
    for (const sql of ['select * from public.ops', 'select * from public.households', `select * from public.create_household('x','y')`, `select * from public.join_household('AAAAAAAAAAAA','x')`]) { const r = await denied(null, sql, undefined, 'anon'); assert.ok(r.err, sql); }
  });
  await test('only the owner can invite; invites are limited in uses and in time', async () => {
    assert.ok((await denied(U2, `select public.new_invite('${H1}')`)).err);
    const code = (await as(U1, () => q(`select public.new_invite('${H1}') as c`))).rows[0].c; await db.exec(`update public.invites set max_uses = 1 where code = '${code}'`);
    const a = await as(U3, () => q(`select * from public.join_household($1,'Sam')`, [code])); assert.strictEqual(a.rows[0].error, null);
    const b = await as(U4, () => q(`select * from public.join_household($1,'Late')`, [code])); assert.strictEqual(b.rows[0].error, 'invalid_or_expired_code');
    const c2 = (await as(U1, () => q(`select public.new_invite('${H1}') as c`))).rows[0].c; await db.exec(`update public.invites set expires_at = now() - interval '1 minute' where code = '${c2}'`);
    const d = await as(U4, () => q(`select * from public.join_household($1,'Late')`, [c2])); assert.strictEqual(d.rows[0].error, 'invalid_or_expired_code');
  });
  await test('guessing codes is throttled: 10 failures lock the caller out even for a right code', async () => {
    const goodCode = (await as(U1, () => q(`select public.new_invite('${H1}') as c`))).rows[0].c; const guesser = '55555555-5555-5555-5555-555555555555';
    for (let i = 0; i < 10; i++) { const r = await as(guesser, () => q(`select * from public.join_household('BAD${i}BAD${i}XX','x')`)); assert.strictEqual(r.rows[0].error, 'invalid_or_expired_code'); }
    const locked = await as(guesser, () => q(`select * from public.join_household($1,'x')`, [goodCode])); assert.strictEqual(locked.rows[0].error, 'too_many_attempts');
    const mem = await as(U1, () => q('select count(*)::int n from public.members where household_id=$1 and user_id=$2', [H1, guesser])); assert.strictEqual(mem.rows[0].n, 0);
  });
  await test('removing a member cuts off their access immediately; members cannot remove others', async () => {
    assert.ok((await denied(U2, `select public.remove_member('${H1}','${U3}')`)).err); assert.ok((await denied(U1, `select public.remove_member('${H1}','${U1}')`)).err, 'owner cannot remove self');
    await as(U1, () => q(`select public.remove_member('${H1}','${U3}')`)); const after = await denied(U3, 'select * from public.ops'); assert.ok(after.rows.length === 0); assert.ok((await denied(U3, `insert into public.ops (household_id, op_id, device_id, type, payload) values ($1,$2,'d','put','{}')`, [H1, uuid()])).err);
  });
  await test('payload limits: normal operations are capped, snapshots may be large', async () => {
    const big = JSON.stringify({ s: 'x'.repeat(250000) }); assert.ok((await denied(U1, `insert into public.ops (household_id, op_id, device_id, type, payload) values ($1,$2,'d','put',$3::jsonb)`, [H1, uuid(), big])).err);
    const snap = await addOp(U1, H1, { type: 'snapshot', payload: big }); assert.strictEqual(snap.rows.length, 1);
  });
  await test('leaving: the owner leaving promotes another member; the last member leaving deletes the household and its data', async () => {
    await as(U1, () => q(`select public.leave_household('${H1}')`)); const roles = await as(U2, () => q('select user_id, role from public.members where household_id=$1', [H1])); assert.deepStrictEqual(roles.rows.map((r) => r.role), ['owner']); assert.strictEqual(roles.rows[0].user_id, U2);
    assert.ok((await denied(U1, 'select * from public.ops where household_id=$1', [H1])).rows.length === 0);
    await as(U2, () => q(`select public.leave_household('${H1}')`)); assert.strictEqual((await q('select count(*)::int n from public.households where id=$1', [H1])).rows[0].n, 0); assert.strictEqual((await q('select count(*)::int n from public.ops where household_id=$1', [H1])).rows[0].n, 0);
  });
  await test('only the owner can delete a household; deleting removes everything', async () => {
    const x = (await as(U3, () => q(`select * from public.create_household('Temp','Sam')`))).rows[0]; await addOp(U3, x.household_id);
    const j = await as(U1, () => q(`select * from public.join_household($1,'Dad')`, [x.invite_code])); assert.strictEqual(j.rows[0].error, null); assert.ok((await denied(U1, `select public.delete_household('${x.household_id}')`)).err);
    await as(U3, () => q(`select public.delete_household('${x.household_id}')`)); assert.strictEqual((await q('select count(*)::int n from public.ops where household_id=$1', [x.household_id])).rows[0].n, 0);
  });
  await test('input checks: household name and a limit of three households per person', async () => {
    assert.ok((await denied(U3, `select * from public.create_household('', 'x')`)).err); assert.ok((await denied(U3, `select * from public.create_household('${'n'.repeat(61)}', 'x')`)).err);
    for (const n of ['One', 'Two', 'Three']) await as(U3, () => q(`select * from public.create_household('${n}','x')`)); assert.ok((await denied(U3, `select * from public.create_household('Four','x')`)).err, 'fourth household refused');
  });
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})();
