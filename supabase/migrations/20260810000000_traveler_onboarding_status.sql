-- Traveler onboarding — Phase 1.
-- Spec: docs/specs/operator-trips/traveler-onboarding.md
--
-- On an operator trip (hosting_style 'C'), being APPROVED no longer means being
-- IN the trip. Approval buys a ticket to the onboarding: the traveler can read
-- the requirement list, sign the waiver, fill the medical form and pay the
-- deposit — but takes no seat, is not in participant_count, and gets none of
-- the member UI. Finishing the must_have requirements is what makes them a
-- member.
--
-- ── Why a status column and not "no participant row" ────────────────────────
-- "Approved but not a participant" reads like "don't insert the row yet". That
-- is unbuildable: FIFTEEN policies gate on is_trip_participant() — the
-- requirement reads, every evidence table (documents / acknowledgements /
-- medical), and the storage bucket. With no row the approved traveler could not
-- even SEE what to do, let alone do it.
--
-- So the row is still inserted on approval and carries a lifecycle instead.
-- is_trip_participant() keeps returning true for both statuses, so not one RLS
-- policy changes. What moves is only: who takes a seat, who is counted, and who
-- gets announced.
--
-- ── The default is load-bearing ────────────────────────────────────────────
-- `default 'active'` backfills every existing row, on every trip, to the exact
-- behaviour it has today. Peer trips (A/B) never write anything else. This
-- migration is a no-op for them.
--
-- ⚠️  REFERENCE COPY — applied BY HAND in the Supabase SQL editor, never
--     `db push`. LIVE IS AHEAD OF THE REPO on some of these functions. Before
--     running section 2, 3, 4 or 5, diff the live body:
--         select pg_get_functiondef(oid) from pg_proc
--          where proname = '<name>' and pronamespace = 'public'::regnamespace;
--     and port whatever live has that this file does not.
--
-- ⚠️  Every `create or replace function` below RE-GRANTS EXECUTE TO PUBLIC.
--     The revoke that follows each one is not decoration — without it these
--     become anon-callable over /rest/v1/rpc/.

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The column.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.group_trip_participants
  add column if not exists status text not null default 'active';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'group_trip_participants_status_check'
       and conrelid = 'public.group_trip_participants'::regclass
  ) then
    alter table public.group_trip_participants
      add constraint group_trip_participants_status_check
      check (status in ('onboarding','active'));
  end if;
end $$;

comment on column public.group_trip_participants.status is
  'onboarding = approved on an operator trip but has not finished the must_have '
  'requirements: holds NO seat, absent from participant_count, no member UI. '
  'active = really in the trip. Peer (A/B) trips only ever use active. '
  'Never goes backwards — see activate_trip_membership().';

-- The seat count and the capacity check both filter on this.
create index if not exists group_trip_participants_trip_status_idx
  on public.group_trip_participants (trip_id, status);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Approval inserts 'onboarding' on operator trips, 'active' everywhere else.
