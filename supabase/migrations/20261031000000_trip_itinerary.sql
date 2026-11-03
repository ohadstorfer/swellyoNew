-- Trip itinerary: the optional day-by-day plan an operator adds in the create
-- flow (Figma 18437:22173, 18437:22350), shown on the trip Overview.
--
-- One jsonb column, not a table: it is read and written whole, with the trip,
-- and nothing queries inside it. Shape (src/services/trips/itinerary.ts):
--
--   [{ "day": 1, "title": "Arrival & Welcome", "photos": ["https://..."],
--      "activities": [{ "time": "14:00", "name": "Airport pickup", "place": null }] }]
--
-- `day` is 1-based and NOT a date, so moving the trip keeps every plan attached
-- to its day. Empty array = no itinerary, and the Overview hides the section.
--
-- Apply this BEFORE shipping the client. The client only sends the key when the
-- operator planned something, so trips without an itinerary keep publishing
-- either way, but one WITH an itinerary fails until the column exists.
--
-- Columns only: group_trips already grants at table level, so no GRANT, and the
-- trip's existing RLS covers it. Safe to re-run.

alter table public.group_trips
  add column if not exists itinerary jsonb not null default '[]'::jsonb;

alter table public.group_trips
  drop constraint if exists group_trips_itinerary_is_array;
alter table public.group_trips
  add constraint group_trips_itinerary_is_array
  check (jsonb_typeof(itinerary) = 'array');

comment on column public.group_trips.itinerary is
  'Optional day-by-day plan. Array of {day, title, photos[], activities[]}; day is 1-based, not a date.';
