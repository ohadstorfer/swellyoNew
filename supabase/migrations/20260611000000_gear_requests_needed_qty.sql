-- Gear requests: requester-chosen quantity.
-- Members now set "How many needed?" when requesting a shared (Group Gear) item;
-- the host sees that quantity pre-filled at approval (can still adjust). Existing
-- rows default to 1, matching the old host-sets-qty-at-approval behaviour.

alter table public.group_trip_gear_requests
  add column if not exists needed_qty integer not null default 1
  constraint group_trip_gear_requests_needed_qty_positive check (needed_qty >= 1);
