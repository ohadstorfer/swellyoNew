# Trip Invites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a trip host, from `TripMembersScreen`, browse surfers whose profile aligns with the trip (age, board type, surf level, origin country), invite them, and have the invited user accept/decline via a notification — joining the trip on accept.

**Architecture:** New `trip_invites` table + SECURITY DEFINER trigger (mirrors the existing `group_trip_join_requests` → `notifications` → `notification_queue` pipeline, just in the opposite direction: host invites, invitee decides). A new, dedicated scoring function (`scoreCandidateForTrip`) computes alignment — this does **not** call `matchingServiceV3` (that file is explicitly unshipped/experimental per project convention; entangling a shipped feature with it would be a regression risk). New `InviteMembersSheet` uses `BottomSheetShell` (the current sheet convention), not the older hand-rolled `Modal` pattern seen in `AddMembersSheet`.

**Tech Stack:** React Native/Expo, Supabase (Postgres + RLS + SQL triggers), react-query (`tripsKeys`), existing `NotificationCenter` / `notificationsService`.

## Global Constraints

- Migrations are applied by hand via the Supabase SQL editor, never `supabase db push` (project convention).
- Every new SECURITY DEFINER function must pin `search_path = public`.
- Adding enum values (`alter type ... add value`) must be its own migration, applied and committed *before* any migration that references the new value in a function body (Postgres rule: new enum values aren't visible in the same transaction that adds them).
- New sheets must use `BottomSheetShell` (`src/components/sheets/BottomSheetShell.tsx` per project convention), not a hand-rolled `Modal`.
- Do not touch `matchingServiceV3.ts`, `group_trip_join_requests`, or the existing join-request flow — this is a fully parallel, additive feature.
- No bulk-invite, no invite expiry — explicitly out of scope per spec.

---

## File Map

- Create: `supabase/migrations/20260713000000_trip_invites_enum.sql` — adds 3 `notification_type` enum values.
- Create: `supabase/migrations/20260713000100_trip_invites.sql` — `trip_invites` table, RLS, trigger, push-priority branch.
- Create: `src/services/trips/tripInvitesService.ts` — CRUD + candidate listing.
- Create: `src/services/trips/tripInviteMatching.ts` — scoring function.
- Create: `src/components/trips/InviteMembersSheet.tsx` — host-facing invite UI.
- Create: `src/components/trips/TripInviteResponseSheet.tsx` — invitee-facing accept/decline UI.
- Modify: `src/screens/trips/TripMembersScreen.tsx` — add "Invite" button + sheet wiring.
- Modify: `src/services/notifications/notificationsService.ts` — routing/render cases.
- Modify: `src/components/notifications/NotificationCenter.tsx` — tap routing for invite notifications.

---

### Task 1: Migration — enum values

**Files:**
- Create: `supabase/migrations/20260713000000_trip_invites_enum.sql`

**Interfaces:**
- Produces: enum values `trip_invite_received`, `trip_invite_accepted`, `trip_invite_declined` on `public.notification_type`, consumed by Task 2's trigger and Task 7's routing.

- [ ] **Step 1: Write the migration**

```sql
-- 20260713000000_trip_invites_enum.sql
alter type public.notification_type add value if not exists 'trip_invite_received';
alter type public.notification_type add value if not exists 'trip_invite_accepted';
alter type public.notification_type add value if not exists 'trip_invite_declined';
```

- [ ] **Step 2: Apply via Supabase SQL editor**

Paste the file contents into the SQL editor of the project's Supabase dashboard and run. Confirm no error (enum add is idempotent via `if not exists`, safe to re-run).

- [ ] **Step 3: Verify**

Run in SQL editor:
```sql
select enum_range(null::public.notification_type);
```
Expected: array includes `trip_invite_received`, `trip_invite_accepted`, `trip_invite_declined`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260713000000_trip_invites_enum.sql
git commit -m "feat(db): add trip_invite notification_type enum values"
```

---

### Task 2: Migration — `trip_invites` table, RLS, trigger, push mapping

**Files:**
- Create: `supabase/migrations/20260713000100_trip_invites.sql`

**Interfaces:**
- Consumes: `public.notifications` table shape (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data), `public.user_display_name(uuid)` helper — both from `20260601010000_notification_center.sql`. Enum values from Task 1.
- Produces: table `public.trip_invites(id, trip_id, invited_user_id, invited_by, status, created_at, responded_at)`, callable only after Task 1 is applied.

- [ ] **Step 1: Write the migration**

```sql
-- 20260713000100_trip_invites.sql

create table if not exists public.trip_invites (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.group_trips(id) on delete cascade,
  invited_user_id uuid not null references public.users(id) on delete cascade,
  invited_by uuid not null references public.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (trip_id, invited_user_id)
);

alter table public.trip_invites enable row level security;

-- host can see/manage invites for trips they host
create policy trip_invites_host_select on public.trip_invites
  for select using (invited_by = auth.uid() or invited_user_id = auth.uid());

create policy trip_invites_host_insert on public.trip_invites
  for insert with check (
    invited_by = auth.uid()
    and exists (
      select 1 from public.group_trips gt where gt.id = trip_id and gt.host_id = auth.uid()
    )
  );

-- host can update (re-invite/cancel) own-issued invites; invitee can update own row (accept/decline)
create policy trip_invites_update on public.trip_invites
  for update using (invited_by = auth.uid() or invited_user_id = auth.uid());

-- notify the invitee on new invite
create or replace function public.tg_notify_trip_invite_received()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  v_name := public.user_display_name(new.invited_by);
  insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  values (new.invited_user_id, new.trip_id, 'trip_invite_received', 'user', new.invited_by, 'trip_invite', new.id,
          jsonb_build_object('actor_name', v_name));
  return new;
end $$;

drop trigger if exists trg_trip_invite_received on public.trip_invites;
create trigger trg_trip_invite_received after insert on public.trip_invites
for each row when (new.status = 'pending')
execute function public.tg_notify_trip_invite_received();

-- notify the host when the invitee responds
create or replace function public.tg_notify_trip_invite_decided()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text; v_type public.notification_type;
begin
  if old.status = 'pending' and new.status = 'accepted' then
    v_type := 'trip_invite_accepted';
  elsif old.status = 'pending' and new.status = 'declined' then
    v_type := 'trip_invite_declined';
  else
    return new;
  end if;
  v_name := public.user_display_name(new.invited_user_id);
  insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  values (new.invited_by, new.trip_id, v_type, 'admin', new.invited_user_id, 'trip_invite', new.id,
          jsonb_build_object('actor_name', v_name));
  return new;
end $$;

drop trigger if exists trg_trip_invite_decided on public.trip_invites;
create trigger trg_trip_invite_decided after update on public.trip_invites
for each row execute function public.tg_notify_trip_invite_decided();

-- push priority: invite received = normal priority (urgent-ish), decisions = low-key
create or replace function public.notification_push_priority(p_type public.notification_type, p_data jsonb)
returns smallint language sql immutable as $$
  select case p_type
    when 'join_request_received' then 0
    when 'join_request_decided' then case when p_data->>'decision' = 'approved' then 0 else 1 end
    when 'trip_invite_received' then 0
    when 'trip_invite_accepted' then 0
    when 'trip_invite_declined' then 1
    else -1
  end
$$;
```

> Note: this `create or replace function public.notification_push_priority` must reproduce the *full* existing `case` from `20260609000100_notification_push_mapping.sql` plus the two new `trip_invite_*` branches — before writing the real migration file, open that file and copy every existing `when` branch verbatim so no existing notification type silently loses its priority mapping. Do not truncate the case to only the branches shown above.

- [ ] **Step 2: Apply via Supabase SQL editor**

Run the file contents (after filling in the full `case` per the note above) in the SQL editor.

- [ ] **Step 3: Verify with a manual insert**

```sql
-- pick a real trip_id you host and a real other user_id
insert into public.trip_invites (trip_id, invited_user_id, invited_by)
values ('<trip_id>', '<other_user_id>', '<your_user_id>');

select * from public.notifications where entity_type = 'trip_invite' order by created_at desc limit 1;
-- expected: one row, type='trip_invite_received', recipient_id = invited_user_id

update public.trip_invites set status = 'accepted' where trip_id = '<trip_id>' and invited_user_id = '<other_user_id>';

select * from public.notifications where type = 'trip_invite_accepted' order by created_at desc limit 1;
-- expected: one row, recipient_id = invited_by (the host)
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260713000100_trip_invites.sql
git commit -m "feat(db): add trip_invites table, RLS, notification triggers, push mapping"
```

---

### Task 3: Scoring function — `tripInviteMatching.ts`

**Files:**
- Create: `src/services/trips/tripInviteMatching.ts`
- Test: `src/services/trips/__tests__/tripInviteMatching.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure function).
- Produces:
  ```ts
  export interface TripInviteCriteria {
    destination_country?: string | null;
    surfboard_type?: string | null;
    surf_level_category?: string | null;
    age_min?: number | null;
    age_max?: number | null;
  }
  export interface CandidateProfile {
    user_id: string;
    country_from?: string | null;
    surfboard_type?: string | null;
    surf_level_category?: string | null;
    age?: number | null;
  }
  export function scoreCandidateForTrip(criteria: TripInviteCriteria, candidate: CandidateProfile): number;
  ```
  Consumed by Task 4's `tripInvitesService.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// src/services/trips/__tests__/tripInviteMatching.test.ts
