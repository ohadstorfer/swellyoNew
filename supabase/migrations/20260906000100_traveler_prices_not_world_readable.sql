-- ─────────────────────────────────────────────────────────────────────────────
-- Traveler prices are no longer readable by every signed-in user.
--
-- group_trip_participants has ONE select policy — "readable by authenticated",
-- USING (true) — and it is right that it does: the explore feed, the trip
-- preview a stranger sees before asking to join, and the roster all read it.
-- But the same row carries the money the operator agreed with that one person
-- (price_total_usd, deposit_usd, and who set it when), and on 6 September 2026
-- a real account on no trip at all read 43 rows, 5 of them priced. Test N-10
-- in the operator-trip test pass.
--
-- The fix keeps the ROWS open and closes the four COLUMNS:
--
--   1. a view, organized_trip_traveler_prices, that exposes the money columns
--      to exactly the people who may read the payment ledger — the traveler
--      themself, and staff holding `payments.view_status` (the operator of
--      record included, via trip_staff_can). Same audience as
--      organized_trip_payment_events.otpe_read_own, on purpose: whoever can
--      see what somebody paid may see what they were asked to pay.
--
--   2. SELECT on the base table re-granted column by column, without the four.
--
-- Why not a narrower row policy: rows have to stay world-readable for the
-- preview. Why not a second table: four SECURITY DEFINER functions
-- (freeze_traveler_price, operator_set_traveler_price,
-- operator_traveler_amount_due, operator_freeze_trip_prices) and two
-- clients already read these columns off this row; moving them is a week,
-- this is an afternoon, and both end in the same place for a stranger.
--
-- ⚠️ THE TRAP THIS CREATES, read before adding a column to this table:
-- Postgres ignores a column-level REVOKE while a table-level GRANT stands, so
-- the only way to withhold four columns is to drop the table-level SELECT and
-- grant the other twenty-one BY NAME. From now on a NEW column on
-- group_trip_participants is invisible to the app until it is granted here:
--
--     grant select (your_new_column) on public.group_trip_participants
--       to anon, authenticated;
--
-- The symptom is "permission denied for table group_trip_participants" on
-- any select that names it, or on `select('*')`. Nothing in the app selects
-- `*` on this table today (audited 6 Sep 2026) — keep it that way.
--
-- The four functions above are all SECURITY DEFINER and unaffected. RLS
-- policies on this table read only `role` and `user_id`, both still granted.
-- Clients: operatorDashboardService.fetchTripMoney and
-- tripPaymentsService.fetchTravelerPrices in the app,
-- services/trips.fetchMembers in the dashboard — all three read the view now
-- and fall back to the table when it does not exist yet, so the JS may ship
-- before or after this file.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. The gated view. security_invoker=false so it may read the columns the
--    caller cannot; the WHERE is the whole gate.
create or replace view public.organized_trip_traveler_prices
with (security_invoker = false) as
  select p.trip_id,
         p.user_id,
         p.role,
         p.status,
         p.joined_at,
         p.price_total_usd,
         p.deposit_usd,
         p.price_set_by,
         p.price_set_at
    from public.group_trip_participants p
   where p.user_id = auth.uid()
      or public.trip_staff_can(p.trip_id, 'payments.view_status');

comment on view public.organized_trip_traveler_prices is
  'The money columns of group_trip_participants, readable only by the traveler '
  'themself and staff with payments.view_status. The base table withholds these '
  'four columns from anon/authenticated — see 20260906000100.';

revoke all on public.organized_trip_traveler_prices from public, anon;
grant select on public.organized_trip_traveler_prices to authenticated, service_role;

-- 2. Base table: drop the blanket SELECT, grant every column but the four.
revoke select on public.group_trip_participants from anon, authenticated;

grant select (
  id,
  trip_id,
  user_id,
  role,
  joined_at,
  committed,
  personal_gear_by_host,
  personal_gear_by_me,
  commitment_status,
  commitment_items,
  commitment_note,
  commitment_requested_at,
  commitment_decided_at,
  commitment_decided_by,
  role_granted_at,
  status,
  stall_nudge_24h_sent_at,
  stall_nudge_3d_sent_at,
  stall_nudge_7d_sent_at,
  stall_nudge_stage,
  stall_nudge_anchor_at
) on public.group_trip_participants to anon, authenticated;
