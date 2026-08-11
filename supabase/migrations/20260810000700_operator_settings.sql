-- operator_settings — the operator's own defaults, reused on every trip they
-- create.
--
-- WHY A NEW TABLE AND NOT MORE COLUMNS ON `surfers`. `surfers_select_authenticated`
-- is `using (true)`, so every column on `surfers` is readable by every signed-in
-- user. That is right for a profile and wrong for a business's settings — and
-- this table is where the rest of the operator setup is heading (insurance
-- certificate, default waiver, support contact), none of which should be world
-- readable. Starting it private costs nothing now and avoids a migration later.
--
-- WHAT IS *NOT* HERE: the policy a traveler actually sees. These are DEFAULTS.
-- A trip must carry its own copy, frozen when it is published, or changing your
-- default in March would silently rewrite the terms someone agreed to in
-- January. That copy is the next piece of work; this table is only the source
-- it is copied FROM.
--
-- `default_currency` NULL means "follow my profile country", matching how
-- `surfers.display_currency` treats NULL. It is a DIFFERENT setting: this one
-- pre-fills `group_trips.budget_currency` (what the operator charges in),
-- display_currency is what a traveler reads prices in.
--
-- Shape of `cancellation_rules`, only used when preset = 'custom':
--   [{"days_before": 60, "refund_pct": 100}, {"days_before": 30, "refund_pct": 50}]
-- Read as "cancel at least N days before and you get P% back". Anything later
-- than the smallest days_before gets nothing. Validation and canonical ordering
-- are done by a trigger, not a CHECK, because a CHECK cannot contain the
-- subquery needed to walk a jsonb array.
--
-- ⚠️ REFERENCE COPY — applied BY HAND (2026-08-10), never `db push`.
-- Idempotent: safe to re-run.

create table if not exists public.operator_settings (
  user_id             uuid primary key
                        references auth.users(id) on delete cascade,
  default_currency    text,
  cancellation_preset text        not null default 'standard',
  cancellation_rules  jsonb       not null default '[]'::jsonb,
  cancellation_notes  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'operator_settings_currency_check') then
    alter table public.operator_settings
      add constraint operator_settings_currency_check
      check (default_currency is null or default_currency in (
        'USD','ILS','EUR','GBP','AUD','NZD','CAD','CHF','BRL','JPY','SEK','NOK','DKK','ZAR'
      ));
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'operator_settings_preset_check') then
    alter table public.operator_settings
      add constraint operator_settings_preset_check
      check (cancellation_preset in
             ('flexible','standard','non_refundable','custom'));
  end if;

  -- A note long enough to be a whole policy belongs in a waiver, not here.
  if not exists (select 1 from pg_constraint
                  where conname = 'operator_settings_notes_len_check') then
    alter table public.operator_settings
      add constraint operator_settings_notes_len_check
      check (cancellation_notes is null or length(cancellation_notes) <= 2000);
  end if;
end $$;


-- ── Validate and canonicalise the custom rules ────────────────────────────
-- Both clients read this column; neither should have to defend against a
-- malformed array or re-sort it. The database hands back one shape.
create or replace function public.normalise_operator_cancellation()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_bad integer;
begin
  -- A preset other than 'custom' has no rows. Keeping stale rows around would
  -- make "switch to custom" silently restore an old policy.
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

drop trigger if exists trg_normalise_operator_cancellation on public.operator_settings;
create trigger trg_normalise_operator_cancellation
  before insert or update on public.operator_settings
  for each row execute function public.normalise_operator_cancellation();


create or replace function public.touch_operator_settings()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_operator_settings on public.operator_settings;
create trigger trg_touch_operator_settings
  before update on public.operator_settings
  for each row execute function public.touch_operator_settings();


-- ── RLS: your own row, and nobody else's ──────────────────────────────────
-- No SELECT for anyone else on purpose. A traveler never reads these; they read
-- the copy frozen onto the trip. No DELETE policy either — there is nothing to
-- gain from deleting a settings row, and its absence is already "no defaults".
--
-- Deliberately NOT gated on surfers.operator. Someone promoted mid-session
-- would otherwise get a 403 on their own row until they signed out and back in,
-- and the row is invisible to everyone else anyway. Visibility is the UI's job.
alter table public.operator_settings enable row level security;

drop policy if exists operator_settings_select_own on public.operator_settings;
create policy operator_settings_select_own on public.operator_settings
  for select using ((select auth.uid()) = user_id);

drop policy if exists operator_settings_insert_own on public.operator_settings;
create policy operator_settings_insert_own on public.operator_settings
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists operator_settings_update_own on public.operator_settings;
create policy operator_settings_update_own on public.operator_settings
  for update using ((select auth.uid()) = user_id)
              with check ((select auth.uid()) = user_id);

grant select, insert, update on public.operator_settings to authenticated;

comment on table public.operator_settings is
  'An operator''s reusable defaults (price currency, cancellation policy). '
  'Private to the owner. Trips must copy these at publish time, never read '
  'them live — a default changed later must not rewrite agreed terms.';
