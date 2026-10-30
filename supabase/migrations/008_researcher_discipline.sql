-- ─────────────────────────────────────────────────────────────────────────────
-- Workshop AI — researcher becomes a discipline (after 007). Safe to re-run.
-- Researchers are now participants whose discipline is 'researcher'. They keep
-- presenter access (research decks, live step state), now keyed on discipline.
-- ─────────────────────────────────────────────────────────────────────────────

alter table members drop constraint if exists members_role_check;
alter table members drop constraint if exists members_discipline_check;

update members set role = 'participant', discipline = 'researcher' where role = 'researcher';

alter table members add constraint members_role_check
  check (role in ('organizer', 'facilitator', 'participant'));
alter table members add constraint members_discipline_check
  check (discipline in ('design', 'pm', 'eng', 'researcher'));

create or replace function is_researcher(ws uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from members where workshop_id = ws and user_id = auth.uid() and discipline = 'researcher');
$$;

create or replace function set_step_state(ws uuid, patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (is_organizer(ws) or is_researcher(ws)) then raise exception 'not allowed'; end if;
  update workshops set step_state = step_state || patch where id = ws;
end $$;

drop policy if exists "presenters add research" on research;
create policy "presenters add research" on research for insert
  with check (is_organizer(workshop_id) or is_researcher(workshop_id));
drop policy if exists "presenters remove research" on research;
create policy "presenters remove research" on research for delete
  using (is_organizer(workshop_id) or is_researcher(workshop_id));

drop policy if exists "presenters upload decks" on storage.objects;
create policy "presenters upload decks" on storage.objects for insert
  with check (bucket_id = 'research' and (
    is_organizer(((storage.foldername(name))[1])::uuid) or is_researcher(((storage.foldername(name))[1])::uuid)));
