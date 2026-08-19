# Editing deadlines — spec

**Written 2026-08-19, from an interview with Ohad. BUILT the same day.**

Status: implemented, not yet device-tested and not committed. No migration —
none was needed.

**Four things the spec got wrong, corrected below and in the code:**

1. **§4.2 had the buttons backwards.** The scale is days BEFORE departure, so
   it runs backwards against the calendar: `+` is MORE days before, which is an
   EARLIER date. `+` is the button that can land in the past, not `−`.
2. **"Minus is always safe" was false as arithmetic.** On a trip ten days out,
   stepping 365 → 180 is still deep in the past. It is safe as POLICY — it
   always improves things — so the rule became "only `+` is ever refused",
   baked into the predicate rather than left to each call site.
3. **The predicate was renamed** `stepWouldLandInPast` → `deadlineStepBlocked`.
   It expresses a policy, not a fact, and the old name invited a caller to use
   it as one.
4. **A real bug fell out of the tests.** `resolveDeadlineDate` in the app
   parsed `YYYY-MM-DD` with `new Date()`, which is UTC midnight — west of
   Greenwich that is the evening BEFORE, so every deadline rendered a day early
   for every operator in the Americas. Fixed (`parseLocalDate`); the web twin
   works in calendar strings so it cannot happen there.

Companion docs: `operator-dashboard/docs/SPEC.md` (the web app),
`docs/specs/operator-trips/requirements-model.md`,
`docs/specs/operator-trips/traveler-onboarding.md`.

---

## 1. Summary

An operator can already edit every deadline on a trip **from the phone**, and
cannot edit any of them **from the web dashboard**. This closes that: the web
dashboard gets the same editor, inline on the cards that already list the
requirements. On the way, one rule changes in both apps — a deadline may no
longer be set to a date that has already passed.

---

## 2. What already exists (verified, 19 Aug)

Do not rebuild these. Read them first.

**Mobile — `src/components/trips/ManageRequirementsSheet.tsx`.** The full
editor. Per requirement it offers:

- a toggle: is this requirement on this trip at all;
- timing pills: **"When they join"** (`must_have`) vs **"They can skip"**
  (`skippable`);
- when skippable, a stepper over `DEADLINE_STEPS`
  (`1, 3, 7, 14, 21, 30, 60, 90, 120, 180, 365` days before departure) with the
  resolved calendar date printed under it.

Pay rows (`deposit`, `balance`) appear with **no on/off toggle** but their
timing controls do work — `noToggle` in that file. They are listed only when
`payment_mode === 'managed'` **and** a real active row exists.

Reachable from two places:

| Where | Line | Gate |
|---|---|---|
| Edit trip → **Requirements** row | `OperatorTripEditScreen.tsx:849` | operator of record |
| Plan tab → manage requirements | `TripDetailScreen.tsx:3030` | `canManageRequirements` = (`isHostDerived` \|\| `can('trip.edit')`) && (has documents \|\| `isOperatorTrip`) |

Saving goes through `saveRequirementChanges()` in
`src/services/trips/tripDocumentsService.ts`, which diffs a whole draft against
the stored rows.

**Mobile — the offline payment deadline** is a separate field
(`group_trips.offline_payment_due_days_before`), edited in the `payDeadline`
sheet at `OperatorTripEditScreen.tsx:1150`. Offline trips only: a managed
trip's full-payment deadline lives on its `balance` requirement row.

**Mobile — `describeDeadlineShift()`** (`OperatorTripEditScreen.tsx:522`)
already warns, when the trip's start date changes, which deadlines move and how
many land in the past. It reports; it changes nothing.

**Web — nothing.** `operator-dashboard/` has `TripPriceDialog`,
`TravelerPriceDialog`, `RefundDialog`, `RejectDialog`, `AddCrewDialog`,
`CrewMemberDialog`. No requirements editor, no deadline field. The only
`daysBefore` in the project is the cancellation policy.

