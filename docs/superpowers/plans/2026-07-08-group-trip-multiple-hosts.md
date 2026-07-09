# Group Trip Multiple Hosts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a group trip have more than one host — any host can promote a member to host, and any host can demote another host — by moving permission off `group_trips.host_id` (single user) onto `group_trip_participants.role = 'host'` (a set).

**Architecture:** Postgres owns every invariant (≥1 host, `host_id` always points at a current host, role is immutable via client writes). Role changes happen only through two `SECURITY DEFINER` RPCs that re-verify the caller. The client gets a single `isTripHost()` helper replacing six copy-pasted checks, and a WhatsApp-style member sheet on `BottomSheetShell`.

**Tech Stack:** React Native 0.81 / Expo 54 / React 19, Supabase Postgres + RLS, Supabase Edge Functions (Deno), TanStack Query v5, Jest (`jest-expo`).

## Global Constraints

- **`role` values stay `('host','member')`** — no new `'admin'` role value, no schema-value migration.
- **Database word is `host`; every user-facing string is "admin"** — `Set as admin`, `Remove as admin`, the badge. Do not reconcile the two.
- **Migration is applied BY HAND in the Supabase SQL editor** — never `supabase db push`; remote migration history is frozen at `20260528`.
- **Public-schema RPCs are PostgREST-callable** — every new function must `REVOKE EXECUTE FROM PUBLIC, anon` and `GRANT EXECUTE TO authenticated`.
- **`SET search_path = public, extensions, pg_temp`** on every new function (`pg_temp` last).
- **Edge Functions deploy by copy-paste** into the Supabase dashboard — download+diff the live version before deploying; repo copies drift.
- **Errors reach users via `friendlyErrorMessage` / `showErrorAlert`** (`src/utils/friendlyError.ts`) — never `Alert.alert(title, e.message)`.
- **New sheets use `BottomSheetShell`** — never a hand-rolled `Modal`.
- **Fonts via `ff(family, weight)`** from `src/theme/fonts.ts`.
- **Do not commit.** Ohad reviews and commits manually.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `supabase/migrations/20260708000000_group_trip_multiple_hosts.sql` | Whole DB change: `role_granted_at`, backfill, `is_trip_host`, I1/I2 triggers, 15 policy rewrites, INSERT/UPDATE tightening, promote/demote RPCs, `trip_admin_ids` fix | Create |
| `src/utils/tripRole.ts` | Pure `isTripHost(trip, participants, uid)` — single source of truth | Create |
| `src/utils/__tests__/tripRole.test.ts` | Unit tests for the helper | Create |
| `src/services/trips/groupTripsService.ts` | `promoteTripHost` / `demoteTripHost` RPC wrappers | Modify |
| `src/components/sheets/SheetOptionRow.tsx` | Reusable icon+label+destructive sheet row | Create |
| `src/components/trips/TripMemberSheet.tsx` | The member action sheet | Create |
| `src/screens/trips/TripMembersScreen.tsx` | Row chevron + open sheet; delete inline Remove; consume helper | Modify |
| `src/screens/trips/TripDetailScreen.tsx` `:353` | Consume helper | Modify |
| `src/screens/trips/YourGearScreen.tsx` `:66` | Consume helper | Modify |
| `src/screens/trips/PackingAndGearScreen.tsx` `:64` | Consume helper | Modify |
| `src/screens/trips/TripUpdatesScreen.tsx` `:78` | Consume helper | Modify |
| `src/hooks/trips/useTripDetail.ts` `:94` | Consume helper (myRequest gate) | Modify |
| `src/navigation/MainNavContext.tsx` `:76-84` | Add `onStartConversation` to `tripCard` | Modify |
| `src/navigation/RootNavigator.tsx` `:182-192` | Thread `onMessage` into TripMembersScreen | Modify |
| `src/components/AppContent.tsx` `:1803-1806` | Wire `tripCard.onStartConversation` | Modify |
| `supabase/functions/send-trip-removed-notification/index.ts` `:89-97` | host_id check → host-set check | Modify |
| `supabase/functions/geocode-group-trip-destinations/index.ts` `:178-188` | host_id check → host-set check | Modify |

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260708000000_group_trip_multiple_hosts.sql`

**Interfaces:**
- Produces (SQL, callable from client via PostgREST): `promote_trip_host(p_trip_id uuid, p_user_id uuid) returns void`, `demote_trip_host(p_trip_id uuid, p_user_id uuid) returns void`. Both `SECURITY DEFINER`, granted to `authenticated`.
- Produces (SQL helper, used only inside RLS): `is_trip_host(p_trip_id uuid) returns boolean`.

This is one migration file, applied as a single transaction. There is no per-statement TDD; correctness is verified by the query battery in Step 3.

- [ ] **Step 1: Write the migration file**

```sql
-- 20260708000000_group_trip_multiple_hosts.sql
-- Group trips can have multiple hosts.
--  * Permission moves from group_trips.host_id (one user) to
--    group_trip_participants.role = 'host' (a set).
--  * group_trips.host_id becomes "primary host" — display + notification target,
--    kept in sync by trigger. Still exactly one per trip.
--  * Enforced invariants (all in Postgres, none trusted to the app):
--      I1  every trip has >= 1 host
--      I2  host_id always points at a current host of that trip
--      I3  role cannot be changed by a direct client write
--  * Closes two pre-existing holes on group_trip_participants:
--      - anyone could UPDATE their own row to role='host' (self-promotion)
--      - anyone could INSERT themselves into any trip (bypassing join requests)
--
-- Applied by hand in the SQL editor. Do NOT db push.

