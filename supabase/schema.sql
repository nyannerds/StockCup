-- StockCup household sync: database schema for Supabase.
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Before using the app also enable: Authentication -> Sign In / Providers -> "Allow anonymous sign-ins".
--
-- Security model
--   * People have no email or password. Each phone signs in anonymously (a silent identity) and joins a household with an invite code.
--   * Row-level security: only members of a household can read or add its operations. Operations are append-only (no update, no delete).
--   * Households, members and invites can only be changed through the functions below (they check who is calling).

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  seq bigint not null default 0                      -- last server_seq handed out for this household
);

create table if not exists public.members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('owner', 'member')),
  label text not null check (char_length(label) between 1 and 40),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.invites (
  code text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null,
  expires_at timestamptz not null default now() + interval '7 days',
  max_uses int not null default 5,
  uses int not null default 0
);

create table if not exists public.join_attempts (
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists join_attempts_user_at on public.join_attempts (user_id, at);

create table if not exists public.ops (
  household_id uuid not null references public.households(id) on delete cascade,
  server_seq bigint not null,                        -- assigned by the trigger below; the order everyone replays in
  op_id uuid not null unique,                        -- makes re-sending harmless
  device_id text not null check (char_length(device_id) <= 80),
  type text not null check (char_length(type) <= 40),
  v int not null default 1,
  payload jsonb not null check ((type = 'snapshot' and octet_length(payload::text) < 8000000) or octet_length(payload::text) < 200000),
  author uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (household_id, server_seq)
);

-- Gap-free, commit-ordered sequence per household. The row lock on the household is held until the
-- inserting transaction commits, so a phone that pulls "everything after N" can never miss a late commit.
create or replace function public.ops_assign_seq() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.households set seq = seq + 1 where id = new.household_id returning seq into new.server_seq;
  if new.server_seq is null then raise exception 'unknown household'; end if;
  return new;
end $$;
drop trigger if exists ops_seq on public.ops;
create trigger ops_seq before insert on public.ops for each row execute function public.ops_assign_seq();

create or replace function public.is_member(hid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.members m where m.household_id = hid and m.user_id = auth.uid())
$$;

-- ---------- row-level security ----------
alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.join_attempts enable row level security;
alter table public.ops enable row level security;

drop policy if exists households_read on public.households;
create policy households_read on public.households for select to authenticated using (public.is_member(id));
drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated using (public.is_member(household_id));
drop policy if exists ops_read on public.ops;
create policy ops_read on public.ops for select to authenticated using (public.is_member(household_id));
drop policy if exists ops_add on public.ops;
create policy ops_add on public.ops for insert to authenticated with check (public.is_member(household_id) and author = auth.uid());
-- no policies on invites / join_attempts: nobody can touch them directly; no update/delete policy on ops: append-only.

revoke all on public.households, public.members, public.invites, public.join_attempts, public.ops from anon, authenticated;
grant select on public.households, public.members, public.ops to authenticated;
grant insert on public.ops to authenticated;

-- ---------- functions (the only way to create, join, invite, remove) ----------
create or replace function public.make_code() returns text language sql volatile as $$
  select upper(substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 12))
$$;

create or replace function public.create_household(p_name text, p_label text)
returns table (household_id uuid, invite_code text)
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); hid uuid; code text; nm text := btrim(coalesce(p_name, '')); lb text := btrim(coalesce(p_label, ''));
begin
  if uid is null then raise exception 'not signed in'; end if;
  if char_length(nm) < 1 or char_length(nm) > 60 then raise exception 'household name must be 1 to 60 characters'; end if;
  if char_length(lb) < 1 or char_length(lb) > 40 then lb := 'Member'; end if;
  if (select count(*) from public.households h where h.created_by = uid) >= 3 then raise exception 'too many households'; end if;
  insert into public.households (name, created_by) values (nm, uid) returning id into hid;
  insert into public.members (household_id, user_id, role, label) values (hid, uid, 'owner', lb);
  code := public.make_code();
  insert into public.invites (code, household_id, created_by) values (code, hid, uid);
  return query select hid, code;
