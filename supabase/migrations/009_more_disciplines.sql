-- ─────────────────────────────────────────────────────────────────────────────
-- Workshop AI — more disciplines (after 008). Safe to re-run.
-- Adds Documentation, Agile Delivery Lead, End User, Product Growth and
-- Leadership. AI (synthetic) participants are always End Users.
-- ─────────────────────────────────────────────────────────────────────────────

alter table members drop constraint if exists members_discipline_check;
alter table members add constraint members_discipline_check
  check (discipline in ('design', 'pm', 'eng', 'researcher', 'docs', 'agile', 'enduser', 'growth', 'leadership'));

update members set discipline = 'enduser' where is_synthetic and role = 'participant';
