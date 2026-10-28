-- ─────────────────────────────────────────────────────────────────────────────
-- Workshop AI — Supabase schema (phase 1).
-- Run once in the Supabase SQL Editor, then every file in supabase/migrations/
-- in order. (Existing projects: run only the migrations you haven't run yet.) Safe to re-run: objects are dropped and
-- recreated, but re-running WIPES workshop data.
--
-- Auth model:
--   • Organizers are real Supabase users (email + password).
--   • Everyone else (researchers, participants) signs in ANONYMOUSLY from their
--     invite link and is bound to one workshop via claim_invite().
--   • Row-level security limits every table to members of the workshop.
-- ─────────────────────────────────────────────────────────────────────────────

drop table if exists votes, stickies, research, invites, members, workshops, profiles cascade;

-- Staff profile (organizers). Anonymous guests never get one.
create table profiles (
  id         uuid primary key references auth.users on delete cascade,
  name       text not null default '',
  email      text not null default '',
  created_at timestamptz not null default now()
);

create table workshops (
  id            uuid primary key default gen_random_uuid(),
  organizer_id  uuid not null default auth.uid() references auth.users on delete cascade,
  title         text not null default 'Untitled workshop',
  project       text not null default '',
  description   text not null default '',
  starts_at     timestamptz,
  intro         jsonb not null default '{}',   -- { welcome, background, overview, rules[], expectations }
  agenda        jsonb not null default '[]',   -- [ { key, enabled, minutes } ]
  status        text not null default 'draft' check (status in ('draft','live','done')),
  current_step  text not null default 'intro', -- agenda key everyone is on
  step_state    jsonb not null default '{}',   -- live flags: research doc/page, reveals, timer pause
  timer_ends_at timestamptz,
  created_at    timestamptz not null default now()
);

create table members (
  id           uuid primary key default gen_random_uuid(),
  workshop_id  uuid not null references workshops on delete cascade,
  user_id      uuid references auth.users on delete set null,
  name         text not null default '',
  email        text not null default '',
  role         text not null check (role in ('organizer','researcher','participant')),
  discipline   text check (discipline in ('design','pm','eng')),
  color        text not null default '#FFE27A',
  is_decider   boolean not null default false,
  is_synthetic boolean not null default false,
  joined_at    timestamptz,
  created_at   timestamptz not null default now()
);
create index on members (workshop_id);
create index on members (user_id);

-- Invite tokens live apart from members so participants can't read each other's links.
create table invites (
  token       text primary key default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  member_id   uuid not null unique references members on delete cascade,
  workshop_id uuid not null references workshops on delete cascade
);

create table research (
  id          uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references workshops on delete cascade,
  member_id   uuid references members on delete set null,
  title       text not null default '',
  file_path   text not null,               -- storage path: <workshop_id>/<uuid>.pdf
  created_at  timestamptz not null default now()
);

create table stickies (
  id          uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references workshops on delete cascade,
  member_id   uuid not null references members on delete cascade,
  step        text not null,               -- 'research' | 'hmw' | …
  kind        text not null,               -- 'pain' | 'opportunity' | 'observation' | 'question' | 'hmw'
  text        text not null,
  data        jsonb not null default '{}', -- later phases: grid position, votes, etc.
  created_at  timestamptz not null default now()
);
create index on stickies (workshop_id);

-- ── Helpers (security definer so policies can call them without recursion) ──
create or replace function is_member(ws uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from members where workshop_id = ws and user_id = auth.uid());
$$;

create or replace function is_organizer(ws uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from workshops where id = ws and organizer_id = auth.uid());
$$;

create or replace function has_role(ws uuid, r text) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from members where workshop_id = ws and user_id = auth.uid() and role = r);
$$;

create or replace function my_member_id(ws uuid) returns uuid
language sql security definer stable set search_path = public as $$
  select id from members where workshop_id = ws and user_id = auth.uid() limit 1;
$$;

create or replace function is_staff() returns boolean
language sql stable as $$
  select auth.uid() is not null and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false;
$$;

-- Guest invite: bind the calling (anonymous) user to the invited member.
create or replace function claim_invite(p_token text, p_name text, p_discipline text)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv invites;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into inv from invites where token = p_token;
  if not found then raise exception 'invalid invite'; end if;
  update members set
    user_id    = auth.uid(),
    name       = coalesce(nullif(trim(p_name), ''), name),
    discipline = case when role = 'participant' then coalesce(nullif(p_discipline, ''), discipline) else discipline end,
    joined_at  = coalesce(joined_at, now())
  where id = inv.member_id;
  return inv.workshop_id;
