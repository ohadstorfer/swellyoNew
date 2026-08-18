-- Ask a crew member for paperwork BEFORE the invite goes out — and let them
-- actually answer it once they accept.
--
-- Spec: docs/staff-requirements-and-wallet-delivery-spec-and-plan.html, Part A
--       (the rest of steps A3 and A4).
--
-- ── The two gaps this closes ───────────────────────────────────────────────
--
-- 1. AN INVITED PERSON HAS NO STAFF ROW YET. 20260812000200 gave staff
--    requirements a home, but an assignment points at
--    `organized_trip_staff.id`, and that row is only written when the invite is
--    accepted. So "what do I need from you" could only be asked AFTER they
--    joined — by which time the operator has closed the sheet and moved on, and
--    the guide has joined a trip that asks them for nothing.
--
--    The invite now CARRIES the list, and accept_staff_invite applies it in the
--    same transaction that creates the staff row. The ask is made once, at the
--    moment the operator is thinking about that person.
--
-- 2. STAFF COULD SEE THE ASK AND NOT ANSWER IT. The fulfilment tables were
--    written for travelers: every INSERT policy ends in
--    `is_trip_participant(trip_id)`, and staff are deliberately NOT
--    participants — a person is crew or a traveler, never both (the invite
--    functions refuse the overlap in both directions). So a guide asked for a
--    passport hit an RLS failure on upload. The three policies below now also
--    accept crew on the same trip.
--
-- ── What is deliberately NOT here ──────────────────────────────────────────
-- No gate. A traveler with unmet requirements cannot join; a guide with unmet
-- paperwork is flagged and nothing more. Assignments carry no deadline, and
-- accept_staff_invite never refuses an acceptance over them.

-- ══════════════════════════════════════════════════════════════════
-- 1. The invite carries the ask
-- ══════════════════════════════════════════════════════════════════
alter table public.organized_trip_staff_invites
  add column if not exists requirement_ids uuid[] not null default '{}'::uuid[];

comment on column public.organized_trip_staff_invites.requirement_ids is
  'Staff-audience requirement ids the operator ticked when sending this invite. '
  'Applied to organized_trip_staff_requirements by accept_staff_invite(), which '
  're-checks each one — a requirement deleted in the meantime is skipped, never '
  'a reason to refuse the acceptance.';

-- ══════════════════════════════════════════════════════════════════
-- 2. "Is this person crew on this trip?"
-- ══════════════════════════════════════════════════════════════════
-- SECURITY DEFINER so the policies below do not recurse into
-- organized_trip_staff's own RLS on every row they check. Mirrors the shape of
-- is_trip_participant(), which the same policies already call.
--
-- Membership, not capability: trip_staff_can() answers "may they do X", and
-- uploading your own passport is not a permission anyone grants — it is the
-- one thing every tier can do for themselves.
create or replace function public.is_trip_staff(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (
    select 1 from public.organized_trip_staff s
     where s.trip_id = p_trip_id
       and s.user_id = auth.uid()
       and s.revoked_at is null
  );
$$;

revoke execute on function public.is_trip_staff(uuid) from public, anon;
grant  execute on function public.is_trip_staff(uuid) to authenticated;

comment on function public.is_trip_staff(uuid) is
  'True when the caller is unrevoked crew on this trip. Used by the fulfilment '
  'tables INSERT policies, which were written when only travelers could be asked '
  'for anything.';

-- ══════════════════════════════════════════════════════════════════
-- 3. Crew may satisfy what they were asked for
-- ══════════════════════════════════════════════════════════════════
-- `user_id = auth.uid()` is untouched in all three: this widens WHO may write a
-- row about themselves, never who may write a row about somebody else. An
-- operator still cannot upload a passport on a guide's behalf, which is the
-- whole point of the evidence tables.

drop policy if exists otd_insert on public.organized_trip_travelers_documents;
create policy otd_insert on public.organized_trip_travelers_documents
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (public.is_trip_participant(trip_id) or public.is_trip_staff(trip_id))
  );

drop policy if exists ack_insert on public.group_trip_acknowledgements;
create policy ack_insert on public.group_trip_acknowledgements
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (public.is_trip_participant(trip_id) or public.is_trip_staff(trip_id))
  );

