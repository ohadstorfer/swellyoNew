-- One waiver per trip, for the life of the trip.
--
-- Spec: docs/operator-trips-checklist.html §4 (scenario review, 17 Aug) —
--       "A new waiver quietly un-signs everyone".
--
-- ── The scenario ────────────────────────────────────────────────────────────
-- The waiver was versioned on purpose, and the versioning is CORRECT: a
-- traveler's acknowledgement is pinned to the exact `operator_document_id` they
-- agreed to, and `operator_trip_my_requirements` only counts an agreement
-- against the CURRENT document. So publishing waiver v2 does exactly what it
-- was designed to do — every signature collected against v1 stops counting.
--
-- The problem is everything that does NOT happen next. Nobody is told to sign
-- again. There is no automatic requirement reminder in the system (the only
-- producer of `operator_requirement_due_soon` is the operator pressing Remind),
-- so the waiver simply reverts to missing for every traveler on the trip and
-- sits there. On a trip that is already selling, that is a silent, retroactive
-- un-signing of people who did nothing wrong.
--
-- ── The decision ────────────────────────────────────────────────────────────
-- Ohad, 18 Aug: "simply no waiver changes after the trip is published."
--
-- So the fix is not a notification — it is removing the ability. The waiver is
-- set once, when the trip goes live, and is then frozen for the life of the
-- trip. That also makes the document a stabler legal record: there is exactly
-- one thing every traveler on a given trip agreed to, and it cannot move.
--
-- ── Why a unique index and not a trigger ────────────────────────────────────
-- The rule is literally "at most one row per (trip_id, kind)", which is what a
-- unique index says natively and enforces on every path — client, dashboard,
-- direct PostgREST, service role, backfill. A trigger would restate it in
-- procedural code and could be disabled; the index cannot be sidestepped by
-- anything short of dropping it.
--
-- `kind` is already CHECK-constrained to the single value 'waiver', so
-- (trip_id, kind) is (trip_id) today. It is written with `kind` anyway so that
-- adding a second document kind later does not silently make this index mean
-- something narrower than it reads.
--
-- The pre-existing UNIQUE (trip_id, kind, version) stays. It is now implied by
-- this one, but it is also the constraint that documents what `version` was
-- for, and dropping it buys nothing.
--
-- ── The path this deliberately keeps open ───────────────────────────────────
-- A trip with NO waiver can still get its first one. That is not a loophole,
-- it is a real repair path: `CreateTripFlowA` publishes the document and the
-- requirement rows in one try-block, and when the requirement insert fails it
-- tells the operator to add them from Edit. A trip can therefore legitimately
-- exist with a waiver requirement and no document — and until a document
-- exists, `operator_trip_my_requirements` can never mark the waiver approved,
-- so the trip is unjoinable. Version 1 must stay reachable.
--
-- Nobody is un-signed by allowing it, because there are no signatures to
-- invalidate: with no document, nothing could have been agreed to.
--
-- ── Verified before applying ────────────────────────────────────────────────
-- select trip_id, kind, count(*) from organized_trip_operator_documents
--   group by trip_id, kind having count(*) > 1;
-- -- 2026-08-18: no rows. Both trips carrying a waiver had exactly version 1,
-- -- so this applies without touching data.
--
-- ✅ APPLIED to prod 2026-08-18 (by Claude, on Ohad's standing say-so for this
--    stream of work). Ran via MCP execute_sql rather than apply_migration, so
--    the frozen supabase_migrations history is untouched.

create unique index if not exists organized_trip_operator_documents_one_per_trip
  on public.organized_trip_operator_documents (trip_id, kind);

comment on index public.organized_trip_operator_documents_one_per_trip is
  'One waiver per trip, for the life of the trip. Replacing it would silently '
  'un-sign every traveler who already agreed — their acknowledgement is pinned '
  'to the document id, and nothing in the system would tell them to sign again. '
  'The first waiver is still allowed, so a trip that failed to get one at '
  'publish can be repaired.';
