-- ⚠️ DRAFT — reconcile against live def before applying; RLS changes are
-- high-risk, apply table-by-table with before/after pg_policies diff + realtime +
-- visibility verification. (This file is indexes only — no RLS — but the header
-- is kept per WS5 convention. Indexes are non-blocking-ish but on a hot table:
-- prefer CREATE INDEX CONCURRENTLY when applying to prod — see note below.)
-- ============================================================================
-- WS5 Part A supporting indexes for match_surfers' sargable `prefiltered` CTE.
--
-- match_surfers (20260605120000_match_surfers.sql) now narrows on indexable
-- columns before the fuzzy mc_* fns + per-row JSONB scoring run. These indexes
-- let the planner use Index/Bitmap scans instead of a full Seq Scan on surfers.
--
--   * idx_surfers_age              -> the age range pre-filter (b.age >= / <=).
--   * idx_surfers_country_from_norm -> the normalized country_from equality path
--     inside mc_country_from_match (lower(btrim(country_from)) = lower(btrim(r))).
--     This is a FUNCTIONAL index; it matches that exact expression. The fn ALSO
--     has substring/position() fuzzy fallbacks that no btree index can serve —
--     those still scan, but the common exact-country case becomes indexable.
--
-- ALREADY EXIST on prod (per WS5 research — do NOT recreate, they are referenced
-- by the board/level pre-filter and the composite hard filter):
--   * idx_surfers_surf_level_category
--   * idx_surfers_surf_level_category_board_type
-- The controller MUST confirm these exist on LIVE before relying on them:
--   select indexname, indexdef from pg_indexes
--   where schemaname='public' and tablename='surfers' order by indexname;
--
-- APPLY NOTE: `create index if not exists` (plain) takes a brief ACCESS EXCLUSIVE
-- lock — fine on a small table, but on a busy prod `surfers` prefer:
--   create index concurrently if not exists idx_surfers_age on surfers (age);
-- (CONCURRENTLY cannot run inside a transaction block / the SQL-editor implicit
-- txn — run each CONCURRENTLY statement on its own.) The plain forms below are
-- the migration-of-record; swap to CONCURRENTLY at apply time if needed.
-- ============================================================================

create index if not exists idx_surfers_age
  on surfers (age);

create index if not exists idx_surfers_country_from_norm
  on surfers (lower(btrim(country_from)));

-- ---------------------------------------------------------------------------
-- VERIFY (after applying):
--   select indexname from pg_indexes
--   where schemaname='public' and tablename='surfers'
--     and indexname in ('idx_surfers_age','idx_surfers_country_from_norm');
--   -- expect both rows present.
--
-- ROLLBACK:
--   drop index if exists public.idx_surfers_age;
--   drop index if exists public.idx_surfers_country_from_norm;
-- ---------------------------------------------------------------------------