drop policy if exists medical_traveler_insert on public.organized_trip_medical_forms;
create policy medical_traveler_insert on public.organized_trip_medical_forms
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (public.is_trip_participant(trip_id) or public.is_trip_staff(trip_id))
  );
-- medical_traveler_update is already `user_id = auth.uid()` on both sides, so
-- editing an existing form needs no change — only creating the first one did.

-- ══════════════════════════════════════════════════════════════════
-- 4. Validating a ticked list
-- ══════════════════════════════════════════════════════════════════
-- One place, called by both invite paths and again by accept. A requirement id
-- from another trip, or one addressed to travelers, would otherwise become an
-- assignment that hands somebody else's paperwork to the wrong person — the
-- same failure trg_staff_requirement_same_trip guards from the other side.
create or replace function public.staff_requirement_ids_ok(
  p_trip_id uuid,
  p_ids     uuid[]
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select coalesce(array_length(p_ids, 1), 0) = 0
      or not exists (
        select 1 from unnest(p_ids) as rid
         where not exists (
           select 1 from public.organized_trip_requirements r
            where r.id = rid
              and r.trip_id = p_trip_id
              and r.audience = 'staff'
              and r.is_active
         )
      );
$$;

revoke execute on function public.staff_requirement_ids_ok(uuid, uuid[]) from public, anon;
grant  execute on function public.staff_requirement_ids_ok(uuid, uuid[]) to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 5. Both invite paths take the list
-- ══════════════════════════════════════════════════════════════════
-- DROPPED and recreated rather than given a defaulted extra argument. A second
-- overload would leave create_staff_invite(uuid,text,text) and
-- create_staff_invite(uuid,text,text,uuid[]) both resolvable from a three-key
-- PostgREST call, and which one runs is not something the client can state.
-- Dropping also drops the grants, so they are re-issued below — a recreated
-- function otherwise comes back executable by PUBLIC.

-- Both signatures dropped, so running this file twice is safe: the second run
-- finds the new one and replaces it rather than failing on "already exists".
drop function if exists public.create_staff_invite(uuid, text, text);
drop function if exists public.create_staff_invite(uuid, text, text, uuid[]);
create function public.create_staff_invite(
  p_trip_id         uuid,
  p_role_key        text,
  p_title           text default null,
  p_requirement_ids uuid[] default '{}'::uuid[]
)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_token text;
begin
  if not exists (
    select 1 from public.group_trips
    where id = p_trip_id and host_id = auth.uid() and hosting_style = 'C'
  ) then
    raise exception 'Only the operator of this trip can invite crew'
      using errcode = '42501';
  end if;

  if not public.staff_requirement_ids_ok(p_trip_id, p_requirement_ids) then
    raise exception 'Those requirements are not on this trip''s crew list'
      using errcode = '23514';
  end if;

  insert into public.organized_trip_staff_invites
    (trip_id, operator_id, role_key, title, requirement_ids)
  values
    (p_trip_id, auth.uid(), p_role_key, nullif(btrim(p_title), ''),
     coalesce(p_requirement_ids, '{}'::uuid[]))
  returning token into v_token;

  return v_token;
end $$;

revoke execute on function public.create_staff_invite(uuid, text, text, uuid[]) from public, anon;
grant  execute on function public.create_staff_invite(uuid, text, text, uuid[]) to authenticated;

drop function if exists public.invite_staff_member(uuid, uuid, text, text);
drop function if exists public.invite_staff_member(uuid, uuid, text, text, uuid[]);
create function public.invite_staff_member(
  p_trip_id         uuid,
  p_user_id         uuid,
  p_role_key        text,
  p_title           text default null,
  p_requirement_ids uuid[] default '{}'::uuid[]
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

  if not public.staff_requirement_ids_ok(p_trip_id, p_requirement_ids) then
    raise exception 'Those requirements are not on this trip''s crew list'
      using errcode = '23514';
  end if;

  insert into public.organized_trip_staff_invites
    (trip_id, operator_id, role_key, title, invited_user_id, requirement_ids)
  values
    (p_trip_id, auth.uid(), p_role_key, nullif(btrim(p_title), ''), p_user_id,
     coalesce(p_requirement_ids, '{}'::uuid[]))
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

revoke execute on function public.invite_staff_member(uuid, uuid, text, text, uuid[]) from public, anon;
grant  execute on function public.invite_staff_member(uuid, uuid, text, text, uuid[]) to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 6. Accepting applies the ask
-- ══════════════════════════════════════════════════════════════════
-- Unchanged from 20260807000400 except for the assignment insert at the end.
-- It runs in the same statement as the staff row, so there is no window where
-- somebody is crew with the paperwork silently lost.
create or replace function public.accept_staff_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  i         record;
  v_uid     uuid := auth.uid();
  v_host    uuid;
  v_staff_id uuid;
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

  -- An invite addressed to someone is only theirs.
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
    (i.trip_id, v_uid, i.operator_id, i.role_key, i.title, now())
  returning id into v_staff_id;

  -- Re-checked here rather than trusted from the invite. Between the invite
  -- being sent and this moment the operator may have deleted a requirement, and
  -- a stale id would fail the foreign key and take the whole acceptance down
  -- with it. A vanished ask is simply not made.
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

  return i.trip_id;
end $$;

revoke execute on function public.accept_staff_invite(text) from public, anon;
grant  execute on function public.accept_staff_invite(text) to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 7. Agreeing to a waiver, as crew
-- ══════════════════════════════════════════════════════════════════
-- The RLS change in section 3 is not enough on its own: the waiver never goes
-- through the table directly, it goes through this SECURITY DEFINER RPC, which
-- had its own `is_trip_participant` gate. A guide asked to sign the waiver
-- would have seen the ask, read the document, typed their name and been told
-- "not on this trip".
--
-- Body copied from LIVE (20260724000800 is the last migration that rewrote it)
-- and changed in exactly one line. The record it writes is
-- identical — same name, same version, same IP and user agent — because a
-- guide's agreement is worth exactly what a traveler's is.
create or replace function public.operator_requirement_acknowledge(
  p_requirement_id uuid,
  p_full_name      text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  r        record;
  v_doc    record;
  v_id     uuid;
  v_headers json;
  v_ip     text;
  v_ua     text;
begin
  select * into r from public.organized_trip_requirements where id = p_requirement_id;
  if r is null then raise exception 'requirement not found'; end if;
  if r.req_type <> 'acknowledge' then
    raise exception 'requirement % is not an acknowledge item', p_requirement_id;
  end if;
  -- CHANGED: crew count too. A person is a traveler or crew, never both, and
  -- both can be asked to agree to something.
  if not (public.is_trip_participant(r.trip_id) or public.is_trip_staff(r.trip_id)) then
    raise exception 'not on this trip';
  end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'a name is required';
  end if;

  if r.kind = 'waiver' then
    select od.* into v_doc
      from public.organized_trip_operator_documents od
     where od.trip_id = r.trip_id and od.kind = 'waiver'
     order by od.version desc limit 1;
    if v_doc is null then raise exception 'no waiver has been published yet'; end if;
  end if;

  v_headers := nullif(current_setting('request.headers', true), '')::json;
  v_ip := coalesce(v_headers ->> 'x-forwarded-for', v_headers ->> 'x-real-ip');
  v_ua := v_headers ->> 'user-agent';

  insert into public.group_trip_acknowledgements
    (requirement_id, trip_id, user_id, agreed_name, operator_document_id, agreed_version,
     ip_address, user_agent, consent_electronic)
  values
    (r.id, r.trip_id, auth.uid(), trim(p_full_name), v_doc.id, v_doc.version,
     v_ip, v_ua, true)  -- consent_electronic: they used the e-flow and tapped agree.
  returning id into v_id;

  return v_id;
end $$;

-- CREATE OR REPLACE keeps the existing grants, but re-issuing them costs
-- nothing and makes the intent explicit next to a function that just changed
-- who may reach it.
revoke execute on function public.operator_requirement_acknowledge(uuid, text) from public, anon;
grant  execute on function public.operator_requirement_acknowledge(uuid, text) to authenticated;

-- ── Verify (read-only) ─────────────────────────────────────────────────────
-- select proname, oidvectortypes(proargtypes)
--   from pg_proc where proname in
--   ('create_staff_invite','invite_staff_member','accept_staff_invite');
--   -- exactly one row each, no overloads.
--
-- select polname, pg_get_expr(polwithcheck, polrelid)
--   from pg_policy p join pg_class c on c.oid = p.polrelid
--  where polname in ('otd_insert','ack_insert','medical_traveler_insert');
--   -- each mentions is_trip_staff.
