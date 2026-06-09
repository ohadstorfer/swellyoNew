-- Phase 1 queue regression. Run in the SQL editor against a DB with the
-- 20260609* migrations applied. Each block raises an exception if an
-- expectation fails. The mutating blocks must be wrapped in begin;/rollback;.

-- ---------------------------------------------------------------------------
-- A. notification_push_priority mapping (pure, non-mutating)
-- ---------------------------------------------------------------------------
do $$
begin
  -- urgent (decisions / about-them)
  assert public.notification_push_priority('join_request_received', '{}'::jsonb) = 0, 'join_request_received should be P0';
  assert public.notification_push_priority('join_request_decided', '{"decision":"approved"}'::jsonb) = 0, 'approved join should be P0';
  assert public.notification_push_priority('join_request_decided', '{"decision":"declined"}'::jsonb) = 1, 'declined join should be P1';
  assert public.notification_push_priority('commitment_request_received', '{}'::jsonb) = 0, 'commit request P0';
  assert public.notification_push_priority('commitment_decided', '{"decision":"approved"}'::jsonb) = 0, 'commit approved P0';
  assert public.notification_push_priority('commitment_decided', '{"decision":"declined"}'::jsonb) = -1, 'commit declined is FEED ONLY (2.9)';
  assert public.notification_push_priority('gear_request_received', '{}'::jsonb) = 0, 'gear request P0';
  assert public.notification_push_priority('trip_cancelled', '{}'::jsonb) = 0, 'cancelled P0';
  assert public.notification_push_priority('member_removed', '{}'::jsonb) = 0, 'removed P0';
  -- normal
  assert public.notification_push_priority('member_committed', '{}'::jsonb) = 1, 'member_committed P1';
  assert public.notification_push_priority('gear_request_decided', '{}'::jsonb) = 1, 'gear decided P1';
  assert public.notification_push_priority('admin_update_posted', '{}'::jsonb) = 1, 'admin update P1';
  assert public.notification_push_priority('group_gear_updated', '{}'::jsonb) = 1, 'group gear P1';
  assert public.notification_push_priority('personal_gear_updated', '{}'::jsonb) = 1, 'personal gear P1';
  assert public.notification_push_priority('member_left', '{}'::jsonb) = 1, 'member_left P1';
  -- feed only (no push in Phase 1)
  assert public.notification_push_priority('member_joined', '{}'::jsonb) = -1, 'member_joined push is LATER (batched)';
  assert public.notification_push_priority('gear_claimed', '{}'::jsonb) = -1, 'gear_claimed is feed only';
  raise notice 'A. notification_push_priority: all assertions passed';
end $$;

-- ---------------------------------------------------------------------------
-- B. Enqueue trigger (MUTATING — run inside: begin; <this block>; rollback;)
--    A push-channel feed row for Ohad creates exactly one pending queue row;
--    a feed-only type creates none.
-- ---------------------------------------------------------------------------
do $$
declare v_ohad uuid; v_trip uuid; v_before int; v_after int; v_feed_id uuid; v_prio smallint; v_status text;
begin
  select id into v_ohad from public.users where lower(email)='ohad.storfer@gmail.com' limit 1;
  select id into v_trip from public.group_trips limit 1;  -- any trip for FK
  assert v_ohad is not null, 'Ohad user missing';

  -- push-channel type → 1 queue row, priority 0, pending, linked
  select count(*) into v_before from public.notification_queue;
  insert into public.notifications (recipient_id, trip_id, type, audience, data)
  values (v_ohad, v_trip, 'commitment_request_received', 'admin', '{}'::jsonb)
  returning id into v_feed_id;
  select count(*) into v_after from public.notification_queue;
  assert v_after = v_before + 1, 'push-channel insert should enqueue exactly 1 row';
  select priority, status into v_prio, v_status from public.notification_queue where notification_id = v_feed_id;
  assert v_prio = 0 and v_status = 'pending', 'queued row should be P0 pending';

  -- feed-only type → 0 queue rows
  select count(*) into v_before from public.notification_queue;
  insert into public.notifications (recipient_id, trip_id, type, audience, data)
  values (v_ohad, v_trip, 'gear_claimed', 'user', '{}'::jsonb);
  select count(*) into v_after from public.notification_queue;
  assert v_after = v_before, 'feed-only insert should NOT enqueue';

  raise notice 'B. enqueue trigger: all assertions passed (rollback to undo)';
end $$;

-- ---------------------------------------------------------------------------
-- C. trip_cancelled fans out to members + pending requesters, not the host.
--    (MUTATING — run inside begin;/rollback;. Skips if Ohad hosts no trip.)
-- ---------------------------------------------------------------------------
do $$
declare v_ohad uuid; v_trip uuid; v_host_rows int;
begin
  select id into v_ohad from public.users where lower(email)='ohad.storfer@gmail.com' limit 1;
  select id into v_trip from public.group_trips where host_id = v_ohad limit 1;
  if v_trip is null then raise notice 'C. skip trip_cancelled test: Ohad hosts no trip'; return; end if;
  update public.group_trips set status='cancelled' where id = v_trip;
  select count(*) into v_host_rows from public.notifications
   where trip_id = v_trip and type='trip_cancelled' and recipient_id = v_ohad;
  assert v_host_rows = 0, 'host should NOT get trip_cancelled';
  raise notice 'C. trip_cancelled trigger: host correctly excluded';
end $$;
