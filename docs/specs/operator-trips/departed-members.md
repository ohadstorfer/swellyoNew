# Departed members — the record that survives leaving

*Written 6 September 2026, after test X-07 was confirmed and Ohad decided the
direction the same day. Built the same day, except the two migrations.*

## Status, 6 September 2026

| Phase | State |
|---|---|
| **0** — ghosts from the ledger | **DONE.** `operator-dashboard/src/services/departed.ts` + the "No longer on the trip" card on the Money page. No schema change; works today; the only thing that will ever find people removed *before* phase 1. |
| **1** — schema and the word "present" | **WRITTEN, NOT APPLIED.** `supabase/migrations/20260906000300_departed_members_phase1.sql`. Blocked on approval to run DDL against the live database. |
| **2** — the two RPCs | **WRITTEN, NOT APPLIED.** `supabase/migrations/20260906000400_departed_members_phase2.sql`. Requires phase 1 first. |
| **2 (clients)** | **DONE.** `leaveTrip()` / `removeParticipant()` call the RPCs and fall back to the old delete when the function is missing (`PGRST202`), so the JS is safe to ship in either order. |
| **3** — screens | **DONE.** The Exit confirm names what you paid and the terms; the roster's "No longer on the trip" section is on both surfaces (`TripPage` on web, `TripMembersScreen` on the phone). Empty until phase 1 lands, and safe either way. |
| **4** — the purge clock | **DECIDED, no code.** Ohad, 6 Sep: leave it on the existing trip-end clock. See §2.7. |

The `member_left` notification carries `paid_usd` and goes to `money.manage`
holders (phase 2 migration), and `dispatch-notification-queue/render.ts` reads
it — **that edge function needs redeploying** for the new wording to appear.

## 0. The decision in one paragraph

A traveler who leaves an operator trip — on their own, or removed — **keeps a
record**. The admins still see them, marked as no longer on the trip, with
everything they paid, everything refunded, and every document they sent. The
operator can still refund them from that record. Today the participant row is
deleted and the person vanishes from every screen, even though every money
row about them survives in the database with nowhere to be shown.

## 1. Where we actually are (verified 6 Sep 2026)

**Two paths delete the row, and neither knows about money.**

- `leaveTrip()` in `groupTripsService.ts` — the traveler's own **Exit trip**.
  Posts a chat banner, calls `fn_notify_member_left`, then
  `delete from group_trip_participants`. No check for an operator trip, no
  check for a paid deposit. The confirm text talks about the group chat. The
  operator gets the ordinary "Oh no! Someone left your trip 📉" push and
  nothing about the $1,000 that stayed behind. **This is X-07.**
- `removeParticipant()` — the host's **Remove**. The phone
  (`TripMembersScreen`, `TripDetailScreen`) and the website run the refund
  sheet *first*, then call this, which does the same delete and passes the
  refunded amount into the push. Money is handled; the record is still lost.

**Everything about the person survives the delete.** Every table that holds
what they paid, agreed to, or sent is keyed to `(trip_id, user_id)` against
`auth.users`, not to the participant row:

| Table | Keyed to | On participant delete |
|---|---|---|
| `organized_trip_payment_events` | user + trip | survives |
| `organized_trip_refunds` | user + trip | survives |
| `organized_trip_policy_consents` | user + trip | survives |
| `organized_trip_travelers_documents` | user + trip | survives |
| `organized_trip_medical_forms` | user + trip | survives |
| `group_trip_participants` | — | **gone**: frozen price, deposit, joined_at, status |

So the ledger for a departed traveler is intact. `payments-refund` never reads
`group_trip_participants` — it could refund them today. What is missing is
(a) the row that lists them anywhere, and (b) the price they were on.

**What counts "present" today, and how.** All of these already use `status`:

- capacity — `enforce_group_trip_max_participants` counts `status = 'active'`
- `participant_count` — `sync_group_trip_participant_count`, same
- the two dashboards' "+N still joining" — `status = 'onboarding'`

And these do **not** look at status — they count any row at all:

- `is_trip_participant()` — every RLS policy that says "a member may read"
- `is_trip_host()` — role only
- `enforce_traveler_not_staff` / `enforce_staff_not_traveler` — any row
- `activate_trip_membership()` — reads status, but only knows two values
- `unique (trip_id, user_id)` — one row per person, ever

