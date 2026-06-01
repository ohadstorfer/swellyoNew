-- Make the audience age range optional. The create-trip "Who is it for?" step
-- treats an empty age as "Any", but the columns were NOT NULL, so publishing a
-- trip without an age range failed. Drop the NOT NULL constraints.

alter table public.group_trips
  alter column age_min drop not null,
  alter column age_max drop not null;
