-- ─────────────────────────────────────────────────────────────────────────────
-- Workshop AI — phase 3 migration (after 002). Crazy 8s sheets, solution
-- sketches, and the sketch image bucket. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- One row per person per kind: their Crazy 8s sheet, or their solution sketch.
create table if not exists sheets (
  id          uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references workshops on delete cascade,
  member_id   uuid not null references members on delete cascade,
  kind        text not null check (kind in ('crazy8', 'solution')),
  title       text not null default '',
  summary     text not null default '',
  based_on    uuid,                         -- the Crazy 8s cell a solution builds on
  cells       jsonb not null default '[]',  -- [{ id, file_path, caption }]: 8 cells, or the solution's frames
  ready       boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (workshop_id, member_id, kind)
);
create index if not exists sheets_workshop_idx on sheets (workshop_id);

alter table sheets enable row level security;
drop policy if exists "members read sheets" on sheets;
drop policy if exists "owners write sheets" on sheets;
create policy "members read sheets" on sheets for select using (is_member(workshop_id));
-- Owners edit their own; organizers also write for synthetic participants.
create policy "owners write sheets" on sheets for all
  using (member_id = my_member_id(workshop_id) or is_organizer(workshop_id))
  with check (member_id = my_member_id(workshop_id) or is_organizer(workshop_id));

do $$ begin
  alter publication supabase_realtime add table sheets;
exception when duplicate_object then null; end $$;

-- Sketch images, path <workshop_id>/<member_id>/<file>.
insert into storage.buckets (id, name, public) values ('sketches', 'sketches', false)
  on conflict (id) do nothing;
drop policy if exists "members read sketches" on storage.objects;
drop policy if exists "owners upload sketches" on storage.objects;
drop policy if exists "owners delete sketches" on storage.objects;
create policy "members read sketches" on storage.objects for select
  using (bucket_id = 'sketches' and is_member(((storage.foldername(name))[1])::uuid));
create policy "owners upload sketches" on storage.objects for insert
  with check (bucket_id = 'sketches' and (
    ((storage.foldername(name))[2])::uuid = my_member_id(((storage.foldername(name))[1])::uuid)
    or is_organizer(((storage.foldername(name))[1])::uuid)));
create policy "owners delete sketches" on storage.objects for delete
  using (bucket_id = 'sketches' and (
    ((storage.foldername(name))[2])::uuid = my_member_id(((storage.foldername(name))[1])::uuid)
    or is_organizer(((storage.foldername(name))[1])::uuid)));
