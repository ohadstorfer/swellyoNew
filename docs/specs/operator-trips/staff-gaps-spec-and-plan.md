# Operator Trips — closing the staff gaps

Ohad, 2026-08-17. Spec + plan for everything still missing from the operator
trips checklist (`docs/operator-trips-checklist.html`).

**STATUS: all six phases BUILT 2026-08-17, same day, uncommitted.** The
migration `20260817000000_updates_send_capability.sql` is **APPLIED to prod**
(2026-08-17). The only gate left is a device test with a second account on an
all-dev-member trip. Type-check is clean (only the repo's known baseline
errors); the trips test suites pass (the one failure, `tripInvitesService`, is
pre-existing and unrelated).

## The one fact that shapes this whole plan

**The database is finished. The client never asks it anything.**

Phases 0–2 of [staff-and-permissions.md](./staff-and-permissions.md) are
applied to prod. Every RLS policy and RPC already answers through
`trip_staff_can(trip_id, capability)`. A Manager with `docs.approve` can
already approve a passport — the server will let them. The app just never
shows them the button, because every client gate is still `isHost`, and staff
are not participants, so `isHost` is always false for them.

The client hook is also done: `useTripCapabilities()` in
`src/hooks/trips/useTripCapabilities.ts` — written, tested, documented, and
called by **zero screens**.

So most of this plan is client-only. One small migration is needed (Phase B),
and everything else ships as JS.

## What each missing item needs

| # | Missing item | Client | DB |
|---|---|---|---|
| 1 | Staff get the Plan tab at all | yes | no |
| 2 | Manager gets the Dashboard tab (2.3) | yes | no |
| 3 | Guide/crew see group surf + travel stats (2.2h) | yes | no |
| 4 | Guide/crew send admin updates (2.2c) | yes | **yes — small** |
| 5 | Crew section moves from Overview to Plan (1.2, 2.1b) | yes | no |
| 6 | Crew card opens a sheet with more info (1.1c) | yes | no |
| 7 | Operator settings editable after setup | yes | no |
| 8 | Review a crew member's docs in the app (2.4) | yes | no |
| 9 | Manager gets the trip edit screen (1.3) | yes | no |
| 10 | "What's included" as a real Overview section (1.1b) | yes | no |

Accommodation position (1.1d) is already done — moved under "About this trip"
in `TripDetailViewRedesigned.tsx` on 2026-08-17.

---

## Phase A — wire the capabilities (unlocks 1, 2, 3, 9)

The single highest-leverage change. One screen, no migration.

### A1. Fetch the answer

`TripDetailScreen.tsx` calls `useTripCapabilities(tripId)` once, next to the
existing `useTripCrew` call (line ~803). One RPC per trip, cached 5 minutes.

### A2. Staff get the Plan tab

Today (`TripDetailScreen.tsx:1091`):

```ts
const canSeePlan = (isHost || isApprovedMember) && !isLockedForTabs;
```

becomes:

```ts
const canSeePlan = (isHost || isApprovedMember || can('roster.view')) && !isLockedForTabs;
```

`roster.view` is the right key: it is what Crew tier and up carry, and it is
exactly what the Plan tab shows (members, updates, gear). A Listed credit has
no account and no `roster.view`, so nothing changes for them.

Inside Plan, staff are not travelers, so three sections must not assume a
participant row:

- **Pay section** — already skipped (staff have no payment rows).
- **Travel wallet / Open tasks** — traveler requirements. For staff, render
  their **own paperwork** here instead (data already exists:
  `fetchMyStaffRequirements`, shown today on `StaffPaperworkScreen`). Same
  wallet card, fed from the staff rows. The separate menu entry stays.
- **Commit pill** — already gated off operator trips.

### A3. The Dashboard tab opens per capability

Today (`TripDetailScreen.tsx:1095`):

```ts
const canSeeDashboard = isHost && !!isOperatorTrip;
```

becomes: the tab appears if the viewer has **any** dashboard capability, and
each card inside gates on its own one:

| Dashboard piece | Capability | Who gets it (seeded tiers) |
|---|---|---|
| Money card + traveler payment rows | `payments.view_status` | Manager, Operator |
| Documents card + review queue | `docs.view` (approve/reject buttons need `docs.approve`) | Manager, Operator |
| Medical card | `medical.view` | Manager, Operator |
| Surf + travel stats | `travelers.view_stats` | Guide, Manager, Operator |
| Manage requirements | `trip.edit` | Manager, Operator |
| "Remind N people" | `docs.approve` | Manager, Operator |
| Stripe banner, refunds, per-traveler price, remove traveler | stays on `host_id` / `money.manage` (except remove: `travelers.remove`) | Operator (+ Manager for remove) |

So a **Guide** sees a one-card Dashboard (stats) — which is exactly item
2.2h. A **Manager** sees everything except money-moving — exactly 2.3. The
server already enforces every one of these, so a bug here shows a broken
button, never leaked data.

`TripDashboardTab` takes a `can` prop (or the caps array) and hides cards; the
review screen hides approve/reject when `docs.approve` is absent.

