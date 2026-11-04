-- ─────────────────────────────────────────────────────────────────────────────
-- Workshop AI — migration 010 (after 009). The optional Warm-Up Exercise keeps
-- each participant's saved drawings and uploaded photos on a 'warmup' sheet.
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────
alter table sheets drop constraint if exists sheets_kind_check;
alter table sheets add constraint sheets_kind_check check (kind in ('crazy8', 'solution', 'warmup'));
