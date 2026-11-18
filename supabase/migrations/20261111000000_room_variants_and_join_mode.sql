-- ─────────────────────────────────────────────────────────────────────────────
-- Room variants (shared / private) and join mode (approval / instant)
-- for operator trips (hosting_style 'C').
--
-- A. Room variants
--    group_trips.cost_per_person stays the base price = the SHARED room.
--    group_trips.private_room_price_usd is optional. When it is set, the
--    traveler picks a room at checkout, before the first payment.
--    The pick lives on the traveler's row (group_trip_participants.room_type)
--    and re-freezes price_total_usd there, so operator_traveler_amount_due,
--    payments-checkout, refunds and the dashboard need no change.
--    Deposit is the same for both rooms.
--
-- B. Join mode
--    group_trips.join_mode = 'approval' (today's request → approve flow, the
--    default) or 'instant' (the traveler joins straight into 'onboarding' and
--    goes to checkout). Capacity is still enforced on activation by
--    enforce_group_trip_max_participants; join_trip_instantly also refuses a
--    trip that is already full so nobody is sent to pay for a seat that is gone.
--
-- Apply by hand in the SQL editor (never `db push`).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Columns ──────────────────────────────────────────────────────────────

alter table public.group_trips
  add column if not exists private_room_price_usd numeric,
  add column if not exists join_mode text not null default 'approval';

alter table public.group_trips
  drop constraint if exists group_trips_join_mode_check,
  add constraint group_trips_join_mode_check
    check (join_mode in ('approval', 'instant'));

alter table public.group_trips
  drop constraint if exists group_trips_private_room_price_check,
  add constraint group_trips_private_room_price_check
    check (
      private_room_price_usd is null
      or (private_room_price_usd > 0
          and (deposit_amount is null or deposit_amount <= private_room_price_usd))
    );

-- null = shared (every row that exists today).
alter table public.group_trip_participants
  add column if not exists room_type text;

alter table public.group_trip_participants
  drop constraint if exists group_trip_participants_room_type_check,
  add constraint group_trip_participants_room_type_check
    check (room_type is null or room_type in ('shared', 'private'));

-- ⚠️ See 20260906000100: every new column on this table must be granted by
-- name, or any select naming it fails with "permission denied".
grant select (room_type) on public.group_trip_participants to anon, authenticated;

-- ── 2. freeze_traveler_price: let set_my_trip_room through, pin room_type ──
-- Same as live (read 11 Nov 2026) plus:
--   * app.room_choice = 'on' lets the room RPC re-price the caller's own row;
--   * a non-operator write can never change room_type by itself.

create or replace function public.freeze_traveler_price()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_mode text; v_price numeric; v_dep numeric;
begin
  if coalesce(nullif(current_setting('app.room_choice', true), ''), 'off') = 'on' then
    return new;                        -- set_my_trip_room()
  end if;

  -- auth.uid() is null under the service role -- treat that as trusted the
  -- same as the operator, rather than assuming a JWT is always present.
  if auth.uid() is not null and not (
       exists (
         select 1 from public.group_trips
          where id = new.trip_id and host_id = auth.uid()
       )
       or (
         exists (
           select 1 from public.group_trips
            where id = new.trip_id and hosting_style = 'C'
         )
         and public.trip_staff_can(new.trip_id, 'money.manage')
       )
     ) then
    if TG_OP = 'UPDATE' then
      new.price_total_usd := old.price_total_usd;
      new.deposit_usd     := old.deposit_usd;
      new.price_set_by    := old.price_set_by;
      new.price_set_at    := old.price_set_at;
      new.room_type       := old.room_type;
      return new;
    end if;

    new.price_set_by := null;
    new.price_set_at := null;
    new.room_type    := null;

    select payment_mode, cost_per_person, deposit_amount
      into v_mode, v_price, v_dep
      from public.group_trips
     where id = new.trip_id;

    if v_mode is distinct from 'managed' then
      new.price_total_usd := null;
      new.deposit_usd     := null;
      return new;
    end if;

    -- Joining on or after the full-payment deadline: the whole price, in one
    -- payment, in onboarding.
    if v_price is not null and public.operator_trip_full_payment_due(new.trip_id) then
      v_dep := v_price;
    end if;

    new.price_total_usd := v_price;
    new.deposit_usd     := v_dep;
    return new;
  end if;

  if TG_OP = 'UPDATE' then
    return new;
  end if;

  if new.price_total_usd is not null then
    return new;
  end if;

  select payment_mode, cost_per_person, deposit_amount
    into v_mode, v_price, v_dep
    from public.group_trips
   where id = new.trip_id;

  if v_mode is distinct from 'managed' then
    return new;
  end if;

  if v_price is not null and public.operator_trip_full_payment_due(new.trip_id) then
    v_dep := v_price;
  end if;

  new.price_total_usd := v_price;
  new.deposit_usd     := v_dep;
  return new;