begin;

-- ── 1. role_granted_at: tie-breaker for primary-host reassignment ───────────
alter table public.group_trip_participants
  add column if not exists role_granted_at timestamptz not null default now();

update public.group_trip_participants
  set role_granted_at = coalesce(joined_at, role_granted_at)
  where role = 'host';

-- ── 2. Defensive backfill: guarantee every trip has its host participant row ──
-- createGroupTrip inserts the host participant best-effort; a past failure could
-- leave a hostless trip. Guarantee I1's precondition before enforcing it.
insert into public.group_trip_participants (trip_id, user_id, role)
select t.id, t.host_id, 'host'
from public.group_trips t
where not exists (
  select 1 from public.group_trip_participants p
  where p.trip_id = t.id and p.user_id = t.host_id
)
on conflict do nothing;

-- Any trip whose host_id row exists but isn't marked host → mark it.
update public.group_trip_participants p
  set role = 'host'
from public.group_trips t
where p.trip_id = t.id and p.user_id = t.host_id and p.role <> 'host';

-- ── 3. is_trip_host: the permission primitive (SECURITY DEFINER → no RLS
--       recursion when called from a policy on group_trip_participants itself) ─
create or replace function public.is_trip_host(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (
    select 1 from public.group_trip_participants
    where trip_id = p_trip_id and user_id = auth.uid() and role = 'host'
  );
$$;
revoke execute on function public.is_trip_host(uuid) from public, anon;
grant execute on function public.is_trip_host(uuid) to authenticated;

-- ── 4. I1: a trip always keeps >= 1 host ────────────────────────────────────
create or replace function public.enforce_min_one_trip_host()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_trip_id uuid := old.trip_id;
  v_was_host boolean := (old.role = 'host');
  v_still_host boolean := (tg_op = 'UPDATE' and new.role = 'host');
  v_remaining int;
begin
  -- Only relevant when a host row is leaving the host set.
  if not v_was_host or v_still_host then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- Lock the trip so two concurrent demotions can't both pass this count.
  perform 1 from public.group_trips where id = v_trip_id for update;
  select count(*) into v_remaining
  from public.group_trip_participants
  where trip_id = v_trip_id and role = 'host' and user_id <> old.user_id;
  if v_remaining = 0 then
    raise exception 'A trip must have at least one host'
      using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_enforce_min_one_trip_host on public.group_trip_participants;
create trigger trg_enforce_min_one_trip_host
  before update or delete on public.group_trip_participants
  for each row execute function public.enforce_min_one_trip_host();

-- ── 5. I2: keep group_trips.host_id pointing at a current host ──────────────
create or replace function public.sync_primary_trip_host()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_trip_id uuid := case when tg_op = 'DELETE' then old.trip_id else new.trip_id end;
  v_current_primary uuid;
  v_new_primary uuid;
begin
  select host_id into v_current_primary from public.group_trips where id = v_trip_id;
  -- Still a host? nothing to do.
  if exists (
    select 1 from public.group_trip_participants
    where trip_id = v_trip_id and user_id = v_current_primary and role = 'host'
  ) then
    return null;
  end if;
  -- Reassign to the longest-tenured remaining host (I1 guarantees one exists).
  select user_id into v_new_primary
  from public.group_trip_participants
  where trip_id = v_trip_id and role = 'host'
  order by role_granted_at asc, user_id asc
  limit 1;
  if v_new_primary is not null then
    update public.group_trips set host_id = v_new_primary where id = v_trip_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_sync_primary_trip_host on public.group_trip_participants;
create trigger trg_sync_primary_trip_host
  after update or delete on public.group_trip_participants
  for each row execute function public.sync_primary_trip_host();

-- I2 guard on the other side: a direct write to group_trips.host_id must land
-- on a current host. (Internal reassignment above always satisfies this.)
create or replace function public.guard_primary_trip_host()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if new.host_id is distinct from old.host_id then
    if not exists (
      select 1 from public.group_trip_participants
      where trip_id = new.id and user_id = new.host_id and role = 'host'
    ) then
      raise exception 'host_id must reference a current host of the trip'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_primary_trip_host on public.group_trips;
create trigger trg_guard_primary_trip_host
  before update on public.group_trips
  for each row execute function public.guard_primary_trip_host();

-- ── 6. Rewrite every host_id-based policy to is_trip_host ────────────────────
-- group_trips
drop policy if exists "group_trips host can update" on public.group_trips;
create policy "group_trips host can update" on public.group_trips
  for update using (public.is_trip_host(id)) with check (public.is_trip_host(id));
drop policy if exists "group_trips host can delete" on public.group_trips;
create policy "group_trips host can delete" on public.group_trips
  for delete using (public.is_trip_host(id));

-- group_trip_participants
--   I3: role immutable via client UPDATE; only own row, role unchanged.
drop policy if exists "group_trip_participants user updates self" on public.group_trip_participants;
create policy "group_trip_participants user updates self" on public.group_trip_participants
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and role = (
      select p.role from public.group_trip_participants p
      where p.trip_id = group_trip_participants.trip_id and p.user_id = group_trip_participants.user_id
    )
  );
--   DELETE: self-leave OR any host removes.
drop policy if exists "group_trip_participants user leaves self or host removes" on public.group_trip_participants;
create policy "group_trip_participants user leaves self or host removes" on public.group_trip_participants
  for delete using (auth.uid() = user_id or public.is_trip_host(trip_id));