import { scoreCandidateForTrip } from '../tripInviteMatching';

describe('scoreCandidateForTrip', () => {
  it('scores a perfect match highest', () => {
    const criteria = { destination_country: 'Portugal', surfboard_type: 'shortboard', surf_level_category: 'intermediate', age_min: 20, age_max: 35 };
    const perfect = { user_id: '1', country_from: 'Portugal', surfboard_type: 'shortboard', surf_level_category: 'intermediate', age: 28 };
    const noMatch = { user_id: '2', country_from: 'Norway', surfboard_type: 'longboard', surf_level_category: 'beginner', age: 55 };
    expect(scoreCandidateForTrip(criteria, perfect)).toBeGreaterThan(scoreCandidateForTrip(criteria, noMatch));
  });

  it('returns 0 for a candidate matching nothing', () => {
    const criteria = { destination_country: 'Portugal', surfboard_type: 'shortboard', surf_level_category: 'intermediate', age_min: 20, age_max: 35 };
    const noMatch = { user_id: '2', country_from: 'Norway', surfboard_type: 'longboard', surf_level_category: 'beginner', age: 55 };
    expect(scoreCandidateForTrip(criteria, noMatch)).toBe(0);
  });

  it('handles missing criteria/candidate fields without throwing', () => {
    expect(() => scoreCandidateForTrip({}, { user_id: '3' })).not.toThrow();
    expect(scoreCandidateForTrip({}, { user_id: '3' })).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx jest src/services/trips/__tests__/tripInviteMatching.test.ts`
Expected: FAIL — `Cannot find module '../tripInviteMatching'`

- [ ] **Step 3: Write the implementation**

```ts
// src/services/trips/tripInviteMatching.ts
export interface TripInviteCriteria {
  destination_country?: string | null;
  surfboard_type?: string | null;
  surf_level_category?: string | null;
  age_min?: number | null;
  age_max?: number | null;
}

export interface CandidateProfile {
  user_id: string;
  country_from?: string | null;
  surfboard_type?: string | null;
  surf_level_category?: string | null;
  age?: number | null;
}

const WEIGHT_COUNTRY = 20;
const WEIGHT_BOARD = 30;
const WEIGHT_LEVEL = 30;
const WEIGHT_AGE = 20;

export function scoreCandidateForTrip(criteria: TripInviteCriteria, candidate: CandidateProfile): number {
  let score = 0;

  if (criteria.destination_country && candidate.country_from
    && criteria.destination_country.toLowerCase() === candidate.country_from.toLowerCase()) {
    score += WEIGHT_COUNTRY;
  }

  if (criteria.surfboard_type && candidate.surfboard_type
    && criteria.surfboard_type.toLowerCase() === candidate.surfboard_type.toLowerCase()) {
    score += WEIGHT_BOARD;
  }

  if (criteria.surf_level_category && candidate.surf_level_category
    && criteria.surf_level_category.toLowerCase() === candidate.surf_level_category.toLowerCase()) {
    score += WEIGHT_LEVEL;
  }

  if (
    typeof criteria.age_min === 'number' &&
    typeof criteria.age_max === 'number' &&
    typeof candidate.age === 'number' &&
    candidate.age >= criteria.age_min &&
    candidate.age <= criteria.age_max
  ) {
    score += WEIGHT_AGE;
  }

  return score;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx jest src/services/trips/__tests__/tripInviteMatching.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/trips/tripInviteMatching.ts src/services/trips/__tests__/tripInviteMatching.test.ts
git commit -m "feat: add trip invite candidate scoring function"
```

---

### Task 4: Service layer — `tripInvitesService.ts`

**Files:**
- Create: `src/services/trips/tripInvitesService.ts`
- Test: `src/services/trips/__tests__/tripInvitesService.test.ts`

**Interfaces:**
- Consumes: `scoreCandidateForTrip`, `TripInviteCriteria`, `CandidateProfile` from Task 3; `supabase` client from `src/services/supabaseClient` (existing project import — check exact path via `grep "from '.*supabaseClient'" src/services/trips/groupTripsService.ts` if unsure, it's the same import every other service in this directory uses).
- Produces (consumed by Task 5 UI and Task 6 UI):
  ```ts
  export type TripInviteStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';
  export interface TripInvite {
    id: string; trip_id: string; invited_user_id: string; invited_by: string;
    status: TripInviteStatus; created_at: string; responded_at: string | null;
  }
  export interface InviteCandidate extends CandidateProfile {
    name: string; profile_image_url: string | null; score: number;
  }
  export async function listInviteCandidates(tripId: string): Promise<InviteCandidate[]>;
  export async function inviteUserToTrip(tripId: string, invitedUserId: string, invitedBy: string): Promise<TripInvite>;
  export async function listPendingInvites(tripId: string): Promise<TripInvite[]>;
  export async function respondToInvite(inviteId: string, response: 'accepted' | 'declined', respondingUserId: string): Promise<void>;
  ```

- [ ] **Step 1: Write the failing test (mocking supabase)**

```ts
// src/services/trips/__tests__/tripInvitesService.test.ts
jest.mock('../../supabaseClient', () => ({
  supabase: {
    from: jest.fn(),
  },
}));
import { supabase } from '../../supabaseClient';
import { inviteUserToTrip, respondToInvite } from '../tripInvitesService';

describe('tripInvitesService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('inviteUserToTrip inserts a pending invite row', async () => {
    const single = jest.fn().mockResolvedValue({ data: { id: 'inv1', trip_id: 't1', invited_user_id: 'u2', invited_by: 'u1', status: 'pending', created_at: 'now', responded_at: null }, error: null });
    const select = jest.fn(() => ({ single }));
    const insert = jest.fn(() => ({ select }));
    (supabase.from as jest.Mock).mockReturnValue({ insert });

    const result = await inviteUserToTrip('t1', 'u2', 'u1');

    expect(supabase.from).toHaveBeenCalledWith('trip_invites');
    expect(insert).toHaveBeenCalledWith({ trip_id: 't1', invited_user_id: 'u2', invited_by: 'u1', status: 'pending' });
    expect(result.id).toBe('inv1');
  });

  it('respondToInvite updates status and responded_at, scoped to the responding user', async () => {
    const eq2 = jest.fn().mockResolvedValue({ error: null });
    const eq1 = jest.fn(() => ({ eq: eq2 }));
    const update = jest.fn(() => ({ eq: eq1 }));
    (supabase.from as jest.Mock).mockReturnValue({ update });

    await respondToInvite('inv1', 'accepted', 'u2');

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'accepted' }));
    expect(eq1).toHaveBeenCalledWith('id', 'inv1');
    expect(eq2).toHaveBeenCalledWith('invited_user_id', 'u2');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx jest src/services/trips/__tests__/tripInvitesService.test.ts`
Expected: FAIL — `Cannot find module '../tripInvitesService'`

- [ ] **Step 3: Write the implementation**

```ts
// src/services/trips/tripInvitesService.ts
import { supabase } from '../supabaseClient';
import { scoreCandidateForTrip, type CandidateProfile } from './tripInviteMatching';

export type TripInviteStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface TripInvite {
  id: string;
  trip_id: string;
  invited_user_id: string;
  invited_by: string;
  status: TripInviteStatus;
  created_at: string;
  responded_at: string | null;
}

export interface InviteCandidate extends CandidateProfile {
  name: string;
  profile_image_url: string | null;
  score: number;
}

export async function inviteUserToTrip(tripId: string, invitedUserId: string, invitedBy: string): Promise<TripInvite> {
  const { data, error } = await supabase
    .from('trip_invites')
    .insert({ trip_id: tripId, invited_user_id: invitedUserId, invited_by: invitedBy, status: 'pending' })
    .select()
    .single();
  if (error) throw error;
  return data as TripInvite;
}

export async function listPendingInvites(tripId: string): Promise<TripInvite[]> {
  const { data, error } = await supabase
    .from('trip_invites')
    .select('*')
    .eq('trip_id', tripId)
    .eq('status', 'pending');
  if (error) throw error;
  return (data ?? []) as TripInvite[];
}

export async function respondToInvite(inviteId: string, response: 'accepted' | 'declined', respondingUserId: string): Promise<void> {
  const { error } = await supabase
    .from('trip_invites')
    .update({ status: response, responded_at: new Date().toISOString() })
    .eq('id', inviteId)
    .eq('invited_user_id', respondingUserId);
  if (error) throw error;

  if (response === 'accepted') {
    const { data: invite, error: fetchError } = await supabase
      .from('trip_invites')
      .select('trip_id, invited_user_id')
      .eq('id', inviteId)
      .single();
    if (fetchError) throw fetchError;
    const { error: participantError } = await supabase
      .from('group_trip_participants')
      .insert({ trip_id: invite.trip_id, user_id: invite.invited_user_id, role: 'member' });
    if (participantError) throw participantError;
  }
}

export async function listInviteCandidates(
  tripId: string,
  criteria: { destination_country?: string | null; surfboard_type?: string | null; surf_level_category?: string | null; age_min?: number | null; age_max?: number | null },
): Promise<InviteCandidate[]> {
  const [{ data: participants, error: pErr }, { data: invites, error: iErr }] = await Promise.all([
    supabase.from('group_trip_participants').select('user_id').eq('trip_id', tripId),
    supabase.from('trip_invites').select('invited_user_id').eq('trip_id', tripId).in('status', ['pending', 'accepted']),
  ]);
  if (pErr) throw pErr;
  if (iErr) throw iErr;

  const excluded = new Set([
    ...(participants ?? []).map((p: { user_id: string }) => p.user_id),
    ...(invites ?? []).map((i: { invited_user_id: string }) => i.invited_user_id),
  ]);

  const { data: users, error: uErr } = await supabase
    .from('users')
    .select('id, name, profile_image_url, country_from, surfboard_type, surf_level_category, age')
    .limit(200);
  if (uErr) throw uErr;

  return (users ?? [])
    .filter((u: { id: string }) => !excluded.has(u.id))
    .map((u: { id: string; name: string; profile_image_url: string | null; country_from: string | null; surfboard_type: string | null; surf_level_category: string | null; age: number | null }) => ({
      user_id: u.id,
      name: u.name,
      profile_image_url: u.profile_image_url,
      country_from: u.country_from,
      surfboard_type: u.surfboard_type,
      surf_level_category: u.surf_level_category,
      age: u.age,
      score: scoreCandidateForTrip(criteria, {
        user_id: u.id,
        country_from: u.country_from,
        surfboard_type: u.surfboard_type,
        surf_level_category: u.surf_level_category,
        age: u.age,
      }),
    }))
    .sort((a, b) => b.score - a.score);
}
```

> Before finalizing this step, grep the `users` table's actual column names (`grep -n "country_from\|surf_level_category\|surfboard_type" src/services/trips/groupTripsService.ts` shows `ParticipantProfile`'s shape) to confirm the select list matches reality — `ParticipantProfile` in `groupTripsService.ts:228-240` is the authoritative field list; adjust the `.select(...)` string to match it exactly if it differs from what's guessed above.

- [ ] **Step 4: Run test, verify it passes**

Run: `npx jest src/services/trips/__tests__/tripInvitesService.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/trips/tripInvitesService.ts src/services/trips/__tests__/tripInvitesService.test.ts
git commit -m "feat: add trip invites service (list candidates, invite, respond)"
```

---

### Task 5: `InviteMembersSheet` (host-facing)

**Files:**
- Create: `src/components/trips/InviteMembersSheet.tsx`

**Interfaces:**
- Consumes: `listInviteCandidates`, `inviteUserToTrip`, `InviteCandidate` from Task 4; `BottomSheetShell` from `src/components/sheets/BottomSheetShell.tsx` (read that file's props before wiring — it takes `visible`, `onClose`, and renders `children`, per project convention referenced in memory `project_bottom_sheet_shell`).
- Produces: `<InviteMembersSheet visible tripId criteria onClose onInvited onViewProfile />`, consumed by Task 7 (`TripMembersScreen`).

- [ ] **Step 1: Write the component**

```tsx
// src/components/trips/InviteMembersSheet.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Image, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { BottomSheetShell } from '../sheets/BottomSheetShell';
import { listInviteCandidates, inviteUserToTrip, type InviteCandidate } from '../../services/trips/tripInvitesService';
import type { TripInviteCriteria } from '../../services/trips/tripInviteMatching';

interface InviteMembersSheetProps {
  visible: boolean;
  tripId: string;
  hostId: string;
  criteria: TripInviteCriteria;
  onClose: () => void;
  onInvited: (userId: string) => void;
  onViewProfile: (userId: string) => void;
}

export function InviteMembersSheet({ visible, tripId, hostId, criteria, onClose, onInvited, onViewProfile }: InviteMembersSheetProps) {
  const [candidates, setCandidates] = useState<InviteCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [invitingId, setInvitingId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    listInviteCandidates(tripId, criteria)
      .then(setCandidates)
      .finally(() => setLoading(false));
  }, [visible, tripId, criteria]);

  const handleInvite = useCallback(async (userId: string) => {
    setInvitingId(userId);
    try {
      await inviteUserToTrip(tripId, userId, hostId);
      setCandidates(prev => prev.filter(c => c.user_id !== userId));
      onInvited(userId);
    } finally {
      setInvitingId(null);
    }
  }, [tripId, hostId, onInvited]);

  return (
    <BottomSheetShell visible={visible} onClose={onClose}>
      <Text style={styles.title}>Invite surfers</Text>
      {loading ? (
        <ActivityIndicator style={styles.loading} />
      ) : (
        <FlatList
          data={candidates}
          keyExtractor={c => c.user_id}
          ListEmptyComponent={<Text style={styles.empty}>No matching surfers found.</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <TouchableOpacity style={styles.rowMain} onPress={() => onViewProfile(item.user_id)}>
                {item.profile_image_url ? (
                  <Image source={{ uri: item.profile_image_url }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder]} />
                )}
                <View>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.meta}>
                    {[item.surf_level_category, item.surfboard_type, item.country_from].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.inviteButton}
                disabled={invitingId === item.user_id}
                onPress={() => handleInvite(item.user_id)}
              >
                <Text style={styles.inviteButtonText}>{invitingId === item.user_id ? '...' : 'Invite'}</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </BottomSheetShell>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '600', marginBottom: 12, paddingHorizontal: 16 },
  loading: { marginTop: 32 },
  empty: { textAlign: 'center', color: '#888', marginTop: 32 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarPlaceholder: { backgroundColor: '#ddd' },
  name: { fontSize: 15, fontWeight: '500' },
  meta: { fontSize: 12, color: '#888', marginTop: 2 },
  inviteButton: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#111' },
  inviteButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
```

> Before finalizing this step: open `src/components/sheets/BottomSheetShell.tsx` and confirm its exact prop names (`visible`/`onClose` are assumed here based on convention) — adjust the props passed to `<BottomSheetShell>` to match its real interface if it differs (e.g. it may want a `snapPoints` or `title` prop instead of a manual `<Text style={styles.title}>`).

- [ ] **Step 2: Manual smoke test**

This is a presentational component with no pure-logic branch worth a snapshot test (data flow is exercised by Task 4's tests). Verify by wiring it into `TripMembersScreen` in Task 7 and running the app.

- [ ] **Step 3: Commit**

```bash
git add src/components/trips/InviteMembersSheet.tsx
git commit -m "feat: add InviteMembersSheet for host trip-invite UI"
```

---

### Task 6: `TripInviteResponseSheet` (invitee-facing accept/decline)

**Files:**
- Create: `src/components/trips/TripInviteResponseSheet.tsx`

**Interfaces:**
- Consumes: `respondToInvite` from Task 4; `BottomSheetShell`.
- Produces: `<TripInviteResponseSheet visible inviteId tripName respondingUserId onClose onResponded />`, consumed by Task 8 (notification routing).

- [ ] **Step 1: Write the component**

```tsx
// src/components/trips/TripInviteResponseSheet.tsx
import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { BottomSheetShell } from '../sheets/BottomSheetShell';
import { respondToInvite } from '../../services/trips/tripInvitesService';

interface TripInviteResponseSheetProps {
  visible: boolean;
  inviteId: string;
  tripName: string;
  respondingUserId: string;
  onClose: () => void;
  onResponded: (response: 'accepted' | 'declined') => void;
}

export function TripInviteResponseSheet({ visible, inviteId, tripName, respondingUserId, onClose, onResponded }: TripInviteResponseSheetProps) {
  const [submitting, setSubmitting] = useState(false);

  const respond = useCallback(async (response: 'accepted' | 'declined') => {
    setSubmitting(true);
    try {
      await respondToInvite(inviteId, response, respondingUserId);
      onResponded(response);
    } finally {
      setSubmitting(false);
    }
  }, [inviteId, respondingUserId, onResponded]);

  return (
    <BottomSheetShell visible={visible} onClose={onClose}>
      <View style={styles.container}>
        <Text style={styles.title}>You've been invited</Text>
        <Text style={styles.body}>Join "{tripName}"?</Text>
        {submitting ? (
          <ActivityIndicator style={styles.loading} />
        ) : (
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.button, styles.decline]} onPress={() => respond('declined')}>
              <Text style={styles.declineText}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.accept]} onPress={() => respond('accepted')}>
              <Text style={styles.acceptText}>Accept</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </BottomSheetShell>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  title: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  body: { fontSize: 15, color: '#444', marginBottom: 20 },
  loading: { marginVertical: 20 },
  actions: { flexDirection: 'row', gap: 12 },
  button: { flex: 1, paddingVertical: 12, borderRadius: 24, alignItems: 'center' },
  decline: { backgroundColor: '#eee' },
  accept: { backgroundColor: '#111' },
  declineText: { color: '#333', fontWeight: '600' },
  acceptText: { color: '#fff', fontWeight: '600' },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/components/trips/TripInviteResponseSheet.tsx
git commit -m "feat: add TripInviteResponseSheet for invitee accept/decline UI"
```

---

### Task 7: Wire "Invite" button into `TripMembersScreen`

**Files:**
- Modify: `src/screens/trips/TripMembersScreen.tsx`

**Interfaces:**
- Consumes: `InviteMembersSheet` from Task 5; `isTripHost` (already imported per research, `src/utils/tripRole.ts`); `tripsKeys` (already imported) for cache invalidation.
- Produces: nothing new consumed by later tasks — this is the leaf UI wiring.

- [ ] **Step 1: Add import and state**

Near the existing imports (after the `isTripHost` import, per research report line ~35):
```ts
import { InviteMembersSheet } from '../../components/trips/InviteMembersSheet';
```

Inside the component body, alongside the existing `sheetMember` state:
```ts
const [inviteSheetOpen, setInviteSheetOpen] = useState(false);
```

- [ ] **Step 2: Add the Invite button to the header**

In the header block (research report: lines 187-202, the dark bar with back chevron + `<NotificationCenter bare>`), add a button before/alongside the bell, gated on host:
```tsx
{isTripHost(trip, participants, currentUserId) && (
  <TouchableOpacity onPress={() => setInviteSheetOpen(true)} style={styles.inviteHeaderButton}>
    <Text style={styles.inviteHeaderButtonText}>Invite</Text>
  </TouchableOpacity>
)}
```
Add to the existing `StyleSheet.create({...})` in this file:
```ts
inviteHeaderButton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.15)', marginRight: 8 },
inviteHeaderButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
```

- [ ] **Step 3: Render the sheet, wire `onInvited` to refetch**

Near the existing `<TripMemberSheet .../>` render (driven by `sheetMember`), add:
```tsx
<InviteMembersSheet
  visible={inviteSheetOpen}
  tripId={tripId}
  hostId={currentUserId}
  criteria={{
    destination_country: trip?.destination_country ?? null,
    surfboard_type: trip?.surfboard_type ?? null,
    surf_level_category: trip?.surf_level_category ?? null,
    age_min: trip?.age_min ?? null,
    age_max: trip?.age_max ?? null,
  }}
  onClose={() => setInviteSheetOpen(false)}
  onInvited={() => {}}
  onViewProfile={(userId) => onViewUserProfile?.(userId)}
/>
```

> Before finalizing this step: confirm `trip.destination_country` / `trip.surfboard_type` / `trip.surf_level_category` / `trip.age_min` / `trip.age_max` are the real field names on the `trip` object returned by `useTripCore` — if the trip's stored criteria use different field names (e.g. nested under a `criteria` object, or named `board_type` instead of `surfboard_type`), adjust the `criteria` prop mapping to match the real shape. Check by reading the `GroupTrip`/trip type near the top of `groupTripsService.ts`.

- [ ] **Step 4: Manual verification**

Run the app (`npm run ios` or `npm start`), navigate as a trip host to Members → View all, tap "Invite", confirm the sheet opens, shows candidates (or the empty state), and tapping "Invite" on a candidate removes them from the list without crashing.

- [ ] **Step 5: Commit**

```bash
git add src/screens/trips/TripMembersScreen.tsx
git commit -m "feat: wire Invite button and InviteMembersSheet into TripMembersScreen"
```

---

### Task 8: Notification routing for invite notifications

**Files:**
- Modify: `src/services/notifications/notificationsService.ts`
- Modify: `src/components/notifications/NotificationCenter.tsx`

**Interfaces:**
- Consumes: `TripInviteResponseSheet` from Task 6.
- Produces: nothing further consumed — this is the final integration point.

- [ ] **Step 1: Add render cases in `notificationsService.ts`**

Near the existing `case 'join_request_received':` inside `renderNotificationDefault` (research report: ~line 469), add:
```ts
case 'trip_invite_received':
  return { title: 'Trip invite', body: `${n.data?.actor_name ?? 'Someone'} invited you to join a trip`, icon: 'mail' };
case 'trip_invite_accepted':
  return { title: 'Invite accepted', body: `${n.data?.actor_name ?? 'They'} accepted your trip invite`, icon: 'check' };
case 'trip_invite_declined':
  return { title: 'Invite declined', body: `${n.data?.actor_name ?? 'They'} declined your trip invite`, icon: 'x' };
```
(Match the exact return shape used by neighboring cases — read the function's existing return type before finalizing field names like `icon`.)

Near `tripFocusForNotification` (research report: lines 112-152), add:
```ts
case 'trip_invite_accepted':
case 'trip_invite_declined':
  return 'overview';
```
(`trip_invite_received` does NOT go through this function — it routes to a dedicated response sheet, handled in Step 2 below, not the generic trip-focus path.)

- [ ] **Step 2: Add tap routing in `NotificationCenter.tsx`**

Inside `handleRowPress` (research report: lines 292-304), add a branch before the generic `onOpenTrip` fallback, mirroring the existing `join_request_received` special case:
```ts
const handleRowPress = useCallback((n: NotificationRow) => {
  if (n.type === 'join_request_received' && n.actor_id) {
    pushRootCard('ProfileCard', { userId: n.actor_id });
    return;
  }
  if (n.type === 'trip_invite_received' && n.entity_id) {
    setActiveInvite({ inviteId: n.entity_id, tripId: n.trip_id, tripName: n.data?.trip_name ?? 'this trip' });
    return;
  }
  if (!onOpenTrip || !n.trip_id) return;
  onOpenTrip(n.trip_id, tripFocusForNotification(n.type, n.data));
}, [onOpenTrip]);
```

Add local state and the sheet render near the component's existing state/JSX:
```ts
const [activeInvite, setActiveInvite] = useState<{ inviteId: string; tripId: string; tripName: string } | null>(null);
```
```tsx
{activeInvite && currentUserId && (
  <TripInviteResponseSheet
    visible
    inviteId={activeInvite.inviteId}
    tripName={activeInvite.tripName}
    respondingUserId={currentUserId}
    onClose={() => setActiveInvite(null)}
    onResponded={() => setActiveInvite(null)}
  />
)}
```
Add the import at the top:
```ts
import { TripInviteResponseSheet } from '../trips/TripInviteResponseSheet';
```

> Before finalizing: confirm `NotificationCenter.tsx` already has a `currentUserId` in scope (it must, to know which user's notifications are being shown) — if it's named differently (e.g. `userId`), use that name instead. Also confirm `n.data?.trip_name` is actually populated — if the `tg_notify_trip_invite_received` trigger (Task 2) doesn't include a trip name in `data`, either add it there (`jsonb_build_object('actor_name', v_name, 'trip_name', (select title from group_trips where id = new.trip_id))`) or fall back to fetching the trip name client-side before opening the sheet.

- [ ] **Step 3: Manual verification**

As the host, invite a second test user (via Task 7's UI). Log in as that user, open the notification bell, confirm a "Trip invite" row appears, tap it, confirm `TripInviteResponseSheet` opens with the right trip name, tap Accept, confirm the user now appears in the trip's members list (re-open Members screen as host to check) and the host receives an "Invite accepted" notification.

- [ ] **Step 4: Commit**

```bash
git add src/services/notifications/notificationsService.ts src/components/notifications/NotificationCenter.tsx
git commit -m "feat: route trip invite notifications to accept/decline sheet"
```

---

## Post-plan checklist (do not skip)

- [ ] Re-read `20260609000100_notification_push_mapping.sql` in full and confirm Task 2's `notification_push_priority` replacement includes every existing `when` branch unchanged, not just the ones shown in this plan.
- [ ] Confirm react-query cache invalidation: after `respondToInvite` accepts, invalidate the same `tripsKeys` used by `TripMembersScreen`/`TripDetailScreen` for participants, so the new member appears without a manual refresh (per the known join-request staleness gotcha in project memory).
- [ ] Confirm `BottomSheetShell`'s real prop names before Tasks 5/6 are considered done (flagged inline in both tasks).