**Status is pinned.** `enforce_participant_status` sets `'onboarding'` on
insert for operator trips and refuses every status change from a user token.
Only `activate_trip_membership()` moves it, by lifting a transaction-local GUC
(`app.membership_activation`) for exactly one statement. That is the pattern
to reuse.

## 2. The design

### 2.1 Never delete an operator-trip participant row. Mark it.

Two new values on `group_trip_participants.status`:

```
'onboarding' | 'active' | 'left' | 'removed'
```

and three columns:

```
left_at     timestamptz   -- when they stopped being on the trip
left_by     uuid          -- null = they left themselves; else who removed them
left_reason text          -- the operator's note, optional
```

**Peer trips keep deleting.** Nothing on a peer trip needs the record — no
money, no documents — and G-01/G-02 in the test pass exist precisely so the
operator work does not change them. The rule keys on `hosting_style = 'C'`.

### 2.2 "Present" means `status in ('onboarding','active')`, everywhere

Every place in §1 that counts any row learns the word "present":

| Object | Change |
|---|---|
| `is_trip_participant()` | `and status in ('onboarding','active')` — a departed traveler loses the roster, the other travelers' documents, the group's requirements. They keep their own rows: `otpe_read_own`, `trip_refunds_select_own`, `otd_select`, `medical_traveler_select` all say `user_id = auth.uid()`, and that is right — X-16 asks that a refunded person can see their own refund. |
| `is_trip_host()` | same filter, for symmetry; a host cannot leave (`protect_trip_owner_membership`) so this is belt and braces |
| `enforce_traveler_not_staff`, `enforce_staff_not_traveler` | ignore departed rows — someone who left as a traveler may be crew next year |
| `activate_trip_membership()` | `'left'`/`'removed'` → raise "Not a participant of this trip" (same error it gives for no row) |
| `enforce_group_trip_max_participants`, `sync_group_trip_participant_count` | already correct — a departed row is not `'active'` and takes no seat |
| `scan-stalled-onboarding` | skip departed — no nudging somebody who left |
| `scan-requirement-deadlines`, "Remind N people" | skip departed |
| `organized_trip_requirements_resolved`, `operator_trip_my_requirements`, the dashboard's late counts, `SummaryTiles`, `TripDashboardTab` | present only |
| `organized_trip_traveler_prices` (the N-10 view) | already carries `status` — nothing to change; that is how the roster tells "left" from "on the trip" |
| exports (zips) | present only by default; the payments CSV already includes everyone in the ledger |

### 2.3 Two RPCs, no client deletes

```
leave_operator_trip(p_trip_id)                       -- the traveler
operator_remove_traveler(p_trip_id, p_user_id, p_reason)  -- host / travelers.remove
```

Both: verify the caller, lift a new transaction-local GUC
(`app.membership_departure`) for one statement, set `status`, `left_at`,
`left_by`, `left_reason`, put the GUC back. `enforce_participant_status` honours
the GUC exactly as it honours `app.membership_activation`. Client code stops
calling `.delete()` on operator trips; `leaveTrip()` and `removeParticipant()`
branch on `hosting_style`.

The chat removal, the banner, and the join-request cleanup stay as they are.

### 2.4 Rejoining reactivates the row

`unique (trip_id, user_id)` means a person who left and asks again already has
a row. The approve path (`fn_approve_join_request` or whichever RPC inserts
the participant) does `insert … on conflict (trip_id, user_id) do update set
status = 'onboarding', left_at = null, left_by = null, left_reason = null,
joined_at = now()`. `enforce_group_trip_max_participants` already treats an
UPDATE from a non-active status as claiming a new seat, so the capacity check
fires on the way back in. Their frozen price is re-frozen by
`freeze_traveler_price` on that update — at *today's* trip price, which is
the right answer: they are joining again, not resuming.

### 2.5 The traveler's Exit on an operator trip — X-07 itself

`Exit trip` stays in the menu. The confirm changes to say what happens to the
money, in plain words, and it depends on whether they paid:

- **Paid nothing:** "You'll leave the trip. You can ask to join again later."
- **Paid something:** "You'll leave the trip. Your payments stay with the
  operator — the refund terms you agreed to when you paid are *{policy
  summary}*. Ask the operator about a refund." Then Leave / Stay.

