-- Operator Trips — resolved deadlines, derived state, and the write RPCs.
--
-- A deadline is stored relative to departure (deadline_days_before) and becomes
-- a real date only when read, against group_trips.start_date. Nothing is cached,
-- so moving trip dates keeps every deadline correct with no backfill.
--
-- State is DERIVED, never stored. See requirements-model.md.

-- ══════════════════════════════════════════════════════════════════
-- 1. Resolved view: the real due date.
-- ══════════════════════════════════════════════════════════════════
create or replace view public.group_trip_requirements_resolved
with (security_invoker = on) as
select
  r.*,
  t.start_date as departure_date,
  case
    when r.deadline_days_before is null or t.start_date is null then null
    else (t.start_date - make_interval(days => r.deadline_days_before))::date
  end as due_date
from public.group_trip_requirements r
join public.group_trips t on t.id = r.trip_id;

revoke all    on public.group_trip_requirements_resolved from anon, public;
grant  select on public.group_trip_requirements_resolved to   authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 2. Pay state — v1 STUB.
--    The payments spec replaces the body with a read of the ledger.
--    The signature never changes. Returns not_started | submitted | approved.
-- ══════════════════════════════════════════════════════════════════
create or replace function public.operator_requirement_pay_state(
  p_trip_id uuid, p_user_id uuid, p_requirement_id uuid
) returns text
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select 'not_started'::text;
$$;