end $$;

-- Returns an error text instead of raising, so that failed guesses are still recorded (a raise would roll the record back).
create or replace function public.join_household(p_code text, p_label text)
returns table (household_id uuid, household_name text, error text)
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); norm text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')); inv public.invites%rowtype; hn text; lb text := btrim(coalesce(p_label, ''));
begin
  if uid is null then raise exception 'not signed in'; end if;
  delete from public.join_attempts where at < now() - interval '1 day';
  if (select count(*) from public.join_attempts a where a.user_id = uid and a.at > now() - interval '10 minutes') >= 10 then
    return query select null::uuid, null::text, 'too_many_attempts'::text; return;
  end if;
  if char_length(lb) < 1 or char_length(lb) > 40 then lb := 'Member'; end if;
  select * into inv from public.invites i where i.code = norm and i.expires_at > now() and i.uses < i.max_uses for update;
  if not found then
    insert into public.join_attempts (user_id) values (uid);
    return query select null::uuid, null::text, 'invalid_or_expired_code'::text; return;
  end if;
  if not exists (select 1 from public.members m where m.household_id = inv.household_id and m.user_id = uid) then
    insert into public.members (household_id, user_id, role, label) values (inv.household_id, uid, 'member', lb);
    update public.invites set uses = uses + 1 where code = inv.code;
  end if;
  select h.name into hn from public.households h where h.id = inv.household_id;
  return query select inv.household_id, hn, null::text;
end $$;

create or replace function public.new_invite(p_household uuid) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); code text;
begin
  if not exists (select 1 from public.members m where m.household_id = p_household and m.user_id = uid and m.role = 'owner') then raise exception 'only the owner can create invites'; end if;
  delete from public.invites i where i.household_id = p_household and (i.expires_at < now() or i.uses >= i.max_uses);
  code := public.make_code();
  insert into public.invites (code, household_id, created_by) values (code, p_household, uid);
  return code;
end $$;

create or replace function public.remove_member(p_household uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if not exists (select 1 from public.members m where m.household_id = p_household and m.user_id = uid and m.role = 'owner') then raise exception 'only the owner can remove members'; end if;
  if p_user = uid then raise exception 'use leave to remove yourself'; end if;
  delete from public.members m where m.household_id = p_household and m.user_id = p_user;
end $$;

create or replace function public.leave_household(p_household uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); was_owner boolean; next_owner uuid;
begin
  select (m.role = 'owner') into was_owner from public.members m where m.household_id = p_household and m.user_id = uid;
  if was_owner is null then return; end if;
  delete from public.members m where m.household_id = p_household and m.user_id = uid;
  if not exists (select 1 from public.members m where m.household_id = p_household) then
    delete from public.households h where h.id = p_household;
  elsif was_owner and not exists (select 1 from public.members m where m.household_id = p_household and m.role = 'owner') then
    select m.user_id into next_owner from public.members m where m.household_id = p_household order by m.joined_at limit 1;
    update public.members m set role = 'owner' where m.household_id = p_household and m.user_id = next_owner;
  end if;
end $$;

create or replace function public.delete_household(p_household uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.members m where m.household_id = p_household and m.user_id = auth.uid() and m.role = 'owner') then raise exception 'only the owner can delete the household'; end if;
  delete from public.households h where h.id = p_household;
end $$;

revoke all on function public.create_household(text, text), public.join_household(text, text), public.new_invite(uuid), public.remove_member(uuid, uuid), public.leave_household(uuid), public.delete_household(uuid), public.make_code(), public.is_member(uuid), public.ops_assign_seq() from public, anon;
grant execute on function public.create_household(text, text), public.join_household(text, text), public.new_invite(uuid), public.remove_member(uuid, uuid), public.leave_household(uuid), public.delete_household(uuid), public.is_member(uuid) to authenticated;

-- live updates: phones are told when a new operation arrives (row-level security still applies)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'ops') then
    alter publication supabase_realtime add table public.ops;
  end if;
end $$;
