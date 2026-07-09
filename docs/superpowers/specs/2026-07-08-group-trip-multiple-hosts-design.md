# Group Trips — Multiple Hosts

**Date:** 2026-07-08
**Status:** Design approved, pending implementation plan

## Summary

A group trip can have more than one host. Any host can promote a member to host, and any host can demote another host. There is no new role: the existing `'host'` value on `group_trip_participants.role` simply stops being limited to one person per trip.

Permission checks move off `group_trips.host_id` (a single user) and onto `group_trip_participants.role = 'host'` (a set of users).

`group_trips.host_id` survives with a narrowed meaning: **primary host** — the one shown on trip cards, in Explore, and in "About the host". It is display and attribution data, not authority.

## Motivation

Hosting a trip is administrative work: approving join requests, approving commitments, curating the gear list, posting updates. Today exactly one person can do any of it. Trips organised by a pair or a small crew have no way to share that load.

## Decisions

Settled during brainstorming, recorded so the implementation doesn't relitigate them:

| Question | Decision |
|---|---|
| New `'admin'` role, or reuse `'host'`? | **Reuse `'host'`.** No new role value. |
| Who can promote? | **Any host.** Fully symmetrical. |
| Is the creator protected from demotion? | **No.** Fully flat. `host_id` is display data only. |
| What happens to `host_id` when its holder is demoted or leaves? | **Reassigned** by trigger to the longest-tenured remaining host. |
| Who is notified of join / commitment / gear requests? | **All hosts.** |
| Is the promoted user notified? | **No.** They discover it in-app. |
| Where does promotion happen? | **Trip Members row → arrow → bottom sheet**, WhatsApp-style. |
| Can an admin step down on their own? | **No UI for it.** Only another admin can remove your admin status. |
| Last host tries to leave or be demoted? | **Blocked**, enforced in the database. |

### Naming: `host` in the database, "admin" in the UI

`TripMembersScreen.tsx:262` already renders `AdminBadgeIcon` on rows where `role === 'host'`. The user-facing word for this role in group trips is **already "admin"**, and has been.

This spec keeps that split, deliberately:

- **Schema, RPCs, RLS, types:** `'host'`. No renaming, no migration of existing values.
- **Every string a user reads:** "admin" — `Set as admin`, `Remove as admin`, the badge.

Do not "fix" this into agreement in either direction.

## Security — two pre-existing holes this feature forces us to close

The live RLS on `group_trip_participants` is:

```
SELECT  USING (true)
INSERT  WITH CHECK (auth.uid() = user_id)
UPDATE  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)
DELETE  USING (auth.uid() = user_id OR auth.uid() = (SELECT host_id FROM group_trips WHERE id = trip_id))
```

Neither the `INSERT` nor the `UPDATE` policy constrains `role`, and the `INSERT` policy does not require an approved join request.

**Hole 1 — self-promotion.** Any authenticated user can `UPDATE` their own participant row to `role = 'host'`, or `INSERT` themselves with `role = 'host'`.

Today this is inert: every permission check reads `group_trips.host_id`, so the `role` column is decorative. **This feature makes `role` load-bearing.** The moment it is, this becomes a full privilege-escalation path — any user could become host of any trip, edit it, remove its members, delete it. Closing it is mandatory and lands in the same migration.

**Hole 2 — self-insertion.** Independently of this feature, any authenticated user can `INSERT` themselves into any trip, bypassing the join-request flow entirely. Pre-existing, live. Fixed here because we are already rewriting this table's policies.

Both are fixed. Confirmed approach: role becomes immutable via direct client writes; all role changes go through `SECURITY DEFINER` RPCs that verify the caller server-side.

## Data model

### Schema changes

- `group_trip_participants.role` — check constraint stays `('host','member')`. Unchanged.
- `group_trip_participants.role_granted_at timestamptz not null default now()` — **new.** Determines the longest-tenured host for `host_id` reassignment, and breaks ties deterministically. Backfilled from `joined_at`.
- `group_trips.host_id` — column, type, and FK unchanged. Semantics change from *creator* to *primary host*. Now mutable.

No new tables.

### Invariants — all enforced in Postgres, not the app

**I1. A trip always has at least one host.**
`BEFORE UPDATE OR DELETE` trigger on `group_trip_participants`. Takes `SELECT ... FOR UPDATE` on the trip's `group_trips` row, counts remaining hosts, raises if the operation would leave zero.

The row lock is load-bearing. Two hosts demoting each other simultaneously would otherwise both observe the other as demotable, both succeed, and leave the trip hostless. Same pattern already used by `enforce_group_trip_max_participants`.

