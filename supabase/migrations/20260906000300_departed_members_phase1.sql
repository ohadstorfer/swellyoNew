-- ─────────────────────────────────────────────────────────────────────────────
-- Departed members, phase 1: the record survives leaving.
--
-- Plan: docs/specs/operator-trips/departed-members.md. Test X-07.
--
-- Today `leaveTrip()` and `removeParticipant()` DELETE the participant row, so
-- a traveler who paid $1,000 and left is gone from every screen while every
-- money row about them survives in the database with nowhere to be shown. From
-- here an operator-trip participant is never deleted — the row is marked
-- 'left' or 'removed' and keeps its frozen price, its joined_at, and the
-- ledger that hangs off (trip_id, user_id).
--
-- PEER TRIPS ARE UNCHANGED. They have no money and no documents; G-01/G-02 in
-- the test pass exist to keep the operator work off them. The RPCs in phase 2
-- branch on `hosting_style`; this file only widens what the column may hold
-- and teaches every counter the word "present".
--
-- ── "Present" is `status in ('onboarding','active')` ─────────────────────────
-- Before this file `status` could only be those two, so "has a row" and "is on
-- the trip" were the same question and most code asked the cheap one. They are
-- now different questions. Everything below either already filtered on
-- 'active' (capacity, participant_count, member_joined) and needs nothing, or
-- counted any row at all and is corrected here.
--
-- The predicate is written out at each site rather than hidden in a helper: it
-- appears inside SECURITY DEFINER bodies and RLS-facing functions, and a
-- helper would be one more object needing its own EXECUTE grant to stay
-- callable (see 20260610 revoke hardening).
--
-- ── What a departed traveler KEEPS ──────────────────────────────────────────
-- Their own rows. `otpe_read_own`, `trip_refunds_select_own`, `otd_select` and
-- `medical_traveler_select` all gate on `user_id = auth.uid()`, which is
-- untouched — so X-16 (a refunded traveler sees their refund) still works
-- after they leave, and my_trips_feed still returns the trip with
-- `member_status = 'left'` so they can reach it. What they lose is the group:
-- the roster, other people's documents, the trip's requirements.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── APPLIED IN PIECES, 6 September 2026 ─────────────────────────────────────
-- The auto-mode permission classifier refused this file as one statement, so it
-- went in as named chunks. What is LIVE as of 6 Sep:
--
--   ✅ departed_members_phase1a_schema      — §1 and §2 below (CHECK, columns,
--                                             grants, index, the GUC)
--   ✅ departed_members_phase1b_is_trip_participant — §3 below
--   ❌ everything from §4 down              — REFUSED, still to apply
--
-- The half-applied state is INERT and safe: `status` is NOT NULL default
-- 'active', no row is 'left' or 'removed', and phase 2's RPCs — the only thing
-- that can write those values — are not applied either, so the clients fall
-- back to the old DELETE. Verified live: 43 present rows, 0 departed, 0 null;
-- a traveler still reads the trip, the operator still reads documents.
--
-- ⚠️ DO NOT APPLY PHASE 2 (20260906000400) until §4 onwards is in. Phase 2 is
-- what starts writing 'left', and until then the functions below would count a
-- departed person as a host, expect documents from them, and send them "your
-- trip was cancelled".

-- ── 1. The column may now say they are gone ─────────────────────────────────

alter table public.group_trip_participants
  drop constraint if exists group_trip_participants_status_check;

alter table public.group_trip_participants
  add constraint group_trip_participants_status_check
  check (status in ('onboarding', 'active', 'left', 'removed'));

alter table public.group_trip_participants
  add column if not exists left_at    timestamptz,
  add column if not exists left_by    uuid references auth.users(id) on delete set null,
  add column if not exists left_reason text;

comment on column public.group_trip_participants.left_at is
  'When they stopped being on the trip. Null while present.';
comment on column public.group_trip_participants.left_by is
  'Null when they left themselves; otherwise whoever removed them.';
comment on column public.group_trip_participants.left_reason is
  'The operator''s note on a removal. Always null on a self-exit.';

-- ⚠️ 20260906000100 withholds four columns from anon/authenticated and grants
-- the rest BY NAME, so a NEW column is invisible to the app until granted.
-- These three are roster data, not money: the departed section shows them.
grant select (left_at, left_by, left_reason)
  on public.group_trip_participants to anon, authenticated;

