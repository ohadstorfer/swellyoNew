-- A passport requirement is only allowed on an OPERATOR trip (hosting_style = 'C').
--
-- WHY: `is_trip_host()` is any participant with role = 'host'. On an operator
-- trip that is a business with an agreement and a data-protection clause. On a
-- peer group trip it is another surfer. "One surfer can open another surfer's
-- passport" is not something we would want to defend, so the database refuses
-- to create the requirement in the first place.
--
-- Enforcing it HERE and not only in the client is what makes it real: a
-- passport document row must point at a requirement (FK), and a passport
-- requirement now cannot exist on a non-operator trip. That closes the path
-- without touching the storage policies.
--
-- A CHECK constraint cannot do this -- it may not read another table. Hence a
-- trigger.
--
-- Spec: docs/specs/operator-trips/passport-upload-v1.md §14.3 (decided 2026-07-29)

-- Fail loudly if any offending row already exists. The feature is not live, so
-- this should find nothing; if it finds something, that is exactly the case we
-- must not silently grandfather in.
do $$
declare v_bad integer;
begin
  select count(*) into v_bad
    from public.organized_trip_requirements r
    join public.group_trips t on t.id = r.trip_id
   where r.kind = 'passport'
     and t.hosting_style is distinct from 'C';
  if v_bad > 0 then
    raise exception
      'cannot apply: % passport requirement(s) exist on non-operator trips. Resolve them first.', v_bad;
  end if;
end $$;

-- SECURITY DEFINER so the check does not depend on whether the caller can see
-- the group_trips row through RLS -- an invisible trip would otherwise read as
-- "no style" and block a legitimate insert. Same reasoning as is_trip_host().
create or replace function public.enforce_passport_requires_operator_trip()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_style text;
begin
  if new.kind <> 'passport' then
    return new;
  end if;

  select hosting_style into v_style
    from public.group_trips
   where id = new.trip_id;

  if v_style is distinct from 'C' then
    raise exception
      'a passport requirement is only allowed on an operator trip (hosting_style = ''C'')';
  end if;

  return new;
end $$;

-- A SECURITY DEFINER function keeps the default PUBLIC execute grant, which
-- makes it callable by anon over /rest/v1/rpc/. Revoke it -- only the trigger
-- ever needs to run this. (See 20260724000600_operator_touch_fn_hardening.sql.)
revoke execute on function public.enforce_passport_requires_operator_trip()
  from public, anon, authenticated;

drop trigger if exists trg_passport_requires_operator_trip
  on public.organized_trip_requirements;
create trigger trg_passport_requires_operator_trip
  before insert or update of kind, trip_id
  on public.organized_trip_requirements
  for each row execute function public.enforce_passport_requires_operator_trip();

-- NOTE: this covers `kind = 'passport'` only, because that is what was decided.
-- `visa` and `insurance` are the same shape of risk on a peer trip -- if those
-- ship, widen the `new.kind <> 'passport'` test rather than adding a second
-- trigger.
