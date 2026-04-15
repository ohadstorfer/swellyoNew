-- Group Surf Trips
-- Hosts create trips that other users can discover (Explore) and, later, join.
-- This migration adds two tables + RLS + a storage bucket for trip images.

-- ============================================================================
-- Table: group_trips
-- ============================================================================
create table if not exists public.group_trips (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,

  -- Step 0: hosting style (see docs/create-group-surf-trip-flow.md)
  hosting_style char(1) not null check (hosting_style in ('A','B','C')),

  -- Step 1: general details
  title text,
  description text not null,
  hero_image_url text not null,

  -- Step 1.4: dates
  -- B/C use exact dates; A uses fuzzy months
  start_date date,
  end_date date,
  dates_set_in_stone boolean,
  date_months text[],                         -- e.g. {'2026-05','2026-06'}

  -- Step 1.5: destination / spot
  destination_country text,
  destination_area text,
  destination_spot text,

  -- Step 1.6: accommodation
  accommodation_type text,                    -- A / B-a ("hostel","villa",...)
  accommodation_name text,                    -- B-b / C
  accommodation_url text,                     -- B-b / C
  accommodation_image_url text,               -- B-b / C

  -- Step 1.7: vibe (optional)
  -- { morning: text[], afternoon: text[], evening: text[], night: text[] }
  vibe jsonb,

  -- Step 1.8: surf spots list (optional)
  -- [{ name, country }, ...]
  surf_spots jsonb,

  -- Step 2: participants alignment
  age_min int not null,
  age_max int not null,
  target_surf_levels text[] not null,         -- beginner|intermediate|advanced|pro|all
  target_surf_styles text[] not null,         -- shortboard|midlength|longboard|softtop|all
  wave_fat_to_barreling int,                  -- 0..10 slider (nullable = skipped)
  wave_size_min numeric,
  wave_size_max numeric,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint group_trips_age_range_valid check (age_max >= age_min),
  constraint group_trips_age_window_min check (
    (hosting_style = 'A' and age_max - age_min >= 7) or
    (hosting_style = 'B' and age_max - age_min >= 5) or
    (hosting_style = 'C' and age_max - age_min >= 2)
  ),
  constraint group_trips_levels_nonempty check (array_length(target_surf_levels, 1) >= 1),
  constraint group_trips_styles_nonempty check (array_length(target_surf_styles, 1) >= 1)
);

create index if not exists group_trips_host_id_idx on public.group_trips(host_id);
create index if not exists group_trips_created_at_idx on public.group_trips(created_at desc);
create index if not exists group_trips_destination_country_idx on public.group_trips(destination_country);

-- ============================================================================
-- Table: group_trip_participants
-- ============================================================================
-- Host is inserted with role='host' on trip creation. Joining is not yet wired
-- in the client but the table is ready for it.
create table if not exists public.group_trip_participants (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.group_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('host','member')) default 'member',
  joined_at timestamptz not null default now(),
  unique (trip_id, user_id)
);

create index if not exists group_trip_participants_trip_id_idx on public.group_trip_participants(trip_id);
create index if not exists group_trip_participants_user_id_idx on public.group_trip_participants(user_id);

-- ============================================================================
-- updated_at trigger
-- ============================================================================
create or replace function public.set_updated_at_group_trips()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_group_trips_set_updated_at on public.group_trips;
create trigger trg_group_trips_set_updated_at
before update on public.group_trips
for each row execute function public.set_updated_at_group_trips();

-- ============================================================================
-- RLS: group_trips
-- ============================================================================
alter table public.group_trips enable row level security;

drop policy if exists "group_trips readable by authenticated" on public.group_trips;
create policy "group_trips readable by authenticated"
  on public.group_trips for select
  to authenticated
  using (true);

drop policy if exists "group_trips host can insert" on public.group_trips;
create policy "group_trips host can insert"
  on public.group_trips for insert
  to authenticated
  with check (auth.uid() = host_id);

drop policy if exists "group_trips host can update" on public.group_trips;
create policy "group_trips host can update"
  on public.group_trips for update
  to authenticated
  using (auth.uid() = host_id)
  with check (auth.uid() = host_id);

drop policy if exists "group_trips host can delete" on public.group_trips;
create policy "group_trips host can delete"
  on public.group_trips for delete
  to authenticated
  using (auth.uid() = host_id);

-- ============================================================================
-- RLS: group_trip_participants
-- ============================================================================
alter table public.group_trip_participants enable row level security;

drop policy if exists "group_trip_participants readable by authenticated" on public.group_trip_participants;
create policy "group_trip_participants readable by authenticated"
  on public.group_trip_participants for select
  to authenticated
  using (true);

drop policy if exists "group_trip_participants user joins self" on public.group_trip_participants;
create policy "group_trip_participants user joins self"
  on public.group_trip_participants for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "group_trip_participants user leaves self or host removes" on public.group_trip_participants;
create policy "group_trip_participants user leaves self or host removes"
  on public.group_trip_participants for delete
  to authenticated
  using (
    auth.uid() = user_id
    or auth.uid() = (select host_id from public.group_trips where id = trip_id)
  );

-- ============================================================================
-- Storage bucket: trip-images
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('trip-images', 'trip-images', true)
on conflict (id) do nothing;

drop policy if exists "trip-images authenticated can upload" on storage.objects;
create policy "trip-images authenticated can upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'trip-images');

drop policy if exists "trip-images authenticated can update own" on storage.objects;
create policy "trip-images authenticated can update own"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'trip-images' and owner = auth.uid());

drop policy if exists "trip-images authenticated can delete own" on storage.objects;
create policy "trip-images authenticated can delete own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'trip-images' and owner = auth.uid());

drop policy if exists "trip-images public read" on storage.objects;
create policy "trip-images public read"
  on storage.objects for select
  to public
  using (bucket_id = 'trip-images');