--   INSERT: self, and only with an approved join request OR as the trip creator
--   (the createGroupTrip host row; group_trips INSERT already gates host_id=uid).
drop policy if exists "group_trip_participants user joins self" on public.group_trip_participants;
create policy "group_trip_participants user joins self" on public.group_trip_participants
  for insert with check (
    auth.uid() = user_id
    and (
      exists (
        select 1 from public.group_trip_join_requests jr
        where jr.trip_id = group_trip_participants.trip_id
          and jr.requester_id = auth.uid() and jr.status = 'approved'
      )
      or auth.uid() = (select host_id from public.group_trips where id = group_trip_participants.trip_id)
    )
  );

-- group_trip_join_requests
drop policy if exists "join_requests readable by requester or host" on public.group_trip_join_requests;
create policy "join_requests readable by requester or host" on public.group_trip_join_requests
  for select using (auth.uid() = requester_id or public.is_trip_host(trip_id));
drop policy if exists "join_requests requester can insert pending" on public.group_trip_join_requests;
create policy "join_requests requester can insert pending" on public.group_trip_join_requests
  for insert with check (
    auth.uid() = requester_id and status = 'pending' and not public.is_trip_host(trip_id)
  );
drop policy if exists "join_requests host can review" on public.group_trip_join_requests;
create policy "join_requests host can review" on public.group_trip_join_requests
  for update using (public.is_trip_host(trip_id))
  with check (public.is_trip_host(trip_id) and status = any (array['approved','declined']));
drop policy if exists "join_requests host or requester can delete" on public.group_trip_join_requests;
create policy "join_requests host or requester can delete" on public.group_trip_join_requests
  for delete using (auth.uid() = requester_id or public.is_trip_host(trip_id));
-- ("join_requests requester can withdraw" UPDATE is requester-only — unchanged.)

-- group_trip_commitment_requests
drop policy if exists "gtcr select" on public.group_trip_commitment_requests;
create policy "gtcr select" on public.group_trip_commitment_requests
  for select using (auth.uid() = user_id or public.is_trip_host(trip_id));
drop policy if exists "gtcr update host or self supersede" on public.group_trip_commitment_requests;
create policy "gtcr update host or self supersede" on public.group_trip_commitment_requests
  for update using (public.is_trip_host(trip_id) or auth.uid() = user_id)
  with check (public.is_trip_host(trip_id) or auth.uid() = user_id);
-- ("gtcr insert self" INSERT is user-only — unchanged.)

-- group_trip_gear_items
drop policy if exists "gear_items host can insert" on public.group_trip_gear_items;
create policy "gear_items host can insert" on public.group_trip_gear_items
  for insert with check (auth.uid() = created_by and public.is_trip_host(trip_id));
drop policy if exists "gear_items host can update" on public.group_trip_gear_items;
create policy "gear_items host can update" on public.group_trip_gear_items
  for update using (public.is_trip_host(trip_id)) with check (public.is_trip_host(trip_id));
drop policy if exists "gear_items host can delete" on public.group_trip_gear_items;
create policy "gear_items host can delete" on public.group_trip_gear_items
  for delete using (public.is_trip_host(trip_id));

-- group_trip_gear_requests
drop policy if exists "gear_requests host can review" on public.group_trip_gear_requests;
create policy "gear_requests host can review" on public.group_trip_gear_requests
  for update using (public.is_trip_host(trip_id)) with check (public.is_trip_host(trip_id));
-- (insert / withdraw are requester-based — unchanged.)

-- group_trip_admin_updates
drop policy if exists "admin_updates host can insert" on public.group_trip_admin_updates;
create policy "admin_updates host can insert" on public.group_trip_admin_updates
  for insert with check (auth.uid() = author_id and public.is_trip_host(trip_id));
drop policy if exists "admin_updates host can update" on public.group_trip_admin_updates;
create policy "admin_updates host can update" on public.group_trip_admin_updates
  for update using (public.is_trip_host(trip_id)) with check (public.is_trip_host(trip_id));
drop policy if exists "admin_updates host can delete" on public.group_trip_admin_updates;
create policy "admin_updates host can delete" on public.group_trip_admin_updates
  for delete using (public.is_trip_host(trip_id));

