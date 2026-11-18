-- Crew invite accepted → tell the operator. Part 2 of 2.
--
-- APPLIED to prod 2026-11-08 (Ohad's go-ahead), after 20261108000000.
--
-- Why: Jake's to-do (Nov 2026) — "Staff invite accepted should populate on
-- phone and in app". invite_staff_member already writes a bell row + push to
-- the INVITEE; nothing told the operator when they said yes, so a pending crew
-- invite only turned into a name on the Crew list the next time they looked.
--
-- What this does:
--   1. accept_staff_invite writes one `operator_staff_accepted` notification to
--      the operator who sent the invite. trg_enqueue_push on notifications
--      turns it into a push; the bell shows it from the same row.
--   2. notification_push_priority: the new type pushes (1 = normal, honours
--      quiet hours — it is news, not a question).
--   3. One notification_templates row with PUSH text only. renderPush checks
--      templates first, so the phone gets the right words with no
--      dispatch-notification-queue deploy. bell_* stay NULL on purpose, so the
--      app's own bodyParts layout (actor bold) still renders the bell row.
--
-- accept_staff_invite below is the LIVE body (diffed 2026-11-08, == repo
-- 20261002000000) plus section "notify the operator" only.

create or replace function public.accept_staff_invite(p_token text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  i            record;
  v_uid        uuid := auth.uid();
  v_host       uuid;
  v_staff_id   uuid;
  v_trip_title text;
  v_role_label text;
begin
  if v_uid is null then
    raise exception 'Sign in to accept this invite' using errcode = '42501';
  end if;

  select * into i
    from public.organized_trip_staff_invites
   where token = p_token
   for update;

  if i is null or i.revoked_at is not null or i.accepted_at is not null
     or i.expires_at <= now() then
    raise exception 'This invite is no longer valid' using errcode = 'P0002';
  end if;

  if i.invited_user_id is not null and i.invited_user_id <> v_uid then
    raise exception 'This invite is no longer valid' using errcode = 'P0002';
  end if;

  select host_id, title into v_host, v_trip_title from public.group_trips where id = i.trip_id;

  if v_uid = v_host then
    raise exception 'You already run this trip' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.group_trip_participants
     where trip_id = i.trip_id and user_id = v_uid
  ) then
    raise exception 'You are a traveler on this trip, so you cannot also be crew'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.organized_trip_staff
     where trip_id = i.trip_id and user_id = v_uid and revoked_at is null
  ) then
    raise exception 'You are already on this trip''s crew' using errcode = '23505';
  end if;

  insert into public.organized_trip_staff
    (trip_id, user_id, operator_id, role_key, title, bio, accepted_at, is_local)
  values
    (i.trip_id, v_uid, i.operator_id, i.role_key, i.title, i.bio, now(),
     coalesce(i.is_local, false))
  returning id into v_staff_id;

  insert into public.organized_trip_staff_requirements
    (staff_id, requirement_id, trip_id, assigned_by)
  select v_staff_id, r.id, i.trip_id, i.operator_id
    from public.organized_trip_requirements r
   where r.id = any (coalesce(i.requirement_ids, '{}'::uuid[]))
     and r.trip_id  = i.trip_id
     and r.audience = 'staff'
     and r.is_active
  on conflict (staff_id, requirement_id) do nothing;

  update public.organized_trip_staff_invites
     set accepted_at = now(), accepted_by = v_uid
   where id = i.id;

  -- notify the operator ------------------------------------------------------
  -- Best-effort: a notification failure must never undo joining the crew.
  begin
    select r.label into v_role_label
      from public.organized_trip_staff_roles r
     where r.role_key = i.role_key and r.operator_id is null;

    insert into public.notifications
      (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
    values (
      i.operator_id, i.trip_id, 'operator_staff_accepted', 'user', v_uid,
      'organized_trip_staff', v_staff_id,
      jsonb_build_object(
        'trip_title', v_trip_title,
        'role_key',   i.role_key,
        'role_label', v_role_label,
        'actor_name', public.user_display_name(v_uid),
        'item_name',  coalesce(v_role_label, 'crew')
      )
    );
  exception when others then
    raise warning 'accept_staff_invite: operator notification failed: %', sqlerrm;
  end;

  return i.trip_id;
end $function$;

revoke execute on function public.accept_staff_invite(text) from public, anon;
grant  execute on function public.accept_staff_invite(text) to authenticated, service_role;

-- 2 ── push priority (LIVE body as of 2026-11-08 + one line) ──────────────────
create or replace function public.notification_push_priority(p_type notification_type, p_data jsonb)
 returns smallint
 language sql
 immutable
as $function$
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
    when 'operator_staff_accepted'      then 1
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
    when 'operator_payment_landed'      then 1
    when 'operator_charge_disputed'     then 0
    when 'operator_dispute_closed'      then 1
    when 'operator_requirement_due_soon' then 1
    when 'operator_setup_required'      then 1
    when 'onboarding_unfinished'        then 1
    when 'operator_onboarding_stalled'  then 1
    when 'operator_traveler_confirmed'  then -1
    when 'member_joined'                then -1
    when 'gear_claimed'                 then -1
    when 'profile_destinations_missing' then 1
    else -1
  end::smallint;
$function$;

-- 3 ── push copy (bell_* NULL on purpose, see header) ─────────────────────────
insert into public.notification_templates (key, push_title, push_body)
values ('operator_staff_accepted', '{actor} joined your crew',
        'They accepted your invite to {trip} as {item}.')
on conflict (key) do update
  set push_title = excluded.push_title, push_body = excluded.push_body;
