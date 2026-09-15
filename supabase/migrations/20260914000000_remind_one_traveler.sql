-- Remind ONE traveler about one requirement.
--
-- The operator's per-document screen (Figma 14980-66698) puts "Send reminder" on
-- each traveler's row. operator_remind_requirement can only notify everyone who
-- still owes the document, so that button would either lie or spam.
--
-- A NEW function, not an extra parameter on the old one. Adding `p_user_id` with
-- a default to operator_remind_requirement would create a second overload next
-- to the two-argument one, and PostgREST cannot pick between them — every
-- existing "Remind N people" call would start failing.
--
-- The body is operator_remind_requirement's, verbatim, plus `p.user_id =
-- p_user_id`. Keep them in step: the state branches MUST mirror
-- operator_trip_my_requirements (see that function's comments), and the 24-hour
-- cooldown is shared — it reads the same notification type and entity, so a
-- traveler reminded by "Remind everyone" this morning is skipped here too.
--
-- Returns 1 when a notification went out, 0 when it did not (already sent it,
-- already reminded today, or not a traveler on this trip).
--
-- Adds nothing else: no table, no column, no policy.

create or replace function public.operator_remind_traveler_requirement(
  p_trip_id uuid,
  p_requirement_id uuid,
  p_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_sent       integer;
  v_req_title  text;
  v_req_type   text;
  v_req_kind   text;
  v_due        date;
  v_trip_title text;
  v_actor      text;
begin
  -- Same gate as the everyone version: docs.view, Manager and up.
  if not public.trip_staff_can(p_trip_id, 'docs.view') then
    raise exception 'Only a host of this trip can send reminders'
      using errcode = '42501';
  end if;

  select r.title, r.req_type, r.kind, r.due_date
    into v_req_title, v_req_type, v_req_kind, v_due
  from public.organized_trip_requirements_resolved r
  where r.id = p_requirement_id
    and r.trip_id = p_trip_id
    and r.is_active;

  if v_req_title is null then
    raise exception 'That requirement is not on this trip'
      using errcode = 'P0002';
  end if;

  -- Pay rows are out, for the same reason as the everyone version: the client
  -- does not know who has paid from the review data.
  if v_req_type = 'pay' then
    raise exception 'Payment reminders are not supported yet'
      using errcode = '0A000';
  end if;

  select g.title into v_trip_title from public.group_trips g where g.id = p_trip_id;
  v_actor := public.user_display_name(auth.uid());

  with owed as (
    select p.user_id
    from public.group_trip_participants p
    left join public.organized_trip_travelers_documents d
           on d.requirement_id = p_requirement_id
          and d.user_id = p.user_id
    left join public.group_trip_acknowledgements a
           on a.requirement_id = p_requirement_id
          and a.user_id = p.user_id
          and (
            v_req_kind <> 'waiver'
            or a.operator_document_id = (
                 select od.id from public.organized_trip_operator_documents od
                  where od.trip_id = p_trip_id and od.kind = 'waiver'
                  order by od.version desc limit 1)
          )
    left join public.organized_trip_medical_forms m
           on m.trip_id = p_trip_id
          and m.user_id = p.user_id
    where p.trip_id = p_trip_id
      and p.user_id = p_user_id
      and p.role is distinct from 'host'
      and (case
             when v_req_type = 'acknowledge' then
               case when a.id is not null then 'approved'
                    when v_due is not null and v_due < current_date then 'overdue'
                    else 'not_started' end
             when v_req_kind = 'medical' then
               case when m.completed_at is not null then 'approved'
                    when v_due is not null and v_due < current_date then 'overdue'
                    else 'not_started' end
             when d.id is null then
               case when v_due is not null and v_due < current_date then 'overdue'
                    else 'not_started' end
             when d.rejected_at is not null then 'rejected'
             when d.approved_at is not null then 'approved'
             else 'submitted'
           end) in ('not_started', 'overdue', 'rejected')
  )
  insert into public.notifications
    (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  select
    o.user_id, p_trip_id, 'operator_requirement_due_soon', 'user', auth.uid(),
    'requirement', p_requirement_id,
    jsonb_build_object(
      'trip_title',        v_trip_title,
      'requirement_title', v_req_title,
      'item_name',         v_req_title,
      'actor_name',        v_actor
    )
  from owed o
  where not exists (
    select 1 from public.notifications n
    where n.recipient_id = o.user_id
      and n.type = 'operator_requirement_due_soon'
      and n.entity_id = p_requirement_id
      and n.created_at > now() - interval '24 hours'
  );

  get diagnostics v_sent = row_count;
  return v_sent;
end;
$function$;

-- New functions are executable by PUBLIC by default. Match the everyone version:
-- authenticated only.
revoke execute on function public.operator_remind_traveler_requirement(uuid, uuid, uuid) from public, anon;
grant  execute on function public.operator_remind_traveler_requirement(uuid, uuid, uuid) to authenticated;