Rule from the spec stays: **never** branch on the role name, only on
capabilities. No `tier >= 4` anywhere.

### A4. Manager gets the edit screen (item 9)

The "Edit trip" menu entry (`TripDetailScreen.tsx:~2649`) is gated
`isTripOwner` because the edit screen can change the price. Split it:

- Menu entry: `can('trip.edit')`.
- Inside `OperatorTripEditScreen`: the **Price** section (price, deposit,
  getting paid, payment deadline) renders only for the operator of record —
  the same `host_id` check the server makes. Everything else (cover, name,
  description, dates, requirements, gear, updates, visibility) is `trip.edit`,
  which RLS already allows a Manager.

"Crew" (staff.manage) stays operator-only. That is hard-locked in the DB on
purpose and does not move.

**Files:** `TripDetailScreen.tsx`, `TripDashboardTab.tsx`,
`DocumentReviewScreen.tsx`, `OperatorTripEditScreen.tsx`,
`useTripCapabilities.ts` (no change, just finally imported).

---

## Phase B — `updates.send` (unlocks 4) — the only migration

Sending an admin update is gated `trip.edit`
(`20260807000100_operator_trip_staff_gates.sql:105`). The Guide tier's blurb
literally promises "Adds chat, updates, stats" — but the seed gives Guide no
`trip.edit`, so a Guide's insert is refused. Granting `trip.edit` to Guide
would also hand them the whole edit screen. Wrong tool.

One migration:

1. New capability key `'updates.send'` (documented in the hook's type union).
2. Rewrite the three `group_trip_admin_updates` policies:
   `trip_staff_can(trip_id, 'trip.edit') OR trip_staff_can(trip_id, 'updates.send')`.
   Update/delete stay author-or-`trip.edit` (a Guide edits their own update,
   not the operator's).
3. Seed `updates.send` into the global `guide` row (one `UPDATE`). Adding it
   to `crew` later is one more `UPDATE` — no release. **Decide with Eyal
   whether Crew tier sends updates**; the wishlist says yes, the seeded
   "present but silent" blurb says no. Default: Guide only.

Client: `AdminUpdatesCard`'s `isHost` prop becomes `canSend`
(= `isHost || can('updates.send') || can('trip.edit')`).

Applied by hand in the SQL editor, as always. No new RPCs, so no GRANT to
remember.

**Files:** one migration file, `PlanSections.tsx` (AdminUpdatesCard prop),
`TripDetailScreen.tsx`, `useTripCapabilities.ts` (add the key).

---

## Phase C — the Crew section moves home (unlocks 5, 6)

One new component, used twice.

### C1. `CrewSection` + `CrewMemberSheet`

- Extract the crew list JSX from `TripDetailViewRedesigned.tsx` (~line 704)
  into `src/components/trips/CrewSection.tsx`.
- Cards become pressable. Tap opens `CrewMemberSheet` — a `BottomSheetShell`
  (house rule: every new sheet) with photo, name, role label, and the **full**
  bio (the card cuts it at three lines).
- Data needs nothing new: `useTripCrew` already returns id, name, title, bio,
  avatar.

### C2. Where it renders

- **Overview, non-members** (1.1): keep it, now with the sheet.
- **Overview, members** (1.2): hide it — same trick as the Participants row,
  which already hides when the viewer has a Plan tab
  (`TripDetailViewRedesigned.tsx:841`). Pass the same flag.
- **Plan** (2.1b / 2.2b): render `CrewSection` between Members and Admin
  updates in `TripDetailScreen.tsx`'s Plan block.

Later (optional): crew members with an account could open their real profile
instead of the sheet. The staff row has `user_id`; expose it from
`useTripCrew` and call `onViewUserProfile` when present. This also closes the
2.4 "partly" (operator opening a crew member's surf profile).

**Files:** new `CrewSection.tsx`, new or inline `CrewMemberSheet`,
`TripDetailViewRedesigned.tsx`, `TripDetailScreen.tsx`.

---

## Phase D — operator settings, editable after setup (unlocks 7)

**What this means (Ohad, 2026-08-17): the fields chosen during setup must be
changeable later from Settings — not a new screen concept.**

The good news: `OperatorSetupScreen` was already built for revisits — finished
steps recede but stay tappable, and its own header comment says re-entering to
change things "is allowed and expected". The only thing missing is a door.

1. **Settings row.** In `SettingsScreen.tsx`, next to "Default price
   currency", add an "Operator settings" row for operators
   (`surfers.operator`). It pushes the existing `OperatorSetup` route — which
   already works when setup is complete; only the banner entry disappears
   today.
2. **Rename in place.** When every step is done the screen's header reads
   "Operator settings" instead of "Set up"; the progress line ("6 of 6 done")
   hides.
3. **Check each step allows a second pass:**
   - Currency — already editable (also in Settings).
   - Policy — re-pick works; new trips only. Frozen copies on published trips
     do not change (by design — `trip-cancellation-freeze`).
   - Waiver — re-upload replaces the default for future trips.
   - Insurance — re-upload sends it back to `under_review`. This is the one
     that matters: insurance expires.
   - Stripe — the step becomes "Open Stripe dashboard" (Connect express
     login link) once the account is live.
   - Agreement — read-only view of what was signed, with the date. Signing is
     once.

**Files:** `SettingsScreen.tsx`, `OperatorSetupScreen.tsx`,
`operatorSetup.ts` (a `mode: 'setup' | 'settings'` if the copy needs it).

---

## Phase E — crew paperwork review in the app (unlocks 8)

Today the operator can ask crew for docs and crew can upload them, but only
the web dashboard's Crew page can look at what arrived. In the app:

1. In `TripStaffSheet`, each crew row with requirements shows a status line
   ("2 of 3 docs in") — data from `listStaffRequirements` /
   `staffRequirementsService`, which already joins assignments per person.
2. Tapping the status opens the document: reuse `DocumentViewer` +
   `RejectDocumentSheet` (the traveler review pieces), fed from the
   staff-audience rows. Approve / reject writes go through the same tables —
   RLS already allows it (`docs.approve` on staff-audience requirement rows,
   and `staff.manage` is operator-only so in practice this is the operator).
3. No new service functions expected — check `staffRequirementsService`
   exposes the file path + status per assignment; add a small read if not.

Scope guard: this is review-only. Reminders, deadlines-for-staff, and staff
notifications stay out (staff get no notifications at all today — that is the
known "Still open after Phase 2" item in staff-and-permissions.md, and it is
bigger than this phase).

**Files:** `TripStaffSheet.tsx`, `StaffPaperworkSection.tsx` (status display),
maybe `staffRequirementsService.ts`.

---

## Phase F — "What's included" becomes a section (unlocks 10)

Flow C trips only. The content already exists behind the Price chip
(`priceInclusions.ts` + the `WizardBottomSheet` at
`TripDetailViewRedesigned.tsx:1006`).

- New Overview section under Accommodation: title "What's included", the
  included/not-included rows rendered inline (same rows the sheet shows).
- The Price chip keeps opening the sheet — it is the answer to "what am I
  paying for", and chips can't scroll the page.
- If the inline list is long, cap at ~5 rows + "See all" opening the same
  sheet.

**Files:** `TripDetailViewRedesigned.tsx` only.

---

## Order and size

| Phase | What | Size | Depends on |
|---|---|---|---|
| A | Capability wiring — Plan tab for staff, Dashboard per capability, manager edit | **L** — the big one | — |
| B | `updates.send` migration + client | S | A (client half) |
| C | Crew section → Plan, tappable sheet | M | — (parallel with A) |
| D | Operator settings door | S | — (parallel) |
| E | Crew doc review in app | M | — (parallel) |
| F | What's included section | S | — (parallel) |

A is the unlock and should go first. C, D, E, F touch disjoint files and can
run in parallel worktrees. B is a 20-minute follow-up to A.

## How to verify (no simulator — code + tsc, device by Ohad)

- `npx tsc --noEmit` — only the known baseline errors.
- Phase A: on a test trip, add a dev account as Manager → Dashboard tab
  appears, money card visible, refund button absent. Add as Guide → Plan tab +
  one-card Dashboard. As Crew → Plan tab, no Dashboard.
- Phase B: as Guide, post an update (before the migration this 403s — good
  proof the gate moved).
- All staff testing on all-dev-member trips only (prod rule).

## Known NOT done (deliberately out of scope)

These are real, and none of them is in the checklist's ten gaps — they are
either the spec's own "Still open after Phase 2" items or a second pass.

1. **Staff get no notifications.** The fan-out builds `trip_admin_ids` from
   `participants.role = 'host'` and does not know the staff table exists. So
   an invited guide is never told, and a Manager misses every document and
   payment notification. Its own piece of work — see staff-and-permissions.md.
2. **Staff are not in the group chat.** `chat.participate` is granted by the
   Guide and Manager tiers and wired to nothing: a guide needs a conversation
   membership, which is a separate permission system. The chat CTA therefore
   stays host-and-member only, on purpose — a button that errors is worse than
   no button.
3. **Opening a crew member's real profile.** The sheet shows their card. The
   staff row carries `user_id`, but `useTripCrew` does not return it, so there
   is nothing to push a profile with. One field + one tap handler.
4. **Inviting travelers is still host-only** on the Members screen. A Manager
   reviews and removes, but does not invite. Not asked for; flag if wanted.
5. **The web `operator-dashboard/` is untouched.** Its Crew page already does
   the document review Phase E added to the app; nothing there regressed, but
   nothing there gained the new capabilities either.

## Open questions for Eyal

1. Does **Crew (tier 2)** send admin updates, or only Guide and up? (One
   `UPDATE` either way, but the seed should start right.)
2. Manager and the edit screen: OK that a Manager edits dates/description but
   the Price section is operator-only? (This spec says yes.)
3. Staff notifications are still zero (invites, docs, payments). Separate
   spec, or fold into the notifications queue work?
