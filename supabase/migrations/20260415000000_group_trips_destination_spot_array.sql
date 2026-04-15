-- Change group_trips.destination_spot from text to text[]
-- Existing non-null values are preserved as single-element arrays.

alter table public.group_trips
  alter column destination_spot type text[]
  using case
    when destination_spot is null then null
    else array[destination_spot]
  end;
