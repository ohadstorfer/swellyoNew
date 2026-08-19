-- Moving the dates is no longer silent.
--
-- Hole: docs/operator-trips-checklist.html, "Moving the dates moves every
-- deadline in silence".
-- Type: 20260819000200 (must already be applied — see its header).
-- Order: apply AFTER 20260819000100 — the function in §1 below is rebuilt from
--        that migration's version of `notification_push_priority`, so running
--        these out of order erases whichever line was added last.
--
-- ── The scenario ────────────────────────────────────────────────────────────
-- Every deadline on an operator trip is stored relative to departure, never as
-- an absolute date:
--
--   · document deadlines — organized_trip_requirements.deadline_days_before,
--     resolved against start_date by group_trip_requirements_resolved
--     (20260724000400)
--   · the final payment  — the same column on the `balance` row, which is also
--     what 20260817000000 reads to decide a late joiner pays in full
--   · offline trips      — group_trips.offline_payment_due_days_before
--     (20260813000000), the same idea as a trip column
--
-- That design is right: moving a trip keeps every deadline correct with no
-- backfill. What was missing is that it also moves them for the traveler, who
-- had agreed to a different set of dates and was told nothing. There was no
-- "trip changed" notification of any kind — the only way anyone heard was the
-- operator pressing Remind on a requirement.
--
-- The operator side of this is `describeDeadlineShift` in
-- OperatorTripEditScreen.tsx, which spells out what the new start date does
-- before they confirm. This file is the other half: the travelers hear too.
--
-- ── Why a trigger and not the edit screen ───────────────────────────────────
-- Same reason cancel, leave, remove and decline are triggers: the dates can be
-- changed from the phone, from the operator dashboard, or by hand in SQL, and
-- all three have to notify identically. A notification fired from
-- `updateOperatorTrip` would only cover the first.

-- ── 1. Push priority for the new type ───────────────────────────────────────
--
-- Rebuilt whole, from 20260819000100's definition (which was itself rebuilt
-- from 20260818000600's, which was rebuilt from the LIVE definition — live
-- drifts ahead of the repo). The only edit is the one added line.
--
-- Priority 1, not 0. The trip moved; nothing is on fire and nothing is owed in
-- the next few hours, so there is no claim to wake anyone. Outside quiet hours
-- priority 1 sends immediately anyway.
create or replace function public.notification_push_priority(
  p_type notification_type, p_data jsonb
) returns smallint
language sql
immutable
as $$
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
    when 'trip_dates_changed'           then 1
    when 'trip_invite_received'         then 0
    when 'operator_staff_invited'       then 0
    when 'trip_invite_accepted'         then 0
    when 'trip_invite_declined'         then 1
    when 'operator_document_rejected'   then 0
    when 'operator_requirement_added'   then 1
    when 'operator_requirement_overdue' then 0
    when 'operator_requirement_overdue_operator' then 1
    when 'operator_stripe_ready'        then 1
    when 'operator_stripe_action_needed' then
      case when p_data->>'reason' in ('charges_disabled', 'blocked') then 0 else 1 end
    when 'operator_payment_stuck'       then 1
    when 'operator_requirement_due_soon' then 1
    when 'operator_setup_required'      then 1
    when 'onboarding_unfinished'        then 1
    when 'operator_onboarding_stalled'  then 1
    when 'member_joined'                then -1
    when 'gear_claimed'                 then -1
    else -1
  end::smallint;
$$;

-- CREATE OR REPLACE can re-add the PUBLIC execute grant. Restore the exact
-- pre-existing state: this function is only ever called by tg_enqueue_push,
-- which runs as the definer.
revoke execute on function public.notification_push_priority(notification_type, jsonb)
  from public, anon, authenticated;
grant  execute on function public.notification_push_priority(notification_type, jsonb)
  to service_role;

