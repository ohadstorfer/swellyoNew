-- Operator Trips — rename to the `organized_trip_*` scheme (Eyal + Ohad, 2026-07-24).
--
-- All of these tables are EMPTY and nothing in the client references them yet,
-- so this is a pure rename with no data movement and no downtime risk.
--
--   group_trip_requirements       -> organized_trip_requirements
--   group_trip_documents          -> organized_trip_travelers_documents
--   group_trip_operator_documents -> organized_trip_operator_documents
--   group_trip_medical_forms      -> organized_trip_medical_forms
--   column requirements.timing    -> skip_at_onboarding
--
-- NOT renamed here:
--   group_trip_acknowledgements — Eyal's note says to delete it. Not dropped
--     yet: it is the only record of who signed which waiver version. Needs a
--     replacement decided first. See the summary.
--
-- `skip-at-onboarding` (Eyal's spelling) would need double quotes in every
-- statement forever, so the column uses underscores like every other column.

-- ── 0. Drop the views first.
--   A view expands `select r.*` into an explicit column list at CREATE time, so
--   renaming the table's `timing` column does NOT rename the view's output
--   column — and `create or replace view` cannot rename a column either. Both
--   views are rebuilt at step 9.
drop view if exists public.group_trip_requirements_resolved;
drop view if exists public.group_trip_medical_flags;

-- ── 1. Tables
alter table public.group_trip_requirements        rename to organized_trip_requirements;
alter table public.group_trip_documents           rename to organized_trip_travelers_documents;
alter table public.group_trip_operator_documents  rename to organized_trip_operator_documents;
alter table public.group_trip_medical_forms       rename to organized_trip_medical_forms;

-- ── 2. Column
alter table public.organized_trip_requirements rename column timing to skip_at_onboarding;

-- ── 4. Constraints
alter table public.organized_trip_requirements
  rename constraint group_trip_req_deadline_rule to organized_trip_req_deadline_rule;
alter table public.organized_trip_requirements
  rename constraint group_trip_requirements_pkey to organized_trip_requirements_pkey;
alter table public.organized_trip_requirements
  rename constraint group_trip_requirements_kind_check to organized_trip_requirements_kind_check;
alter table public.organized_trip_requirements
  rename constraint group_trip_requirements_req_type_check to organized_trip_requirements_req_type_check;
alter table public.organized_trip_requirements
  rename constraint group_trip_requirements_timing_check to organized_trip_requirements_skip_at_onboarding_check;
alter table public.organized_trip_requirements
  rename constraint group_trip_requirements_deadline_days_before_check
                 to organized_trip_requirements_deadline_days_before_check;

alter table public.organized_trip_travelers_documents
  rename constraint gtd_not_both_states to otd_not_both_states;
alter table public.organized_trip_travelers_documents
  rename constraint group_trip_documents_pkey to organized_trip_travelers_documents_pkey;

alter table public.organized_trip_operator_documents
  rename constraint op_doc_has_content to organized_op_doc_has_content;
alter table public.organized_trip_operator_documents
  rename constraint group_trip_operator_documents_pkey to organized_trip_operator_documents_pkey;
alter table public.organized_trip_operator_documents
  rename constraint group_trip_operator_documents_kind_check to organized_trip_operator_documents_kind_check;
alter table public.organized_trip_operator_documents
  rename constraint group_trip_operator_documents_version_check to organized_trip_operator_documents_version_check;
alter table public.organized_trip_operator_documents
  rename constraint group_trip_operator_documents_trip_id_kind_version_key
                 to organized_trip_operator_documents_trip_id_kind_version_key;

alter table public.organized_trip_medical_forms
  rename constraint medical_text_len to organized_medical_text_len;
alter table public.organized_trip_medical_forms
  rename constraint group_trip_medical_forms_pkey to organized_trip_medical_forms_pkey;
alter table public.organized_trip_medical_forms
  rename constraint group_trip_medical_forms_trip_id_user_id_key
                 to organized_trip_medical_forms_trip_id_user_id_key;

-- ── 5. Indexes
alter index public.uq_group_trip_req_kind_per_trip rename to uq_organized_trip_req_kind_per_trip;
alter index public.idx_group_trip_req_trip         rename to idx_organized_trip_req_trip;
alter index public.uq_gtd_trip_user_requirement    rename to uq_otd_trip_user_requirement;
alter index public.idx_gtd_pending_review          rename to idx_otd_pending_review;
alter index public.idx_gtod_trip_kind              rename to idx_otod_trip_kind;
alter index public.idx_gtmf_trip                   rename to idx_otmf_trip;

-- ── 6. Triggers + their functions
alter trigger trg_touch_group_trip_requirements on public.organized_trip_requirements
  rename to trg_touch_organized_trip_requirements;
alter trigger trg_touch_group_trip_medical_forms on public.organized_trip_medical_forms
  rename to trg_touch_organized_trip_medical_forms;

alter function public.touch_group_trip_requirements()  rename to touch_organized_trip_requirements;
alter function public.touch_group_trip_medical_forms() rename to touch_organized_trip_medical_forms;

-- ── 7. Policies
alter policy group_trip_req_select on public.organized_trip_requirements rename to organized_trip_req_select;
alter policy group_trip_req_write  on public.organized_trip_requirements rename to organized_trip_req_write;
alter policy gtd_select on public.organized_trip_travelers_documents rename to otd_select;
alter policy gtd_insert on public.organized_trip_travelers_documents rename to otd_insert;
alter policy gtd_delete on public.organized_trip_travelers_documents rename to otd_delete;
alter policy gtod_select on public.organized_trip_operator_documents rename to otod_select;
alter policy gtod_insert on public.organized_trip_operator_documents rename to otod_insert;

-- ── 9. Rebuild the views under their new names.
create or replace view public.organized_trip_requirements_resolved
with (security_invoker = on) as
select
  r.*,
  t.start_date as departure_date,
  case
    when r.deadline_days_before is null or t.start_date is null then null
    else (t.start_date - make_interval(days => r.deadline_days_before))::date
  end as due_date
from public.organized_trip_requirements r
join public.group_trips t on t.id = r.trip_id;

revoke all    on public.organized_trip_requirements_resolved from anon, public;
grant  select on public.organized_trip_requirements_resolved to   authenticated;

create or replace view public.organized_trip_medical_flags
with (security_invoker = true) as
select trip_id,
       count(*) filter (where coalesce(length(trim(injuries)), 0)    > 0) as injuries_reported,
       count(*) filter (where coalesce(length(trim(allergies)), 0)   > 0) as allergies_reported,
       count(*) filter (where coalesce(length(trim(dietary)), 0)     > 0) as dietary_reported,
       count(*) filter (where coalesce(length(trim(medications)), 0) > 0) as medications_reported,
       count(*) filter (where completed_at is not null)                   as forms_completed
from public.organized_trip_medical_forms
group by trip_id;

-- Supabase default privileges grant ALL on new views to anon — revoke explicitly.
revoke all    on public.organized_trip_medical_flags from anon, public;
grant  select on public.organized_trip_medical_flags to   authenticated;

-- ── 8. Rebuild the functions whose bodies name the old tables.
--   plpgsql resolves table names at RUNTIME, so these would break after the
--   rename if left alone. (SQL-language functions store a parse tree and follow
--   the OIDs, but are rebuilt too so the source text is not misleading.)

-- 8a. counts RPC — also renamed off the group_trip_ prefix.
drop function if exists public.group_trip_document_counts(uuid);

create or replace function public.organized_trip_document_counts(p_trip_id uuid)
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
      from public.organized_trip_requirements r
     where r.trip_id = p_trip_id and r.req_type = 'upload' and r.is_active
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

-- 8b. approve
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
  update public.organized_trip_travelers_documents d
     set approved_at      = now(),
         approved_by      = auth.uid(),
         approbation_note = coalesce(nullif(p_note, ''), d.approbation_note)
   where d.id = any(p_document_ids)
     and d.approved_at is null
     and d.rejected_at is null
     and public.is_trip_host(d.trip_id);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- 8c. reject
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
  select * into d from public.organized_trip_travelers_documents where id = p_document_id;
  if d is null then raise exception 'document not found'; end if;
  if not public.is_trip_host(d.trip_id) then raise exception 'not your trip'; end if;

  update public.organized_trip_travelers_documents
     set rejected_at      = now(),
         approved_at      = null,
         approved_by      = null,
         approbation_note = nullif(p_note, '')
   where id = p_document_id;

  insert into public.notifications
    (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  values (d.user_id, d.trip_id, 'operator_document_rejected', 'user', auth.uid(),
          'organized_trip_travelers_document', d.id,
          jsonb_build_object('requirement_id', d.requirement_id,
                             'note', nullif(p_note, '')));
end $$;

-- 8d. acknowledge
create or replace function public.operator_requirement_acknowledge(
  p_requirement_id uuid,
  p_full_name      text
) returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  r     record;
  v_doc record;
  v_id  uuid;
begin
  select * into r from public.organized_trip_requirements where id = p_requirement_id;
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

  if r.kind = 'waiver' then
    select od.* into v_doc
      from public.organized_trip_operator_documents od
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

-- 8e. the traveler's list — DROP + CREATE because an output column is renamed
--     (timing -> skip_at_onboarding), which changes the return type.
drop function if exists public.operator_trip_my_requirements(uuid);

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
    and public.is_trip_participant(p_trip_id)
  order by
    case when r.skip_at_onboarding = 'must_have' then 0 else 1 end,
    r.due_date nulls first,
    r.sort_order;
$$;

revoke execute on function public.operator_trip_my_requirements(uuid) from public, anon;
grant  execute on function public.operator_trip_my_requirements(uuid) to authenticated;
