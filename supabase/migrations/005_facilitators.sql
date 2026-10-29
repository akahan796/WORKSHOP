-- ─────────────────────────────────────────────────────────────────────────────
-- Workshop AI — facilitators (after 004). Safe to re-run.
-- A member with role 'facilitator' runs the workshop like its creator: room
-- controls, AI actions, setup and invites. Only the creator (organizer_id) can
-- delete the workshop.
-- ─────────────────────────────────────────────────────────────────────────────

alter table members drop constraint if exists members_role_check;
alter table members add constraint members_role_check
  check (role in ('organizer', 'facilitator', 'researcher', 'participant'));

-- "Organizer" in every policy now means: the creator, or a facilitator member.
create or replace function is_organizer(ws uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from workshops where id = ws and organizer_id = auth.uid())
      or exists (select 1 from members where workshop_id = ws and user_id = auth.uid() and role = 'facilitator');
$$;

drop policy if exists "organizer edits workshop" on workshops;
create policy "organizer edits workshop" on workshops for update using (is_organizer(id));
