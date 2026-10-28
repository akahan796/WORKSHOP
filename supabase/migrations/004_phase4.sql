-- ─────────────────────────────────────────────────────────────────────────────
-- Workshop AI — phase 4 migration (after 003). The user flow and prototype
-- versions the workshop produces. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists artifacts (
  id          uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references workshops on delete cascade,
  kind        text not null check (kind in ('flow', 'prototype')),
  version     integer not null default 1,
  data        jsonb not null default '{}',  -- flow: { title, steps[], details[], questions[] }; prototype: { source, notes }
  content     text not null default '',     -- prototype: the self-contained HTML
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (workshop_id, kind, version)
);
create index if not exists artifacts_workshop_idx on artifacts (workshop_id);

alter table artifacts enable row level security;
drop policy if exists "members read artifacts" on artifacts;
drop policy if exists "organizer writes artifacts" on artifacts;
create policy "members read artifacts" on artifacts for select using (is_member(workshop_id));
create policy "organizer writes artifacts" on artifacts for all
  using (is_organizer(workshop_id)) with check (is_organizer(workshop_id));

do $$ begin
  alter publication supabase_realtime add table artifacts;
exception when duplicate_object then null; end $$;
