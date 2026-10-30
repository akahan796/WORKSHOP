-- ─────────────────────────────────────────────────────────────────────────────
-- Workshop AI — pre-work documents (after 006). Safe to re-run.
-- Facilitators list the documents a workshop needs. Each one has a name, an
-- optional description and, once someone uploads it, a file. A document can be
-- requested from one person, who then uploads it through their guest link.
-- Files live in the private "prework" bucket at <workshop_id>/<document_id>/<file>.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists prework (
  id             uuid primary key default gen_random_uuid(),
  workshop_id    uuid not null references workshops on delete cascade,
  title          text not null default '',
  description    text not null default '',
  file_path      text,                                          -- null = not uploaded yet
  file_name      text,
  file_size      bigint,
  requested_from uuid references members on delete set null,    -- who's asked to upload it
  uploaded_by    uuid references members on delete set null,
  uploaded_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists prework_workshop_idx on prework (workshop_id);

alter table prework enable row level security;
drop policy if exists "members read prework" on prework;
drop policy if exists "organizer manages prework" on prework;
create policy "members read prework" on prework for select using (is_member(workshop_id));
create policy "organizer manages prework" on prework for all
  using (is_organizer(workshop_id)) with check (is_organizer(workshop_id));

-- May the caller upload a file for this document? Facilitators always; anyone
-- else only for a document requested from them.
create or replace function can_upload_prework(doc uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from prework p where p.id = doc
    and (is_organizer(p.workshop_id) or p.requested_from = my_member_id(p.workshop_id)));
$$;

-- Attach an uploaded file to a document (the person it was requested from can't
-- edit the row directly, only hand in the file).
create or replace function submit_prework(p_id uuid, p_path text, p_name text, p_size bigint)
returns void language plpgsql security definer set search_path = public as $$
declare doc prework;
begin
  select * into doc from prework where id = p_id;
  if not found or not can_upload_prework(p_id) then raise exception 'not allowed'; end if;
  if p_path not like doc.workshop_id || '/' || doc.id || '/%' then raise exception 'wrong file path'; end if;
  update prework set file_path = p_path, file_name = p_name, file_size = p_size,
    uploaded_by = my_member_id(doc.workshop_id), uploaded_at = now()
  where id = p_id;
end $$;

do $$ begin
  alter publication supabase_realtime add table prework;
exception when duplicate_object then null; end $$;

insert into storage.buckets (id, name, public) values ('prework', 'prework', false)
  on conflict (id) do nothing;
drop policy if exists "members read prework files" on storage.objects;
drop policy if exists "uploaders add prework files" on storage.objects;
drop policy if exists "organizer removes prework files" on storage.objects;
create policy "members read prework files" on storage.objects for select
  using (bucket_id = 'prework' and is_member(((storage.foldername(name))[1])::uuid));
create policy "uploaders add prework files" on storage.objects for insert
  with check (bucket_id = 'prework' and can_upload_prework(((storage.foldername(name))[2])::uuid));
create policy "organizer removes prework files" on storage.objects for delete
  using (bucket_id = 'prework' and is_organizer(((storage.foldername(name))[1])::uuid));
