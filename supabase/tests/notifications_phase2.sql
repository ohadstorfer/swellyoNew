-- Phase 2 checks. Run in the SQL editor after the 20260610* migrations are applied.
-- Mutating block (C) must be wrapped in begin; ... rollback;.

-- A. tz column + new enum values (non-mutating)
do $$
begin
  assert exists (select 1 from information_schema.columns
                 where table_name='surfers' and column_name='timezone'), 'surfers.timezone missing';
  assert (select enum_range(null::public.notification_type)
          @> array['trip_reminder','trip_ended']::public.notification_type[]), 'new enum values missing';
  raise notice 'A. tz column + enum: passed';
end $$;

-- B. next_quiet_window: always returns a future-or-now instant; null tz falls back, bad tz falls back
do $$
begin
  assert public.next_quiet_window('America/Sao_Paulo') >= date_trunc('minute', now()), 'tz window in the past';
  assert public.next_quiet_window(null) >= date_trunc('minute', now()), 'null tz window in the past';
  assert public.next_quiet_window('Not/AZone') >= date_trunc('minute', now()), 'bad tz did not fall back';
  raise notice 'B. next_quiet_window: passed';
end $$;

-- C. stage-aware dedup: two trip_reminder rows (week, tomorrow) for Ohad -> TWO pending queue rows.
--    (run inside: begin; <this>; rollback;)
do $$
declare v_ohad uuid; v_trip uuid; v_before int; v_after int;
begin
  select id into v_ohad from public.users where lower(email)='ohad.storfer@gmail.com' limit 1;
  select id into v_trip from public.group_trips limit 1;
  assert v_ohad is not null, 'Ohad user missing';
  select count(*) into v_before from public.notification_queue;
  insert into public.notifications (recipient_id, trip_id, type, audience, entity_type, entity_id, data)
  values (v_ohad, v_trip, 'trip_reminder', 'user', 'group_trip', v_trip, '{"trip_title":"X","stage":"week"}'::jsonb),
         (v_ohad, v_trip, 'trip_reminder', 'user', 'group_trip', v_trip, '{"trip_title":"X","stage":"tomorrow"}'::jsonb);
  select count(*) into v_after from public.notification_queue;
  assert v_after = v_before + 2, 'stage-aware dedup failed: expected 2 distinct queue rows';
  raise notice 'C. stage-aware dedup: passed (rollback to undo)';
end $$;
