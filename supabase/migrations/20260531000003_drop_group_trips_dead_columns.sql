-- Drop dead/unused columns from group_trips. None are read or written by the
-- app after this change (verified across all create flows + detail screen):
--   surf_style          — only ever written null
--   vibe (jsonb)        — only the removed Flow BC ever set it
--   surf_spots (jsonb)  — only the removed Flow BC ever set it
--   destination_spot    — superseded by group_trip_destinations
--   wave_type           — Flow C break-type, dropped per product
--   total_cost          — Flow C total price, dropped (cost_per_person kept)
--   included_components — Flow C; duplicate of price_includes (kept), never displayed
-- Applied 2026-05-31.

alter table public.group_trips
  drop column if exists surf_style,
  drop column if exists vibe,
  drop column if exists surf_spots,
  drop column if exists destination_spot,
  drop column if exists wave_type,
  drop column if exists total_cost,
  drop column if exists included_components;
