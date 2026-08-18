-- A crew requirement was about to become a wall in front of every traveler.
--
-- ── The bug ────────────────────────────────────────────────────────────────
-- 20260812000200 added `audience` to organized_trip_requirements and a table of
-- per-person assignments, so that a staff requirement applies to nobody until
-- it is given to a named crew member. It did not go back and teach the
-- TRAVELER-side reads about the new column, and both of them select every
-- active requirement on the trip:
--
--   • operator_trip_my_requirements() — the traveler's own task list. A crew
--     passport would have appeared in it, addressed to people it was never
--     written for.
--
--   • activate_trip_membership() counts `must_have` rows FROM THAT FUNCTION to
--     decide who is let into the trip. createStaffRequirement writes
--     skip_at_onboarding = 'must_have' (staff paperwork has no skip), so the
--     first time an operator ticked "Passport" for a guide, every traveler on
--     that trip would have been held in onboarding — unable to satisfy it,
--     because the crew screens are the only place it can be answered, and
--     unable to skip it.
--
--   • organized_trip_document_counts() — the operator's own review dashboard.
--     A crew row would show as "0 of 12 travelers" forever.
--
-- Nothing is in this state today: the operator UI had no way to create a
-- staff-audience requirement until the crew screens shipped, so no such row
-- exists in production. This lands before the first one can.
--
-- ── Why the filter is a join and not `r.audience` ──────────────────────────
-- organized_trip_requirements_resolved was created with `select r.*`, which
-- Postgres expanded to the columns that existed THEN. `audience` came later, so
-- the view does not carry it, and `create or replace view` cannot add a column
-- in the middle of an existing list. Joining the base table on the primary key
-- is one index lookup and needs no view rebuild.

create or replace function public.operator_trip_my_requirements(p_trip_id uuid)
returns table (
  requirement_id     uuid,
  kind               text,
  req_type           text,
  skip_at_onboarding text,
  title              text,
  help_text          text,
  due_date           date,
  effective_state    text,
  submitted_at       timestamptz,
  reviewed_at        timestamptz,
  approbation_note   text,
  document_id        uuid
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select
    r.id, r.kind, r.req_type, r.skip_at_onboarding, r.title, r.help_text, r.due_date,
    case
      when r.req_type = 'pay'
        then public.operator_requirement_pay_state(p_trip_id, auth.uid(), r.id)
      when r.req_type = 'acknowledge' then
        case when a.id is not null then 'approved'
             when r.due_date is not null and r.due_date < current_date then 'overdue'
             else 'not_started' end
      when r.kind = 'medical' then
        case when m.completed_at is not null then 'approved'
             when r.due_date is not null and r.due_date < current_date then 'overdue'
             else 'not_started' end
      when d.id is null then
        case when r.due_date is not null and r.due_date < current_date then 'overdue'
             else 'not_started' end
      when d.rejected_at is not null then 'rejected'
      when d.approved_at is not null then 'approved'
      else 'submitted'
    end as effective_state,
    coalesce(d.uploaded_at, a.agreed_at, m.completed_at) as submitted_at,
    d.approved_at as reviewed_at,
    d.approbation_note,
    d.id as document_id
  from public.organized_trip_requirements_resolved r
  -- NEW: the audience, which the resolved view does not carry.
  join public.organized_trip_requirements base on base.id = r.id
  left join public.organized_trip_travelers_documents d
         on d.requirement_id = r.id
        and d.user_id = auth.uid()
  left join public.group_trip_acknowledgements a
         on a.requirement_id = r.id
        and a.user_id = auth.uid()
        and (
          r.kind <> 'waiver'
          or a.operator_document_id = (
               select od.id from public.organized_trip_operator_documents od
                where od.trip_id = r.trip_id and od.kind = 'waiver'
                order by od.version desc limit 1)
        )
  left join public.organized_trip_medical_forms m
         on m.trip_id = r.trip_id
        and m.user_id = auth.uid()
  where r.trip_id = p_trip_id
    and r.is_active
    -- NEW. Every pre-existing row is 'traveler' (the column's default), so this
    -- changes nothing about any trip that exists today.
    and base.audience = 'traveler'
    and public.is_trip_participant(p_trip_id)
  order by
    case when r.skip_at_onboarding = 'must_have' then 0 else 1 end,
    r.due_date nulls first,
    r.sort_order;
$$;

revoke execute on function public.operator_trip_my_requirements(uuid) from public, anon;
grant  execute on function public.operator_trip_my_requirements(uuid) to authenticated;

-- activate_trip_membership() needs no change: it counts must_have rows FROM the
-- function above, so it inherits the filter. Recorded here because "the gate is
-- fixed" is not obvious from a diff that does not mention it.

-- The operator's review dashboard: a crew requirement is not something every
-- traveler owes, so it must not appear in the per-requirement progress counts.
create or replace function public.organized_trip_document_counts(p_trip_id uuid)
returns table (requirement_id uuid, expected integer, received integer, approved integer)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not public.trip_staff_can(p_trip_id, 'docs.view') then raise exception 'not your trip'; end if;

  return query
  with active as (
    select p.user_id
      from public.group_trip_participants p
     where p.trip_id = p_trip_id and p.role = 'member'
  ), reqs as (
    select r.id
      from public.organized_trip_requirements r
     where r.trip_id = p_trip_id
       and r.req_type = 'upload'
       and r.is_active
       and r.audience = 'traveler'   -- NEW
  )
  select r.id,
         (select count(*) from active)::int,
         count(d.id) filter (where d.rejected_at is null)::int,
         count(d.id) filter (where d.approved_at is not null)::int
    from reqs r
    left join public.organized_trip_travelers_documents d
           on d.requirement_id = r.id
          and d.user_id in (select user_id from active)
   group by r.id;
end $$;

revoke execute on function public.organized_trip_document_counts(uuid) from public, anon;
grant  execute on function public.organized_trip_document_counts(uuid) to authenticated;

-- ── Verify (read-only) ─────────────────────────────────────────────────────
-- select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and proname in ('operator_trip_my_requirements','organized_trip_document_counts')
--    and pg_get_functiondef(p.oid) like '%audience%';
--   -- both rows.
