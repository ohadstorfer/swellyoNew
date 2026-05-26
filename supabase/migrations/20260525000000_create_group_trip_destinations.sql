-- Geocoded destination for a group trip.
-- One row per trip (1:1), written when the host picks a place via the Google
-- Places picker in the create-trip wizard. The human-readable label is also
-- mirrored into group_trips.destination_country for existing list/detail UIs;
-- this table holds the precise geocode data (place_id, lat/lng, ISO country).

create table if not exists public.group_trip_destinations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.group_trips(id) on delete cascade,

  place_id text,                 -- Google Places place_id
  name text,                     -- displayName.text e.g. "Uluwatu"
  short_label text,              -- "Uluwatu, Bali" (name + locality)
  formatted_address text,        -- Google formattedAddress
  locality text,                 -- city/town
  country text,                  -- ISO-2 e.g. "ID"
  lat double precision,
  lng double precision,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (trip_id)
);

create index if not exists group_trip_destinations_trip_id_idx
  on public.group_trip_destinations(trip_id);
create index if not exists group_trip_destinations_country_idx
  on public.group_trip_destinations(country);

-- ============================================================================
-- updated_at trigger
-- ============================================================================
create or replace function public.set_updated_at_group_trip_destinations()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_group_trip_destinations_set_updated_at on public.group_trip_destinations;
create trigger trg_group_trip_destinations_set_updated_at
before update on public.group_trip_destinations
for each row execute function public.set_updated_at_group_trip_destinations();

-- ============================================================================
-- RLS — mirror group_trips: anyone authenticated can read; only the trip host
-- can write (insert/update/delete), gated on group_trips.host_id.
-- ============================================================================
alter table public.group_trip_destinations enable row level security;

drop policy if exists "gtd readable by authenticated" on public.group_trip_destinations;
create policy "gtd readable by authenticated"
  on public.group_trip_destinations for select
  to authenticated
  using (true);

drop policy if exists "gtd host can insert" on public.group_trip_destinations;
create policy "gtd host can insert"
  on public.group_trip_destinations for insert
  to authenticated
  with check (auth.uid() = (select host_id from public.group_trips where id = trip_id));

drop policy if exists "gtd host can update" on public.group_trip_destinations;
create policy "gtd host can update"
  on public.group_trip_destinations for update
  to authenticated
  using (auth.uid() = (select host_id from public.group_trips where id = trip_id))
  with check (auth.uid() = (select host_id from public.group_trips where id = trip_id));

drop policy if exists "gtd host can delete" on public.group_trip_destinations;
create policy "gtd host can delete"
  on public.group_trip_destinations for delete
  to authenticated
  using (auth.uid() = (select host_id from public.group_trips where id = trip_id));
