-- ============================================================================
-- Delete all group_trips NOT hosted by e11a30c8-aeff-4caf-bddf-adf231cf4456.
-- Run in the Supabase SQL editor (runs as a superuser role -> bypasses RLS).
--
-- Safety design:
--   * host_id is NOT NULL, so "not made by him" = host_id <> '<id>' (no NULLs).
--   * Every child row is deleted EXPLICITLY, deepest-first. We do NOT rely on
--     ON DELETE CASCADE (the gear_* / admin_updates tables were created by hand
--     and their delete rules aren't in the repo). Explicit deletes work either
--     way and never get blocked.
--   * Order is also trigger-safe: participants are removed in their own
--     statement (so the participant_count trigger updates a still-live trip row
--     instead of one being cascade-deleted -> avoids "tuple already modified").
--     Notifications are removed AFTER gear items (the gear-delete trigger emits
--     notifications), so no stragglers remain. group_trips is deleted last as a
--     clean leaf (no children, no DELETE trigger on it).
--   * The kept user's trips and their children are never in the target set.
--   * Removing a trip also removes that user's PARTICIPATION in others' trips
--     (the whole trip goes) -- expected for "delete all trips not made by him".
-- ============================================================================


------------------------------------------------------------------------------
-- STEP 1 - PREVIEW (read-only). Run alone first; eyeball the list + counts.
------------------------------------------------------------------------------
SELECT id, title, host_id, status, participant_count, created_at
FROM public.group_trips
WHERE host_id <> 'e11a30c8-aeff-4caf-bddf-adf231cf4456'
ORDER BY created_at;

SELECT
  count(*) FILTER (WHERE host_id <> 'e11a30c8-aeff-4caf-bddf-adf231cf4456') AS will_delete,
  count(*) FILTER (WHERE host_id  = 'e11a30c8-aeff-4caf-bddf-adf231cf4456') AS will_keep,
  count(*) AS total
FROM public.group_trips;


------------------------------------------------------------------------------
-- STEP 2 - DRY RUN. Performs every delete, prints the result, then ROLLS BACK.
-- Nothing is persisted. Confirm remaining_trips == will_keep before Step 3.
------------------------------------------------------------------------------
BEGIN;

CREATE TEMP TABLE _doomed_trips ON COMMIT DROP AS
  SELECT id FROM public.group_trips
  WHERE host_id <> 'e11a30c8-aeff-4caf-bddf-adf231cf4456';

-- 1. gear claims (FK -> gear_items.id)
DELETE FROM public.group_trip_gear_claims
WHERE item_id IN (SELECT id FROM public.group_trip_gear_items
                  WHERE trip_id IN (SELECT id FROM _doomed_trips));

-- 2. gear items (fires gear-notify trigger; notifications cleaned in step 8)
DELETE FROM public.group_trip_gear_items
WHERE trip_id IN (SELECT id FROM _doomed_trips);

-- 3. gear requests (referenced by gear_items.source_gear_request_id; items gone)
DELETE FROM public.group_trip_gear_requests
WHERE trip_id IN (SELECT id FROM _doomed_trips);

-- 4. admin updates
DELETE FROM public.group_trip_admin_updates
WHERE trip_id IN (SELECT id FROM _doomed_trips);

-- 5. commitment requests
DELETE FROM public.group_trip_commitment_requests
WHERE trip_id IN (SELECT id FROM _doomed_trips);

-- 6. join requests
DELETE FROM public.group_trip_join_requests
WHERE trip_id IN (SELECT id FROM _doomed_trips);

-- 7. destinations
DELETE FROM public.group_trip_destinations
WHERE trip_id IN (SELECT id FROM _doomed_trips);

-- 8. participants (own statement => count trigger updates a live trip row)
DELETE FROM public.group_trip_participants
WHERE trip_id IN (SELECT id FROM _doomed_trips);

-- 9. notifications (after gear: also clears notifications emitted by step 2)
DELETE FROM public.notifications
WHERE trip_id IN (SELECT id FROM _doomed_trips);

-- 10. the trips themselves (clean leaf now)
DELETE FROM public.group_trips
WHERE id IN (SELECT id FROM _doomed_trips);

-- verify (remaining_trips should equal will_keep from Step 1)
SELECT count(*) AS remaining_trips,
       count(*) FILTER (WHERE host_id = 'e11a30c8-aeff-4caf-bddf-adf231cf4456') AS kept_users_trips
FROM public.group_trips;

ROLLBACK;   -- dry run: discard everything


------------------------------------------------------------------------------
-- STEP 3 - REAL RUN. Identical to Step 2 but COMMITs. Run only after the dry
-- run's counts looked correct.
------------------------------------------------------------------------------
BEGIN;

CREATE TEMP TABLE _doomed_trips ON COMMIT DROP AS
  SELECT id FROM public.group_trips
  WHERE host_id <> 'e11a30c8-aeff-4caf-bddf-adf231cf4456';

DELETE FROM public.group_trip_gear_claims
WHERE item_id IN (SELECT id FROM public.group_trip_gear_items
                  WHERE trip_id IN (SELECT id FROM _doomed_trips));

DELETE FROM public.group_trip_gear_items
WHERE trip_id IN (SELECT id FROM _doomed_trips);

DELETE FROM public.group_trip_gear_requests
WHERE trip_id IN (SELECT id FROM _doomed_trips);

DELETE FROM public.group_trip_admin_updates
WHERE trip_id IN (SELECT id FROM _doomed_trips);

DELETE FROM public.group_trip_commitment_requests
WHERE trip_id IN (SELECT id FROM _doomed_trips);

DELETE FROM public.group_trip_join_requests
WHERE trip_id IN (SELECT id FROM _doomed_trips);

DELETE FROM public.group_trip_destinations
WHERE trip_id IN (SELECT id FROM _doomed_trips);

DELETE FROM public.group_trip_participants
WHERE trip_id IN (SELECT id FROM _doomed_trips);

DELETE FROM public.notifications
WHERE trip_id IN (SELECT id FROM _doomed_trips);

DELETE FROM public.group_trips
WHERE id IN (SELECT id FROM _doomed_trips);

COMMIT;