**I2. `host_id` always points at a current host of that trip.**
`AFTER UPDATE OR DELETE` trigger. When the participant referenced by `host_id` stops being a host (demoted or removed), reassign `host_id` to the remaining host with the lowest `role_granted_at`. I1 guarantees such a host exists.

This is what lets every existing consumer of `host_id` — `explore_feed`, `my_trips_feed`, trip cards, About-the-host, `trip_admin_ids` — keep working untouched.

**I3. `role` cannot be set by a client write.**
The participants `UPDATE` policy gains a `WITH CHECK` clause requiring `role` to equal its existing value. Direct role writes are impossible regardless of who attempts them.

### How roles actually change

Two `SECURITY DEFINER` functions, mirroring the existing `add_surftrip_members_from_dms` pattern (which already re-verifies caller role server-side):

```sql
promote_trip_host(p_trip_id uuid, p_user_id uuid)
  -- caller must be a host of p_trip_id
  -- p_user_id must already be a participant
  -- sets role = 'host', role_granted_at = now()

demote_trip_host(p_trip_id uuid, p_user_id uuid)
  -- caller must be a host of p_trip_id
  -- sets role = 'member'
  -- I1 rejects if p_user_id is the last host
```

`demote_trip_host` does not special-case `p_user_id = auth.uid()`. Self-demotion is therefore permitted by the RPC, but **no UI invokes it** — there is no "step down" affordance, by decision. The RPC stays permissive rather than growing a rule that exists only to forbid something nothing calls.

Both, per the standing rule that public-schema functions are PostgREST-callable and bypass any client-side gate:

```sql
REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION ... TO authenticated;
```

## RLS rewrite

One helper:

```sql
CREATE FUNCTION public.is_trip_host(p_trip_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, extensions, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_trip_participants
    WHERE trip_id = p_trip_id AND user_id = auth.uid() AND role = 'host'
  )
$$;
```

Then a mechanical swap of `host_id = auth.uid()` → `is_trip_host(<trip_id>)` across **9 policies on 6 tables**:

| Table | Policies |
|---|---|
| `group_trips` | update, delete |
| `group_trip_participants` | delete (host-removes branch) |
| `group_trip_join_requests` | select, insert, update |
| `group_trip_commitment_requests` | select, update |
| `group_trip_gear_items` | insert, update, delete |
| `group_trip_gear_requests` | update |
| `group_trip_admin_updates` | insert, update, delete |

All nine, or some screens silently retain single-host behaviour with no error surfaced anywhere.

### Repo drift warning

`group_trip_gear_items`, `group_trip_gear_requests`, and `group_trip_admin_updates` **have no creation migration in the repo** — they were applied by hand to prod. Their live policy definitions were pulled via `pg_policies` on 2026-07-08 and are the source of truth for the rewrite. Do not attempt to reconstruct them from repo files; there are none.

### Participants INSERT tightening

New `WITH CHECK`: a user may insert their own participant row only when an approved `group_trip_join_requests` row exists for them on that trip.

Two existing insert paths must keep working:

- **Join-request approval** — performed by `handle_join_request_approval`, `SECURITY DEFINER` owned by `postgres` (which has `BYPASSRLS`). Confirmed. RLS does not apply. No change needed.
- **Trip creation** — `groupTripsService.createGroupTrip` inserts the host row from the client. This path *is* subject to RLS. Accommodated by a second `OR` branch in the policy: `auth.uid() = (SELECT host_id FROM group_trips WHERE id = trip_id)`.

The trip-creation branch is safe because `group_trips` INSERT already requires `auth.uid() = host_id`, so it only ever lets the creator add their own first row. It does not reopen Hole 1: the `role` value is still governed by I3 on `UPDATE`, and the row this branch creates is the creator's own.

Final `WITH CHECK`:

```sql
auth.uid() = user_id
AND (
  EXISTS (SELECT 1 FROM public.group_trip_join_requests
          WHERE trip_id = group_trip_participants.trip_id
            AND requester_id = auth.uid() AND status = 'approved')
  OR auth.uid() = (SELECT host_id FROM public.group_trips
                   WHERE id = group_trip_participants.trip_id)
)
```

## Notifications

Already built, by accident. `trip_admin_ids(p_trip_id)` exists in prod:

```sql
SELECT host_id FROM group_trips WHERE id = p_trip_id
UNION
SELECT user_id FROM group_trip_participants WHERE trip_id = p_trip_id AND role = 'admin'
```

Its second branch has never matched a row — `'admin'` is not a permitted value of `role`. It is already the recipient lookup for all three relevant notification triggers:

