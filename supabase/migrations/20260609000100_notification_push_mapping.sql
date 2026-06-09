-- ============================================================================
-- Push channel + priority, read from group-trip-notifications-plan.html.
--   returns -1 = feed only (no push) · 0 = urgent (send now) · 1 = normal (held)
-- Phase 1 = event-driven only. Time-based types (trip_ended/trip_reminder) and
-- batched member_joined push arrive in Phase 2 — they return -1 here for now.
-- APPLY ORDER: 000000 → 000050 → 000100 (this) → 000300. The new enum values
-- referenced below (member_left, trip_cancelled, member_removed) are created in
-- 20260609000050 — it MUST be applied first or this SQL function fails to resolve them.
-- ============================================================================
create or replace function public.notification_push_priority(
  p_type public.notification_type,
  p_data jsonb
) returns smallint
language sql immutable as $$
  select case p_type
    when 'join_request_received'        then 0      -- 1.1 host decision
    when 'join_request_decided'         then case when p_data->>'decision' = 'approved' then 0 else 1 end  -- 1.2 / 1.3
    when 'commitment_request_received'  then 0      -- 2.7 host decision
    when 'commitment_decided'           then case when p_data->>'decision' = 'approved' then 0 else -1 end -- 2.8 push / 2.9 feed-only
    when 'member_committed'             then 1      -- 2.8 momentum to others
    when 'gear_request_received'        then 0      -- 2.10 host decision
    when 'gear_request_decided'         then 1      -- 2.11
    when 'admin_update_posted'          then 1      -- 2.1
    when 'group_gear_updated'           then 1      -- 2.5
    when 'personal_gear_updated'        then 1      -- 2.2
    when 'member_left'                  then 1      -- 1.6
    when 'trip_cancelled'               then 0      -- 5.2
    when 'member_removed'               then 0      -- 5.3
    -- feed only in Phase 1:
    when 'member_joined'                then -1     -- 1.4 push is LATER (batched)
    when 'gear_claimed'                 then -1     -- 2.4 feed only
    else -1
  end::smallint;
$$;

-- ============================================================================
-- Enqueue a push intent for every push-channel feed row.
-- Runs AFTER INSERT, so it only sees rows that survived the only-Ohad gate.
-- send_after: now() for urgent (P0), now()+60s for normal (P1 dedup window).
-- dedup_key: one pending push per (recipient, type, entity).
-- ============================================================================
create or replace function public.tg_enqueue_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_prio smallint;
begin
  v_prio := public.notification_push_priority(new.type, new.data);
  if v_prio < 0 then
    return new;  -- feed-only
  end if;
  insert into public.notification_queue
    (recipient_id, trip_id, type, priority, dedup_key, notification_id, send_after)
  values (
    new.recipient_id, new.trip_id, new.type, v_prio,
    new.recipient_id::text || ':' || new.type::text || ':' || coalesce(new.entity_id::text, new.id::text),
    new.id,
    case when v_prio = 0 then now() else now() + interval '60 seconds' end
  )
  on conflict (dedup_key) where status = 'pending' do nothing;  -- collapse duplicate pending pushes
  return new;
end $$;
drop trigger if exists trg_enqueue_push on public.notifications;
create trigger trg_enqueue_push after insert on public.notifications
for each row execute function public.tg_enqueue_push();