end;
$function$;

-- ── 3. handle_join_request_approval: a rejoin starts back on the shared room ─
-- Same as live (read 11 Nov 2026) plus `room_type = null` on the rejoin branch.

create or replace function public.handle_join_request_approval()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    perform set_config('app.membership_activation', 'on', true);

    insert into public.group_trip_participants
      (trip_id, user_id, role, status, price_total_usd, deposit_usd)
    select new.trip_id, new.requester_id, 'member',
           case when t.hosting_style = 'C' then 'onboarding' else 'active' end,
           case when t.payment_mode = 'managed' then t.cost_per_person end,
           case when t.payment_mode = 'managed' then
                  case when t.cost_per_person is not null
                        and public.operator_trip_full_payment_due(new.trip_id)
                       then t.cost_per_person
                       else t.deposit_amount end
           end
      from public.group_trips t
     where t.id = new.trip_id
    on conflict (trip_id, user_id) do update
      set status          = excluded.status,
          role            = 'member',
          joined_at       = now(),
          price_total_usd = excluded.price_total_usd,
          deposit_usd     = excluded.deposit_usd,
          price_set_by    = null,
          price_set_at    = null,
          room_type       = null,
          left_at         = null,
          left_by         = null,
          left_reason     = null
      where public.group_trip_participants.status in ('left', 'removed');

    perform set_config('app.membership_activation', 'off', true);
  end if;
  return new;
end;
$function$;

-- ── 4. join_trip_instantly ─────────────────────────────────────────────────
-- For join_mode = 'instant'. Records an approved join request (so every
-- screen that reads "my request" sees the same thing as after an approval)
-- and creates the 'onboarding' row the same way an approval does.
-- Returns the caller's participant status.

