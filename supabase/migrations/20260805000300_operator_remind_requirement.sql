-- Operator Trips — "Remind N people" from the Dashboard tab.
--
-- Item 3 of docs/specs/operator-trips/dashboard-tab-ux.md.
--
-- WHAT THIS SOLVES: the most common thing an operator does is chase the people
-- who have not sent a document, and until now there was no way to do it as a
-- group. The only path was: tap a traveler, open their page, send one DM, go
-- back, repeat — having first worked out who those people were by reading every
-- row of the list.
--
-- NOTHING NEW IS STORED. No table, no column. The cooldown reads
-- public.notifications itself, which already records exactly what we need to
-- know: did this person get this reminder recently.
--
-- THE PLUMBING ALREADY EXISTED AND HAD NO PRODUCER. 20260724000000 added
-- `operator_requirement_due_soon` to the enum and 20260724000500 gave it a push
-- priority, with the comment "reminder cadence is not decided yet". Nothing has
-- ever created one. A manual button dissolves that question: the operator
-- decides the cadence by tapping.
--
-- ── APPLY BY HAND, in the SQL editor. Never `db push`. ──────────────────────

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Push priority: -1 → 1
-- ════════════════════════════════════════════════════════════════════════════
-- `operator_requirement_due_soon` was DELIBERATELY left at -1 (feed only, no
-- push) by 20260724000500, because at the time nothing sent it and the cadence
-- was undecided. That is now the wrong default: a "Remind 8 people" button that
-- only writes eight bell rows is worse than no button, because the operator
-- believes they have chased someone and they have not.
--
-- 1, not 0: this is a nudge about something that is not necessarily late yet.
-- `operator_requirement_overdue` keeps 0 (urgent) for an actual missed deadline.
--
-- ⚠️ THE BODY BELOW WAS READ FROM PRODUCTION, NOT COPIED FROM A REPO FILE.
-- The live definition has drifted ahead of every migration in this repo —
-- operator_* cases were added directly to prod — so replacing it from an older
-- file would silently demote those types back to feed-only. Verified live
-- 2026-08-05 with:
--   select pg_get_functiondef('public.notification_push_priority(public.notification_type, jsonb)'::regprocedure);
-- The ONLY change is the single 'operator_requirement_due_soon' line.
-- If you ever touch this again: read the live definition FIRST and add to THAT.
create or replace function public.notification_push_priority(p_type notification_type, p_data jsonb)
returns smallint language sql immutable as $function$
  select case p_type
    when 'join_request_received'        then 0
    when 'join_request_decided'         then case when p_data->>'decision' = 'approved' then 0 else 1 end
    when 'commitment_request_received'  then 0
    when 'commitment_decided'           then case when p_data->>'decision' = 'approved' then 0 else -1 end
    when 'member_committed'             then 1
    when 'gear_request_received'        then 0
    when 'gear_request_decided'         then 1
    when 'admin_update_posted'          then 1
    when 'group_gear_updated'           then 1
    when 'personal_gear_updated'        then 1
    when 'member_left'                  then 1
    when 'trip_cancelled'               then 0
    when 'member_removed'               then 0
    when 'trip_invite_received'         then 0
    when 'trip_invite_accepted'         then 0
    when 'trip_invite_declined'         then 1
    when 'operator_document_rejected'   then 0
    when 'operator_requirement_added'   then 1
    when 'operator_requirement_overdue' then 0
    when 'operator_requirement_overdue_operator' then 1
    when 'operator_stripe_ready'        then 1
    when 'operator_requirement_due_soon' then 1   -- ← the only new line
    when 'member_joined'                then -1
    when 'gear_claimed'                 then -1
    else -1
  end::smallint;
$function$;

-- Restore the EXACT grants read from prod before this ran:
--   proacl = {postgres=X/postgres,service_role=X/postgres}
-- i.e. NOT authenticated, NOT anon, NOT PUBLIC. Only tg_enqueue_push calls it,
-- and that runs as its definer.
revoke execute on function public.notification_push_priority(notification_type, jsonb)
  from public, anon, authenticated;
