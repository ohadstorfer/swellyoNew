-- Change group_trips.accommodation_type from text to text[]
-- Existing non-null values are preserved as single-element arrays.

alter table public.group_trips
  alter column accommodation_type type text[]
  using case
    when accommodation_type is null then null
    else array[accommodation_type]
  end;
