# Traveler Onboarding — spec + plan

Type-C (operator) trips get a guided onboarding for approved travelers.
UI illustration: `docs/traveler-onboarding-flow.html` (source of truth for screens).

**Status: DB APPLIED + EDGE FN DEPLOYED (2026-08-10). Client written, UNCOMMITTED, NOT device-tested.**

| Phase | State |
|---|---|
| 1 — DB | **APPLIED to prod** in three parts (`traveler_onboarding_status_part1/2/3`). All 42 existing participant rows backfilled to `'active'`; `participant_count` verified unchanged. |
| 2 — `payments-checkout` | **DEPLOYED** (`--use-api`, project `rfdhtvcmagsbxqntnepv`). `verify_jwt` stays `true` — this one needs the traveler's JWT. |
| 3 — Client | Written, typechecks, 208 tests pass. **Uncommitted, no device test.** |

### Two live-vs-repo drifts found by diffing before applying

Both would have been production regressions:

1. **`tg_notify_member_joined`** — live hardcodes `audience = 'user'` and
   **excludes the host and all admins** (`p.user_id <> v_host` and
   `role = 'member'`). The repo copy notifies them via a `case`. Recreating
   from the repo would have spammed every operator on every join. The applied
   version is live's body + the status gates.
2. **`my_trips_feed`** — live carries **`budget_fx_rate numeric`**, the frozen
   USD→₪ rate the cards print "about ₪X" from. The repo copy does not.
   The drop-and-recreate would have silently deleted it and broken currency
   display for every Israeli user. Ported.

### Bug found on the first device run (fixed 10 Aug)

**Every second step was silently skipped.** The runner derived its step list
from `plan.remaining`, memoised on `remaining.length`. `plan` is refetched after
each completed step, so the list shrank while `index` counted up and the two
crossed:

```
[Deposit, Medical, Insurance, Flights, Visa]   index 0 -> Deposit
[Medical, Insurance, Flights, Visa]            index 1 -> Insurance  (Medical never opened)
[Medical, Flights, Visa]                       index 2 -> Visa       (Flights never opened)
```

Fix: the walk is `useState`, set exactly once from the first load. Only `index`
moves. The Done screen also compared `walk.includes(step)` — object identity
against a list rebuilt by every refetch, so it never matched; it now reads
`plan.steps` directly, which is the server's own answer.

### A hole the spec had missed

The live UPDATE policy on `group_trip_participants` is self-service and pins
only `role`:

```
using       (auth.uid() = user_id)
with check  (auth.uid() = user_id and role = <their current role>)
```

`status` was not pinned, so **any traveler could `PATCH status='active'`** and
become a member without the waiver, the medical form or the deposit. Fixed with
`enforce_participant_status()` + `trg_apply_participant_status`, same
silently-pin-the-column shape `freeze_traveler_price` already uses on this
table. The sanctioned path identifies itself with a transaction-local GUC
(`app.membership_activation`) that only `activate_trip_membership` sets — it
cannot key off `auth.uid()`, because that RPC runs as the traveler.

**The trigger name is load-bearing**: same-timing triggers fire alphabetically,
and `trg_apply_…` must sort before `trg_enforce_group_trip_max_participants`.
Otherwise an INSERT that omits `status` takes the column default `'active'`,
and the capacity check would refuse a newly approved traveler their onboarding
row on a full trip — when over-approving is the whole point.

Verified live, in a rolled-back transaction: a traveler impersonated via
`request.jwt.claims` ran `update … set status='active'` and the row stayed
`'onboarding'`. Post-test: 42 rows, all active, counts agree, no stray
`member_joined` notifications.

---

## 1. The decisions (locked)

1. **Request to join stays as it is.** Same sheet, same approval UI.
2. **Approval buys a ticket to onboarding, nothing else.** No seat, no spot in
   the count, not in the group. The traveler sees exactly what a stranger sees:
   the public trip page, plus a **Start onboarding** button. They can DM the
   organiser (anyone can).
