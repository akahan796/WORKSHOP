-- ─────────────────────────────────────────────────────────────────────────────
-- Workshop AI — admins (after 005). Safe to re-run.
-- Every registered (non-anonymous) account is an admin: it sees and edits every
-- workshop, drafts and completed ones included, as if it were a facilitator.
-- Only the creator (organizer_id) can delete a workshop.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function is_staff() returns boolean
language sql stable as $$
  select auth.uid() is not null and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false;
$$;

-- Admins read everything a member reads...
create or replace function is_member(ws uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select is_staff() or exists (select 1 from members where workshop_id = ws and user_id = auth.uid());
$$;

-- ...and edit everything a facilitator edits.
create or replace function is_organizer(ws uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select is_staff()
      or exists (select 1 from workshops where id = ws and organizer_id = auth.uid())
      or exists (select 1 from members where workshop_id = ws and user_id = auth.uid() and role = 'facilitator');
$$;

-- Admins see each other's names (the dashboard shows who created each workshop).
drop policy if exists "staff read profiles" on profiles;
create policy "staff read profiles" on profiles for select using (is_staff());