end $$;

-- Read the workshop name/role behind an invite before claiming it (for the join page).
create or replace function peek_invite(p_token text)
returns table (workshop_title text, member_name text, member_role text, member_discipline text)
language sql security definer stable set search_path = public as $$
  select w.title, m.name, m.role, m.discipline
  from invites i join members m on m.id = i.member_id join workshops w on w.id = i.workshop_id
  where i.token = p_token;
$$;

-- Live state that the presenter (researcher) may change too, not just the organizer.
create or replace function set_step_state(ws uuid, patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (is_organizer(ws) or has_role(ws, 'researcher')) then raise exception 'not allowed'; end if;
  update workshops set step_state = step_state || patch where id = ws;
end $$;

-- New staff user → profile row.
create or replace function on_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.is_anonymous, false) = false then
    insert into profiles (id, name, email)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''), coalesce(new.email, ''))
    on conflict (id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function on_new_user();

-- New workshop → the organizer becomes its first member.
create or replace function on_new_workshop() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into members (workshop_id, user_id, name, email, role, color, joined_at)
  select new.id, new.organizer_id, p.name, p.email, 'organizer', '#CFE0FF', now()
  from profiles p where p.id = new.organizer_id;
  return new;
end $$;
create trigger on_workshop_created after insert on workshops
  for each row execute function on_new_workshop();

-- New member → invite token (organizer's own row doesn't need one, but it's harmless).
create or replace function on_new_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into invites (member_id, workshop_id) values (new.id, new.workshop_id);
  return new;
end $$;
create trigger on_member_created after insert on members
  for each row execute function on_new_member();

-- ── Row-level security ──
alter table profiles  enable row level security;
alter table workshops enable row level security;
alter table members   enable row level security;
alter table invites   enable row level security;
alter table research  enable row level security;
alter table stickies  enable row level security;

create policy "own profile" on profiles for all using (id = auth.uid()) with check (id = auth.uid());

create policy "members read workshop" on workshops for select using (organizer_id = auth.uid() or is_member(id));
create policy "staff create workshop" on workshops for insert with check (is_staff() and organizer_id = auth.uid());
create policy "organizer edits workshop" on workshops for update using (organizer_id = auth.uid());
create policy "organizer deletes workshop" on workshops for delete using (organizer_id = auth.uid());

create policy "members read roster" on members for select using (is_member(workshop_id) or is_organizer(workshop_id));
create policy "organizer manages roster" on members for all using (is_organizer(workshop_id)) with check (is_organizer(workshop_id));

create policy "organizer reads invites" on invites for select using (is_organizer(workshop_id));

create policy "members read research" on research for select using (is_member(workshop_id));
create policy "presenters add research" on research for insert
  with check (is_organizer(workshop_id) or has_role(workshop_id, 'researcher'));
create policy "presenters remove research" on research for delete
  using (is_organizer(workshop_id) or has_role(workshop_id, 'researcher'));

create policy "members read stickies" on stickies for select using (is_member(workshop_id));
create policy "members add own stickies" on stickies for insert
  with check (member_id = my_member_id(workshop_id) or is_organizer(workshop_id));
create policy "authors edit stickies" on stickies for update
  using (member_id = my_member_id(workshop_id) or is_organizer(workshop_id));
create policy "authors delete stickies" on stickies for delete
  using (member_id = my_member_id(workshop_id) or is_organizer(workshop_id));

-- ── Realtime ──
alter publication supabase_realtime add table workshops, members, research, stickies;

-- ── Storage: research decks, path <workshop_id>/<file>.pdf ──
insert into storage.buckets (id, name, public) values ('research', 'research', false)
  on conflict (id) do nothing;
drop policy if exists "members read decks" on storage.objects;
drop policy if exists "presenters upload decks" on storage.objects;
create policy "members read decks" on storage.objects for select
  using (bucket_id = 'research' and is_member(((storage.foldername(name))[1])::uuid));
create policy "presenters upload decks" on storage.objects for insert
  with check (bucket_id = 'research' and (
    is_organizer(((storage.foldername(name))[1])::uuid) or has_role(((storage.foldername(name))[1])::uuid, 'researcher')));
