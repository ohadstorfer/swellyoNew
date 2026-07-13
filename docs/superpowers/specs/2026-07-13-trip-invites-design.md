# Trip Invites (Recommended Users)

## Problem

Group trip hosts currently have no way to proactively bring new, relevant surfers into a trip. The only existing paths are: (a) a user requesting to join and the host approving (`requestToJoinTrip` / `approveJoinRequest` in `groupTripsService.ts`), or (b) `AddMembersSheet`, which only lets a host add people from their existing DM contacts.

We want a small "trip invite" system: after creating a trip, the host can open a recommended-users list (surfers whose profile aligns with the trip's criteria), view their profile, and invite them. The invited user gets a notification; accepting adds them to the trip.

## Data model

New table `trip_invites`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `trip_id` | uuid fk → trips | |
| `invited_user_id` | uuid fk → users | recipient |
| `invited_by` | uuid fk → users | must be the trip host at time of invite |
| `status` | text | `pending` \| `accepted` \| `declined` \| `cancelled` |
| `created_at` | timestamptz | |
| `responded_at` | timestamptz | null until accepted/declined |

Unique constraint on `(trip_id, invited_user_id)`. Re-inviting after a `declined`/`cancelled` status updates the same row (status → `pending`, `responded_at` → null) rather than inserting a new one.

RLS: host can insert/select/update invites for their own trip; invited user can select their own invites and update status (accept/decline) on their own row only.

New `notification_type` enum values (extending `20260601010000_notification_center.sql`): `trip_invite_received`, `trip_invite_accepted`, `trip_invite_declined`. Added via `alter type notification_type add value ...` migrations (must run in a separate transaction/migration from any code that references the new value, per Postgres enum rules).

## Recommendation / matching

Reuse the scoring logic already in `src/services/matching/matchingServiceV3.ts` (board type, surf level, age range, country/destination alignment). A new function builds the match criteria from the trip itself (destination, dates, board type, surf level, participants' age range) and runs it against candidate users, excluding:
- existing trip participants
- users with a `trip_invites` row in `pending` or `accepted` status for this trip

Results are ranked by the existing `priorityScore` weighting (board type match, surf level match, age range match, destination match).

## UI

**Entry point:** `TripMembersScreen` — host-only "Invite" button fixed above the members list.

**`InviteMembersSheet` (new):** lists recommended users as cards (photo, name, surf level, board type, country). Each card has:
- **View profile** — navigates to the existing profile screen/component (no new profile UI needed).
- **Invite** — inserts/updates the `trip_invites` row to `pending`.

**Notification + accept flow**, mirroring `approveJoinRequest()` (`groupTripsService.ts:1927`):
1. Insert into `trip_invites` (`pending`) → DB trigger inserts a `notifications` row (audience: invited user, type `trip_invite_received`) → push via existing `dispatch-notification-queue` / `send-push-notification`.
2. Invited user sees it in NotificationCenter; tapping opens a trip invite detail (trip summary + Accept/Decline).
3. **Accept** → status → `accepted`; insert into `participants` (role `member`); add to trip conversation; post a system message (matches `approveJoinRequest`'s existing side effects); trigger notification `trip_invite_accepted` back to the host.
4. **Decline** → status → `declined`; trigger notification `trip_invite_declined` to the host (no system message — silent).

## Out of scope

- Bulk/mass inviting.
- Expiring invites automatically.
- Any change to the existing join-request (user-initiated) flow — this is a parallel, independent path.

## Known gotcha to carry over

Per `project_join_request_notification_gaps` memory: react-query cache staleness between `TripMembersScreen` (unmounts each visit) and `TripDetailScreen` (stays mounted) has bitten the join-request feature before. Any new invite-list/pending-count query key must be invalidated on both realtime broadcast and screen focus-regain.