create or replace function public.join_trip_instantly(p_trip_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_trip   public.group_trips%rowtype;
  v_status text;
  v_active integer;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select * into v_trip from public.group_trips where id = p_trip_id for update;
  if not found or v_trip.status is distinct from 'active' then
    raise exception 'Trip not found' using errcode = 'P0002';
  end if;
  if v_trip.hosting_style is distinct from 'C' or v_trip.join_mode is distinct from 'instant' then
    raise exception 'This trip needs a request to join' using errcode = 'check_violation';
  end if;

  select status into v_status
    from public.group_trip_participants
   where trip_id = p_trip_id and user_id = v_uid;
  if v_status in ('onboarding', 'active') then
    return v_status;                   -- already in: idempotent
  end if;
  if v_status = 'removed' then
    -- The operator took this person off the trip; they need a real approval.
    raise exception 'Ask the operator to rejoin this trip' using errcode = '42501';
  end if;

  if v_trip.max_participants is not null then
    select count(*) into v_active
      from public.group_trip_participants
     where trip_id = p_trip_id and status = 'active';
    if v_active >= v_trip.max_participants then
      raise exception 'Trip is full — % of % spots taken', v_active, v_trip.max_participants
        using errcode = 'check_violation';
    end if;
  end if;

  -- An approved request, inserted as pending then flipped, so the existing
  -- approval trigger creates the participant row (rejoin branch included).
  -- The request_received / decided notifications are skipped: nobody has to
  -- decide anything, and the operator hears from operator_traveler_confirmed
  -- once the traveler pays.
  perform set_config('app.instant_join', 'on', true);

  -- unique (trip_id, requester_id): clear an older request first, the same way
  -- requestToJoinTrip() does on the client.
  delete from public.group_trip_join_requests
   where trip_id = p_trip_id and requester_id = v_uid;

  with r as (
    insert into public.group_trip_join_requests (trip_id, requester_id, status)
    values (p_trip_id, v_uid, 'pending')
    returning id
  )
  update public.group_trip_join_requests j
     set status = 'approved', reviewed_by = v_uid, reviewed_at = now()
    from r
   where j.id = r.id;

  perform set_config('app.instant_join', 'off', true);

  select status into v_status
    from public.group_trip_participants
   where trip_id = p_trip_id and user_id = v_uid;
  return v_status;
end;
$function$;

revoke all on function public.join_trip_instantly(uuid) from public, anon;
grant execute on function public.join_trip_instantly(uuid) to authenticated;

-- Silence the two request notifications during an instant join.
create or replace function public.tg_notify_join_request_received()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_name text;
begin
  if coalesce(nullif(current_setting('app.instant_join', true), ''), 'off') = 'on' then
    return new;
  end if;
  v_name := public.user_display_name(new.requester_id);
  insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  select uid, new.trip_id, 'join_request_received', 'admin', new.requester_id, 'join_request', new.id,
         jsonb_build_object('actor_name', v_name, 'note', new.request_note,
                            'trip_title', (select title from public.group_trips where id = new.trip_id))
  from unnest(public.trip_admin_ids(new.trip_id)) as uid
  where uid <> new.requester_id;
  return new;
end $function$;

create or replace function public.tg_notify_join_request_decided()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_title  text;
  v_style  char(1);
begin
  if coalesce(nullif(current_setting('app.instant_join', true), ''), 'off') = 'on' then
    return new;
  end if;
  if new.status is distinct from old.status
     and new.status in ('approved','declined') then

    select g.title, g.hosting_style
      into v_title, v_style
      from public.group_trips g
     where g.id = new.trip_id;

    insert into public.notifications
      (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
    values (
      new.requester_id, new.trip_id, 'join_request_decided', 'user',
      new.reviewed_by, 'join_request', new.id,
      jsonb_build_object(
        'decision',   new.status,
        'trip_title', v_title,
        'needs_onboarding', (v_style = 'C')
      )
    );
  end if;
  return new;
end
$function$;

-- Trigger functions: re-created functions get EXECUTE re-granted to PUBLIC.
revoke all on function public.freeze_traveler_price() from public, anon, authenticated;
revoke all on function public.handle_join_request_approval() from public, anon, authenticated;
revoke all on function public.tg_notify_join_request_received() from public, anon, authenticated;
revoke all on function public.tg_notify_join_request_decided() from public, anon, authenticated;

-- ── 5. set_my_trip_room ────────────────────────────────────────────────────
-- The traveler picks shared / private for themself. Allowed only:
--   * on a managed-payment trip that offers a private room (or picking shared);
--   * while nothing has been paid yet on this trip;
--   * when the operator has not set a custom price for this traveler.
-- Re-freezes price_total_usd; the deposit stays the trip deposit (or the full
-- price when the full-payment deadline has passed, same rule as joining).
-- Returns the new total.

create or replace function public.set_my_trip_room(p_trip_id uuid, p_room text)
returns numeric
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_trip  public.group_trips%rowtype;
  v_part  public.group_trip_participants%rowtype;
  v_price numeric;
  v_dep   numeric;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_room not in ('shared', 'private') then
    raise exception 'Unknown room type' using errcode = '22023';
  end if;

  select * into v_trip from public.group_trips where id = p_trip_id;
  if not found or v_trip.payment_mode is distinct from 'managed' then
    raise exception 'This trip has no room options' using errcode = 'check_violation';
  end if;
  if p_room = 'private' and v_trip.private_room_price_usd is null then
    raise exception 'This trip has no private room' using errcode = 'check_violation';
  end if;

  select * into v_part
    from public.group_trip_participants
   where trip_id = p_trip_id and user_id = v_uid
   for update;
  if not found or v_part.status not in ('onboarding', 'active') then
    raise exception 'You are not on this trip' using errcode = '42501';
  end if;
  if v_part.price_set_by is not null then
    raise exception 'Your price was set by the operator' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.organized_trip_payment_events
     where trip_id = p_trip_id and user_id = v_uid and event_type = 'paid'
  ) then
    raise exception 'Room can''t change after a payment' using errcode = 'check_violation';
  end if;

  v_price := case when p_room = 'private'
                  then v_trip.private_room_price_usd
                  else v_trip.cost_per_person end;
  v_dep := case when v_price is not null and public.operator_trip_full_payment_due(p_trip_id)
                then v_price
                else v_trip.deposit_amount end;

  perform set_config('app.room_choice', 'on', true);
  update public.group_trip_participants
     set room_type       = p_room,
         price_total_usd = v_price,
         deposit_usd     = v_dep
   where trip_id = p_trip_id and user_id = v_uid;
  perform set_config('app.room_choice', 'off', true);

  return v_price;
end;
$function$;

revoke all on function public.set_my_trip_room(uuid, text) from public, anon;
grant execute on function public.set_my_trip_room(uuid, text) to authenticated;
