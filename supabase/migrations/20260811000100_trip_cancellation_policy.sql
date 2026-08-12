-- The cancellation policy, frozen onto the trip.
--
-- WHY THE TRIP CARRIES ITS OWN COPY. `operator_settings` holds a DEFAULT. If a
-- traveler screen read that default live, an operator switching to "No refunds"
-- in March would silently rewrite the terms somebody agreed to in January. So
-- the policy is copied at publish and never read live — the same rule the
-- default waiver follows, and the one `20260810000700_operator_settings.sql`
-- said this migration would implement.
--
-- COLUMN NAMES MATCH `operator_settings` EXACTLY, on purpose: `toPreset`,
-- `rulesFromWire`, `explain` and `summarise` then work on a trip row with no
-- new code on either client.
--
-- NULL preset means NOT SPECIFIED, which is a real and common state:
--   * every type A and B trip (they have no policy concept at all)
--   * the 23 operator trips that already exist
-- It does NOT mean "no refunds". Nothing is shown to a traveler in that case.
-- Existing trips are deliberately NOT backfilled from the operator's current
-- default — that would be inventing terms for trips already sold.
--
-- ⚠️ REFERENCE COPY — applied BY HAND, never `db push`. Idempotent: safe to re-run.

alter table public.group_trips
  add column if not exists cancellation_preset text,
  add column if not exists cancellation_rules  jsonb not null default '[]'::jsonb,
  add column if not exists cancellation_notes  text;

comment on column public.group_trips.cancellation_preset is
  'Frozen copy of the operator''s policy, taken at publish. NULL = not '
  'specified (all A/B trips, and operator trips predating this column). NULL is '
  'NOT "no refunds" — that is the ''non_refundable'' preset.';

do $$
begin
  -- 'flexible' is deliberately absent. It was removed from both clients on
  -- 2026-08-11, so nothing can send it; unlike `operator_settings`, this column
  -- is new and has no stored rows to keep accepting.
  if not exists (select 1 from pg_constraint
                  where conname = 'group_trips_cancellation_preset_check') then
    alter table public.group_trips
      add constraint group_trips_cancellation_preset_check
      check (cancellation_preset is null
             or cancellation_preset in ('standard','non_refundable','custom'));
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'group_trips_cancellation_notes_len_check') then
    alter table public.group_trips
      add constraint group_trips_cancellation_notes_len_check
      check (cancellation_notes is null or length(cancellation_notes) <= 2000);
  end if;
end $$;


-- ── Validate and canonicalise, for trips ──────────────────────────────────
--
-- ⚠️ THIS IS A SEPARATE FUNCTION FROM `normalise_operator_cancellation`, AND
-- MUST STAY ONE. Reusing that function here would break creating every type A
-- and B trip. It opens with:
--
--     if new.cancellation_preset <> 'custom' then ... return new; end if;
--
-- With a NULL preset that comparison evaluates to NULL, not true, so the guard
-- does not fire and execution falls into the custom branch — which raises
-- 'A custom cancellation policy needs at least one rule' on a trip that never
-- claimed to have one. Every ordinary group trip would fail to insert.
--
-- Hence the NULL guard first. The rest is the same logic; it is duplicated
-- rather than shared because editing the operator_settings function to add a
-- NULL branch would change behaviour on a table that is already live.
create or replace function public.normalise_trip_cancellation()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_bad integer;
begin
  -- No policy at all. The overwhelmingly common case: every A and B trip.
  if new.cancellation_preset is null then
    new.cancellation_rules := '[]'::jsonb;
    new.cancellation_notes := null;
    return new;
  end if;

  -- A fixed preset carries no rows. Keeping stale rules around would make
  -- "switch to custom" silently restore an old policy.
  if new.cancellation_preset <> 'custom' then
    new.cancellation_rules := '[]'::jsonb;
    return new;
  end if;

  if jsonb_typeof(new.cancellation_rules) <> 'array'
     or jsonb_array_length(new.cancellation_rules) = 0 then
    raise exception 'A custom cancellation policy needs at least one rule'
      using errcode = 'check_violation';
  end if;

  select count(*) into v_bad
    from jsonb_array_elements(new.cancellation_rules) e
   where jsonb_typeof(e->'days_before') <> 'number'
      or jsonb_typeof(e->'refund_pct')  <> 'number'
      or (e->>'days_before')::numeric < 0
      or (e->>'days_before')::numeric > 3650
      or (e->>'refund_pct')::numeric  < 0
      or (e->>'refund_pct')::numeric  > 100;

  if v_bad > 0 then
    raise exception 'Each rule needs days_before 0-3650 and refund_pct 0-100'
      using errcode = 'check_violation';
  end if;

  -- Canonical order: furthest out first, which is the order they are read in
  -- and the order any refund calculation has to walk them.
  select jsonb_agg(e order by (e->>'days_before')::numeric desc)
    into new.cancellation_rules
    from jsonb_array_elements(new.cancellation_rules) e;

  return new;
end;
$$;

drop trigger if exists trg_normalise_trip_cancellation on public.group_trips;
create trigger trg_normalise_trip_cancellation
  before insert or update on public.group_trips
  for each row execute function public.normalise_trip_cancellation();
