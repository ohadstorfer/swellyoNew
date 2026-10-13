-- "Medical info" is called "Personal info" now (Figma 17098:23607 / 17134:25594).
-- This renames the table, the counts view and everything hanging off them.
--
--   organized_trip_medical_forms  -> organized_trip_personal_info
--   organized_trip_medical_flags  -> organized_trip_personal_info_flags
--
-- ⚠️ THE OLD NAMES STAY, AS VIEWS. Store builds already on people's phones read
-- and write `organized_trip_medical_forms` directly through PostgREST. Dropping
-- the name would 404 the Personal Info step for every one of them. Both old
-- names are now plain `select *` views over the new ones: auto-updatable, and
-- `security_invoker` so the base table's RLS decides, not the view owner.
-- Drop them only when no installed build still uses the old names.
--
-- ⚠️ NOT RENAMED HERE, ON PURPOSE:
--   * `organized_trip_requirements.kind = 'medical'` — a wire value. Installed
--     apps key their requirement catalog on it; a row that says anything else
--     is a requirement they cannot draw. It can only change after every
--     installed build understands the new value.
--   * the `'medical.view'` permission key — same reason, and it is stored in
--     staff rows.
--   * the `'medical'` key in dev_reset_my_onboarding's summary json.

-- 1. The table and the counts view. Views, FKs, policies and the trigger follow
--    the table by OID, so nothing else breaks at this point.
alter table public.organized_trip_medical_forms rename to organized_trip_personal_info;
alter view public.organized_trip_medical_flags rename to organized_trip_personal_info_flags;

-- 2. Constraints (the PK / unique ones carry their index with them), then any
--    index that is still named after the old table.
do $$
declare
  r record;
  v_new text;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.organized_trip_personal_info'::regclass
      and conname like '%medical%'
  loop
    v_new := replace(replace(r.conname, 'medical_forms', 'personal_info'), 'medical', 'personal_info');
    execute format('alter table public.organized_trip_personal_info rename constraint %I to %I',
                   r.conname, v_new);
  end loop;

  for r in
    select indexrelid::regclass::text as idx, c.relname
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    where i.indrelid = 'public.organized_trip_personal_info'::regclass
      and c.relname like '%medical%'
  loop
    v_new := replace(replace(r.relname, 'medical_forms', 'personal_info'), 'medical', 'personal_info');
    execute format('alter index public.%I rename to %I', r.relname, v_new);
  end loop;
end $$;

-- 3. Policies.
alter policy medical_operator_select on public.organized_trip_personal_info
  rename to personal_info_operator_select;
alter policy medical_traveler_insert on public.organized_trip_personal_info
  rename to personal_info_traveler_insert;
alter policy medical_traveler_select on public.organized_trip_personal_info
  rename to personal_info_traveler_select;
alter policy medical_traveler_update on public.organized_trip_personal_info
  rename to personal_info_traveler_update;

-- 4. The updated_at trigger and its function.
do $$
declare
  r record;
begin
  for r in
    select tgname
    from pg_trigger
    where tgrelid = 'public.organized_trip_personal_info'::regclass
      and not tgisinternal
      and tgname like '%medical%'
  loop
    execute format('alter trigger %I on public.organized_trip_personal_info rename to %I',
                   r.tgname, replace(replace(r.tgname, 'medical_forms', 'personal_info'), 'medical', 'personal_info'));
  end loop;
end $$;

alter function public.touch_organized_trip_medical_forms()
  rename to touch_organized_trip_personal_info;

-- 5. Functions that name the table in their body. plpgsql resolves names when
--    it runs, so these would keep working through the compat view below — but
--    then eight functions would depend on a name that exists only for old apps.
--    Rewritten from the LIVE definitions (they drift from the repo), so this
--    changes the table name and nothing else. CREATE OR REPLACE keeps grants.
do $$
declare
  r record;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosrc like '%organized_trip_medical_forms%'
  loop
    execute replace(pg_get_functiondef(r.oid),
                    'organized_trip_medical_forms', 'organized_trip_personal_info');
  end loop;
end $$;

-- 6. The old names, for installed apps. See the warning at the top.
create view public.organized_trip_medical_forms
  with (security_invoker = true) as
  select * from public.organized_trip_personal_info;

comment on view public.organized_trip_medical_forms is
  'COMPAT: old name of organized_trip_personal_info, kept for installed app builds. Do not use in new code.';

revoke all on public.organized_trip_medical_forms from public, anon;
grant select, insert, update on public.organized_trip_medical_forms to authenticated;
grant all on public.organized_trip_medical_forms to service_role;

create view public.organized_trip_medical_flags
  with (security_invoker = true) as
  select * from public.organized_trip_personal_info_flags;

comment on view public.organized_trip_medical_flags is
  'COMPAT: old name of organized_trip_personal_info_flags, kept for installed dashboard builds. Do not use in new code.';

revoke all on public.organized_trip_medical_flags from public, anon;
grant select on public.organized_trip_medical_flags to authenticated;
grant select on public.organized_trip_medical_flags to service_role;

notify pgrst, 'reload schema';
