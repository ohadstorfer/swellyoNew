-- ============================================================================
-- Phase 2 (part 2/3): quiet-hours-aware enqueue + new-type priorities.
-- APPLY AFTER 000000 (needs trip_reminder/trip_ended committed). Before 000100.
-- ============================================================================

-- Next allowed send instant for a NON-URGENT push, honoring 8am-9pm local quiet hours.
-- Uses Postgres native IANA tzdata (DST-correct). Unknown/invalid tz -> next 8am UTC.
create or replace function public.next_quiet_window(p_tz text)
returns timestamptz language plpgsql stable as $$
declare v_tz text := coalesce(nullif(p_tz, ''), 'UTC');
        v_local timestamp; v_hour int; v_target timestamp;
begin
  begin
    v_local := now() at time zone v_tz;          -- wall-clock in their zone
  exception when others then                      -- bad/renamed zone -> UTC
    v_tz := 'UTC'; v_local := now() at time zone 'UTC';
  end;
  v_hour := extract(hour from v_local)::int;
  if v_hour >= 8 and v_hour < 21 then
    return now();                                 -- inside window -> send now
  end if;
  v_target := date_trunc('day', v_local) + interval '8 hours'
            + case when v_hour >= 21 then interval '1 day' else interval '0' end;
  return v_target at time zone v_tz;              -- wall-clock -> timestamptz
end $$;

-- New-type priorities (normal -> obey quiet hours / batch / cap).
create or replace function public.notification_push_priority(
  p_type public.notification_type, p_data jsonb
) returns smallint language sql immutable as $$
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
    when 'trip_reminder'                then 1
    when 'trip_ended'                   then 1
    when 'member_joined'                then -1
    when 'gear_claimed'                 then -1
    else -1
  end::smallint;
$$;

-- Enqueue: quiet-hours-aware send_after for non-urgent; stage-aware dedup_key.
create or replace function public.tg_enqueue_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_prio smallint; v_tz text; v_send_after timestamptz;
begin
  v_prio := public.notification_push_priority(new.type, new.data);
  if v_prio < 0 then
    return new;                                   -- feed-only
  end if;
  if v_prio = 0 then
    v_send_after := now();                        -- urgent: bypass quiet hours
  else
    select timezone into v_tz from public.surfers where user_id = new.recipient_id;
    v_send_after := public.next_quiet_window(v_tz);
  end if;
  insert into public.notification_queue
    (recipient_id, trip_id, type, priority, dedup_key, notification_id, send_after)
  values (
    new.recipient_id, new.trip_id, new.type, v_prio,
    new.recipient_id::text || ':' || new.type::text || ':'
      || coalesce(new.entity_id::text, new.id::text)
      || coalesce(':' || (new.data->>'stage'), ''),   -- stage-aware (week vs tomorrow vs ...)
    new.id, v_send_after
  )
  on conflict (dedup_key) where status = 'pending' do nothing;
  return new;
end $$;
