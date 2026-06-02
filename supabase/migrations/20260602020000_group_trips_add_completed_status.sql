-- Group Trip Status — add 'completed'
-- Hosts can now explicitly close a finished trip. Completed trips are hidden
-- from Explore (only 'active' shows there) and appear under "Past trips" in
-- My Trips. Cancelled trips are hidden from My Trips entirely (FE-side).
-- 'active'    — visible in Explore, joinable
-- 'cancelled' — soft-deleted; hidden everywhere, kept for history
-- 'completed' — closed; overview + chat stay, plan is locked

alter table public.group_trips
  drop constraint if exists group_trips_status_check;

alter table public.group_trips
  add constraint group_trips_status_check
    check (status in ('active', 'cancelled', 'completed'));