-- ── 7. Role-change RPCs (the ONLY way role changes; I3 blocks direct writes) ─
create or replace function public.promote_trip_host(p_trip_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not public.is_trip_host(p_trip_id) then
    raise exception 'Only a host can promote' using errcode = 'insufficient_privilege';
  end if;
  update public.group_trip_participants
    set role = 'host', role_granted_at = now()
    where trip_id = p_trip_id and user_id = p_user_id and role <> 'host';
  if not found then
    -- Either already a host (no-op ok) or not a participant (error).
    if not exists (
      select 1 from public.group_trip_participants
      where trip_id = p_trip_id and user_id = p_user_id
    ) then
      raise exception 'That user is not a participant of this trip'
        using errcode = 'no_data_found';
    end if;
  end if;
end;
$$;
revoke execute on function public.promote_trip_host(uuid, uuid) from public, anon;
grant execute on function public.promote_trip_host(uuid, uuid) to authenticated;

create or replace function public.demote_trip_host(p_trip_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not public.is_trip_host(p_trip_id) then
    raise exception 'Only a host can demote' using errcode = 'insufficient_privilege';
  end if;
  -- The >=1-host trigger (I1) rejects demoting the last host.
  update public.group_trip_participants
    set role = 'member'
    where trip_id = p_trip_id and user_id = p_user_id and role = 'host';
end;
$$;
revoke execute on function public.demote_trip_host(uuid, uuid) from public, anon;
grant execute on function public.demote_trip_host(uuid, uuid) to authenticated;

-- ── 8. Notification fan-out: trip_admin_ids already unions role='admin' (never
--       matches). Point it at 'host' so all hosts receive join/commit/gear pushes ─
create or replace function public.trip_admin_ids(p_trip_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select array_agg(distinct uid)
  from (
    select host_id as uid from public.group_trips where id = p_trip_id
    union
    select user_id from public.group_trip_participants
      where trip_id = p_trip_id and role = 'host'
  ) x
  where uid is not null;
$$;

commit;
```

- [ ] **Step 2: Apply the migration**

Do NOT auto-apply. Hand to Ohad to paste into the Supabase SQL editor. He confirms it runs clean (single transaction — a failure rolls back the whole thing).

- [ ] **Step 3: Verify with the query battery**

Run each against prod (read-only) after apply. Expected results inline:

```sql
-- (a) role_granted_at present & backfilled for hosts
select count(*) as hosts_missing_grant
from group_trip_participants where role='host' and role_granted_at is null;   -- 0

-- (b) every trip still has exactly one host_id and >=1 host participant
select count(*) as bad_trips from group_trips t
where not exists (select 1 from group_trip_participants p
  where p.trip_id=t.id and p.user_id=t.host_id and p.role='host');            -- 0

-- (c) RPCs not executable by anon
select p.proname,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
  ('promote_trip_host','demote_trip_host','is_trip_host');                    -- anon_can = false for all

-- (d) trip_admin_ids now returns all hosts (pick any real trip id)
select public.trip_admin_ids('<some-trip-id>');                              -- array incl. every host
```

Negative checks (run as an authenticated non-host — Ohad does this from a second account, or via a service query simulating a uid; describe rather than auto-run):
- A member `update group_trip_participants set role='host' where user_id=<self>` → **blocked** by I3 WITH CHECK.
- A non-participant `insert into group_trip_participants(...)` for a trip with no approved request → **blocked** by INSERT policy.
- `select promote_trip_host('<trip>','<user>')` as a non-host → **raises** insufficient_privilege.
- Demoting the sole host → **raises** "A trip must have at least one host".

- [ ] **Step 4: Commit the migration file** (Ohad commits; do not auto-commit)

```bash
git add supabase/migrations/20260708000000_group_trip_multiple_hosts.sql
```

---

## Task 2: `isTripHost` helper — single source of truth

**Files:**
- Create: `src/utils/tripRole.ts`
- Test: `src/utils/__tests__/tripRole.test.ts`

**Interfaces:**
- Produces: `isTripHost(trip: { host_id: string } | null | undefined, participants: { user_id: string; role: 'host' | 'member' }[], userId: string | null | undefined): boolean`
- Consumes: nothing.

Definition matters: it returns true if the user is `host_id` **or** holds `role='host'` in participants. The `host_id` clause makes the primary host resolve instantly during the placeholder window (before participants load, when `participants` is `[]`); the participants clause resolves co-hosts once loaded. Both, deliberately.

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/__tests__/tripRole.test.ts
import { isTripHost } from '../tripRole';

const P = (user_id: string, role: 'host' | 'member') => ({ user_id, role });

describe('isTripHost', () => {
  it('is false when userId is null', () => {
    expect(isTripHost({ host_id: 'a' }, [P('a', 'host')], null)).toBe(false);
  });
  it('is true for the primary host even before participants load', () => {
    expect(isTripHost({ host_id: 'a' }, [], 'a')).toBe(true);
  });
  it('is true for a co-host present only in participants', () => {
    expect(isTripHost({ host_id: 'a' }, [P('a', 'host'), P('b', 'host')], 'b')).toBe(true);
  });
  it('is false for a plain member', () => {
    expect(isTripHost({ host_id: 'a' }, [P('a', 'host'), P('c', 'member')], 'c')).toBe(false);
  });
  it('is false for a non-participant', () => {
    expect(isTripHost({ host_id: 'a' }, [P('a', 'host')], 'z')).toBe(false);
  });
  it('is false when trip is null and user not in participants', () => {
    expect(isTripHost(null, [], 'a')).toBe(false);
  });
  it('is true when trip is null but user is a host participant', () => {
    expect(isTripHost(null, [P('a', 'host')], 'a')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/utils/__tests__/tripRole.test.ts`
Expected: FAIL — `Cannot find module '../tripRole'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/utils/tripRole.ts
// Single source of truth for "is this user a host of this trip".
// Any host (not only the creator) returns true. The host_id branch keeps the
// primary host resolving during the placeholder window, before participants load.
export function isTripHost(
  trip: { host_id: string } | null | undefined,
  participants: { user_id: string; role: 'host' | 'member' }[],
  userId: string | null | undefined,
): boolean {
  if (!userId) return false;
  if (trip?.host_id === userId) return true;
  return participants.some(p => p.user_id === userId && p.role === 'host');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/utils/__tests__/tripRole.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit** (Ohad)

```bash
git add src/utils/tripRole.ts src/utils/__tests__/tripRole.test.ts
```

---

## Task 3: Swap the six `isHost` call sites onto the helper

**Files:**
- Modify: `src/hooks/trips/useTripDetail.ts:94`
- Modify: `src/screens/trips/TripDetailScreen.tsx:353`
- Modify: `src/screens/trips/TripMembersScreen.tsx:89`
- Modify: `src/screens/trips/YourGearScreen.tsx:66`
- Modify: `src/screens/trips/PackingAndGearScreen.tsx:64`
- Modify: `src/screens/trips/TripUpdatesScreen.tsx:78`

**Interfaces:**
- Consumes: `isTripHost` from `src/utils/tripRole.ts` (Task 2).

Each site currently reads `trip.host_id === currentUserId`. Each has `participants` in scope from `useTripCore`/`useTripCore(...).data`. Verify `participants` is available at each site before editing; every one of these screens already destructures it (TripMembersScreen `:86`, others via the same hook). Where a screen does not already have `participants`, pull it from the same `coreQuery.data?.participants ?? []` it already uses for other data.

- [ ] **Step 1: `useTripDetail.ts` — replace line 94**

The function `fetchTripCore` has `participantsData` in scope.

```ts
// was: const userIsHost = !!currentUserId && tripData.host_id === currentUserId;
const userIsHost = isTripHost(tripData, participantsData, currentUserId);
```
Add at top: `import { isTripHost } from '../../utils/tripRole';`

- [ ] **Step 2: `TripMembersScreen.tsx` — replace line 89**

```ts
// was: const isHost = !!trip && !!currentUserId && trip.host_id === currentUserId;
const isHost = isTripHost(trip, participants, currentUserId);
```
Add: `import { isTripHost } from '../../utils/tripRole';`

- [ ] **Step 3: `TripDetailScreen.tsx` — replace line 353**

```ts
// was: const isHostDerived = !!trip && !!currentUserId && trip.host_id === currentUserId;
const isHostDerived = isTripHost(trip, participants, currentUserId);
```
Add: `import { isTripHost } from '../../utils/tripRole';` (confirm `participants` is in scope; TripDetailScreen reads it from `useTripCore`).

- [ ] **Step 4: `YourGearScreen.tsx`, `PackingAndGearScreen.tsx`, `TripUpdatesScreen.tsx` — replace their `isHost` line**

Same substitution in each:
```ts
const isHost = isTripHost(trip, participants, currentUserId);
```
Add the import (`../../utils/tripRole`). For each file, first confirm `participants` is destructured from the trip-core query; if a file only has `trip`, add `const participants = coreQuery.data?.participants ?? [];` next to where `trip` is read (matching that file's variable name for the core query).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit** (Ohad)

---

## Task 4: `promoteTripHost` / `demoteTripHost` service wrappers

**Files:**
- Modify: `src/services/trips/groupTripsService.ts` (add near `removeParticipant`, ~`:1482`)

**Interfaces:**
- Consumes: RPCs from Task 1.
- Produces: `promoteTripHost(tripId: string, userId: string): Promise<void>`, `demoteTripHost(tripId: string, userId: string): Promise<void>`.

- [ ] **Step 1: Add both functions**

```ts
/** Promote a participant to host. Server verifies the caller is a host (RPC). */
export async function promoteTripHost(tripId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('promote_trip_host', {
    p_trip_id: tripId,
    p_user_id: userId,
  });
  if (error) {
    console.error('[groupTripsService] promoteTripHost error:', error);
    throw new Error(error.message);
  }
}

/** Demote a host back to member. Server rejects removing the last host (trigger). */
export async function demoteTripHost(tripId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('demote_trip_host', {
    p_trip_id: tripId,
    p_user_id: userId,
  });
  if (error) {
    console.error('[groupTripsService] demoteTripHost error:', error);
    throw new Error(error.message);
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit** (Ohad)

---

## Task 5: `SheetOptionRow` reusable row

**Files:**
- Create: `src/components/sheets/SheetOptionRow.tsx`

**Interfaces:**
- Produces: `SheetOptionRow` — props `{ icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean }`.

Modeled on the inline rows in `surftrips/ParticipantMenuSheet.tsx:92-106`; neutral ink `#222B30`, destructive red `#C0392B`, icon size 20, `ff('Inter','400')` label.

- [ ] **Step 1: Write the component**

```tsx
// src/components/sheets/SheetOptionRow.tsx
import React from 'react';
import { Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ff } from '../../theme/fonts';

interface Props {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
}

export function SheetOptionRow({ icon, label, onPress, danger = false }: Props) {
  const color = danger ? '#C0392B' : '#222B30';
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={20} color={color} />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, paddingHorizontal: 20 },
  label: { fontFamily: ff('Inter', '400'), fontSize: 16, includeFontPadding: false },
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit** (Ohad)

---

## Task 6: `TripMemberSheet`

**Files:**
- Create: `src/components/trips/TripMemberSheet.tsx`

**Interfaces:**
- Consumes: `BottomSheetShell` (`src/components/BottomSheetShell.tsx`), `SheetOptionRow` (Task 5), `Thumb` (`src/components/Thumb`), `EnrichedParticipant` (`groupTripsService`).
- Produces: `TripMemberSheet` — props below. It renders options only; it performs no data writes itself — the parent supplies `onSetAdmin`/`onRemoveAdmin`/`onRemove`/`onViewProfile`/`onMessage` and owns confirmation + RPC calls.

```ts
interface TripMemberSheetProps {
  visible: boolean;
  member: EnrichedParticipant | null;
  viewerIsHost: boolean;
  isSelf: boolean;
  onClose: () => void;
  onViewProfile: (userId: string) => void;
  onMessage: (userId: string, name?: string, avatar?: string | null) => void;
  onSetAdmin: (member: EnrichedParticipant) => void;
  onRemoveAdmin: (member: EnrichedParticipant) => void;
  onRemove: (member: EnrichedParticipant) => void;
}
```

Row visibility (matches the spec table):
- Always (any viewer, any target): `View profile`, `Message`.
- Only when `viewerIsHost && !isSelf`:
  - target is a member → `Set as admin` + `Remove from trip` (red)
  - target is a host → `Remove as admin` + `Remove from trip` (red)

The sheet is never opened for your own row (the screen won't attach a chevron there), but `isSelf` guards the admin actions defensively.

- [ ] **Step 1: Write the component**

```tsx
// src/components/trips/TripMemberSheet.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetShell } from '../BottomSheetShell';
import { SheetOptionRow } from '../sheets/SheetOptionRow';
import Thumb from '../Thumb';
import { ff } from '../../theme/fonts';
import type { EnrichedParticipant } from '../../services/trips/groupTripsService';

interface Props {
  visible: boolean;
  member: EnrichedParticipant | null;
  viewerIsHost: boolean;
  isSelf: boolean;
  onClose: () => void;
  onViewProfile: (userId: string) => void;
  onMessage: (userId: string, name?: string, avatar?: string | null) => void;
  onSetAdmin: (member: EnrichedParticipant) => void;
  onRemoveAdmin: (member: EnrichedParticipant) => void;
  onRemove: (member: EnrichedParticipant) => void;
}

const timeAgo = (iso: string | null): string => {
  if (!iso) return '';
  const day = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (day <= 0) return 'Joined today';
  if (day < 7) return `Joined ${day} day${day === 1 ? '' : 's'} ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `Joined ${wk} week${wk === 1 ? '' : 's'} ago`;
  const mo = Math.floor(day / 30);
  return `Joined ${mo} month${mo === 1 ? '' : 's'} ago`;
};

export function TripMemberSheet({
  visible, member, viewerIsHost, isSelf, onClose,
  onViewProfile, onMessage, onSetAdmin, onRemoveAdmin, onRemove,
}: Props) {
  const m = member;
  const wrap = (fn: () => void) => () => { onClose(); fn(); };
  const canManage = viewerIsHost && !isSelf && !!m;

  return (
    <BottomSheetShell visible={visible} onClose={onClose}>
      <View style={styles.sheet}>
        {m ? (
          <View style={styles.header}>
            {m.profile_image_url ? (
              <Thumb uri={m.profile_image_url} size={128} style={styles.avatar} contentFit="cover" cachePolicy="memory-disk" />
            ) : (
              <View style={[styles.avatar, styles.avatarEmpty]}>
                <Ionicons name="person" size={34} color="#FFFFFF" />
              </View>
            )}
            <Text style={styles.name} numberOfLines={1}>{m.name ?? 'User'}</Text>
            <Text style={styles.sub} numberOfLines={1}>{timeAgo(m.joined_at)}</Text>
          </View>
        ) : null}

        {m ? (
          <View style={styles.group}>
            <SheetOptionRow icon="person-outline" label="View profile" onPress={wrap(() => onViewProfile(m.user_id))} />
            <SheetOptionRow icon="chatbubble-outline" label="Message" onPress={wrap(() => onMessage(m.user_id, m.name ?? undefined, m.profile_image_url))} />
            {canManage && m.role === 'member' ? (
              <SheetOptionRow icon="shield-checkmark-outline" label="Set as admin" onPress={wrap(() => onSetAdmin(m))} />
            ) : null}
            {canManage && m.role === 'host' ? (
              <SheetOptionRow icon="shield-outline" label="Remove as admin" onPress={wrap(() => onRemoveAdmin(m))} />
            ) : null}
            {canManage ? (
              <SheetOptionRow icon="person-remove-outline" label="Remove from trip" danger onPress={wrap(() => onRemove(m))} />
            ) : null}
          </View>
        ) : null}
      </View>
    </BottomSheetShell>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 24, paddingBottom: 12 },
  header: { alignItems: 'center', paddingHorizontal: 20, marginBottom: 12 },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  avatarEmpty: { backgroundColor: '#C9CED2', alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: ff('Montserrat', '700'), fontSize: 18, color: '#212121', marginTop: 12, includeFontPadding: false },
  sub: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#7B7B7B', marginTop: 4, includeFontPadding: false },
  group: { marginTop: 4 },
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit** (Ohad)

---

## Task 7: Wire `onMessage` through the nav context

**Files:**
- Modify: `src/navigation/MainNavContext.tsx:76-84`
- Modify: `src/components/AppContent.tsx:1803-1806`
- Modify: `src/navigation/RootNavigator.tsx:182-192`

**Interfaces:**
- Consumes: `stableHandlers.onStartConversation` (already exists, `AppContent.tsx:1770`).
- Produces: `tripCard.onStartConversation(userId, name?, avatar?)` available to `TripMembersScreen` as an `onMessage` prop.

- [ ] **Step 1: Extend the `tripCard` type in `MainNavContext.tsx`**

```ts
  tripCard: {
    onOpenGroupChat: (params: {
      conversationId: string;
      title: string;
      heroImageUrl?: string | null;
      tripId?: string;
    }) => void;
    onViewUserProfile: (userId: string, fromTripId: string) => void;
    onStartConversation: (userId: string, otherUserName?: string, otherUserAvatar?: string | null) => void;
  };
```

- [ ] **Step 2: Provide it in `AppContent.tsx` (`mainNavValue.tripCard`)**

```ts
    tripCard: {
      onOpenGroupChat: handleOpenGroupChat,
      onViewUserProfile: stableHandlers.onViewUserProfileFromTrip,
      onStartConversation: stableHandlers.onStartConversation,
    },
```

- [ ] **Step 3: Thread into `TripMembersScreen` in `RootNavigator.tsx`**

```tsx
function TripMembersCardScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'TripMembers'>) {
  const { tripCard } = useMainNav();
  const { tripId } = route.params;
  return (
    <TripMembersScreen
      tripId={tripId}
      onBack={() => navigation.goBack()}
      onViewUserProfile={userId => tripCard.onViewUserProfile(userId, tripId)}
      onMessage={tripCard.onStartConversation}
      onReviewRequest={(userId, requestId) =>
        navigation.dispatch(
          StackActions.push('ProfileCard', { userId, joinRequest: { tripId, requestId } })
        )
      }
    />
  );
}
```

- [ ] **Step 4: Type-check** (will fail until Task 8 adds the `onMessage` prop — that's expected; run after Task 8)

- [ ] **Step 5: Commit together with Task 8** (Ohad)

---

## Task 8: TripMembersScreen — chevron + sheet, delete inline Remove

**Files:**
- Modify: `src/screens/trips/TripMembersScreen.tsx`

**Interfaces:**
- Consumes: `TripMemberSheet` (Task 6), `promoteTripHost`/`demoteTripHost`/`removeParticipant` (Task 4 + existing), `isTripHost` (Task 2, done in Task 3), `onMessage` prop (Task 7).

Behaviour changes:
- Add `onMessage` to `Props`.
- Delete the inline text `Remove` button and the `handleRemove`/`removingId`/`showRemove`/`canRemove`/`tappable` machinery tied to it.
- The whole participant row becomes a `Pressable` that opens the sheet — **except the current user's own row**, which shows no chevron and is inert.
- Render a `chevron-forward` (size 20, `#C4C4C4`) at the row's trailing edge for every row except your own.
- Hold sheet state: `const [sheetMember, setSheetMember] = useState<EnrichedParticipant | null>(null);`
- Confirmation + RPC handlers live here (promote/demote/remove), each via `Alert.alert`, errors via `friendlyErrorMessage`.

- [ ] **Step 1: Add `onMessage` to `Props`**

```ts
interface Props {
  tripId: string;
  onBack: () => void;
  onViewUserProfile?: (userId: string) => void;
  /** Start (or open) a DM with this user. */
  onMessage?: (userId: string, name?: string, avatar?: string | null) => void;
  onReviewRequest?: (userId: string, requestId: string) => void;
}
```
And destructure `onMessage` in the signature.

- [ ] **Step 2: Add imports + sheet state, delete old remove machinery**

Add imports:
```ts
import { removeParticipant, promoteTripHost, demoteTripHost } from '../../services/trips/groupTripsService';
import { TripMemberSheet } from '../../components/trips/TripMemberSheet';
```
(remove the old `removeParticipant`-only import line — merge it as above).

Delete lines 97-98 (`canRemove`) is no longer used as a row gate — but `isHost` stays (from Task 3). Delete `const [removingId, setRemovingId] = useState<string | null>(null);` and the whole `handleRemove` function (lines 114-140).

Add:
```ts
const [sheetMember, setSheetMember] = useState<EnrichedParticipant | null>(null);

const confirmSetAdmin = (m: EnrichedParticipant) => {
  Alert.alert(
    `Set ${m.name ?? 'this member'} as admin?`,
    'Admins can edit this trip, approve requests, remove members, and delete the trip.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Set as admin',
        onPress: async () => {
          try {
            await promoteTripHost(tripId, m.user_id);
            await queryClient.invalidateQueries({ queryKey: tripsKeys.detail(tripId) });
          } catch (e: any) {
            Alert.alert('Could not update', friendlyErrorMessage(e, 'Please try again.'));
          }
        },
      },
    ],
  );
};

const confirmRemoveAdmin = (m: EnrichedParticipant) => {
  Alert.alert(
    `Remove ${m.name ?? 'this member'} as admin?`,
    'They stay on the trip as a member and lose admin controls.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove as admin',
        style: 'destructive',
        onPress: async () => {
          try {
            await demoteTripHost(tripId, m.user_id);
            await queryClient.invalidateQueries({ queryKey: tripsKeys.detail(tripId) });
          } catch (e: any) {
            Alert.alert('Could not update', friendlyErrorMessage(e, 'Please try again.'));
          }
        },
      },
    ],
  );
};

const confirmRemove = (m: EnrichedParticipant) => {
  Alert.alert(
    'Remove from trip',
    `Remove ${m.name ?? 'this member'} from the trip? They lose access to the plan and group chat.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeParticipant(tripId, m.user_id);
            await queryClient.invalidateQueries({ queryKey: tripsKeys.detail(tripId) });
          } catch (e: any) {
            Alert.alert('Could not remove', friendlyErrorMessage(e, 'Please try again.'));
          }
        },
      },
    ],
  );
};
```

- [ ] **Step 3: Rewrite the participant row (replace lines 240-303 block)**

```tsx
{participants.map((p, i) => {
  const thumb = p.profile_image_url;
  const isOwnRow = p.user_id === currentUserId;
  return (
    <Pressable
      key={p.user_id}
      onPress={isOwnRow ? undefined : () => setSheetMember(p)}
      disabled={isOwnRow}
      style={[styles.row, i < participants.length - 1 && styles.rowDivider]}
      accessibilityRole={isOwnRow ? undefined : 'button'}
      accessibilityLabel={p.name ? `Open options for ${p.name}` : undefined}
    >
      <View style={styles.avatarWrap}>
        {thumb ? (
          <Thumb uri={thumb} size={96} style={styles.avatar} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          <View style={[styles.avatar, styles.avatarEmpty]}>
            <Ionicons name="person" size={26} color="#FFFFFF" />
          </View>
        )}
        {p.role === 'host' ? (
          <View style={styles.badge}><AdminBadgeIcon size={22} /></View>
        ) : canSeeCommitted && p.committed ? (
          <View style={styles.badge}><CommittedPassportIcon size={22} /></View>
        ) : null}
      </View>

      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={1}>{p.name ?? '—'}</Text>
        <Text style={styles.joined} numberOfLines={1}>{formatJoined(p.joined_at)}</Text>
      </View>

      {!isOwnRow ? (
        <Ionicons name="chevron-forward" size={20} color="#C4C4C4" />
      ) : null}
    </Pressable>
  );
})}
```

- [ ] **Step 4: Mount the sheet before the closing `</SafeAreaView>`**

```tsx
      <TripMemberSheet
        visible={!!sheetMember}
        member={sheetMember}
        viewerIsHost={isHost}
        isSelf={sheetMember?.user_id === currentUserId}
        onClose={() => setSheetMember(null)}
        onViewProfile={userId => onViewUserProfile?.(userId)}
        onMessage={(userId, name, avatar) => onMessage?.(userId, name, avatar)}
        onSetAdmin={confirmSetAdmin}
        onRemoveAdmin={confirmRemoveAdmin}
        onRemove={confirmRemove}
      />