3. **The set is FIXED on every operator trip** (Ohad, 10 Aug). Operators no
   longer choose which requirements exist or which are mandatory — every
   operator trip asks for the same seven things, split the same way, so a
   traveler who has done one operator trip knows what the next will ask.
   Source of truth: `ONBOARDING_REQUIREMENT_SPEC` in `tripDocumentsService.ts`.
   Only the **deadlines** on optional items stay the operator's call.

   Two kinds are unavoidably conditional, and neither is a bug:

   - **`deposit` only exists on a `managed` trip.**
     `enforce_pay_requires_managed_trip` raises otherwise. An offline trip
     takes money outside the app, so there is nothing here to pay.
   - **`waiver` can only be required once a PDF exists.**
     `operator_trip_my_requirements` counts an acknowledgement only if its
     `operator_document_id` matches the *current* waiver document. With no
     document the waiver is stuck at `not_started` forever — and as a
     `must_have` that means **nobody can ever join the trip**. So: the create
     wizard blocks publish without the PDF, and `publishWaiverPdf` promotes
     the requirement to `must_have` the moment one is uploaded. Trips that
     predate the rule keep the waiver as skippable until then.

   The steps, in order:

   | # | Step | Required? | Existing UI |
   |---|------|-----------|-------------|
   | 1 | Waiver | **required** | `WaiverAgreeSheet` |
   | 2 | Medical | **required** | `MedicalFormSheet` |
   | 3 | Deposit | **required** | `PayAmountSheet` |
   | 4 | Insurance | skippable | `RequirementUploadFlow` |
   | 5 | Passport | skippable | `RequirementUploadFlow` |
   | 6 | Flights | skippable | `RequirementUploadFlow` |
   | 7 | Visa | skippable | `RequirementUploadFlow` |

   Deposit goes after waiver + medical (free steps first — no refunds if they
   bail on the waiver). Skip is a full-width button, equal to Upload.

   **The deposit is all-or-nothing here** (Ohad, 10 Aug). No "pay part of it"
   sheet during onboarding: a half-paid deposit holds no spot, so offering to
   split it would let someone leave believing they are on the trip when they
   are not. Partial payments still exist for the **balance**, in the Plan tab,
   which is where paying over time actually makes sense.

   Optional steps are labelled **"Optional"**, never "Later".
4. **Finishing the required steps makes them a member.** Seat taken, counted in
   "8 of 10", Plan tab + group chat + member list appear. Skipped items become
   open tasks in the Plan tab.
5. **Onboarding never re-opens.** A rejected document or a new waiver version
   comes back as a task, not a second onboarding.

---

## 2. The core mechanic: `status` on the participant row

**The trap we must avoid:** "approved but not a participant" cannot mean "no
participant row". 15 database policies gate on `is_trip_participant()` —
requirement reads, waiver/medical writes, every upload, the storage bucket.
With no row, the approved traveler could not even see the requirement list.

**So:** approval still inserts the row. It gets a lifecycle column:

```sql
alter table public.group_trip_participants
  add column status text not null default 'active'
  check (status in ('onboarding','active'));
```

- Default `'active'` → **A/B trips completely untouched.** Every existing row
  backfills to `'active'` for free.
- Approval trigger (`handle_join_request_approval`,
  `20260429000000_create_trip_join_requests.sql:52`) inserts
  `status = 'onboarding'` **when the trip is type C**, `'active'` otherwise.
- `is_trip_participant()` keeps returning true for both statuses →
  **zero RLS rewrites.** All evidence tables and the bucket keep working.

What changes meaning:

| Question | Where | Change |
|---|---|---|
| May I touch this trip's documents? | `is_trip_participant()` | none — both statuses pass |
| Do I take a spot? | `enforce_group_trip_max_participants()` | count `status = 'active'` only; ALSO fire on UPDATE onboarding→active (that is the claim moment) |
| Am I in "8 of 10"? | `sync_group_trip_participant_count()` | count `status = 'active'` only |
| "X joined the group" notification | `tg_notify_member_joined` | fire on activation, not on the onboarding insert |
| Group-chat membership | client `approveJoinRequest()` | move the `addConversationMember` + system message from approval to activation |
| Member UI (Plan tab, chat, members) | `isApprovedMember` in `TripDetailScreen` | true only when `status = 'active'` |

### Activation — when does `'onboarding'` become `'active'`?

When **every `skip_at_onboarding = 'must_have'` requirement is satisfied**
(waiver acknowledged, medical completed, deposit paid). Not "when the flow
ends" — the flow's tail is all skippable.

One new RPC, `activate_trip_membership(p_trip_id)`:

