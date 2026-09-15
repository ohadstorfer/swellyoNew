-- The traveler's Payment card has to say WHEN the money is due.
--
-- It only ever had `due_date`, which `organized_trip_requirements_resolved`
-- computes as `start_date - deadline_days_before`. On a months-only trip there
-- is no `start_date`, so `due_date` comes back null even though the operator
-- DID set a deadline — and the card then says nothing about when to pay at
-- all. The offline sibling (`OfflinePaymentNote`) already solves this by
-- naming the stored value instead ("Due 30 days before the trip"); it could
-- only do that because that number lives on the trip row for offline trips.
-- A managed trip keeps it on the balance requirement, where the traveler had
-- no way to read it.
--
-- So: return it. Additive — every existing caller reads by column name and is
-- unaffected. The return type changes, so this is a DROP + CREATE; the body is
-- otherwise byte-identical to the live definition.
drop function if exists public.operator_trip_my_requirements(uuid);

create or replace function public.operator_trip_my_requirements(p_trip_id uuid)
returns table(
  requirement_id uuid,
  kind text,
  req_type text,
  skip_at_onboarding text,
  title text,
  help_text text,
  due_date date,
  -- The deadline as the operator stored it. Non-null whenever a deadline was
  -- set, whether or not the trip has a real date to resolve it against.
  deadline_days_before integer,
  effective_state text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  approbation_note text,
  document_id uuid
)
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select
    r.id, r.kind, r.req_type, r.skip_at_onboarding, r.title, r.help_text,
    r.due_date, r.deadline_days_before,
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
    and base.audience = 'traveler'
    and public.is_trip_participant(p_trip_id)
  order by
    case when r.skip_at_onboarding = 'must_have' then 0 else 1 end,
    r.due_date nulls first,
    r.sort_order;
$function$;

-- CREATE hands EXECUTE to PUBLIC, and Supabase's default privileges hand it
-- separately to `anon` — which survives the PUBLIC revoke. This is SECURITY
-- DEFINER, so take both back and grant only the roles that had it before.
revoke execute on function public.operator_trip_my_requirements(uuid) from public;
revoke execute on function public.operator_trip_my_requirements(uuid) from anon;
grant execute on function public.operator_trip_my_requirements(uuid) to authenticated, service_role;