- `tg_notify_join_request_received`
- `tg_notify_commitment_received`
- `tg_notify_gear_request_received`

**Change `'admin'` → `'host'` in that one function and the entire notification fan-out is done.** No edge-function changes, no trigger changes.

Per decision: **no notification is sent to a newly promoted host.**

## Edge functions

Two hard-check `trip.host_id === user.id` and must switch to a host-set check:

- `supabase/functions/send-trip-removed-notification/index.ts:91-94`
- `supabase/functions/geocode-group-trip-destinations/index.ts:178-188`

`send-trip-request-notification` also checks `host_id`, but nothing in `src/` invokes it. **Dead. Leave it alone.**

Both live functions are deployed by copy-paste into the Supabase dashboard. Per standing practice, download and diff the live version before deploying — repo copies drift.

## Client

### Single source of truth

`isHost` is currently derived as `trip.host_id === currentUserId`, copy-pasted independently in six places:

- `src/screens/trips/TripDetailScreen.tsx:353`
- `src/hooks/trips/useTripDetail.ts:94`
- `src/screens/trips/TripMembersScreen.tsx:89`
- `src/screens/trips/YourGearScreen.tsx:66`
- `src/screens/trips/PackingAndGearScreen.tsx:64`
- `src/screens/trips/TripUpdatesScreen.tsx:78`

Plus prop drilling through `TripDetailView.tsx`, `TripDetailViewRedesigned.tsx`, and `plan/PlanSections.tsx`.

Replace all of them with one hook, `useTripRole(tripId) → { isHost }`, reading the participants list that `useTripDetail` already fetches. No additional network call.

Missing one of the six means that screen keeps single-host behaviour with no error. This is the single most likely way to ship this feature broken.

Also: `useTripDetail:123-140` gates `useTripRequests` and `useTripGearRequests` on `isHost`. Those gates follow the hook automatically once it is the source.

### Member row → member sheet

**The row.** `TripMembersScreen.tsx:245-302`. The text-only `Remove` button (`styles.remove`, `#FF5367`, `TripMembersScreen.tsx:294-300`) is **deleted** and replaced by a right chevron, matching the affordance on the gear/updates rows:

```tsx
<Ionicons name="chevron-forward" size={20} color="#C4C4C4" />
```