**The write is already permitted.** `organized_trip_req_write` on
`organized_trip_requirements` is `for all to authenticated`, using and with
check `trip_staff_can(trip_id, 'trip.edit')`
(`20260807000100_operator_trip_staff_gates.sql:45`). **No migration is needed
for any of this.**

---

## 3. Decisions locked in this interview

| Question | Decision |
|---|---|
| Where does the work go | **Web dashboard only.** Mobile's editor is fine; Ohad had not found it. |
| Whose deadline moves | **Everyone's, always.** One number on the trip, no per-traveler freeze, no new column. |
| Do travelers get told | **No. Silent.** The Plan tab shows the new date next time they open it. No push, no bell entry. |
| Date model | **Keep "N days before departure" on the fixed scale.** No calendar picker, no free numbers, no per-traveler override. |
| A deadline in the past | **Cannot be selected.** Not a warning — the step is unreachable. |
| Un-overdue travelers | Recompute (it is derived), **but name it in the confirm before saving**. |
| Web feature scope | **The same as mobile** — stepper, timing pills, on/off toggle. |
| Placement | **Inline on the existing cards**, not a dialog or a new route. |
| Save model | **Card-level Save.** Edit any number of rows, one Save, one diff. |
| Mobile consistency | **Backport the past-date block to mobile**, so the two apps agree on what is legal. |
| Money deadline | **Shown read-only on the Money card**, edited with the other requirements. |
| Dashboard SPEC Rule 1 | **Remove it.** No longer relevant — the project already writes prices, refunds, rejections and crew. |
| First version | **All of the above.** Nothing deferred. |

---

## 4. The past-date rule

The one behaviour change that touches both apps.

### 4.1 The rule

A deadline step may be **selected** only if the date it resolves to is today or
later. `resolveDeadlineDate(startDateISO, daysBefore)` already computes that
date (`tripDocumentsService.ts:909`).

### 4.2 In the stepper

⚠️ The scale is **days before departure**, so it runs backwards against the
calendar. More days before is an earlier date.

- The **`+`** button (MORE days before → EARLIER date) is the only one that can
  walk a deadline off the back of today. It is disabled once the next step up
  would land before today, the same way `isDeadlineAtEnd()` already disables
  the ends of the scale, and it looks the same — not a new visual state.
- The **`−`** button (fewer days before → LATER date) is never blocked.

### 4.3 A row whose CURRENT value is already in the past

Reachable today: a deadline set months ago, or one the trip's dates moved past.
**Decided by Claude, per "you decide carefully":**

- The row renders its passed date.
- **`+` is dead. `−` works** until the value clears today.
- It is **never** read-only, and it is **never** silently snapped forward on
  open.

Why: snapping on open rewrites a stored deadline because someone looked at a
page, and read-only traps the operator in the exact state they came to fix. The
only job this rule has is to stop a *new* bad value being chosen; an existing
one must always be fixable.

**This is why `−` is never refused, and it is policy, not arithmetic.** One
notch later does not always reach the future: on a trip ten days out, 365 days
before is historic and so is 180. If the rule asked only "does the result land
in the past?", both buttons would be dead on exactly the row the operator came
to fix. So: a step that improves things is always allowed, even when it does
not finish the job. The predicate short-circuits on `direction === -1` before
it computes anything.

### 4.4 Trips with no start date

Months-only trips have no `start_date`, so `resolveDeadlineDate` returns null
and nothing resolves to a real date. Then **nothing is blocked** — the stepper
moves freely over the whole scale and the date line reads
`"Set exact dates to see the date"`, exactly as mobile already prints it
(`ManageRequirementsSheet.tsx:414`). There is no date to compare, so there is
no rule to apply.

### 4.5 What this rule does NOT do

**It does not block moving the trip's start date.** Pulling a trip earlier can
push existing deadlines into the past. That stays a **warning**, exactly as
today: `describeDeadlineShift()` keeps counting them and the confirm keeps
saying so. Moving a trip is a real-world fact; refusing it because paperwork
would go overdue traps the operator in something worse.

