-- The deadline scanner never chases a document it sent back.
--
-- `operator_requirement_deadline_owed` (20260820000000) matched exactly one
-- state, 'not_started'. Its own edge function's header says it "mirrors
-- operator_remind_requirement's own 'who still owes this' logic" — it did not.
-- That function matches `('not_started', 'overdue', 'rejected')`, where
-- 'overdue' is just 'not_started' past its due date, so the real difference is
-- one state: **rejected**.
--
-- The gap is the worst possible one to have. A rejected document is the case
-- where the operator has ALREADY spoken — `operator_reject_document` told the
-- traveler what was wrong and asked for a new one. Someone who never sends it
-- was, until now:
--
--   * never nudged at 14/7/3/2/1 days before the deadline,
--   * never told when the deadline passed,
--   * and invisible in the operator's own overdue digest, so nobody found out
--     from the other side either.
--
-- Verified on prod 2026-08-20 against El Salvador 26: sababa's passport was
-- rejected on 5 Aug and never re-sent. With that requirement's due date moved
-- to yesterday, this function returned only the OTHER traveler, and the
-- operator digest said "1 person late" when it was two.
--
-- 'submitted' stays excluded, in both functions, and that is correct: the
-- document is sitting in the operator's review queue and the ball is not in
-- the traveler's court. Chasing them for it would be the mirror-image bug.
--
-- Body is otherwise byte-identical to 20260820000000 — only the final `in`
-- list changed.

create or replace function public.operator_requirement_deadline_owed(p_trip_id uuid)
returns table (
  requirement_id    uuid,
  requirement_title text,
  due_date          date,
  user_id           uuid,
  days_until_due    integer
)
language sql
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
         end) in ('not_started', 'rejected');
$$;

-- ⚠️ CREATE OR REPLACE re-grants EXECUTE to PUBLIC. This one is
-- SECURITY DEFINER and reads every traveler's document state on a trip with no
-- caller check at all — it is safe ONLY because nothing but the service role
-- can call it. Its ACL on prod before this migration was
-- {postgres, service_role}; these three lines are what keep it that way.
revoke execute on function public.operator_requirement_deadline_owed(uuid) from public;
revoke execute on function public.operator_requirement_deadline_owed(uuid) from anon;
revoke execute on function public.operator_requirement_deadline_owed(uuid) from authenticated;
