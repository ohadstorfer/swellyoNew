-- Group gear: manual sort order.
-- The host can now drag-reorder gear items in the "Edit Group Gear" editor. We
-- persist that order in a new `sort_order` column. Existing rows are backfilled
-- per trip by their created_at order (oldest = 0) so nothing jumps on first load.
-- Column is nullable (no default) — new rows get max(sort_order)+1 from the
-- service layer, and the listGearItems query orders by sort_order with
-- created_at as a tiebreaker (nullsFirst:false), so un-backfilled rows fall last.

alter table public.group_trip_gear_items
  add column if not exists sort_order integer;

-- Backfill: assign a contiguous 0-based order within each trip, oldest first.
with ranked as (
  select
    id,
    (row_number() over (partition by trip_id order by created_at) - 1) as new_order
  from public.group_trip_gear_items
)
update public.group_trip_gear_items g
set sort_order = ranked.new_order
from ranked
where g.id = ranked.id
  and g.sort_order is null;