### 4.6 The two copies of the predicate

The app and `operator-dashboard/` **share no code** — separate `package.json`,
excluded from Metro and tsconfig on purpose. So this cannot be one import.

Follow the pattern `src/domain/operatorSetup.ts` already uses on the dashboard:
write the predicate in each project, and put a comment in both naming the other
as its twin. Suggested homes:

- app: `src/services/trips/tripDocumentsService.ts`, next to `stepDeadline` /
  `isDeadlineAtEnd`;
- web: `operator-dashboard/src/domain/requirements.ts`, next to `todayISO`.

As built:

```ts
// app — src/services/trips/tripDocumentsService.ts
export function deadlineStepBlocked(
  current: number,
  direction: 1 | -1,
  startDateISO: string | null,
): boolean

// web — operator-dashboard/src/domain/requirements.ts
export function deadlineStepBlocked(
  current: number,
  direction: 1 | -1,
  startDateISO: string | null,
  today: string = todayISO(),   // injectable, so the tests are exact
): boolean
```

**Named for the policy, not the fact.** An earlier draft called it
`stepWouldLandInPast`, which is a question about dates and tempted the caller
into applying it to both buttons. The direction rule lives inside the function
so the two apps cannot drift on it.

⚠️ **Never `new Date('YYYY-MM-DD')`.** A bare date string parses as UTC
midnight, which west of Greenwich is the evening before. The app carried that
bug in `resolveDeadlineDate` and rendered every deadline a day early across the
Americas; it is fixed with `parseLocalDate`. The web twin works in `YYYY-MM-DD`
strings end to end (`resolveDeadlineISO`, compared against `todayISO()`), which
makes the bug unrepresentable rather than merely absent.

---

## 5. The web editor

### 5.1 Placement

Inline on `operator-dashboard/src/routes/TripPage.tsx`, on the cards that
already list these rows:

- **Documents card** (`TripPage.tsx:163`) — the `uploads` rows, plus the waiver
  and medical line.
- **Other requirements card** (`TripPage.tsx:228`) — the `custom` rows.
- **Money card** (`TripPage.tsx:476`) — read-only, see 5.5.

⚠️ **The rows are `<Link>`s today.** Each upload row is a whole-row link to
`/trips/:id/d/:reqId`, and a stepper cannot go inside an anchor — it swallows
clicks and fails a11y.

**Resolved without restructuring the rows.** Read and edit are two renders of
the same card, not one render with controls wedged in: pressing **Edit** swaps
the card body for the editor. One mode shows links, the other shows controls,
and neither is ever inside the other. The links keep working untouched, and the
edit view is free to be laid out for editing rather than for scanning.

### 5.2 What each row gains

Mirror the mobile card, in the dashboard's flatter idiom:

- the on/off control;
- the two timing pills, **When they join** / **They can skip**;
- when skippable: `[−] 30 days before the trip · 11 Dec 2026 [+]`.

Reuse `DEADLINE_STEPS`, `stepDeadline` and `isDeadlineAtEnd` — copy them into
`operator-dashboard/src/domain/requirements.ts` with the same twin comment as
4.6. The scale must not drift between the two apps.

### 5.3 Save

**Card-level.** Any edit marks the card dirty and reveals a
`Save changes` / `Discard` bar on that card. One write per save, diffing the
draft against what was loaded — the same shape as the app's
`saveRequirementChanges()`.

Port that function into `operator-dashboard/src/services/`. Keep the app's
constraint handling, because the same triggers will fire:

- `organized_trip_req_deadline_rule` — `skippable` MUST carry a deadline,
  `must_have` MUST NOT. Sending both or neither is a 23514.
- `trg_passport_requires_operator_trip` — a passport row is refused unless
  `hosting_style = 'C'`.
- `enforce_pay_requires_managed_trip` — a pay row needs
  `payment_mode = 'managed'`.
- Removing a requirement goes through the app's `removeRequirement()` path,
  never a raw delete: deleting the row strands the passports pointing at it.