-- ── 2. Push copy, as a template row ─────────────────────────────────────────
--
-- A template row instead of relying on a render.ts case, so
-- `dispatch-notification-queue` needs NO deploy — its live copy is behind the
-- repo, and `renderPush` checks the template map before its switch. Same trick
-- 20260806000000 used for the Remind button and 20260819000100 for
-- operator_payment_stuck.
--
-- The copy is deliberately vague about WHAT the new dates are. `fill()` in
-- render.ts only substitutes a fixed set of variables — trip, actor, item,
-- qty, preview, days — and a date range is none of them. render.ts does gain a
-- proper case below the templates (see the repo file) that reads
-- `data->>'date_range'` and names the dates; it takes effect the day the
-- function is next deployed and this row is removed. Until then the push says
-- "the dates changed" and the bell, which reads `data` directly, shows them.
--
-- bell_title / bell_body stay NULL: a bell template overrides the client's
-- copy and flattens its layout (20260806000000's warning — one row per key,
-- push fields only, unless flattening is wanted). Bell copy lives in
-- notificationsService.ts like every other type's.
insert into public.notification_templates (key, push_title, push_body)
values (
  'trip_dates_changed',
  'New dates for {trip}',
  'The dates changed. Your deadlines moved with them — tap to see.'
)
on conflict (key) do nothing;

-- ── 3. The trigger ──────────────────────────────────────────────────────────
create or replace function public.tg_notify_trip_dates_changed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_range      text;
  v_data       jsonb;
  v_deadlines  boolean;
  v_actor      uuid;