- SECURITY DEFINER; caller must be an `'onboarding'` participant.
- Re-checks server-side that every must_have requirement is satisfied, reusing
  the same evidence joins `operator_trip_my_requirements` uses. The client
  never gets to just say "I'm done".
- Flips `status → 'active'`. The capacity trigger on UPDATE is the last gate.
- Idempotent; `status` never goes backwards. Must-have requirements added
  *after* activation never demote anyone.
- REVOKE from public/anon, GRANT to authenticated (REVOKE-EXECUTE regime).

The client calls it right after the deposit step succeeds, and also
opportunistically when opening a trip where `status = 'onboarding'` but all
required items read as done (heals webhook-delay and killed-app cases).

### The full-trip race (decided: accepted, with a guard)

Seats are claimed at activation, and the deposit is paid seconds before.
14 approved for 10 spots could mean someone pays and then hits "trip is full".

Guard: **`payments-checkout` refuses to create a checkout session when
`active count >= max_participants`** — "sorry, full" happens *before* money
moves. The leftover window (two concurrent checkout sessions racing for one
seat) is small and rare; if it ever fires, the webhook sees the activation
fail and the operator refunds. Accepted for v1.

### No-deposit trips

A type-C trip with no managed payment has required set = waiver + medical
only. Same rule, same RPC — activation happens when those are done. Nothing
special-cased.

### Joining after the full-payment deadline (17 Aug)

Migration: `20260817000000_full_payment_after_deadline.sql`