### 5.4 The confirm

Before writing, if any deadline moved **later** and travelers are currently
overdue on it, say so:

> **Save these changes?**
> 4 travelers stop being overdue on Travel insurance.

Counted from data the page already holds — `deriveState()` in
`operator-dashboard/src/domain/requirements.ts` returns `overdue`, and the
review query already has every traveler's evidence.

No confirm when nothing un-overdues. Never a confirm about a deadline moving
earlier — the past-date block already makes the harmful version of that
impossible.

### 5.5 The Money card

Shows the final payment's due date, **read-only**, next to the amounts it
governs:

> Final payment · $2,000 outstanding · due 11 Dec 2026

with a quiet link to the requirements card where it is changed. On an offline
trip the same line reads from `group_trips.offline_payment_due_days_before`
instead — that one is a trip column, not a requirement row.

### 5.6 Who may edit

`access.can('trip.edit')`. Already defined in
`operator-dashboard/src/services/access.ts`, and it is the exact capability
`organized_trip_req_write` checks — so the button and the database agree by
construction. Hide the controls, do not disable them, when the capability is
absent.

---

## 6. Data

Nothing new. Every column already exists.

**Read — two queries, not one.** The spec assumed extending `review.ts` would
be enough. It is not: that query drops `pay` rows (no ledger UI on this site)
and filters to `is_active`, and the editor needs both — pay rows because their
deadline IS the trip's full-payment date, and inactive rows because reviving
one is what restores the passports travelers had already sent.

So:

- `review.ts` gains **`deadline_days_before`** on its select and
  `deadlineDaysBefore` on `Requirement`. That is what puts `Due 11 Dec 2026` on
  each row in READ mode.
- `services/requirements.ts` adds **`fetchEditableRequirements`**, reading the
  base table for `audience = 'traveler'`, active or not, pay rows included.
  That is what the editor diffs against. It refetches on mount (`gcTime: 0`) —
  a diff is only as good as what it is diffed against, and saving against a
  stale cache would silently undo a change made on someone's phone.

**Write.** The **base table** `organized_trip_requirements`, not the view.
Columns touched: `skip_at_onboarding`, `deadline_days_before`, `is_active`.

**Flow.** `TripPage` → card draft state → ported `saveRequirementChanges()` →
`supabase.from('organized_trip_requirements').update(...)` → RLS
`organized_trip_req_write` checks `trip_staff_can(trip_id, 'trip.edit')` →
invalidate the review query.

**Traveler state is derived, not stored.** `deriveState()` on the web and
`operator_trip_my_requirements` in SQL both compute `overdue` from the resolved
date against today. Moving a deadline changes what every traveler sees, with
no backfill and no second write. That is why "everyone shifts, always" costs
nothing.

---

## 7. Edge cases

| Case | Behaviour |
|---|---|
| Deadline already in the past | Minus dead, plus works, overdue marker shown. Never read-only. §4.3 |
| Trip has no start date | Nothing resolves, nothing blocked, date line says "Set exact dates to see the date". §4.4 |
| Trip start date moves | Warning only. Deadlines are relative, so they follow. §4.5 |
| Requirement is `must_have` | No deadline exists — `deadline_days_before` is null in the DB. The stepper is hidden, not zeroed. The number `fetchTripRequirements` fills in is a UI default, not a deadline. |
| Waiver | Frozen once on file. Timing may change; the document may not be replaced. See `20260818000000_waiver_is_frozen_after_publish`. |
| Pay rows on an offline trip | Not listed. No pay row exists — the DB refuses one. |
| Managed trip with no deposit row | The `deposit` card is not shown. Gating on `payment_mode` alone shows a card whose Save silently no-ops. Require a real active row, as mobile does. |
| Save fails | The card keeps the draft and shows the error. Never clear an edit the server refused. |
| Two people editing | Last write wins. The diff is per column, so two people editing different rows do not clobber each other. Not worth locking. |
| A traveler already submitted late | Stays submitted. `deriveState` only marks overdue when there is **no** evidence — moving the deadline does not un-approve anything. |