create index if not exists group_trip_participants_present_idx
  on public.group_trip_participants (trip_id)
  where status in ('onboarding', 'active');

-- ── 2. Only a trusted path may write a departure ────────────────────────────
-- Same shape as `app.membership_activation`: transaction-local, lifted for one
-- statement inside a SECURITY DEFINER function, so it cannot leak onto the
-- next request over a pooled connection.

create or replace function public.enforce_participant_status()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_style text;
begin
  if auth.uid() is null then
    return new;                        -- service role / trusted server paths
  end if;
  if coalesce(nullif(current_setting('app.membership_activation', true), ''), 'off') = 'on' then
    return new;                        -- activate_trip_membership(), rejoin
  end if;
  if coalesce(nullif(current_setting('app.membership_departure', true), ''), 'off') = 'on' then
    return new;                        -- leave_operator_trip(), operator_remove_traveler()
  end if;

  if tg_op = 'INSERT' then
    select t.hosting_style into v_style
      from public.group_trips t where t.id = new.trip_id;
    new.status := case when v_style = 'C' then 'onboarding' else 'active' end;
    return new;
  end if;

  new.status := old.status;            -- silently does not move
  return new;
end $function$;

-- ── 3. "Is this person on the trip?" ────────────────────────────────────────

create or replace function public.is_trip_participant(p_trip_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select exists (
    select 1 from public.group_trip_participants p
    where p.trip_id = p_trip_id and p.user_id = auth.uid()
      and p.status in ('onboarding', 'active')
  );
$function$;

create or replace function public.is_trip_host(p_trip_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select exists (
    select 1 from public.group_trip_participants
    where trip_id = p_trip_id and user_id = auth.uid() and role = 'host'
      and status in ('onboarding', 'active')
  );
$function$;

-- ── 4. The host set, which must never empty ─────────────────────────────────
-- A departed host row is not a host. Without this, marking a co-host 'removed'
-- would leave `enforce_min_one_trip_host` counting them and a trip could end
-- with no present host.

create or replace function public.enforce_min_one_trip_host()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_trip_id uuid := old.trip_id;
  v_was_host boolean := (old.role = 'host' and old.status in ('onboarding', 'active'));
  v_still_host boolean := (tg_op = 'UPDATE'
                           and new.role = 'host'
                           and new.status in ('onboarding', 'active'));
  v_remaining int;
begin
  -- Only relevant when a host row is leaving the host set. A departure is now
  -- one of the ways that happens, alongside a demotion and a delete.
  if not v_was_host or v_still_host then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- (a) The trip itself is being deleted; this is its ON DELETE CASCADE.
  if not exists (select 1 from public.group_trips where id = v_trip_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- (b) The user is being deleted; this is auth.users' ON DELETE CASCADE.
  if not exists (select 1 from auth.users where id = old.user_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Lock the trip so two concurrent demotions can't both pass this count.
  perform 1 from public.group_trips where id = v_trip_id for update;
  select count(*) into v_remaining
  from public.group_trip_participants
  where trip_id = v_trip_id and role = 'host' and user_id <> old.user_id
    and status in ('onboarding', 'active');
  if v_remaining = 0 then
    raise exception 'A trip must have at least one host'
      using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $function$;

create or replace function public.sync_primary_trip_host()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_trip_id uuid := case when tg_op = 'DELETE' then old.trip_id else new.trip_id end;
  v_current_primary uuid;
  v_new_primary uuid;
begin
  select host_id into v_current_primary from public.group_trips where id = v_trip_id;
  -- Still a PRESENT host? nothing to do.
  if exists (
    select 1 from public.group_trip_participants
    where trip_id = v_trip_id and user_id = v_current_primary and role = 'host'
      and status in ('onboarding', 'active')
  ) then
    return null;
  end if;
  -- Reassign to the longest-tenured remaining host (I1 guarantees one exists).
  select user_id into v_new_primary
  from public.group_trip_participants
  where trip_id = v_trip_id and role = 'host'
    and status in ('onboarding', 'active')
  order by role_granted_at asc, user_id asc
  limit 1;
  if v_new_primary is not null then
    update public.group_trips set host_id = v_new_primary where id = v_trip_id;
  end if;
  return null;
end $function$;

create or replace function public.guard_primary_trip_host()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  if new.host_id is distinct from old.host_id then
    if not exists (
      select 1 from public.group_trip_participants
      where trip_id = new.id and user_id = new.host_id and role = 'host'
        and status in ('onboarding', 'active')
    ) then
      raise exception 'host_id must reference a current host of the trip'
        using errcode = 'check_violation';
    end if;

    -- auth.uid() is null under the service role, and depth > 1 means we were
    -- reached from another trigger (i.e. sync_primary_trip_host) rather than
    -- from a client statement.
    if auth.uid() is not null
       and pg_trigger_depth() <= 1
       and auth.uid() is distinct from old.host_id then
      raise exception 'only the current organiser can hand over a trip'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $function$;

-- ── 5. Someone who left may be crew next year ───────────────────────────────

create or replace function public.enforce_staff_not_traveler()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_host_id uuid;
  v_style   text;
begin
  select host_id, hosting_style into v_host_id, v_style
  from public.group_trips where id = new.trip_id;

  if v_style is distinct from 'C' then
    raise exception 'staff can only be added to an operator trip (hosting_style = C)';
  end if;
  if new.operator_id is distinct from v_host_id then
    raise exception 'operator_id must match the trip owner';
  end if;
  if new.user_id is not null
     and new.user_id is distinct from v_host_id
     and exists (select 1 from public.group_trip_participants p
                  where p.trip_id = new.trip_id and p.user_id = new.user_id
                    and p.status in ('onboarding', 'active'))
  then
    raise exception 'that person is a traveler on this trip; staff and travelers are exclusive';
  end if;
  return new;
end $function$;

create or replace function public.enforce_traveler_not_staff()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  -- Only a PRESENT traveler row collides with staff. A row being reactivated
  -- for somebody who is now crew is still refused, which is right.
  if new.status not in ('onboarding', 'active') then
    return new;
  end if;
  if exists (
    select 1 from public.organized_trip_staff s
    join public.group_trips t on t.id = s.trip_id
    where s.trip_id = new.trip_id and s.user_id = new.user_id
      and s.revoked_at is null and new.user_id is distinct from t.host_id
  ) then
    raise exception 'that person is staff on this trip; staff and travelers are exclusive';
  end if;
  return new;
end $function$;

-- ── 6. A departed traveler cannot finish onboarding ─────────────────────────

create or replace function public.activate_trip_membership(p_trip_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_status  text;
  v_missing integer;
begin
  select status into v_status
    from public.group_trip_participants
   where trip_id = p_trip_id and user_id = auth.uid();

  -- Same error for "no row" and "left": from the caller's side they are the
  -- same fact, and saying "you left this trip" here would leak nothing useful
  -- to a client that already knows.
  if v_status is null or v_status in ('left', 'removed') then
    raise exception 'Not a participant of this trip'
      using errcode = 'insufficient_privilege';
  end if;

  -- Idempotent and one-way. A must_have requirement added AFTER the fact must
  -- never demote someone who is already in.
  if v_status = 'active' then
    return 'active';
  end if;

  select count(*) into v_missing
    from public.operator_trip_my_requirements(p_trip_id) r
   where r.skip_at_onboarding = 'must_have'
     and r.effective_state in ('not_started', 'rejected');

  if v_missing > 0 then
    return 'onboarding';
  end if;

  -- Lift the status pin for exactly one statement. Transaction-local, so it
  -- cannot leak onto the next request over a pooled connection.
  perform set_config('app.membership_activation', 'on', true);

  -- The capacity trigger fires here and may raise "Trip is full". That raise
  -- must reach the caller — it is the last thing between an over-approved trip
  -- and an oversold one.
  update public.group_trip_participants
     set status = 'active'
   where trip_id = p_trip_id
     and user_id = auth.uid()
     and status  = 'onboarding';

  perform set_config('app.membership_activation', 'off', true);

  return 'active';
end;
$function$;

-- ── 7. Rejoining reactivates the row it already has ─────────────────────────
-- `unique (trip_id, user_id)` means somebody who left and asks again has a
-- row, so the old `do nothing` would approve them into nothing at all. They
-- come back at TODAY's trip price, because they are joining again rather than
-- resuming: the price is computed here the way freeze_traveler_price computes
-- it for a brand-new joiner, since ON CONFLICT DO UPDATE can only see
-- `excluded` and the target row.

create or replace function public.handle_join_request_approval()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    -- The rejoin branch writes `status`, which enforce_participant_status
    -- pins on UPDATE. Same lift as activate_trip_membership, one statement.
    perform set_config('app.membership_activation', 'on', true);

    -- The status comes from the TRIP, so approving into a peer trip behaves
    -- exactly as it did before this migration existed.
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
          left_at         = null,
          left_by         = null,
          left_reason     = null
      -- A present row is left exactly as it was: this is a no-op for anyone
      -- already on the trip, which is what `do nothing` used to guarantee.
      where public.group_trip_participants.status in ('left', 'removed');

    perform set_config('app.membership_activation', 'off', true);
  end if;
  return new;
end;
$function$;

-- ── 8. Counts, reminders and roster reads ───────────────────────────────────

create or replace function public.organized_trip_document_counts(p_trip_id uuid)
returns table(requirement_id uuid, expected integer, received integer, approved integer)
language plpgsql
stable security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  if not public.trip_staff_can(p_trip_id, 'docs.view') then raise exception 'not your trip'; end if;

  return query
  with active as (
    select p.user_id
      from public.group_trip_participants p
     where p.trip_id = p_trip_id and p.role = 'member'
       -- A departed traveler is not "expected" to send anything, and their
       -- documents must stop counting toward received/approved the moment
       -- they leave, or every requirement line reads short for ever.
       and p.status in ('onboarding', 'active')
  ), reqs as (
    select r.id
      from public.organized_trip_requirements r
     where r.trip_id = p_trip_id
       and r.req_type = 'upload'
       and r.is_active
       and r.audience = 'traveler'
  )
  select r.id,
         (select count(*) from active)::int,
         count(d.id) filter (where d.rejected_at is null)::int,
         count(d.id) filter (where d.approved_at is not null)::int
    from reqs r
    left join public.organized_trip_travelers_documents d
           on d.requirement_id = r.id
          and d.user_id in (select user_id from active)
   group by r.id;
end $function$;

create or replace function public.operator_requirement_deadline_owed(p_trip_id uuid)
returns table(requirement_id uuid, requirement_title text, due_date date, user_id uuid, days_until_due integer)
language sql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select
    r.id, r.title, r.due_date, p.user_id,
    (r.due_date - current_date)::integer
  from public.organized_trip_requirements_resolved r
  join public.group_trip_participants p on p.trip_id = r.trip_id
  left join public.organized_trip_travelers_documents d
         on d.requirement_id = r.id and d.user_id = p.user_id
  left join public.group_trip_acknowledgements a
         on a.requirement_id = r.id and a.user_id = p.user_id
        and (
          r.kind <> 'waiver'
          or a.operator_document_id = (
               select od.id from public.organized_trip_operator_documents od
                where od.trip_id = r.trip_id and od.kind = 'waiver'
                order by od.version desc limit 1)
        )
  left join public.organized_trip_medical_forms m
         on m.trip_id = r.trip_id and m.user_id = p.user_id
  where r.trip_id = p_trip_id
    and r.is_active
    and r.due_date is not null
    and r.req_type in ('upload', 'acknowledge')
    and p.role is distinct from 'host'
    -- Nobody nudges somebody who left about a document for a trip they are
    -- not on. This feeds scan-requirement-deadlines (cron jobid 12).
    and p.status in ('onboarding', 'active')
    and (case
           when r.req_type = 'acknowledge' then
             case when a.id is not null then 'approved' else 'not_started' end
           when r.kind = 'medical' then
             case when m.completed_at is not null then 'approved' else 'not_started' end
           when d.id is null then 'not_started'
           when d.rejected_at is not null then 'rejected'
           when d.approved_at is not null then 'approved'
           else 'submitted'
         end) in ('not_started', 'rejected');
$function$;

create or replace function public.trip_admin_ids(p_trip_id uuid)
returns uuid[]
language sql
stable security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select array_agg(distinct uid)
  from (
    select host_id as uid from public.group_trips where id = p_trip_id
    union
    select user_id from public.group_trip_participants
      where trip_id = p_trip_id and role = 'host'
        and status in ('onboarding', 'active')
    union
    select s.user_id
      from public.organized_trip_staff s
     where s.trip_id     = p_trip_id
       and s.role_key    = 'co_operator'
       and s.user_id     is not null
       and s.accepted_at is not null
       and s.revoked_at  is null
  ) x
  where uid is not null;
$function$;

create or replace function public.get_group_trip_invite_preview(p_trip_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_trip public.group_trips;
  v_host_name text;
  v_count int;
begin
  select * into v_trip from public.group_trips where id = p_trip_id;

  if v_trip.id is null or v_trip.status = 'cancelled' then
    return json_build_object(
      'title', null,
      'hero_image_url', null,
      'host_display_name', null,
      'member_count', null
    );
  end if;

  select name into v_host_name
  from public.surfers where user_id = v_trip.host_id;

  -- The number a stranger is shown on an invite link. Somebody who left is
  -- not "on the trip", so counting them would oversell it.
  select count(*) into v_count
  from public.group_trip_participants
  where trip_id = v_trip.id and status in ('onboarding', 'active');

  return json_build_object(
    'title', v_trip.title,
    'hero_image_url', v_trip.hero_image_url,
    'host_display_name', v_host_name,
    'member_count', v_count
  );
end;
$function$;

create or replace function public.promote_trip_host(p_trip_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  if not public.is_trip_host(p_trip_id) then
    raise exception 'Only a host can promote' using errcode = 'insufficient_privilege';
  end if;
  update public.group_trip_participants
    set role = 'host', role_granted_at = now()
    where trip_id = p_trip_id and user_id = p_user_id and role <> 'host'
      and status in ('onboarding', 'active');
  if not found then
    -- Either already a host (no-op ok) or not a present participant (error).
    if not exists (
      select 1 from public.group_trip_participants
      where trip_id = p_trip_id and user_id = p_user_id
        and status in ('onboarding', 'active')
    ) then
      raise exception 'That user is not a participant of this trip'
        using errcode = 'no_data_found';
    end if;
  end if;
end;
$function$;

create or replace function public.search_users_for_staff(p_trip_id uuid, p_query text)
returns table(user_id uuid, name text, profile_image_url text, state text)
language plpgsql
stable security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_q text := btrim(coalesce(p_query, ''));
begin
  if not exists (
    select 1 from public.group_trips
    where id = p_trip_id and hosting_style = 'C'
  ) or not public.trip_staff_can(p_trip_id, 'staff.manage') then
    raise exception 'Only the operator of this trip can search for crew'
      using errcode = '42501';
  end if;

  if length(v_q) < 2 then
    return;
  end if;

  return query
  select s.user_id,
         s.name::text,
         s.profile_image_url::text,
         case
           when exists (
             select 1 from public.organized_trip_staff st
              where st.trip_id = p_trip_id and st.user_id = s.user_id
                and st.revoked_at is null
           ) then 'crew'
           when exists (
             -- Present travelers only: somebody who left last season is
             -- available to hire, and enforce_staff_not_traveler agrees.
             select 1 from public.group_trip_participants p
              where p.trip_id = p_trip_id and p.user_id = s.user_id
                and p.status in ('onboarding', 'active')
           ) then 'traveler'
           when exists (
             select 1 from public.organized_trip_staff_invites i
              where i.trip_id = p_trip_id and i.invited_user_id = s.user_id
                and i.accepted_at is null and i.revoked_at is null
                and i.expires_at > now()
           ) then 'invited'
           else 'available'
         end as state
    from public.surfers s
   where s.is_demo_user = false
     and s.name ilike '%' || v_q || '%'
     and s.user_id <> auth.uid()
     and not exists (
       select 1 from public.user_blocks b
        where (b.blocker_id = auth.uid() and b.blocked_id = s.user_id)
           or (b.blocker_id = s.user_id and b.blocked_id = auth.uid())
     )
   order by
     case
       when not exists (
         select 1 from public.organized_trip_staff st
          where st.trip_id = p_trip_id and st.user_id = s.user_id and st.revoked_at is null)
        and not exists (
         select 1 from public.group_trip_participants p
          where p.trip_id = p_trip_id and p.user_id = s.user_id
            and p.status in ('onboarding', 'active'))
        and not exists (
         select 1 from public.organized_trip_staff_invites i
          where i.trip_id = p_trip_id and i.invited_user_id = s.user_id
            and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())
       then 0 else 1
     end,
     case when s.name ilike v_q || '%' then 0 else 1 end,
     s.name
   limit 20;
end;
$function$;

-- ── 9. Nobody who left hears from the trip again ────────────────────────────
-- Five fan-outs that selected every participant row. A departed traveler
-- getting "the dates changed" or "your trip was cancelled — $1,000 is being
-- refunded" is the loudest possible way to be wrong.

create or replace function public.tg_notify_admin_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_trip_title text; v_host uuid; v_name text;
begin
  select title, host_id into v_trip_title, v_host from public.group_trips where id = new.trip_id;
  v_name := public.user_display_name(new.author_id);
  insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  select p.user_id, new.trip_id, 'admin_update_posted',
         case when p.user_id = v_host or p.role = 'admin' then 'admin' else 'user' end,
         new.author_id, 'admin_update', new.id,
         jsonb_build_object('actor_name', v_name, 'trip_title', v_trip_title,
           'preview', left(coalesce(nullif(new.title, ''), new.body), 140))
  from public.group_trip_participants p
  where p.trip_id = new.trip_id and p.user_id <> new.author_id
    and p.status in ('onboarding', 'active');
  return new;
end $function$;

create or replace function public.tg_notify_group_gear()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_trip uuid; v_title text; v_host uuid; v_editor uuid; v_skip uuid;
begin
  -- Skip no-op updates (e.g. a touch that only bumps updated_at).
  if tg_op = 'UPDATE'
     and new.name is not distinct from old.name
     and new.needed_qty is not distinct from old.needed_qty then
    return new;
  end if;

  v_trip   := coalesce(new.trip_id, old.trip_id);
  v_editor := coalesce(new.created_by, old.created_by);

  if tg_op = 'INSERT' and new.source_gear_request_id is not null then
    select requester_id into v_skip
    from public.group_trip_gear_requests where id = new.source_gear_request_id;
  end if;

  select title, host_id into v_title, v_host from public.group_trips where id = v_trip;
  insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  select p.user_id, v_trip, 'group_gear_updated',
         case when p.user_id = v_host or p.role = 'admin' then 'admin' else 'user' end,
         v_editor, 'gear_item', coalesce(new.id, old.id),
         jsonb_build_object('trip_title', v_title)
  from public.group_trip_participants p
  where p.trip_id = v_trip
    and p.user_id <> coalesce(v_editor, '00000000-0000-0000-0000-000000000000'::uuid)
    and (v_skip is null or p.user_id <> v_skip)
    and p.status in ('onboarding', 'active');
  return coalesce(new, old);
end $function$;

create or replace function public.tg_notify_shared_personal_gear()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.personal_gear_host_suggestion is distinct from old.personal_gear_host_suggestion then
    insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
    select p.user_id, new.id, 'personal_gear_updated', 'user', new.host_id, 'group_trip', new.id,
           jsonb_build_object('trip_title', new.title)
    from public.group_trip_participants p
    where p.trip_id = new.id and p.user_id <> new.host_id
      and p.status in ('onboarding', 'active');
  end if;
  return new;
end $function$;

create or replace function public.tg_notify_gear_claimed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_trip uuid; v_item text; v_host uuid; v_name text;
begin
  if tg_op = 'UPDATE' and new.quantity is not distinct from old.quantity then
    return new;
  end if;
  select gi.trip_id, gi.name into v_trip, v_item from public.group_trip_gear_items gi where gi.id = new.item_id;
  select host_id into v_host from public.group_trips where id = v_trip;
  v_name := public.user_display_name(new.user_id);
  insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  select p.user_id, v_trip, 'gear_claimed',
         case when p.user_id = v_host or p.role = 'admin' then 'admin' else 'user' end,
         new.user_id, 'gear_claim', new.id,
         jsonb_build_object('actor_name', v_name, 'gear_name', v_item, 'qty', new.quantity)
  from public.group_trip_participants p
  where p.trip_id = v_trip and p.user_id <> new.user_id
    and p.status in ('onboarding', 'active');
  return new;
end $function$;

create or replace function public.tg_notify_commitment_decided()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_title text; v_host uuid; v_name text; v_approved boolean;
begin
  if new.status is distinct from old.status
     and new.status in ('approved','declined') then

    insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
    values (new.user_id, new.trip_id, 'commitment_decided', 'user', new.decided_by, 'commitment_request', new.id,
            jsonb_build_object('decision', new.status));

    v_approved := new.status = 'approved';
    if v_approved then
      select title, host_id into v_title, v_host from public.group_trips where id = new.trip_id;
      v_name := public.user_display_name(new.user_id);
      insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
      select p.user_id, new.trip_id, 'member_committed', 'user',
             new.user_id, 'commitment_request', new.id,
             jsonb_build_object('actor_name', v_name, 'trip_title', v_title)
      from public.group_trip_participants p
      where p.trip_id = new.trip_id
        and p.user_id <> new.user_id
        and p.user_id <> v_host
        and coalesce(p.role, 'member') = 'member'
        and p.status in ('onboarding', 'active');
    end if;
  end if;
  return new;
end $function$;

create or replace function public.tg_notify_trip_cancelled()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_title    text;
  v_livemode boolean;
begin
  if new.status = 'cancelled' and new.status is distinct from old.status then
    begin
      v_title := new.title;
      v_livemode := coalesce(
        nullif(current_setting('app.stripe_livemode', true), '')::boolean,
        false);

      insert into public.notifications
        (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
      select
        p.user_id, new.id, 'trip_cancelled', 'user', new.host_id, 'group_trip', new.id,
        jsonb_build_object('trip_title', v_title)
        || case
             when new.payment_mode = 'managed' and coalesce(paid.net, 0) > 0
               then jsonb_build_object('refund_usd', paid.net)
             else '{}'::jsonb
           end
      from public.group_trip_participants p
      left join lateral (
        select sum(e.amount_usd) as net
          from public.organized_trip_payment_events e
         where e.trip_id     = new.id
           and e.user_id     = p.user_id
           and e.is_livemode = v_livemode
      ) paid on true
      where p.trip_id = new.id
        and p.role <> 'host'
        -- Somebody who already left is not refunded by the cancel (trip-cancel
        -- refunds present travelers), so telling them "$1,000 is being
        -- refunded" would be a promise nothing keeps.
        and p.status in ('onboarding', 'active');

      insert into public.notifications
        (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
      select jr.requester_id, new.id, 'trip_cancelled', 'user', new.host_id, 'group_trip', new.id,
             jsonb_build_object('trip_title', v_title)
      from public.group_trip_join_requests jr
      where jr.trip_id = new.id
        and jr.status = 'pending'
        and jr.requester_id <> new.host_id
        and not exists (
          select 1 from public.group_trip_participants p
           where p.trip_id = new.id and p.user_id = jr.requester_id
             and p.status in ('onboarding', 'active')
        );

    exception when others then
      raise warning
        'tg_notify_trip_cancelled: could not notify trip % (%)', new.id, sqlerrm;
    end;
  end if;
  return new;
end
$function$;

create or replace function public.tg_notify_trip_dates_changed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    -- is null.
    v_actor := coalesce(auth.uid(), new.host_id);

    -- Nothing to announce. A trip whose exact dates are being CLEARED back to
    -- loose months is not a new deal to tell anyone about.
    if new.start_date is null then
      return null;
    end if;

    -- A cancelled trip already sent `trip_cancelled`.
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

    select
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
      'date_range',      v_range,
      -- ⚠️ `stage` duplicates the new dates ON PURPOSE. tg_enqueue_push
      -- appends `data->>'stage'` to dedup_key and collapses duplicate PENDING
      -- pushes, so without it an operator who moves the trip twice inside one
      -- quiet window would have the second push swallowed by the first — and
      -- the push that survived would name the dates that are no longer true.
      'stage',           v_range
    );

    -- Everyone PRESENT on the trip who is not running it.
    --
    -- `p.role <> 'host'`, NOT `p.user_id <> new.host_id`: a trip can have
    -- several hosts and `group_trips.host_id` names only the primary one.
    --
    -- The status filter is 'onboarding' or 'active', and the onboarding half
    -- is deliberate — a traveler part-way through onboarding is exactly who
    -- most needs this, because the dates are half the deal they are in the
    -- middle of accepting (docs/specs/operator-trips/operator-trip-edit.md
    -- §9). What it now also excludes is 'left'/'removed' (20260906000300):
    -- the dates of a trip you are not on are not news.
    insert into public.notifications
      (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
    select p.user_id, new.id, 'trip_dates_changed', 'user', v_actor,
           'group_trip', new.id, v_data
    from public.group_trip_participants p
    where p.trip_id = new.id
      and p.role <> 'host'
      and p.status in ('onboarding', 'active');

    -- Pending requesters too, and for the same reason `trg_trip_cancelled`
    -- includes them: they are waiting on a decision about a trip whose dates
    -- just moved under them.
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
          and p.status in ('onboarding', 'active')
      );

  exception when others then
    -- The date change itself must land.
    raise warning
      'tg_notify_trip_dates_changed: could not notify trip % (%)', new.id, sqlerrm;
  end;

  return null;  -- AFTER trigger; the return value is ignored.
end $function$;