```

- [ ] **Step 5: Delete the now-unused `remove` style** (`styles.remove`, line 383) — leave `T.remove` (still referenced? grep; if not, remove it too).

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors (Task 7's `onMessage` prop now satisfied).

- [ ] **Step 7: Commit Tasks 7+8 together** (Ohad)

---

## Task 9: Edge functions — host_id check → host-set check

**Files:**
- Modify: `supabase/functions/send-trip-removed-notification/index.ts:89-97`
- Modify: `supabase/functions/geocode-group-trip-destinations/index.ts:178-188`

**Interfaces:** none new. Both query `group_trip_participants` for the caller's host row instead of comparing `group_trips.host_id`.

- [ ] **Step 1: `send-trip-removed-notification/index.ts` — replace lines 89-97**

```ts
    const { data: hostRow } = await supabase
      .from('group_trip_participants')
      .select('user_id')
      .eq('trip_id', tripId)
      .eq('user_id', user.id)
      .eq('role', 'host')
      .maybeSingle();
    if (!hostRow) {
      console.warn(`[Trip Removed Notif] [${reqId}] Forbidden: ${user.id} is not a host of ${tripId}`);
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
```

- [ ] **Step 2: `geocode-group-trip-destinations/index.ts` — replace lines 178-188**

```ts
      const { data: hostRow, error: hostErr } = await supabaseAdmin
        .from('group_trip_participants')
        .select('user_id')
        .eq('trip_id', trip_id)
        .eq('user_id', user.id)
        .eq('role', 'host')
        .maybeSingle()
      if (hostErr || !hostRow) {
        return new Response(
          JSON.stringify({ error: 'Forbidden: only a trip host can enrich this destination' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
```

- [ ] **Step 3: Deploy** — Ohad copy-pastes each into the Supabase dashboard, after download+diff against the live version (they may have drifted).

- [ ] **Step 4: Commit** (Ohad)

---

## Task 10: Full verification

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Run the affected tests**

Run: `npx jest src/utils/__tests__/tripRole.test.ts`
Expected: PASS.

- [ ] **Step 3: Confirm no stale `host_id === currentUserId` derivations remain**

Run: `grep -rn "host_id === currentUserId\|host_id === userId\|host_id === contextUser" src/`
Expected: no matches (all six moved to `isTripHost`).

- [ ] **Step 4: Device checks (Ohad)** — per the spec's acceptance list:
  - Row → chevron → sheet with avatar/name/joined header
  - `Set as admin` → confirm → promoted member gains Edit/approve controls
  - `View profile` + `Message` work from the sheet; row tap no longer opens a profile directly
  - A member sees the chevron; their sheet shows only View profile + Message
  - Own row shows no chevron, inert
  - Two admins both get the join-request push + badge; first to approve wins
  - Removing the last admin is blocked with the friendly message

---

## Self-Review

**Spec coverage:**
- Reuse `'host'`, no new role → Task 1 keeps the check constraint. ✓
- Any host promotes; fully flat → `promote_trip_host`/`demote_trip_host` gate only on `is_trip_host`, no creator special-case. ✓
- `host_id` reassigned to longest-tenured host → I2 trigger + `role_granted_at`. ✓
- All hosts notified → `trip_admin_ids` `'admin'`→`'host'`. ✓
- No promotion notification → nothing added. ✓
- Row → arrow → sheet; own row inert → Task 8. ✓
- Row tap no longer opens profile → Task 8 removes it; `View profile` in sheet. ✓
- Last host cannot leave/demote → I1 trigger. ✓
- Two security holes closed → I3 UPDATE check + tightened INSERT. ✓
- Single `isHost` source → Task 2 + Task 3. ✓
- `SheetOptionRow` extracted; surftrips untouched → Task 5, out-of-scope note honored. ✓
- Two edge functions → Task 9; dead `send-trip-request-notification` left alone. ✓
- DB word `host` / UI word "admin" → Task 8 strings + AdminBadgeIcon unchanged. ✓

**Placeholder scan:** none — every code step carries full code.

**Type consistency:** `isTripHost(trip, participants, userId)` signature identical across Tasks 2/3. `promoteTripHost`/`demoteTripHost` names identical across Tasks 4/8. `TripMemberSheet` prop names identical across Tasks 6/8. RPC param names `p_trip_id`/`p_user_id` identical across Task 1 SQL and Task 4 wrappers. ✓
