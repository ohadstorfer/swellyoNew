-- The medical form asks for four things. The spec asks for five.
--
-- Product Specs §"Trip onboarding": "complete medical statement — injuries,
-- allergies and dietary preferences, prescribed medicine, emergency contact".
-- The table has carried the first four since 20260724000200 and has never had
-- anywhere to put the fifth, which is the only one of the five that exists to
-- be USED rather than read.
--
-- ── Who may read it ────────────────────────────────────────────────────────
-- The operator of record, and nobody else. That is not a new rule, it is the
-- existing one: 20260824000000 narrowed this whole table to `medical.view`
-- and said why in as many words — "allergies, medication, injuries and an
-- emergency contact are a medical record; the person who owns the trip is the
-- only one who needs it". These columns land on that row and inherit it, so
-- there is no policy change here and no new capability.
--
-- ⚠️ TWO STRINGS PROMISED OTHERWISE and are corrected in the same change:
-- CAPABILITY_LABELS['travelers.view_profiles'] in the app read "Traveler
-- profiles + emergency contact", and the operator dashboard's SPEC.md gave a
-- Manager that row with a tick. Both were written before the August ruling and
-- described a field that did not exist, so nothing was ever leaked — but a
-- permission matrix that advertises a field it does not grant is how the next
-- person builds the leak.
--
-- If the counter-argument ever wins — that the person who phones a traveler's
-- family is the guide on the beach, not the owner in another country — the
-- honest change is a narrow `emergency.view` capability and a column-scoped
-- read path, NOT widening `medical.view`. One row in
-- organized_trip_staff_roles, no client release. It is deliberately not done
-- here.
--
-- ── Additive and reversible ────────────────────────────────────────────────
-- Three nullable columns. Every existing row stays valid, every existing read
-- is by column name and is unaffected, and no completed form becomes
-- incomplete: `completed_at` is set by the client and this migration does not
-- clear it. Travelers who filled the form in before today are asked for a
-- contact the next time they open it, and are not blocked in the meantime.

alter table public.organized_trip_medical_forms
  add column if not exists emergency_name     text,
  add column if not exists emergency_phone    text,
  add column if not exists emergency_relation text;

-- A SEPARATE constraint, not an edit of `medical_text_len`.
--
-- Dropping and rebuilding that one would revalidate every existing row for no
-- reason and would make this migration non-additive for the sake of tidiness.
-- Two named constraints that each say one thing are easier to read in an error
-- message than one that says five.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'medical_emergency_len') then
    alter table public.organized_trip_medical_forms
      add constraint medical_emergency_len check (
        coalesce(length(emergency_name), 0)     <= 120 and
        coalesce(length(emergency_phone), 0)    <= 40  and
        coalesce(length(emergency_relation), 0) <= 60
      );
  end if;
end $$;

comment on column public.organized_trip_medical_forms.emergency_name is
  'Who to call about this traveler. Read under medical.view like the rest of '
  'the row — see 20260824000000, which named the emergency contact explicitly '
  'when it narrowed this table to the operator of record.';

comment on column public.organized_trip_medical_forms.emergency_phone is
  'Free text, not validated as a phone number: an international traveler''s '
  'contact may be written any of a dozen ways and a regex that refuses one of '
  'them costs more than it saves. Rendered as a tel: link by both clients.';

comment on column public.organized_trip_medical_forms.emergency_relation is
  'Mother, partner, flatmate. Optional — the name and the number are what get '
  'dialled.';

-- ── Verify (read-only) ─────────────────────────────────────────────────────
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_name = 'organized_trip_medical_forms'
--    and column_name like 'emergency%';
--
-- select conname from pg_constraint where conname = 'medical_emergency_len';
--
-- Still operator-only. This must return exactly {co_operator, operator} — the
-- two tiers 20260901000000 left holding it, Manager having lost it in
-- 20260824000000:
--   select role_key from organized_trip_staff_roles
--    where 'medical.view' = any(capabilities) order by role_key;
