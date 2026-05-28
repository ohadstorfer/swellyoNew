-- Rename group_trip_commitment_requests.items → commitment_proofs.
-- The column never held generic "items" — it's the checklist of commitment
-- proofs a member ticks (flight_booked, insurance_sorted, something_else) to
-- show the host they're seriously in. "items" also collided with the gear
-- tables (group_trip_gear_items), so the new name removes that ambiguity.

alter table public.group_trip_commitment_requests
  rename column items to commitment_proofs;
