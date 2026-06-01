-- accommodation_status (text 'booked'|'notyet') was never wired into any flow,
-- so every existing row is null. Repurpose it: it now records whether the host
-- selected a specific stay at all (the step-3 Yes/No gate in the create flow),
-- as a boolean. Rename + convert to boolean. The CASE just future-proofs the
-- cast; with all-null data it resolves to null for every row.
-- Applied 2026-05-31.

alter table public.group_trips
  rename column accommodation_status to specific_stay_selected;

alter table public.group_trips
  alter column specific_stay_selected type boolean
  using (case
    when specific_stay_selected = 'booked' then true
    when specific_stay_selected = 'notyet' then false
    else null
  end);