The money on a managed trip is split in two: `deposit` (must_have, no
deadline, paid in onboarding) and `balance` (skippable, carrying the
operator's full-payment deadline, paid later in the Plan tab).

That split assumes the deadline is still ahead. Once it has passed, a new
traveler was being asked for a deposit and handed a final payment that was
already overdue — and because the balance is *skippable*, activation does not
wait for it. They could pay $1,000 of a $3,000 trip, finish onboarding as a
full member, take a seat, and owe the rest with no deadline left to chase
them with.

The rule now: **a traveler whose participant row is created on or after the
full-payment deadline has `deposit_usd` frozen at the whole price.** One
payment, in onboarding, for the full cost. The balance then works out to
exactly `0`, which `operator_traveler_amount_due` already returns and
`operator_requirement_pay_state` already reads as approved.

- Frozen **per traveler at join time**, like the price itself. Nobody already
  on the trip is touched, and moving the dates afterwards does not rewrite a
  deal that was already struck.
- It does **not** apply when the operator sets a traveler's price by hand —
  that is a deliberate number and the deadline must not silently overwrite it.
- Not applied on months-only trips (no `start_date`, so a relative deadline
  has no date to land on) — mirrors `resolveDeadlineDate` on the client.
- No new column, no new requirement row, no change to what activation checks.
  The whole feature is *which number gets frozen*.

Client side is copy only: `isPayingInFull()` in `tripPaymentsService.ts`
renames the step from "Deposit" to "Full payment" in the onboarding runner and
in the Plan tab's task rows. Calling the whole price a deposit — on a trip
whose page advertises a smaller one — reads as a billing error.

---

## 3. New UI

1. **The runner screen** — a **navigator route, never a Modal**. The upload
   steps launch OS pickers from a sheet dismissal; a picker fired under a
   dying Modal hangs the main thread (see `RequirementUploadFlow.tsx` header —
   this already broke uploads once). The runner:
   - orders steps required-first, plays the existing sheets inline
     (`BottomSheetShell inline` where needed),
   - progress bar, "Step N of M", full-width Skip on skippables,
   - resumes: each step's state is already in the DB via
     `operator_trip_my_requirements`, so re-entering skips finished steps,
   - ends on the done screen → calls `activate_trip_membership` if not
     already active → "Go to the trip".
2. **"Start onboarding" CTA** on `JoinDecisionOverlay` (type-C branch only;
   A/B keeps "Enter trip"). Same CTA on the trip page while
   `status = 'onboarding'`.
3. **Trip page gate** — `isApprovedMember` (`TripDetailScreen.tsx:845`)
   becomes `status === 'active'`-aware. Everything else falls out of that one
   flag: Plan tab, chat CTA, member list, itinerary.
4. **"Message organiser" pill** on the trip page organiser row — today a DM
   takes organiser → profile → message; it should be one tap, it is the escape
   hatch for someone stuck at the deposit.
5. **TripsScreen card** — an `'onboarding'` trip shows "Finish onboarding"
   instead of member state. Needs `status` surfaced through the my-trips feed
   RPC.
6. **Operator dashboard counts** — "8 of 10" is not enough once over-approving
   is normal. Show **confirmed / still onboarding / spots** (mobile Dashboard
   tab; `operator-dashboard` reads the same live tables — reads only, so its
   Rule 1 holds).

---

## 4. Create-trip flow — the two "missing" items

Checked. **Both already exist** in `CreateTripFlowA.tsx` (committed):

- **Waiver upload** — `pickWaiverFile` (line 2445), rendered inside the waiver
  card on the Requirements step (2579). Publish is *blocked* if waiver is on
  with no PDF (1831), and `publishWaiverPdf` runs before `createRequirements`
  (2160). It only appears when the waiver toggle is ON — easy to miss.
- **Payment deadline** — deposit/balance render as timing-only cards on the
  Requirements step (2486–2510), asking exactly "when is it due"; the amounts
  live on the budget step. These cards only appear when payment mode is
  "managed" — also easy to miss.

**What DOES need changing there** — the defaults contradict the new decisions
(`DEFAULT_TIMING`, `tripDocumentsService.ts:824`):

| Kind | Today | Decided |
|---|---|---|
| passport | must_have | **skippable** (30 days before) |
| medical | skippable | **must_have** |
| waiver | must_have | must_have ✓ |
| deposit | must_have | must_have ✓ |
| insurance / visa / flights / balance | skippable | skippable ✓ |

Operators can still override per trip; only the defaults flip.

---

## 5. Plan

DB changes are applied by hand in the SQL editor (never `db push`), and live
functions are ahead of the repo — **diff `pg_get_functiondef` against the repo
before touching any function below.**

### Phase 1 — DB migration (one file)
1. `status` column on `group_trip_participants` (+ index on
   `(trip_id, status)`).
2. `handle_join_request_approval` → insert `'onboarding'` for type-C trips.
3. `enforce_group_trip_max_participants` → count active only; add the
   UPDATE-path trigger for onboarding→active.
4. `sync_group_trip_participant_count` → count active only.
5. `tg_notify_member_joined` → skip `'onboarding'` inserts; fire on
   activation UPDATE.
6. New RPC `activate_trip_membership(p_trip_id)`.
7. My-trips feed RPC returns `status` (diff live first — it drifted before).

### Phase 2 — Edge function
8. `payments-checkout`: refuse a session when the trip is full
   (active count vs `max_participants`). Deploy via CLI `--use-api`.

### Phase 3 — Client (OTA-able, no native)
9. Flip `DEFAULT_TIMING` (passport ↔ medical).
10. The runner screen + navigator route.
11. `JoinDecisionOverlay` type-C CTA; move conversation-join + "joined the
    group" message from `approveJoinRequest` to the activation path.
12. `TripDetailScreen`: gate `isApprovedMember` on `status`; "Start
    onboarding" CTA; "Message organiser" pill.
13. TripsScreen "Finish onboarding" card state.
14. Dashboard confirmed/onboarding counts.

### Test wall (before applying anything)
- A/B trips: join → approve → instantly active, chat join message fires,
  counts unchanged. (The default makes this true; verify anyway.)
- Type-C: approve 3 on a 2-spot trip → all can onboard; only 2 activate;
  the third is refused at checkout, not after paying.
- Kill the app mid-onboarding at every step → resume lands on the right step.
- Reject a passport after activation → task appears, no second onboarding.
- Verify with `npx tsc` + jest; device testing is Ohad's, in Expo Go where
  possible (runner has no native deps).

---

## 6. Open questions (not blocking Phase 1)

- Seat expiry: an approved traveler who never finishes costs nothing now (no
  seat held) — so no expiry needed. The operator may still want to *revoke*
  stale approvals; the existing remove-participant path already covers it.
- Custom requirements (`kind = 'custom'`) in the runner: v1 shows them as
  Plan-tab tasks only, never onboarding steps.
- Waiver re-version while someone is mid-onboarding: they sign whatever is
  current when they reach step 1; a later version becomes a task like for
  everyone else.
