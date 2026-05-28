-- Cleanup: remove the OLD shared-group packing system. Fully superseded by the
-- gear system (group_trip_gear_items / _gear_claims / _gear_requests), which adds
-- quantities + an approval flow. The old path had ZERO code callers
-- (setTripGroupPackingList / listTripGroupPackingClaims / claim / unclaim) and
-- only held test data (one "Snacks" claim).
--
-- NOT removed here: group_trip_participants.packing_list (personal list — live)
-- and group_trip_participants.personal_gear (personal gear — live). Different
-- tables, same-ish name. Do not confuse them.

-- ----------------------------------------------------------------------------
-- PART A — applied 2026-05-27 (safe immediately: nothing live reads/writes these)
-- ----------------------------------------------------------------------------

-- The prune trigger fires on group_trips UPDATE and references the claims table,
-- so it must go before/with the table or group_trips updates would error.
drop trigger if exists trg_prune_group_packing_claims on public.group_trips;
drop function if exists public.prune_group_packing_claims_on_list_change();

-- cascade also drops trg_enforce_group_packing_single_claim on this table.
drop table if exists public.group_trip_group_packing_claims cascade;
drop function if exists public.enforce_group_packing_single_claim();

-- ----------------------------------------------------------------------------
-- PART B — applied 2026-05-27 at user's explicit request (accepting that the
-- currently-deployed web bundle, which still inserts `group_packing_list: []`
-- via createGroupTrip(), will error on trip creation until this branch ships).
-- ----------------------------------------------------------------------------

alter table public.group_trips drop column if exists group_packing_list;
