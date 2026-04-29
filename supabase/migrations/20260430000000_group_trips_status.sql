-- Group Trip Status (soft delete / cancel)
-- Adds a `status` column so hosts can cancel a trip without losing history.
-- 'active'    — visible in Explore, joinable
-- 'cancelled' — hidden from Explore; existing participants see a cancelled banner

alter table public.group_trips
  add column if not exists status text not null default 'active'
    check (status in ('active', 'cancelled'));

create index if not exists group_trips_status_idx on public.group_trips(status);