begin
  begin
    -- Who moved the dates. NOT `new.host_id` — since 20260708000000 that
    -- column is only the PRIMARY host and a trip can have several (`role =
    -- 'host'` is a set), so on a co-hosted trip it would credit the change to
    -- someone who did not make it. `auth.uid()` is right for every client
    -- write; the coalesce covers a service-role or SQL-editor update, where it
    -- is null. Assigned here rather than in DECLARE so that it, like
    -- everything else, is inside the handler below.
    v_actor := coalesce(auth.uid(), new.host_id);

    -- Nothing to announce. A trip whose exact dates are being CLEARED back to
    -- loose months is not a new deal to tell anyone about, and the copy
    -- ("the dates changed to …") has nothing to put in the blank.
    if new.start_date is null then
      return null;
    end if;

    -- A cancelled trip already sent `trip_cancelled`. Dragging its dates
    -- afterwards must not reopen the conversation.
    if new.status = 'cancelled' then
      return null;
    end if;

    v_range := case
      when new.end_date is null then
        to_char(new.start_date, 'FMDD Mon YYYY')
      when extract(year from new.start_date) = extract(year from new.end_date) then
        to_char(new.start_date, 'FMDD Mon') || ' – ' || to_char(new.end_date, 'FMDD Mon YYYY')
      else
        to_char(new.start_date, 'FMDD Mon YYYY') || ' – ' || to_char(new.end_date, 'FMDD Mon YYYY')
    end;

    -- Does this trip actually HAVE a deadline that just moved? Both shapes
    -- count: a requirement row carrying `deadline_days_before` (the documents
    -- and, on a managed trip, the `balance` final payment), or an offline
    -- trip's own full-payment column. Every peer trip answers false — they
    -- have no requirements at all — which is what keeps "your deadlines moved"
    -- off a notification where nothing of the sort happened, and keeps the tap
    -- on the trip rather than a Documents card that does not exist.
    select
      -- Gated on payment_mode because the column is deliberately NOT — a
      -- managed trip that used to be offline keeps a stale value there and
      -- nothing reads it (20260813000000's header).
      (new.payment_mode = 'offline' and new.offline_payment_due_days_before is not null)
      or exists (
        select 1 from public.organized_trip_requirements r
        where r.trip_id = new.id
          and r.is_active
          and r.audience = 'traveler'
          and r.deadline_days_before is not null
      )
    into v_deadlines;

    v_data := jsonb_build_object(
      'trip_title',      new.title,
      'has_deadlines',   v_deadlines,
      'start_date',      new.start_date,
      'end_date',        new.end_date,
      'prev_start_date', old.start_date,
      'prev_end_date',   old.end_date,
      -- Pre-formatted here rather than in the client so the push and the bell
      -- read the same string. The client still gets the raw dates above and is
      -- free to format them itself.
      'date_range',      v_range,
      -- ⚠️ `stage` duplicates the new dates ON PURPOSE, exactly as
      -- 20260818000600 does with `reason`. tg_enqueue_push appends
      -- `data->>'stage'` to dedup_key and collapses duplicate PENDING pushes,
      -- so without it an operator who moves the trip twice inside one quiet
      -- window would have the second push swallowed by the first — and the
      -- push that survived would name the dates that are no longer true.
      'stage',           v_range
    );

    -- Everyone on the trip who is not running it.
    --
    -- `p.role <> 'host'`, NOT `p.user_id <> new.host_id`. Since 20260708000000
    -- a trip can have several hosts and `group_trips.host_id` names only the
    -- primary one, so the older `<> new.host_id` test — still what
    -- trg_trip_cancelled uses — tells a co-host about a change on their own
    -- trip. Filtering by role excludes all of them.
    --
    -- No `status` filter on purpose. The column is 'onboarding' | 'active'
    -- (20260810000000), and a traveler part-way through onboarding is exactly
    -- who most needs this: the dates are half the deal they are in the middle
    -- of accepting (spec §9, docs/specs/operator-trips/operator-trip-edit.md).
    insert into public.notifications
      (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
    select p.user_id, new.id, 'trip_dates_changed', 'user', v_actor,
           'group_trip', new.id, v_data
    from public.group_trip_participants p
    where p.trip_id = new.id
      and p.role <> 'host';

    -- Pending requesters too, and for the same reason `trg_trip_cancelled`
    -- includes them (20260609000050:27-34): they are waiting on a decision
    -- about a trip whose dates just moved under them.
    insert into public.notifications
      (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
    select jr.requester_id, new.id, 'trip_dates_changed', 'user', v_actor,
           'group_trip', new.id, v_data
    from public.group_trip_join_requests jr
    where jr.trip_id = new.id
      and jr.status = 'pending'
      and not exists (
        select 1 from public.group_trip_participants p
        where p.trip_id = new.id and p.user_id = jr.requester_id
      );

  exception when others then
    -- The date change itself must land. An operator cannot act on
    -- "notification insert failed" and undoing their edit for it would be
    -- worse than the silence this file exists to end.
    raise warning
      'tg_notify_trip_dates_changed: could not notify trip % (%)', new.id, sqlerrm;
  end;

  return null;  -- AFTER trigger; the return value is ignored.
end $$;

comment on function public.tg_notify_trip_dates_changed() is
  'Tells everyone on a trip when its dates move, because every requirement '
  'deadline and the final payment are stored relative to start_date and move '
  'with it. Fires from the row, so the app, the operator dashboard and a hand '
  'written UPDATE all notify identically.';

drop trigger if exists trg_notify_trip_dates_changed on public.group_trips;

create trigger trg_notify_trip_dates_changed
  after update of start_date, end_date on public.group_trips
  for each row
  -- `update of` alone still fires when the columns are written with the value
  -- they already had — the edit screen sends the whole DatesPatch on every
  -- save, including one where only `duration_days` really changed. This clause
  -- is what keeps a no-op re-save from pushing the whole trip.
  when (
    old.start_date is distinct from new.start_date
    or old.end_date is distinct from new.end_date
  )
  execute function public.tg_notify_trip_dates_changed();

-- To undo:
--   drop trigger if exists trg_notify_trip_dates_changed on public.group_trips;
--   drop function if exists public.tg_notify_trip_dates_changed();
--   delete from public.notification_templates where key = 'trip_dates_changed';
--   (the enum value and the priority line are harmless to leave)