revoke execute on function public.operator_requirement_pay_state(uuid, uuid, uuid) from public, anon;
grant  execute on function public.operator_requirement_pay_state(uuid, uuid, uuid) to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 3. The traveler's list. One read powers onboarding and the Plan panel.
--    Every state is computed from the evidence rows.
-- ══════════════════════════════════════════════════════════════════
create or replace function public.operator_trip_my_requirements(p_trip_id uuid)
returns table (
  requirement_id   uuid,
  kind             text,
  req_type         text,
  timing           text,
  title            text,
  help_text        text,
  due_date         date,
  effective_state  text,
  submitted_at     timestamptz,
  reviewed_at      timestamptz,
  approbation_note text,
  document_id      uuid
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select
    r.id, r.kind, r.req_type, r.timing, r.title, r.help_text, r.due_date,
    case
      -- pay: always straight from the ledger, never a stored flag
      when r.req_type = 'pay'
        then public.operator_requirement_pay_state(p_trip_id, auth.uid(), r.id)
      -- acknowledge: the agreement row IS the done state
      when r.req_type = 'acknowledge' then
        case when a.id is not null then 'approved'
             when r.due_date is not null and r.due_date < current_date then 'overdue'
             else 'not_started' end
      -- medical: completed_at IS the done state
      when r.kind = 'medical' then
        case when m.completed_at is not null then 'approved'
             when r.due_date is not null and r.due_date < current_date then 'overdue'
             else 'not_started' end
      -- upload: the document row is the state
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
  from public.group_trip_requirements_resolved r
  left join public.group_trip_documents d
         on d.requirement_id = r.id
        and d.user_id = auth.uid()
  left join public.group_trip_acknowledgements a
         on a.requirement_id = r.id
        and a.user_id = auth.uid()
        -- for the waiver, only an agreement to the CURRENT version counts
        and (
          r.kind <> 'waiver'
          or a.operator_document_id = (
               select od.id from public.group_trip_operator_documents od
                where od.trip_id = r.trip_id and od.kind = 'waiver'
                order by od.version desc limit 1)
        )
  left join public.group_trip_medical_forms m
         on m.trip_id = r.trip_id
        and m.user_id = auth.uid()
  where r.trip_id = p_trip_id
    and r.is_active
    and public.is_trip_participant(p_trip_id)
  order by
    case when r.timing = 'must_have' then 0 else 1 end,
    r.due_date nulls first,
    r.sort_order;
$$;

revoke execute on function public.operator_trip_my_requirements(uuid) from public, anon;
grant  execute on function public.operator_trip_my_requirements(uuid) to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 4. Traveler acknowledges (the waiver, or a custom "I agree" item).
-- ══════════════════════════════════════════════════════════════════
create or replace function public.operator_requirement_acknowledge(
  p_requirement_id uuid,
  p_full_name      text
) returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  r        record;
  v_doc    record;
  v_id     uuid;
begin
  select * into r from public.group_trip_requirements where id = p_requirement_id;
  if r is null then raise exception 'requirement not found'; end if;
  if r.req_type <> 'acknowledge' then
    raise exception 'requirement % is not an acknowledge item', p_requirement_id;
  end if;
  if not public.is_trip_participant(r.trip_id) then
    raise exception 'not on this trip';
  end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'a name is required';
  end if;

  -- the waiver points at the exact version the traveler saw
  if r.kind = 'waiver' then
    select od.* into v_doc
      from public.group_trip_operator_documents od
     where od.trip_id = r.trip_id and od.kind = 'waiver'
     order by od.version desc limit 1;
    if v_doc is null then raise exception 'no waiver has been published yet'; end if;
  end if;

  insert into public.group_trip_acknowledgements
    (requirement_id, trip_id, user_id, agreed_name, operator_document_id, agreed_version)
  values
    (r.id, r.trip_id, auth.uid(), trim(p_full_name), v_doc.id, v_doc.version)
  returning id into v_id;

  return v_id;
end $$;

revoke execute on function public.operator_requirement_acknowledge(uuid, text) from public, anon;
grant  execute on function public.operator_requirement_acknowledge(uuid, text) to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 5. Operator approves. Same function for one tap and for bulk.
-- ══════════════════════════════════════════════════════════════════
create or replace function public.operator_approve_documents(
  p_document_ids uuid[],
  p_note         text default null
) returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_count integer;
begin
  update public.group_trip_documents d
     set approved_at      = now(),
         approved_by      = auth.uid(),
         approbation_note = coalesce(nullif(p_note, ''), d.approbation_note)
   where d.id = any(p_document_ids)
     and d.approved_at is null
     and d.rejected_at is null          -- a rejected doc has no file to look at
     and public.is_trip_host(d.trip_id);
  get diagnostics v_count = row_count;  -- what the client shows as "12 approved"
  return v_count;
end $$;

revoke execute on function public.operator_approve_documents(uuid[], text) from public, anon;
grant  execute on function public.operator_approve_documents(uuid[], text) to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 6. Operator rejects == "delete + reclaim". One action, one button.
--    The row stays (carrying the note); the traveler re-uploads over it.
--
--    The caller MUST delete the storage object after this returns — a host
--    has the DELETE policy on the bucket. If that call fails, the row is
--    left as rejected_at not null + file_deleted_at null, which is exactly
--    the condition the purge job sweeps.
-- ══════════════════════════════════════════════════════════════════
create or replace function public.operator_reject_document(
  p_document_id uuid,
  p_note        text default null
) returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare d record;
begin
  select * into d from public.group_trip_documents where id = p_document_id;
  if d is null then raise exception 'document not found'; end if;
  if not public.is_trip_host(d.trip_id) then raise exception 'not your trip'; end if;

  update public.group_trip_documents
     set rejected_at      = now(),
         approved_at      = null,
         approved_by      = null,
         approbation_note = nullif(p_note, '')
   where id = p_document_id;

  -- An operator trip IS a group_trips row, so trip_id is a real FK here.
  insert into public.notifications
    (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  values (d.user_id, d.trip_id, 'operator_document_rejected', 'user', auth.uid(),
          'group_trip_document', d.id,
          jsonb_build_object('requirement_id', d.requirement_id,
                             'note', nullif(p_note, '')));
end $$;

revoke execute on function public.operator_reject_document(uuid, text) from public, anon;
grant  execute on function public.operator_reject_document(uuid, text) to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 7. Dashboard counts, per (trip, traveler, requirement).
--    expected = participants with role 'member'. Co-hosts and staff are
--    role 'host' rows and are NOT travelers — excluding by host_id alone
--    would count co-hosts and the trip would read 13/15 forever.
--    A rejected document does not count as received: that traveler owes a
--    new file.
-- ══════════════════════════════════════════════════════════════════
create or replace function public.group_trip_document_counts(p_trip_id uuid)
returns table (requirement_id uuid, expected int, received int, approved int)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not public.is_trip_host(p_trip_id) then raise exception 'not your trip'; end if;

  return query
  with active as (
    select p.user_id
      from public.group_trip_participants p
     where p.trip_id = p_trip_id and p.role = 'member'
  ), reqs as (
    select r.id
      from public.group_trip_requirements r
     where r.trip_id = p_trip_id and r.req_type = 'upload' and r.is_active
  )
  select r.id,
         (select count(*) from active)::int,
         count(d.id) filter (where d.rejected_at is null)::int,
         count(d.id) filter (where d.approved_at is not null)::int
    from reqs r
    left join public.group_trip_documents d
           on d.requirement_id = r.id
          and d.user_id in (select user_id from active)
   group by r.id;
end $$;

revoke execute on function public.group_trip_document_counts(uuid) from public, anon;
grant  execute on function public.group_trip_document_counts(uuid) to authenticated;
