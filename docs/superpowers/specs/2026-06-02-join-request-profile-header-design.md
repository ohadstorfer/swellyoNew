# Join-Request Approve/Decline header on Profile

**Date:** 2026-06-02
**Author:** Ohad (with Claude)
**Status:** Design — awaiting review

## Problem

When a host opens the profile of a user who has requested to join one of their
group trips, there is no way to act on that request from the profile. Today the
Approve/Decline action lives only in the Notification Center
(`NotificationCenter.tsx`). A host browsing the requester's profile to decide
has to back out to notifications to act.

We want: when the host views the profile of someone with a **pending** join
request to a trip the host owns, show an Approve/Decline header at the top of
the profile.

## Scope

- One new service query, one new component, edits to `ProfileScreen.tsx`.
- **No DB migration, no RLS change, no changes to notification/trip-detail call
  sites.** Reuses existing `approveJoinRequest` / `declineJoinRequest`.

Out of scope: changing the Notification Center, multi-request management UI,
any non-host flows.

## Key decisions (locked with user)

1. **Self-detecting, not context-threaded.** The profile does not need to be
   told about a trip/request from the caller. It detects on its own whether the
   viewed user has a pending request to any trip the current user hosts.
   *Rationale:* "no importa de dónde llega" — works identically from
   notifications, trip detail, search, anywhere.
2. **Solid white bar pinned at top, NOT floating** (wireframe option). When a
   pending request exists, the bar sits above the cover and pushes the
   immersive cover photo down. When there is no request, the profile renders
   exactly as today (bar absent, cover full-bleed).
3. **Action animation:** tap → inflight spinner → bar morphs smoothly to a
   single confirmation pill ("Approved ✓" / "Declined") → short hold → the
   whole profile slides up and off-screen, then unmounts.

## Data flow

### New service: `getIncomingJoinRequest`

In `src/services/trips/groupTripsService.ts`, next to the existing join-request
functions:

```ts
type IncomingJoinRequest = {
  requestId: string;
  tripId: string;
  tripTitle: string;
};

// Returns the most recent PENDING request from `requesterId` to any trip
// owned by `hostId`, or null.
getIncomingJoinRequest(
  hostId: string,
  requesterId: string,
): Promise<IncomingJoinRequest | null>
```

Query:

```
SELECT jr.id, jr.trip_id, gt.title
FROM group_trip_join_requests jr
JOIN group_trips gt ON gt.id = jr.trip_id
WHERE gt.host_id = :hostId
  AND jr.requester_id = :requesterId
  AND jr.status = 'pending'
ORDER BY jr.created_at DESC
LIMIT 1
```

(Implement via Supabase client with an inner join on `group_trips`, filtering
`host_id` and `status`.)

**Multiple-pending edge case:** host owns several trips and the same user
requested more than one → we surface the most recent and show its trip title in
the bar subtitle (`wants to join · <Trip title>`). Acting on it approves/declines
only that one request. Documented limitation; no batch handling for now.

### In `ProfileScreen.tsx`

- Run the query once, on mount / when `userId` changes, **only when viewing
  another user** (`!isViewingOwnProfile && !!userId`). Guard against running for
  own profile.
- State: `incomingRequest: IncomingJoinRequest | null`, `requestActionState:
  'idle' | 'approving' | 'declining' | 'approved' | 'declined' | 'error'`.
- `incomingRequest === null` → render unchanged. No layout shift, no extra UI.
- Failures in the lookup fail silently (no bar) — never block the profile.

## UI

### New component: `src/components/trips/JoinRequestActionBar.tsx`

Self-contained, presentational. Props:

```ts
{
  tripTitle: string;
  state: 'idle' | 'approving' | 'declining' | 'approved' | 'declined';
  onApprove: () => void;
  onDecline: () => void;
}
```

Layout (solid bar, full width):

- Optional thin subtitle row: `wants to join · {tripTitle}` (muted, 12–13px).
- Button row, `gap: 12`, horizontal padding 16, buttons `flex: 1`,
  `height: 38`, `borderRadius: 8`.
  - **Decline:** `backgroundColor: #FFFFFF`, `borderWidth: 1`,
    `borderColor: #C9CED4`, text `#222B30`, weight 600.
  - **Approve:** `backgroundColor: #212121`, white text, weight 700.
