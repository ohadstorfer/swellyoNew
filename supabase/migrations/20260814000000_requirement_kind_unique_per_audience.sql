-- Crew paperwork cannot be asked for on any trip that exists.
--
-- ── The bug ────────────────────────────────────────────────────────────────
-- 20260724000700 created:
--
--   unique (trip_id, kind) where kind <> 'custom'
--
-- 20260812000200 then added `audience` so that the same kind could be asked of
-- travelers and of crew separately — and did not widen the index. So one trip
-- can hold ONE passport requirement, full stop, and the operator screens offer
-- to create a second.
--
-- The result is that `ensureStaffRequirements` (crew sheet in the app, crew
-- page on the dashboard) fails with 23505 the first time an operator ticks a
-- kind their travelers are already asked for. Checked on production,
-- 14 August 2026: all 4 operator trips ask travelers for at least one of the
-- six crew kinds, so the tick fails on every one of them. Nobody has hit it
-- yet because there are 0 staff-audience requirements — the crew screens are
-- new.
--
-- ── The fix ────────────────────────────────────────────────────────────────
-- Put `audience` in the key. "One passport per trip" becomes "one passport per
-- trip per audience", which is what the column was added to mean.
--
-- Nothing changes for existing rows: every one of them is audience='traveler'
-- (the column default), so the new key is as unique as the old one over the
-- data that exists.
--
-- ⚠️ Re-running 20260810000200 after this will fail. Its DO block says
--    `on conflict (trip_id, kind) where kind <> 'custom'`, which no longer
--    matches an index. It is a one-off backfill that was applied by hand on
--    10 August and is not needed again; if it ever is, add `, audience` to the
--    three conflict targets first. No live FUNCTION uses that specifier —
--    checked with pg_proc on 14 August 2026.
--
-- ⚠️ APPLIED to production 2026-08-14. Never `db push`.
-- Idempotent: safe to re-run.
--
-- Verified after applying: the index is `(trip_id, kind, audience)`, and a crew
-- passport inserts cleanly onto a trip that already asks travelers for one
-- (proved in a DO block that raised to roll itself back — 0 staff-audience rows
-- remain).

drop index if exists public.uq_organized_trip_req_kind_per_trip;

create unique index if not exists uq_organized_trip_req_kind_per_trip
  on public.organized_trip_requirements (trip_id, kind, audience)
  where kind <> 'custom';

comment on index public.uq_organized_trip_req_kind_per_trip is
  'One row per kind per audience. `custom` is exempt: an operator may write as '
  'many of those as they like, which is the whole point of a custom item.';
