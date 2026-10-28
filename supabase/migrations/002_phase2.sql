-- ─────────────────────────────────────────────────────────────────────────────
-- Workshop AI — phase 2 migration (run once in the SQL Editor on a project that
-- already has schema.sql from phase 1). Adds synthetic-participant personas and
-- dot votes. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table members add column if not exists persona text not null default '';

create table if not exists votes (
  id          uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references workshops on delete cascade,
  member_id   uuid not null references members on delete cascade,
  target_id   uuid not null,                -- the sticky (HMW) voted for; one row per dot
  round       text not null default 'hmw',  -- 'hmw' now; later 'crazy8', 'solution', …
  created_at  timestamptz not null default now()
);
create index if not exists votes_workshop_idx on votes (workshop_id);

alter table votes enable row level security;
drop policy if exists "members read votes" on votes;
drop policy if exists "members cast own votes" on votes;
drop policy if exists "voters remove own votes" on votes;
create policy "members read votes" on votes for select using (is_member(workshop_id));
-- Organizers may also vote on behalf of synthetic participants.
create policy "members cast own votes" on votes for insert
  with check (member_id = my_member_id(workshop_id) or is_organizer(workshop_id));
create policy "voters remove own votes" on votes for delete
  using (member_id = my_member_id(workshop_id) or is_organizer(workshop_id));

do $$ begin
  alter publication supabase_realtime add table votes;
exception when duplicate_object then null; end $$;

-- The Decider (or organizer) records a final call, e.g. the HMW carried forward.
create or replace function set_decision(ws uuid, p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_key not in ('hmw_final', 'solution_final') then raise exception 'unknown decision'; end if;
  if not (is_organizer(ws) or exists (
    select 1 from members where workshop_id = ws and user_id = auth.uid() and is_decider)) then
    raise exception 'only the Decider or organizer can decide';
  end if;
  update workshops set step_state = step_state || jsonb_build_object(p_key, p_value) where id = ws;
end $$;