(Same as `plan/PlanSections.tsx:538`'s `GearRow`. Not the `size={16} color={C.muted}` variant from `AdminUpdateUI.tsx:162` — that one is a dense accordion caret, too small for a person row.)

**Tapping the row — anywhere, including the chevron — opens the member sheet.** The current behaviour of row-tap → profile is **removed**. A profile is now reachable only via `View profile` inside the sheet.

The chevron shows on every row except your own. Your own row is inert: nothing to message, nothing to remove, and there is no self-demote. The nested-`Pressable` remove button disappears with it, so the row becomes a single clean touch target.

**The sheet.** New `TripMemberSheet`, built on `BottomSheetShell` — not a hand-rolled `Modal`. Header mirrors the WhatsApp reference: circular avatar, name, and the `Joined 3 days ago` line the row already renders via `formatJoined`.

Options, filtered by viewer and target:

| Target row | Viewer is admin (`role='host'`) | Viewer is a member |
|---|---|---|
| A member | View profile · Message · **Set as admin** · <span style="color:red">Remove from trip</span> | View profile · Message |
| Another admin | View profile · Message · **Remove as admin** · <span style="color:red">Remove from trip</span> | View profile · Message |
| Yourself | *(no chevron, no sheet)* | *(no chevron, no sheet)* |

`Remove from trip` is destructive-red. Everything else is neutral.

Note the consequence of the flat model plus no self-demote: **an admin can remove another admin, and can remove them from the trip entirely.** That includes the trip's creator. This is the model as chosen; the only floor is invariant I1.

**Confirmations.** `Set as admin`, `Remove as admin`, and `Remove from trip` each confirm first:

> **Set Dana as admin?**
> Admins can edit this trip, approve requests, remove members, and delete the trip.

**Wiring the two new actions:**

- `View profile` → the existing `onViewUserProfile(userId)` prop, already passed into `TripMembersScreen`. Just moves from the row's `onPress` into the sheet.
- `Message` → **new prop.** `AppContent.tsx:1402` already exposes `handleStartConversation(userId, name, avatar)`, which reuses an existing conversation or calls `messagingService.createDirectConversation()` and then `pushRootCard('ChatCard', {...})`. It is already passed to `ProfileScreen` as `onMessage` (`AppContent.tsx:1942`). Thread the same handler into `TripMembersScreen` as `onMessage` with the identical signature. No new messaging code.

**Shared option row.** No reusable icon+label+destructive sheet row exists in the codebase — the pattern lives inline inside `surftrips/ParticipantMenuSheet.tsx:92-106`. Extract it to `src/components/sheets/SheetOptionRow.tsx` (props: `icon`, `label`, `onPress`, `danger?`) and build `TripMemberSheet` on it.

Leave `ParticipantMenuSheet` alone. Migrating surftrips onto the extracted row and onto `BottomSheetShell` is a worthwhile cleanup but is **not** part of this feature — it would put an unrelated, separately-modelled feature in the blast radius.

**Errors** surface through `friendlyErrorMessage` / `showErrorAlert` (`src/utils/friendlyError.ts`) — never `Alert.alert(title, e.message)`. The I1 violation renders as:

> This is the trip's only admin. Set someone else as admin first.

### Types

`src/types/` gains no new role union. `group_trip_participants.role` is already `'host' | 'member'`. Do not conflate with `SurftripRole` (`'host'|'admin'|'member'`) or `conversation_members.role` (`'owner'|'member'`) — three unrelated role vocabularies coexist in this codebase.

## Migration & rollout

No feature flag. Before the migration runs, every trip has exactly one participant row with `role = 'host'`, and `host_id` points at that user. Verified against prod on 2026-07-08:

```
trips                             14
trips_missing_host_participant_row 0
host_rows                         14
host_rows_not_matching_host_id     0
orphan_participants                0
```

So the new rules produce behaviour identical to today's for every existing trip. Nothing changes visibly until someone promotes.

A defensive backfill still runs — inserting a `role='host'` participant row for any trip lacking one — because `createGroupTrip`'s host-row insert is explicitly best-effort (`// Do not fail the whole create if this errors`) and a future failure would otherwise leave a trip whose creator has no powers.

Applied **by hand in the SQL editor**, like every migration in this project. Never `supabase db push` — remote migration history is frozen at `20260528`.

Order within the migration:

1. Add `role_granted_at`, backfill from `joined_at`
2. Defensive host-row backfill
3. `is_trip_host()` helper + grants
4. I1, I2 triggers
5. Rewrite the 9 policies + participants INSERT/UPDATE tightening
6. `promote_trip_host` / `demote_trip_host` + `REVOKE`/`GRANT`
7. `trip_admin_ids`: `'admin'` → `'host'`

Steps 5 and 6 must land together. Between them, role writes are impossible and no RPC exists to perform them.

## Acceptance criteria

Verified by me before hand-off:

- [ ] `npx tsc --noEmit` passes
- [ ] `promote_trip_host` / `demote_trip_host` reject a non-host caller — tested directly against the database, not through the app
- [ ] A member cannot write `role = 'host'` to their own participant row
- [ ] A member cannot insert themselves into a trip they were not accepted into
- [ ] Approving a join request still adds the participant (the `SECURITY DEFINER` bypass holds)
- [ ] Demoting the primary host reassigns `host_id`; the trip card still shows a real, current host
- [ ] The last host cannot leave, step down, or be removed — including under a simulated concurrent mutual demote
- [ ] A co-host receives a push for a new join request
- [ ] Both `promote_trip_host` and `demote_trip_host` are not executable by `anon`

Verified by Ohad on device:

- [ ] Member row → arrow → sheet opens, with avatar / name / joined-at header
- [ ] Sheet → `Set as admin` → confirm → the promoted member sees Edit / approve controls
- [ ] `View profile` and `Message` both work from the sheet; tapping the row itself no longer opens a profile
- [ ] A member sees the arrow, and their sheet shows only `View profile` · `Message`
- [ ] Your own row shows no arrow and does nothing when tapped
- [ ] Two admins both see the pending-request badge; first to approve wins, the other's request disappears
- [ ] Removing the last admin's status is blocked with the friendly message

## Out of scope

- Showing all hosts as stacked avatars on the trip card / Explore. Deliberately deferred: it touches `explore_feed`, `my_trips_feed`, trip cards, About-the-host, and 3 recipient lookups. Once this ships, it becomes a pure-UI change with no migration, because the participants table already holds the full host set.
- Notifying a user that they were promoted.
- A "step down as admin" affordance. `demote_trip_host` supports it; nothing calls it.
- Migrating `surftrips/ParticipantMenuSheet` onto `BottomSheetShell` and the extracted `SheetOptionRow`. Worth doing; not in this blast radius.
- Any change to `surftrip_groups`, which has its own independent host/admin/member model.
- Transferring primary-host status explicitly (it is only ever reassigned implicitly, by I2).
