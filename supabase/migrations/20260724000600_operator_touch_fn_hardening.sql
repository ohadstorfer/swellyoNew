-- Operator Trips — harden the two updated_at trigger functions.
--
-- Flagged by `supabase db advisors --type security` right after they were
-- created: both were SECURITY DEFINER and carried the default PUBLIC execute
-- grant, so `anon` could call them over /rest/v1/rpc/.
--
-- A trigger that only stamps NEW.updated_at needs no elevated rights, so the
-- correct fix is SECURITY INVOKER plus an explicit revoke. Trigger functions do
-- not need an EXECUTE grant to fire as triggers, so nothing breaks.

create or replace function public.touch_group_trip_requirements()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$ begin new.updated_at := now(); return new; end $$;

create or replace function public.touch_group_trip_medical_forms()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$ begin new.updated_at := now(); return new; end $$;

revoke execute on function public.touch_group_trip_requirements()  from public, anon, authenticated;
revoke execute on function public.touch_group_trip_medical_forms() from public, anon, authenticated;
