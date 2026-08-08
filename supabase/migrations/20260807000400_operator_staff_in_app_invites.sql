-- Phase 2b, part 2 of 2: invite an existing user from inside the app.
--
-- APPLIED to prod 2026-08-07.
-- PREREQUISITE: 20260807000300 (the enum value) must have COMMITTED first.
--
-- ── The tradeoff, on the record ─────────────────────────────────────────────
-- A user search is, unavoidably, an endpoint that answers "does an account
-- exist for this name?" over a table of real people. Ohad asked for it
-- (2026-08-07) after the link-only flow shipped, and it is a real UX win: an
-- operator adding a guide they work with every season should not have to leave
-- the app. Links still work, and remain the only way to reach someone who
-- cannot be found by name.
--
-- What narrows it:
--   • Only the OPERATOR OF RECORD of a `hosting_style='C'` trip may call it.
--     Not any signed-in user — the caller must already run an operator trip.
--   • It returns id, name and photo. Nothing else. No email, no country, no
--     age. Email is never searchable, so this cannot confirm an address.
--   • Minimum 2 characters, at most 20 rows — no sweeping the alphabet.
--   • Blocks are honoured in BOTH directions.

-- ══════════════════════════════════════════════════════════════════
-- 1. A targeted invite: bound to one account, not just a bearer token
-- ══════════════════════════════════════════════════════════════════
alter table public.organized_trip_staff_invites
  add column if not exists invited_user_id uuid references auth.users(id) on delete cascade;

create index if not exists otsi_invited_user
  on public.organized_trip_staff_invites (invited_user_id)
  where invited_user_id is not null;

comment on column public.organized_trip_staff_invites.invited_user_id is
  'Set for an in-app invite: only this account may accept. NULL = an open link, '
  'redeemable by whoever holds the token.';

-- ══════════════════════════════════════════════════════════════════
-- 2. Search
-- ══════════════════════════════════════════════════════════════════
create or replace function public.search_users_for_staff(
  p_trip_id uuid,
  p_query   text
)
returns table(user_id uuid, name text, profile_image_url text)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
begin
  if not exists (
    select 1 from public.group_trips
    where id = p_trip_id and host_id = auth.uid() and hosting_style = 'C'
  ) then
    raise exception 'Only the operator of this trip can search for crew'
      using errcode = '42501';
  end if;

  -- Two characters minimum. A one-character query returns a slice of the whole
  -- user table, which is the enumeration this guard exists to prevent.
  if length(v_q) < 2 then
    return;
  end if;

  return query
  select s.user_id, s.name, s.profile_image_url
    from public.surfers s
   where s.name ilike '%' || v_q || '%'
     and s.user_id <> auth.uid()
     -- Already crew on this trip.
     and not exists (
       select 1 from public.organized_trip_staff st
        where st.trip_id = p_trip_id and st.user_id = s.user_id
          and st.revoked_at is null
     )
     -- Already a traveler: staff and travelers are exclusive (I3), so offering
     -- them would only produce a trigger error at insert time.
     and not exists (
       select 1 from public.group_trip_participants p
        where p.trip_id = p_trip_id and p.user_id = s.user_id
     )
     -- Already has an invite waiting.
     and not exists (
       select 1 from public.organized_trip_staff_invites i
        where i.trip_id = p_trip_id and i.invited_user_id = s.user_id
          and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
     )
     -- Blocks, both directions.
     and not exists (
       select 1 from public.user_blocks b
        where (b.blocker_id = auth.uid() and b.blocked_id = s.user_id)
           or (b.blocker_id = s.user_id and b.blocked_id = auth.uid())
     )
   order by
     -- Prefix matches first: typing "mar" should surface Marta before Omar.
     case when s.name ilike v_q || '%' then 0 else 1 end,
     s.name
   limit 20;
end $$;