No automatic refund. The policy may be non-refundable, and the operator
decides; the point is that the traveler hears the terms before pressing Leave
and the operator hears about the money after. Which needs:

- `fn_notify_member_left` on an operator trip carries `paid_usd` and the
  policy summary in `data`. The renderer says: "*Dana* left *Bali Week* —
  paid $1,000. Decide their refund from their page." Recipient: staff with
  `money.manage` (the operator and any co-operator), not every host.
- The traveler's own trip page after leaving: "You left this trip on 3 Sep.
  Your payments: $1,000. Refunded: $0." — the same money view they had, read
  through their own rows.

### 2.6 What the admins see

**Roster, both surfaces.** A section under the travelers: **No longer on the
trip** — name, "Left 3 Sep" / "Removed 3 Sep by Ohad · *reason*", paid,
refunded. Sorted by `left_at` desc. Collapsed when empty.

**Traveler page, both surfaces.** The same page as today with a state chip in
the header ("Left 3 Sep"), the money card as today, the **Refund** button live,
documents read-only, Remove gone (already not on the trip), Price gone (there
is nothing to charge them for). Managers see them — they hold
`travelers.view_profiles` — but only money staff see the Refund button, same as
now.

**Counts.** Departed people are in no count anywhere except the payments
totals, where they always were.

### 2.7 The 30-day document clock — decided: leave it alone

`purge-group-documents` has three cases. Case 1 deletes a traveler's files 30
days after the **trip ends**. Case 2 deletes them 30 days after they stop being
a participant, and it tests that by asking whether they have a **row** — not by
reading `status`.

So keeping the row has a consequence that needs saying out loud: a departed
operator-trip traveler **stops falling into case 2** and waits for case 1
instead. Ohad decided on 6 September to leave exactly that: the operator may
still need a passport copy for an insurance claim or a cancellation weeks after
somebody drops out, and 30-days-after-the-trip is the retention the traveler
disclosure already promises. Nothing outlives that promise either way.

Peer trips still delete the row, so a peer-trip departure is purged 30 days
after they left, exactly as before.

**No code change** — but a comment now sits on case 2 saying this, because the
next reader would otherwise "fix" it by adding a status filter and silently
move everyone back onto the earlier clock.

## 3. Phases

**Phase 0 — ghosts from the ledger (no schema change, ships first).** The
dashboard's `MoneyPage` and `PaymentsPage` list every `user_id` in
`organized_trip_payment_events` for the trip that has no participant row, as
"No longer on the trip (from payments)", with a Refund button. This gives the
operator a refund path for everyone removed *before* this plan lands, and it
is one query. The phone follows when its money page is next touched.

**Phase 1 — schema and the word "present".** The CHECK, three columns, the GUC,
`enforce_participant_status`, and every function in §2.2. One migration,
rehearsed in a rolled-back transaction as a stranger, a traveler, a departed
traveler, and the operator, the way N-10 was.

**Phase 2 — the two RPCs, and the clients stop deleting.** `leaveTrip()` and
`removeParticipant()` branch on `hosting_style`. The approve path gains the
`on conflict` reactivation. The three cron jobs skip departed.

**Phase 3 — the screens.** Roster section, traveler-page chip, the Exit confirm
with money words, the richer `member_left` notification. Phone and website
together, per the parity rule.

**Phase 4 — the purge clock**, once §4 is decided.

## 4. Decisions

**Settled 6 September:** peer trips keep deleting (no); the purge clock stays
on trip-end (§2.7); the departed list is Manager and up; Exit stays allowed
after paying, with the money words. Only the first is still worth revisiting.

### Still open

1. **Peer trips too?** Built as no. If it ever changes,
   `unique(trip_id, user_id)` reactivation applies to them as well, and
   G-01/G-02 in the test pass change with it.

## 5. Tests this adds to the pass

- **X-07** becomes: "Pay, then Exit. The confirm names your refund terms. You
  are gone from the roster and the counts, listed under *No longer on the
  trip*, and the operator's push says what you paid."
- **X-17** (new): "Refund someone who already left. Works from their record."
- **X-18** (new): "Leave, then ask to join again. Same row, back in onboarding,
  today's price, seat counted."
- **X-19** (new): "As a departed traveler, open the trip. You see your own
  payments and refunds and nothing else."
- **G-02** unchanged: peer trips still delete.