grant  execute on function public.notification_push_priority(notification_type, jsonb)
  to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Bell + push copy
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ `public.notification_templates` DOES NOT EXIST IN PRODUCTION. Verified
-- 2026-08-05: migration 20260611000200_notification_templates.sql was never
-- applied. Only `notifications` and `notification_queue` are there.
--
-- Both readers already cope — notificationsService swallows the missing-table
-- error and dispatch-notification-queue try/catches the fetch ("missing
-- table/rows → hardcoded defaults") — so copy has always come from code, not
-- from this table.
--
-- The insert is therefore GUARDED rather than deleted. Unguarded it would abort
-- this whole migration on a 42P01; deleted, the row would be silently missing
-- if 20260611000200 is ever applied later. This way it is right either way.
--
-- {item} resolves from data->>'item_name' (see notificationsService's `vars`),
-- which is why the RPC below writes the requirement title into BOTH
-- `item_name` (for the template) and `requirement_title` (for the hardcoded
-- fallback, matching what operator_document_rejected already reads).
do $$
begin
  if to_regclass('public.notification_templates') is not null then
    insert into public.notification_templates (key, push_title, push_body, bell_title, bell_body)
    values (
      'operator_requirement_due_soon',
      'Still needed for {trip}',
      'Your organiser is waiting for {item}',
      '{item} still needed',
      'Your organiser is still waiting for this for {trip}.'
    )
    on conflict (key) do nothing;   -- never overwrite a later hand-edit
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. The RPC
-- ════════════════════════════════════════════════════════════════════════════
-- Returns how many reminders were ACTUALLY sent, which is not the same as how
-- many people owe — the cooldown silently drops anyone reminded in the last
-- day. The client reports the difference rather than claiming eight when it
-- sent five.
drop function if exists public.operator_remind_requirement(uuid, uuid);

create function public.operator_remind_requirement(
  p_trip_id        uuid,
  p_requirement_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_sent       integer;
  v_req_title  text;
  v_req_type   text;
  v_req_kind   text;
  v_due        date;
  v_trip_title text;
  v_actor      text;
begin
  -- Same gate as every other operator write. is_trip_host reads auth.uid()
  -- itself, so a definer function cannot be tricked by a passed-in id.
  if not public.is_trip_host(p_trip_id) then
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

  -- PAY ROWS ARE OUT, on purpose. fetchTripReview hardcodes every pay row to
  -- 'not_started' because it never loads the ledger (tripDocumentsService.ts
  -- :1216-1226), so the client would compute "remind 15 people" on a deposit
  -- everyone had already paid. Rather than let this function be right while the
  -- button that calls it is wrong, both refuse. See D3 in the spec.
  if v_req_type = 'pay' then
    raise exception 'Payment reminders are not supported yet'
      using errcode = '0A000';
  end if;

  select g.title into v_trip_title from public.group_trips g where g.id = p_trip_id;
  v_actor := public.user_display_name(auth.uid());

  with owed as (
    select p.user_id
    from public.group_trip_participants p
    -- `<> 'host'` and nothing else, because that is EXACTLY what the Dashboard
    -- means by "traveler" (TripDetailScreen: participants.filter(role !==
    -- 'host')). Excluding 'admin' as well would make the button say 8 and send
    -- 7, and nobody would ever notice which of the two was lying.
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
      and p.role is distinct from 'host'
      -- Branch order MIRRORS operator_trip_my_requirements exactly: acknowledge
      -- BEFORE medical, then documents. If these two ever disagree, this button
      -- reminds the wrong people — which is the worst way this feature can fail,
      -- because it looks like it worked.
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
      -- Duplicated into item_name so the template's {item} resolves — the bell
      -- builds its vars from item_name/gear_name and knows nothing about
      -- requirements.
      'item_name',         v_req_title,
      'actor_name',        v_actor
    )
  from owed o
  -- 24-hour cooldown, read straight from the notification history. An operator
  -- who taps twice in frustration must not send twice.
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
$$;

-- A brand-new function is callable by PUBLIC until told otherwise, and the
-- project-wide SECDEF revoke means a client RPC without an explicit grant 403s.
revoke execute on function public.operator_remind_requirement(uuid, uuid) from public, anon;
grant  execute on function public.operator_remind_requirement(uuid, uuid) to authenticated;

comment on function public.operator_remind_requirement(uuid, uuid) is
  'Dashboard "Remind N people". Notifies every non-host participant who has not '
  'satisfied this requirement, skipping anyone reminded for it in the last 24h. '
  'Returns the number actually sent. Host-only. Pay requirements rejected.';
