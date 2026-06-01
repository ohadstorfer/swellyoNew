-- Flow B ("my trip, I'm the leader") adds host-credibility fields to group_trips.
-- These describe the leader's experience WITH THIS trip; null for Flow A/C trips.
--   host_destination_familiarity — how well the leader knows the destination
--   host_stay_familiarity        — how well the leader knows the chosen stay
--   host_lead_note               — short (<=50 char) "why I'm the right person to lead"

alter table public.group_trips
  add column if not exists host_destination_familiarity text,
  add column if not exists host_stay_familiarity text,
  add column if not exists host_lead_note text;

-- Drop the legacy host_been_there boolean: superseded by the 3-state
-- host_destination_familiarity (more accurate), read nowhere, only ever
-- written null.
alter table public.group_trips
  drop column if exists host_been_there;

-- Constrain the two familiarity columns to the known option sets (NULL allowed
-- for non-leader trips). Drop-then-add so re-running the migration is safe.
alter table public.group_trips
  drop constraint if exists group_trips_host_destination_familiarity_check;
alter table public.group_trips
  add constraint group_trips_host_destination_familiarity_check
  check (
    host_destination_familiarity is null
    or host_destination_familiarity in ('never_been', 'been_once', 'been_multiple')
  );

alter table public.group_trips
  drop constraint if exists group_trips_host_stay_familiarity_check;
alter table public.group_trips
  add constraint group_trips_host_stay_familiarity_check
  check (
    host_stay_familiarity is null
    or host_stay_familiarity in ('never_online', 'never_recs', 'stayed_once', 'stayed_multiple')
  );

comment on column public.group_trips.host_destination_familiarity is
  'Flow B leader''s familiarity with the destination: never_been | been_once | been_multiple.';
comment on column public.group_trips.host_stay_familiarity is
  'Flow B leader''s familiarity with the chosen stay: never_online | never_recs | stayed_once | stayed_multiple.';
comment on column public.group_trips.host_lead_note is
  'Flow B leader''s short (<=50 char) pitch for why they''re the right person to lead.';