---

## 8. Files — as built

**Web (`operator-dashboard/`)**

| File | What |
|---|---|
| `src/domain/requirements.ts` | `deadlineDaysBefore` on `Requirement`; `DEADLINE_STEPS`, `stepDeadline`, `isDeadlineAtEnd`, `resolveDeadlineISO`, `deadlineStepBlocked`, `RequirementTiming`. All twins of the app. |
| `src/domain/catalog.ts` | `REQUIREMENT_CATALOG`, `REQUIREMENT_ORDER`, `DEFAULT_TIMING`, `isPayKind`, `isEditableKind`. ⚠️ The titles and help text here are INSERTED into the database and read by travelers in the app — drift does not stay here. |
| `src/services/requirements.ts` | **New.** `fetchEditableRequirements`, `saveRequirementChanges`, `removeRequirement`. |
| `src/services/review.ts` | One more column, carried onto `Requirement`. |
| `src/services/trips.ts` | `offline_payment_due_days_before` on `TRIP_COLUMNS` and `OperatorTrip`, for the Money card's offline case. |
| `src/components/RequirementsEditor.tsx` | **New.** The inline editor, the save bar and the un-overdue confirm. |
| `src/routes/TripPage.tsx` | Edit mode on the Documents card; `overdueByKind`; the due date on each read-mode row; the Money card's due line. |
| `src/styles/global.css` | `.req-edit`, `.req-group`, `.req-off`, `.seg`, `.stepper`, `.savebar`. |
| `src/domain/requirements.test.ts` | 23 new tests: the scale, `resolveDeadlineISO`, `deadlineStepBlocked`. |
| `docs/SPEC.md` | Rule 1 rewritten (§9); §4.2 describes the editor. |

**App (`src/`)**

| File | What |
|---|---|
| `src/services/trips/tripDocumentsService.ts` | `deadlineStepBlocked`, `startOfToday`, and the `parseLocalDate` fix inside `resolveDeadlineDate`. |
| `src/components/trips/ManageRequirementsSheet.tsx` | The `+` button now also disables on `deadlineStepBlocked`. |
| `src/services/trips/__tests__/tripDocumentsService.test.ts` | 8 new tests, mirroring the web's. |

**Database** — nothing. No table, no function, no migration.

---

## 9. Removing Rule 1

`operator-dashboard/docs/SPEC.md` §1 Rule 1 currently reads, after two
amendments: *"Own row only. No write anywhere else, ever. If a feature needs to
change a trip, a traveler, a document or money, it belongs in the app — that is
still the line."*

That line is already false in the shipped code: the site writes trip prices,
traveler prices, refunds, document rejections and crew rows. **Ohad's ruling,
19 Aug: remove the rule.** Do not amend it a third time.

Replace it with what is actually still true, because the original rule was
protecting something worth keeping:

> **This project invents no schema.** No tables, no functions, no migrations
> from here. Every table it writes and every capability it relies on was
> created and enforced by the app's migration set. What this site may do is
> exactly what RLS already lets the signed-in operator or crew member do — no
> more, and never through a path the app does not also have.

---

## 10. Acceptance

1. On the web dashboard, an operator changes "Travel insurance" from 30 to 60
   days before and saves. The mobile Plan tab shows the new date on next open.
2. The minus button will not step a deadline onto a date already gone. Not a
   warning — the button is dead.
3. A deadline already in the past can still be moved forward.
4. Moving a deadline later, over 4 overdue travelers, asks first and names the
   4.
5. No traveler receives a push or a bell entry from any of it.
6. Mobile refuses the same past-date step the web refuses.
7. Moving the trip's start date still works, still warns, still is not blocked.
8. A crew member without `trip.edit` sees no controls at all.
9. `cd operator-dashboard && npm run build && npm test` passes; root `npx tsc`
   shows no new errors.
10. No migration was written.