revoke execute on function public.search_users_for_staff(uuid, text) from public, anon;
grant  execute on function public.search_users_for_staff(uuid, text) to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 3. Invite that person, and tell them
-- ══════════════════════════════════════════════════════════════════
-- Reuses the token machinery rather than inventing a second acceptance path:
-- the row is identical to a link invite except `invited_user_id` is set, which
-- accept_staff_invite() enforces. The token rides in the notification, which
-- only the recipient can read.
create or replace function public.invite_staff_member(
  p_trip_id  uuid,
  p_user_id  uuid,
  p_role_key text,
  p_title    text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id         uuid;
  v_token      text;
  v_trip_title text;
  v_actor      text;
  v_role_label text;
begin
  if not exists (
    select 1 from public.group_trips
    where id = p_trip_id and host_id = auth.uid() and hosting_style = 'C'
  ) then
    raise exception 'Only the operator of this trip can invite crew'
      using errcode = '42501';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You already run this trip' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.group_trip_participants
     where trip_id = p_trip_id and user_id = p_user_id
  ) then
    raise exception 'They are a traveler on this trip, so they cannot also be crew'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.organized_trip_staff
     where trip_id = p_trip_id and user_id = p_user_id and revoked_at is null
  ) then
    raise exception 'They are already on this trip''s crew' using errcode = '23505';
  end if;

  insert into public.organized_trip_staff_invites
    (trip_id, operator_id, role_key, title, invited_user_id)
  values
    (p_trip_id, auth.uid(), p_role_key, nullif(btrim(p_title), ''), p_user_id)
  returning id, token into v_id, v_token;

  select g.title into v_trip_title from public.group_trips g where g.id = p_trip_id;
  select r.label into v_role_label
    from public.organized_trip_staff_roles r
   where r.role_key = p_role_key and r.operator_id is null;
  v_actor := public.user_display_name(auth.uid());

  insert into public.notifications
    (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  values (
    p_user_id, p_trip_id, 'operator_staff_invited', 'user', auth.uid(),
    'organized_trip_staff_invite', v_id,
    jsonb_build_object(
      'trip_title',  v_trip_title,
      'role_key',    p_role_key,
      'role_label',  v_role_label,
      'actor_name',  v_actor,
      -- The bell reads {item} from item_name; it knows nothing about roles.
      'item_name',   v_role_label,
      -- The accept sheet takes a token. Safe here: notifications are RLS'd to
      -- their recipient, and accept_staff_invite additionally refuses anyone
      -- who is not invited_user_id.
      'staff_token', v_token
    )
  );

  return v_id;
end $$;

revoke execute on function public.invite_staff_member(uuid, uuid, text, text) from public, anon;
grant  execute on function public.invite_staff_member(uuid, uuid, text, text) to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 4. A targeted invite is not a bearer token
-- ══════════════════════════════════════════════════════════════════
-- Without this check an in-app invite would still be redeemable by anyone who
-- got hold of the token, which defeats the point of naming a recipient.
-- Everything else in this function is unchanged from 20260807000200.
create or replace function public.accept_staff_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  i      record;
  v_uid  uuid := auth.uid();
  v_host uuid;
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

  -- NEW in this migration: an invite addressed to someone is only theirs.
  if i.invited_user_id is not null and i.invited_user_id <> v_uid then
    raise exception 'This invite is no longer valid' using errcode = 'P0002';
  end if;

  select host_id into v_host from public.group_trips where id = i.trip_id;

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
    (trip_id, user_id, operator_id, role_key, title, accepted_at)
  values
    (i.trip_id, v_uid, i.operator_id, i.role_key, i.title, now());

  update public.organized_trip_staff_invites
     set accepted_at = now(), accepted_by = v_uid
   where id = i.id;

  return i.trip_id;
end $$;

revoke execute on function public.accept_staff_invite(text) from public, anon;
grant  execute on function public.accept_staff_invite(text) to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 5. Push priority — patch the LIVE body, never replace from the repo
-- ══════════════════════════════════════════════════════════════════
-- notification_push_priority's live definition is AHEAD of the repo copy
-- (see the notification_push_priority drift note). Recreating it from a file
-- would silently roll back whatever is only live.
--
-- Its `else -1` default means "no push", so a new type needs an explicit line
-- or the invitee only finds out next time they happen to open the app. 0
-- matches trip_invite_received: someone is waiting on their answer.
do $do$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'notification_push_priority';

  if v_def is null then
    raise exception 'notification_push_priority not found';
  end if;

  if position('''operator_staff_invited''' in v_def) > 0 then
    raise notice 'operator_staff_invited already has a priority; leaving as is';
    return;
  end if;

  if position('when ''trip_invite_received''' in v_def) = 0 then
    raise exception 'anchor line missing — patch notification_push_priority by hand';
  end if;

  v_def := replace(
    v_def,
    'when ''trip_invite_received''         then 0',
    'when ''trip_invite_received''         then 0' || chr(10) ||
    '    when ''operator_staff_invited''     then 0'
  );

  execute v_def;
end $do$;