- Tokens mirror `NotificationCenter.tsx:395–430` for visual consistency.
- `Pressable` with pressed scale ~0.97 feedback.
- `state === 'approving' | 'declining'`: show `ActivityIndicator` in the active
  button, both disabled (prevents double-approve).
- `state === 'approved' | 'declined'`: the two buttons collapse (cross-fade,
  ~250ms) into one full-width confirmation pill — `Approved ✓` (dark/positive)
  or `Declined` (muted). This is the "morph" step before dismissal.

### Placement in `ProfileScreen.tsx`

The bar is rendered as a **sibling above the `ScrollView`**, inside the existing
`ImageBackground`, so it stays pinned at the top and the scroll content (cover
image at `coverContainer`, ~line 2205) flows below it. It is NOT inside the
ScrollView and does NOT float over the cover.

- Top padding: `insets.top` (`useSafeAreaInsets` already in the screen) so it
  clears the status bar / notch.
- Only mounts when `incomingRequest` is set.
- The existing floating back button (`styles.backButton`, absolute `top: 54`)
  and 3-dot menu remain; verify they don't visually collide with the bar — if
  they do, when the bar is present nudge the cover/back-button offset down by
  the bar height. (Implementation detail to confirm visually.)

## Interaction & animation

1. **Tap Approve/Decline** → set `requestActionState` to `approving`/`declining`,
   call `approveJoinRequest(requestId)` / `declineJoinRequest(requestId)`.
   - Approve already adds the user to the trip's group conversation and posts
     the system "joined" message — reuse as-is, do not reimplement.
2. **On success** → set state to `approved`/`declined`; bar morphs to the
   confirmation pill (~250ms cross-fade).
3. **Auto-dismiss** → after a ~600ms hold, animate the whole profile up and off:
   drive a Reanimated `translateY` from 0 → `-screenHeight` (reuse the existing
   `Reanimated.View` wrapper at ~line 1949 that already powers the swipe-in;
   add a `dismissUpward()` that runs the exit timing then calls `onBack()` /
   the existing `handleBackPress`). AppContent unmounts the overlay on `onBack`.
4. **On error** → state `error`, revert to the two buttons, show an inline
   error / toast, no dismiss. User can retry.

## Files touched

| File | Change |
|---|---|
| `src/services/trips/groupTripsService.ts` | + `getIncomingJoinRequest(hostId, requesterId)` + `IncomingJoinRequest` type |
| `src/components/trips/JoinRequestActionBar.tsx` (new) | presentational Approve/Decline bar with morph states |
| `src/screens/ProfileScreen.tsx` | fetch incoming request (other-user only); render bar above ScrollView; wire approve/decline; add slide-up exit |
| `src/components/AppContent.tsx` | none expected — verify `onBack` cleanly unmounts the profile overlay |

## Testing / acceptance criteria

- Host opens profile of a user with a pending request to their trip → bar shows
  with correct trip title.
- Host opens profile of a user with **no** pending request → no bar, profile
  unchanged, no layout shift.
- Non-host (or viewing from a trip you don't own) → no bar.
- Approve → user added to trip + group chat (existing behavior), bar morphs to
  "Approved ✓", profile slides up and dismisses.
- Decline → status declined, bar morphs to "Declined", profile dismisses.
- Double-tap during inflight does not fire two approvals (buttons disabled).
- Service error → bar reverts, profile stays open, no crash.
- Own profile never triggers the lookup.

## Risks / watch-outs

- The floating back button (absolute, `top: 54`) was designed over a full-bleed
  cover; with a solid top bar present, confirm spacing visually so it doesn't
  overlap the bar.
- Approve does multiple side effects inside `approveJoinRequest` (chat +
  participant insert via DB trigger) — keep using the single service call.
- Lookup runs on every other-user profile open: one indexed query on
  `(trip_id, requester_id)` / `host_id`; negligible, and fails silent.
