-- Automatic requirement deadline reminders.
--
-- Hole: docs/operator-trips-checklist.html §4, "Deadline reminders never fire
-- on their own" — operator_requirement_due_soon and operator_requirement_overdue
-- have existed since July (20260724000000) with real copy, but their only
-- producer was operator_remind_requirement (the "Remind N people" button). A
-- traveler could sail past every document deadline in total silence, and
-- operator_requirement_overdue_operator — meant to tell the OPERATOR when
-- people are late — had no producer at all.
--
-- This migration adds the read-only RPC a new daily scan (scan-requirement-
-- deadlines, deployed separately) calls per trip. It does not send anything
-- itself; the edge function decides cadence and writes `notifications` rows,
-- same split as scan-trip-reminders / scan-stalled-onboarding.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Who still owes this requirement, and how many days from its due date.
-- ════════════════════════════════════════════════════════════════════════════
-- Status logic is a DELIBERATE COPY of operator_remind_requirement's (see
-- 20260805000300) — same branch order (acknowledge, then medical, then
-- upload), same reason: a definer function is the security boundary, so a
-- second free-standing one is safer here than threading a shared helper
-- through the RPC that already has a client contract. Keep both in sync BY
-- HAND, the same trade trip-cancel documents for its refund core.
--
-- Narrowed to 'not_started' only — NOT 'rejected'. A rejected upload already
-- has its own live notification (operator_document_rejected) naming exactly
-- what to fix; re-nagging it on a deadline timer would just be a second,
-- vaguer message about the same thing.
create or replace function public.operator_requirement_deadline_owed(p_trip_id uuid)
returns table (
  requirement_id   uuid,
  requirement_title text,
  due_date          date,
  user_id           uuid,
  days_until_due    integer  -- negative = already past due
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select
    r.id, r.title, r.due_date, p.user_id,
    (r.due_date - current_date)::integer
  from public.organized_trip_requirements_resolved r
  join public.group_trip_participants p on p.trip_id = r.trip_id
  left join public.organized_trip_travelers_documents d
         on d.requirement_id = r.id and d.user_id = p.user_id
  left join public.group_trip_acknowledgements a
         on a.requirement_id = r.id and a.user_id = p.user_id
        and (
          r.kind <> 'waiver'
          or a.operator_document_id = (
               select od.id from public.organized_trip_operator_documents od
                where od.trip_id = r.trip_id and od.kind = 'waiver'
                order by od.version desc limit 1)
        )
  left join public.organized_trip_medical_forms m
         on m.trip_id = r.trip_id and m.user_id = p.user_id
  where r.trip_id = p_trip_id
    and r.is_active
    and r.due_date is not null
    and r.req_type in ('upload', 'acknowledge')
    -- Same definition of "traveler" operator_remind_requirement uses: not a
    -- host. Staff have their own paperwork rows (organized_trip_staff_*),
    -- not these, so this join never sees them anyway.
    and p.role is distinct from 'host'
    and (case
           when r.req_type = 'acknowledge' then
             case when a.id is not null then 'approved' else 'not_started' end
           when r.kind = 'medical' then
             case when m.completed_at is not null then 'approved' else 'not_started' end
           when d.id is null then 'not_started'
           when d.rejected_at is not null then 'rejected'
           when d.approved_at is not null then 'approved'
           else 'submitted'
         end) = 'not_started';
$$;

revoke execute on function public.operator_requirement_deadline_owed(uuid) from public, anon, authenticated;
grant  execute on function public.operator_requirement_deadline_owed(uuid) to service_role;

comment on function public.operator_requirement_deadline_owed(uuid) is
  'Service-role only. Every (requirement, traveler) pair on this trip that has '
  'not been started, with days_until_due (negative = overdue). Feeds the daily '
  'scan-requirement-deadlines edge function. Status logic is a hand-kept copy '
  'of operator_remind_requirement''s — change one, change both.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Bell + push copy
-- ════════════════════════════════════════════════════════════════════════════
-- operator_requirement_due_soon already has a template row (20260805000300).
-- operator_requirement_overdue and operator_requirement_overdue_operator get
-- NONE here on purpose: both need a formatted date and (for the operator one)
-- a headcount, and neither {date} nor {count} is a var the two renderers'
-- `fill()` knows how to resolve — the same reason operator_stripe_action_needed
-- has no template row either. Their copy is hardcoded in render.ts and
-- notificationsService.ts, reading the pre-formatted strings the scan writes
-- into data (`due_date_label`, `count`) directly.