--    Original: 20260429000000_create_trip_join_requests.sql
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.handle_join_request_approval()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    -- The status comes from the TRIP, so approving into a peer trip behaves
    -- exactly as it did before this migration existed.
    insert into public.group_trip_participants (trip_id, user_id, role, status)
    select new.trip_id, new.requester_id, 'member',
           case when t.hosting_style = 'C' then 'onboarding' else 'active' end
      from public.group_trips t
     where t.id = new.trip_id
    on conflict (trip_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

revoke execute on function public.handle_join_request_approval()
  from public, anon, authenticated;

drop trigger if exists trg_group_trip_join_requests_on_approve
  on public.group_trip_join_requests;
create trigger trg_group_trip_join_requests_on_approve
  after update of status on public.group_trip_join_requests
  for each row execute function public.handle_join_request_approval();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Capacity — only an 'active' row occupies a spot.
--    Original: 20260617000000_lock_capacity_check_triggers.sql
--
--    This is what makes over-approving safe: the operator can approve 14 people
--    for 10 spots and the boat is not full until 10 of them finish.
--
--    It now also fires on UPDATE, because onboarding -> active IS the moment a
--    seat is claimed. That UPDATE is the last gate before someone is in, and it
--    can legitimately fail with "trip is full" — activate_trip_membership()
--    lets that raise propagate rather than swallowing it.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.enforce_group_trip_max_participants()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_max   integer;
  v_count integer;
begin
  -- An 'onboarding' row takes nothing. Nothing to check.
  if new.status <> 'active' then
    return new;
  end if;

  -- An UPDATE that did not cross into 'active' claims no new seat (e.g. a role
  -- change on someone who was already in).
  if tg_op = 'UPDATE' and old.status = 'active' then
    return new;
  end if;

  -- A duplicate (trip_id, user_id) adds nobody — the INSERT either no-ops via
  -- ON CONFLICT DO NOTHING or is rejected by the unique constraint. Skip the
  -- capacity check so a re-approval of an existing member never falsely fails
  -- on a full trip. (BEFORE INSERT triggers fire even for soon-to-conflict rows.)
  if tg_op = 'INSERT' and exists (
    select 1 from public.group_trip_participants
    where trip_id = new.trip_id and user_id = new.user_id
  ) then
    return new;
  end if;

  -- Lock the trip row so concurrent joins to the same trip serialize.
  select max_participants into v_max
    from public.group_trips
    where id = new.trip_id
    for update;

  if v_max is null then
    return new;  -- no cap set
  end if;

  -- `user_id <> new.user_id` excludes this row's own pre-image. On INSERT it is
  -- a no-op (the row is not there yet); on UPDATE the row is still 'onboarding'
  -- and so would not be counted anyway. It is here so the count means "everyone
  -- ELSE who is in" under either path, whatever the pre-image happened to be.
  select count(*) into v_count
    from public.group_trip_participants
    where trip_id = new.trip_id
      and status  = 'active'
      and user_id <> new.user_id;

  if v_count >= v_max then
    raise exception 'Trip is full — % of % spots taken', v_count, v_max
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_group_trip_max_participants()
  from public, anon, authenticated;

drop trigger if exists trg_enforce_group_trip_max_participants
  on public.group_trip_participants;
create trigger trg_enforce_group_trip_max_participants
  before insert or update of status on public.group_trip_participants
  for each row execute function public.enforce_group_trip_max_participants();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. participant_count — the "8 of 10" on every card, and the explore sort.
--    Original: 20260531000004_group_trips_participant_counts.sql
--    Onboarding travelers must not inflate it, or a trip looks full while it
--    still has real spots.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.sync_group_trip_participant_count()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  affected uuid;
begin
  -- Recount the row's trip (covers INSERT/UPDATE via NEW). The UPDATE path is
  -- what makes activation bump the count.
  if (tg_op = 'INSERT' or tg_op = 'UPDATE') then
    affected := new.trip_id;
    update public.group_trips t
    set participant_count = (
      select count(*) from public.group_trip_participants p
       where p.trip_id = affected and p.status = 'active'
    )
    where t.id = affected;
  end if;

  -- Recount the old trip too (covers DELETE, and trip_id moves on UPDATE).
  if (tg_op = 'DELETE' or tg_op = 'UPDATE') then
    affected := old.trip_id;
    if affected is not null then
      update public.group_trips t
      set participant_count = (
        select count(*) from public.group_trip_participants p
         where p.trip_id = affected and p.status = 'active'
      )
      where t.id = affected;
    end if;
  end if;

  return null; -- AFTER trigger, return value ignored.
end;
$$;

revoke execute on function public.sync_group_trip_participant_count()
  from public, anon, authenticated;

drop trigger if exists trg_sync_participant_count on public.group_trip_participants;
create trigger trg_sync_participant_count
after insert or update or delete on public.group_trip_participants
for each row execute function public.sync_group_trip_participant_count();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. "X joined the group" fires on ACTIVATION, not on approval.
--    Original: 20260601010000_notification_center.sql §5.1
--    Announcing an approved-but-unpaid traveler would tell the whole group
--    someone joined who cannot see the group.
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ PORTED FROM LIVE, NOT FROM THE REPO (diffed 2026-08-10).
--    The repo copy of this function is stale in two ways that matter, and
--    recreating it from the repo would have been a production regression:
--      · repo sets audience with `case ... then 'admin' else 'user' end`;
--        LIVE hardcodes 'user'.
--      · repo notifies EVERY other participant; LIVE excludes the host
--        (`p.user_id <> v_host`) and every admin (`role = 'member'` only).
--    i.e. live deliberately does NOT tell hosts/admins that someone joined.
--    Restoring the repo body would have spammed every operator on every join.
--    The only additions below are the two status gates and `p.status`.
--
--    search_path is widened from live's bare 'public' to the project standard.
--    With pg_temp unlisted it is implicitly searched FIRST, which is the
--    temp-table shadowing hole the hardening pass closed everywhere else; this
--    function was missed. Nothing here resolves out of `extensions`, so the
--    widening cannot change which function any call site binds to.
create or replace function public.tg_notify_member_joined()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_host uuid; v_title text; v_name text;
begin
  -- Not in the trip yet — nothing happened as far as the group is concerned.
  if new.status <> 'active' then
    return new;
  end if;
  -- An UPDATE that did not cross into 'active' is not a join.
  if tg_op = 'UPDATE' and old.status = 'active' then
    return new;
  end if;

  select host_id, title into v_host, v_title from public.group_trips where id = new.trip_id;
  if new.user_id = v_host or new.role = 'host' then
    return new;  -- host creating the trip is not a "joined" event
  end if;
  v_name := public.user_display_name(new.user_id);
  insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  select p.user_id, new.trip_id, 'member_joined', 'user',
         new.user_id, 'participant', new.id,
         jsonb_build_object('actor_name', v_name, 'trip_title', v_title)
  from public.group_trip_participants p
  where p.trip_id = new.trip_id
    and p.user_id <> new.user_id
    and p.user_id <> v_host
    and coalesce(p.role, 'member') = 'member'
    -- Onboarding travelers cannot open the trip, so they get no trip news.
    and p.status = 'active';
  return new;
end $$;

revoke execute on function public.tg_notify_member_joined()
  from public, anon, authenticated;

drop trigger if exists trg_member_joined on public.group_trip_participants;
create trigger trg_member_joined
after insert or update of status on public.group_trip_participants
for each row execute function public.tg_notify_member_joined();

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Pin `status` against the traveler who owns the row.
--
--    WITHOUT THIS THE ENTIRE FEATURE IS ONE REST CALL AWAY FROM BEING
--    BYPASSED. The live UPDATE policy on this table is self-service and pins
--    only `role`:
--
--      using       (auth.uid() = user_id)
--      with check  (auth.uid() = user_id and role = <their current role>)
--
--    So a traveler could PATCH their own row to status='active' and be a full
--    member without signing the waiver, filling the medical form, or paying a
--    cent. The INSERT policy is equally permissive once a join request is
--    approved.
--
--    Same shape as freeze_traveler_price, which already pins the price columns
--    on this exact table for this exact reason: the write is allowed to
--    succeed, the protected column silently does not move. Failing loudly
--    instead would break the ordinary self-PATCHes (gear, commitment note)
--    that legitimately carry the whole row.
--
--    The sanctioned path identifies itself with a TRANSACTION-LOCAL GUC that
--    only activate_trip_membership() sets. It cannot be auth.uid(), because
--    that RPC runs as the traveler; and a client cannot set the GUC itself —
--    PostgREST exposes no way to run set_config, and no other function does.
create or replace function public.enforce_participant_status()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_style text;
begin
  -- Service role / trusted server paths carry no JWT. Nothing to defend
  -- against, and the backfills and admin fixes must stay possible.
  if auth.uid() is null then
    return new;
  end if;

  -- The one sanctioned mutation. See activate_trip_membership().
  if coalesce(nullif(current_setting('app.membership_activation', true), ''), 'off') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Nobody picks their own starting status. It is a fact about the TRIP.
    select t.hosting_style into v_style
      from public.group_trips t where t.id = new.trip_id;
    new.status := case when v_style = 'C' then 'onboarding' else 'active' end;
    return new;
  end if;

  -- UPDATE: everything else on the row still writes; status does not move.
  new.status := old.status;
  return new;
end $$;

revoke execute on function public.enforce_participant_status()
  from public, anon, authenticated;

-- ⚠️ THE NAME IS LOAD-BEARING. Postgres fires same-timing triggers in
--    ALPHABETICAL order, and this one must run before
--    `trg_enforce_group_trip_max_participants` — "apply" sorts before
--    "enforce_group", "enforce_participant" would not.
--
--    Why it matters: an INSERT that does not name `status` gets the column
--    default, 'active'. If the capacity check saw that first, a newly approved
--    traveler on a full operator trip would be refused their onboarding row —
--    and over-approving is the entire point of the feature. Running first
--    means capacity always sees the corrected 'onboarding' and skips them.
drop trigger if exists trg_enforce_participant_status on public.group_trip_participants;
drop trigger if exists trg_apply_participant_status on public.group_trip_participants;
create trigger trg_apply_participant_status
  before insert or update on public.group_trip_participants
  for each row execute function public.enforce_participant_status();

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. activate_trip_membership — the one door from 'onboarding' to 'active'.
--
--    The client never gets to just SAY it finished. This re-derives every
--    must_have requirement's state from the evidence tables (via
--    operator_trip_my_requirements, which is the same resolver the traveler's
--    own task list reads) and refuses if any is outstanding.
--
--    Satisfied is expressed as NOT ('not_started' | 'rejected') rather than
--    = 'approved' on purpose:
--      · an upload sitting at 'submitted' should not block the trip on the
--        operator finding time to review it — that would make membership
--        depend on a human being awake. (Only reachable if an operator
--        overrides an upload kind to must_have; the default must_have set is
--        waiver + medical + deposit, none of which can be 'submitted'.)
--      · 'overdue' cannot occur here — organized_trip_req_deadline_rule
--        forbids a deadline on a must_have row.
--      · it is robust to a pay-state value this file does not know about.
--        ⚠️ operator_requirement_pay_state has been revised live (partial
--        payments). Confirm what it returns for a fully-paid deposit before
--        applying, and that the value is not 'not_started'.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.activate_trip_membership(p_trip_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_status  text;
  v_missing integer;
begin
  select status into v_status
    from public.group_trip_participants
   where trip_id = p_trip_id and user_id = auth.uid();

  if v_status is null then
    raise exception 'Not a participant of this trip'
      using errcode = 'insufficient_privilege';
  end if;

  -- Idempotent, and one-way. Called on every trip open, and a must_have
  -- requirement ADDED after the fact must never demote someone already in.
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

  -- Identify this as the sanctioned status change. `true` = transaction-local,
  -- so it is gone the moment this statement's transaction ends and cannot leak
  -- into the next request on a pooled connection. Set as late as possible —
  -- after every check above has passed — so the window in which the pin is
  -- lifted contains nothing but the UPDATE itself.
  perform set_config('app.membership_activation', 'on', true);

  -- The capacity trigger fires on this UPDATE and may raise "Trip is full".
  -- That raise is deliberate and must reach the caller: it is the last thing
  -- standing between an over-approved trip and an oversold one.
  update public.group_trip_participants
     set status = 'active'
   where trip_id = p_trip_id
     and user_id = auth.uid()
     and status  = 'onboarding';

  perform set_config('app.membership_activation', 'off', true);

  return 'active';
end;
$$;

revoke execute on function public.activate_trip_membership(uuid) from public, anon;
grant  execute on function public.activate_trip_membership(uuid) to authenticated;

comment on function public.activate_trip_membership(uuid) is
  'Onboarding -> active for the calling traveler, if every must_have requirement '
  'is satisfied. Returns the resulting status. Idempotent and one-way. May raise '
  'check_violation when the trip filled up while they were onboarding.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. my_trips_feed — surface the status so the card can say "Finish onboarding".
--    Original: 20260616130000_my_trips_feed_rpc.sql
--
--    `membership` keeps its existing three values. A new COLUMN is added
--    instead of a new membership value, so builds already in the App Store
--    keep bucketing exactly as they do today.
--
--    ⚠️ PORTED FROM LIVE, NOT FROM THE REPO (diffed 2026-08-10). Live carries
--       `budget_fx_rate numeric` — the frozen USD→₪ rate the trip cards use to
--       print "about ₪X" — and the repo copy does not. Recreating from the repo
--       would have DROPPED that column and broken currency display on every My
--       Trips card for Israeli users. It is kept in the same position live has
--       it (after budget_max), because callers select by name but the ordinal
--       shape is what a stale client sees.
--
--    ⚠️ Adding a column changes the return type — hence the drop. Overloads
--       checked 2026-08-10: exactly one, `my_trips_feed()`. A second one would
--       have kept serving the old shape after this ran.
-- ═══════════════════════════════════════════════════════════════════════════
drop function if exists public.my_trips_feed();

CREATE OR REPLACE FUNCTION public.my_trips_feed()
RETURNS TABLE (
  id uuid, host_id uuid, status text, hosting_style text, title text, hero_image_url text,
  start_date date, end_date date, dates_set_in_stone boolean, date_months text[],
  cost_per_person numeric, budget_min numeric, budget_max numeric, budget_fx_rate numeric,
  max_participants int, participant_count int, created_at timestamptz,
  destination jsonb, host_name text, host_avatar text, member_avatars text[],
  membership text, member_status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  trips AS (
    -- Trips the caller is a participant of (host or member).
    SELECT gt.*, 'participant'::text AS membership, p.status AS member_status
    FROM public.group_trips gt
    JOIN public.group_trip_participants p
      ON p.trip_id = gt.id AND p.user_id = (SELECT uid FROM me)
    UNION ALL
    -- Trips the caller has a pending join request for AND isn't already in.
    SELECT gt.*, 'pending_request'::text AS membership, NULL::text AS member_status
    FROM public.group_trips gt
    JOIN public.group_trip_join_requests jr
      ON jr.trip_id = gt.id
     AND jr.requester_id = (SELECT uid FROM me)
     AND jr.status = 'pending'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.group_trip_participants p2
      WHERE p2.trip_id = gt.id AND p2.user_id = (SELECT uid FROM me)
    )
  )
  SELECT t.id, t.host_id, t.status, t.hosting_style, t.title, t.hero_image_url,
         t.start_date, t.end_date, t.dates_set_in_stone, t.date_months,
         t.cost_per_person, t.budget_min, t.budget_max, t.budget_fx_rate,
         t.max_participants, t.participant_count, t.created_at,
         (SELECT jsonb_build_object('name', d.name, 'short_label', d.short_label,
                   'country', d.country, 'admin_level_1', d.admin_level_1,
                   'lat', d.lat, 'lng', d.lng)
            FROM public.group_trip_destinations d WHERE d.trip_id = t.id) AS destination,
         s.name AS host_name, s.profile_image_url AS host_avatar,
         (SELECT array_agg(sub.av)
            FROM (
              SELECT s2.profile_image_url AS av
              FROM public.group_trip_participants pp
              JOIN public.surfers s2 ON s2.user_id = pp.user_id
              WHERE pp.trip_id = t.id AND s2.profile_image_url IS NOT NULL
                -- Social proof means people who are actually going.
                AND pp.status = 'active'
              ORDER BY (pp.user_id = t.host_id) DESC, pp.user_id
              LIMIT 4
            ) sub) AS member_avatars,
         t.membership, t.member_status
  FROM trips t
  LEFT JOIN public.surfers s ON s.user_id = t.host_id;
$$;

REVOKE EXECUTE ON FUNCTION public.my_trips_feed() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.my_trips_feed() TO authenticated;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- Post-apply sanity (run separately, expect every row to say true):
--
--   select 'peer rows untouched' as check,
--          not exists (select 1 from public.group_trip_participants
--                       where status <> 'active') as ok;
--
--   select 'counts still agree' as check,
--          not exists (
--            select 1 from public.group_trips t
--             where t.participant_count <> (
--               select count(*) from public.group_trip_participants p
--                where p.trip_id = t.id and p.status = 'active')) as ok;
-- ═══════════════════════════════════════════════════════════════════════════
