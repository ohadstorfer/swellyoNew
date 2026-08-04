# Operator trip editing

**Status:** v2, 2026-08-03. Approved by Ohad. Replaces Draft v1 (2026-07-22).
**Scope of this rewrite:** v1 was written before payments shipped and before Ohad made the
calls in §3. Every decision below is current. Where v2 reverses v1, it says so.

> **Needs Eyal's sign-off on one point.** v1 §1 quoted him: *"Plan is plan. I'm talking about
> editing only the trip's overview."* v2 puts Plan editing in this screen too — see §3.1. This
> was Ohad's call on 2026-08-03. Eyal should know before it ships.

---

## 1. What this is

An operator publishes a trip. Then something changes. The dates move, the price goes up, a
photo is bad. Today the only way to change a trip is the creation wizard in edit mode, and
that wizard locks fields on purpose. For operator trips it is not even reachable — see §2.

This spec adds a dedicated **Edit trip** screen for operator trips (`hosting_style = 'C'`).
It is reached from the 3-dot menu on the trip Overview. It is flat and direct, not the
wizard with a flag flipped.

An operator trip IS a `group_trips` row. There is no separate operator model.

**Mobile only.** Desktop is read and review only (SPEC.md §2).

---

## 2. Where the code stands today

| Thing | State |
|---|---|
| 3-dot menu | `TripDetailScreen.tsx:1570` — 7 entries. **No Edit entry.** |
| `onEditTrip` prop | Declared at `TripDetailScreen.tsx:152`. **Never called.** A dead wire. |
| `EditTrip` route | `RootNavigator.tsx:204-235`, pushed at `:119`. Wraps `CreateTripWizard` with `initialTrip`. Unreachable from the app. |
| `isOperatorTrip` | Already computed — `TripDetailScreen.tsx:485` (`trip.hosting_style === 'C'`). |
| Inline edit pills on Overview | Cover, description and host note work for every host. **Dates and stay pills are hidden for C trips** — `TripDetailViewRedesigned.tsx:429-430` gates them on `isLooseFlow` (A or B only). |

So today an operator can change a cover photo, a description and their host note. Nothing else.

---

## 3. Decisions (2026-08-03)

### 3.1 Plan items are included — reverses v1

The screen holds Overview fields **and** the things a host edits from the Plan tab:
requirements, group gear, packing suggestions, admin updates.

**Not included:** join requests. Approving a person is not editing a trip; that stays in the
Plan tab. Also out: `hosting_style` (it decides the whole flow) and `status` (Complete and
Cancel are their own menu actions).

### 3.2 Rows show the field name only

No values on the rows. Just name + chevron. Same structure as `ProfileEditPanel` — sections,
rows, and a sub-editor per row — but simpler, because `ProfileEditPanel`'s `InlineField`
(`:1363`) and `EditCard` (`:1411`) both render a value and this screen does not.

### 3.3 No global Save button

Every sheet has its own Save. It writes to the database straight away and closes. This is how
`ProfileEditPanel` already works. Leaving the screen is a plain dismiss — there is never
anything unsaved to lose.

This is why §3.2 works: a row with no value is fine when there is no pending state to show.

### 3.4 No automatic notification to travelers

v1 §6 listed four options and called this a ship gate. Ohad chose: **nothing is sent
automatically.** The operator tells people themselves, using group chat or an admin update.

> ⚠️ v1's own words were *"silence is not really an option."* The risk that buys: a traveler
> can find out the dates moved by opening the app. The confirm popup in §3.5 is the only thing
> standing between an operator and a silent change. Revisit when operators are no longer
> hand-picked.

### 3.5 A confirm popup before changing dates or destination

Fires **before** the write, on **Where** and **When** only. Cancel writes nothing.

```
┌────────────────────────────────┐
│       Change the dates?        │
│                                │
│  12 travelers joined on the    │
│  old dates. Make sure you      │
│  tell them about this change.  │
│                                │
│  [ Cancel ]      [ Change it ] │
└────────────────────────────────┘
```

The count is the non-host participants — `participant_count - 1`, already on the trip row the
screen loads, so it costs no extra query. Everyone holding a spot needs telling, whether or not
they have paid yet. When the count is 0, skip the popup.

For a date change the popup also says what it does to the requirement deadlines, because those
are stored relative to departure and move with the trip (§9): *"3 deadlines move. 1 lands in
the past."*

### 3.6 The trust unlock stays

Two fields are locked for peer hosts on purpose: **destination**
(`CreateTripFlowA.tsx:2529-2565`) and the **specific-stay gate** (`:2772` `canToggle =
!editMode`). They are locked because people joined based on them.

Operators get both. Eyal: *"operators is different. These are businesses, our partners… we can
trust them, at least at the start, when there's a limited number of them."*

> ⚠️ This is trust at small scale, not a permission model. It works because we can name every
> operator. The edit log that would have made this reviewable was cut on 2026-07-23, so there
> is **no record of operator edits at all**. If the operator count grows, bring the edit log
> back first.

This spec does **not** unlock anything for peer hosts. The wizard keeps its locks exactly as
they are.

---

## 4. Entry point and route

1. Operator opens their trip, lands on **Overview**.
2. Taps the ⋮ in the header.
3. A new **Edit trip** entry appears, icon `create-outline`, in the host group (`group: 2`).

**Only the operator of record sees it** — `trip.host_id === currentUserId`, not `isHost`.

> Decided 2026-08-03, after the payments branch landed its C3 ruling. `is_trip_host()` is flat
> multi-host and includes every promoted admin; `group_trips.host_id` is the single operator
> `operator_payout_accounts` pays. `group_trips` UPDATE RLS is `is_trip_host(id)`
> (`20260708000000_group_trip_multiple_hosts.sql:165`), so a co-host can already write the trip
> row — and this screen is the first UI anywhere that edits a published trip's
> `cost_per_person`. Gating the whole screen on `host_id` is the simple version. It does take
> away the cover / description / host-note editing a promoted co-host has today via the inline
> Overview pills, which stay where they are and keep working. Ohad chose the simple version
> for now and may loosen it to per-row gating (money on `host_id`, the rest on `isHost`) later.

```ts
(isHost && isOperatorTrip && !isLocked) && {
  key: 'edit',
  icon: 'create-outline',
  label: 'Edit trip',
  group: 2,
  onPress: () => navigation.push('OperatorEditTrip', { tripId: trip.id }),
}
```

`isLocked` is already `isCancelled || isCompleted || isTripPast(trip)`
(`TripDetailScreen.tsx:1522`), so a cancelled, completed or finished trip has no Edit entry.

New route `OperatorEditTrip` in `RootNavigator.tsx`, modelled on `EditTripCardScreen`
(`:204`) — card presentation, back chevron, title "Edit trip". Card presentation gives the
slide-in-from-the-right feel of the profile editor for free, and keeps the back gesture.

The old `EditTrip` route and the dead `onEditTrip` prop are left alone. A and B trips are not
touched by this spec.

The inline edit pills on Overview stay. They are a fast path for one field. Both they and this
screen write through the same service functions.

---

## 5. The screen

```
‹  Edit trip
──────────────────────────
 PHOTOS
   Cover photo            ›
 THE BASICS
   Trip name              ›
   Description            ›
   Where                  ›   ← confirm popup
   When                   ›   ← confirm popup
   Spots                  ›
 WHO IT'S FOR
   Surf level             ›
   Boards                 ›
   The wave               ›
   Age                    ›
 THE TRIP
   How it works           ›
   Vibe                   ›
   Stay type              ›
   Your stay              ›
   About you              ›
 PRICE
   Price per person       ›
   Deposit                ›
   What's included        ›
 VISIBILITY
   Listed in explore      ›
 MANAGE
   Requirements           ›
   Group gear             ›
   Packing suggestions    ›
   Admin updates          ›
```

### Row → column → sheet

| Row | Writes | Sheet to reuse |
|---|---|---|
| Cover photo | `hero_image_url` | `EditCoverSheet` (`TripEditSheets.tsx:248`) |
| Trip name | `title` | `EditTextSheet` (`:157`) |
| Description | `description` | `EditTextSheet` |
| Where | `group_trip_destinations` row | **new** — see §6.1 |
| When | `start_date`, `end_date`, `dates_set_in_stone`, `date_months`, `duration_days` | `EditDatesSheet` (`:350`) |
| Spots | `max_participants` | **new** — see §7.1 |
| Surf level | `target_surf_levels` | `sheets/LevelsSheetContent` |
| Boards | `target_surf_styles` | `sheets/StyleSheetContent` |
| The wave | `wave_shapes`, `wave_size_min`, `wave_size_max` | `sheets/WaveSheetContent` + `WaveSizeSheetContent` |
| Age | `age_min`, `age_max` | `sheets/AgeSheetContent` |
| How it works | `trip_structure` | `sheets/HowItWorksSheetContent` |
| Vibe | `trip_vibes` | `sheets/VibeSheetContent` |
| Stay type | `accommodation_type` | `sheets/StayTypeSheetContent` |
| Your stay | `specific_stay_selected`, `accommodation_name`, `accommodation_url`, `accommodation_image_url` | `EditAccommodationSheet` (`:487`) + `sheets/SpecificStaySheetContent` |
| About you | `host_lead_note` | `EditTextSheet` |
| Price per person | `cost_per_person` | **new** — see §7.2 |
| Deposit | `deposit_amount` | **new** — see §7.2 |
| What's included | `price_inclusions` | `sheets/IncludesSheets` |
| Listed in explore | `visibility` | **new** — see §6.2 |
| Requirements | `organized_trip_requirements` | `ManageRequirementsSheet` |
| Group gear | trip gear tables | `gear/ManageGearSheet` |
| Packing suggestions | `personal_gear_host_suggestion` | `gear/EditSuggestedGearSheet` — controlled: it calls `onSave(fullArray)` after **every** change, so wire it to `setTripGroupGear` (`groupTripsService.ts:925`). It has no Save button of its own; that is fine under §3.3, just more eager. |
| Admin updates | `group_trip_admin_updates` | `updates/AdminUpdateSheet` |

**Reuse, do not copy.** Every sheet in the right column already exists and already has its own
Save. Copying any of them means two places to fix each bug.

### UI rules

- New sheets wrap their body in **`BottomSheetShell`** (`src/components/BottomSheetShell.tsx`).
  Do not add a new `WizardBottomSheet` — it is a hand-rolled Modal with its own backdrop.
  `ManageGearSheet` is one of those; reuse it as-is, do not migrate it here.
- Fonts: **`ff(family, weight)`** from `src/theme/fonts.ts`. Never bare `fontFamily` +
  `fontWeight` — iOS renders Regular.
- Colours: existing tokens. Do not re-declare a local `COLORS` block the way
  `CreateTripFlowA.tsx:402` does.
- Android modals need `navigationBarTranslucent`; `BottomSheetShell` handles it.

---

## 6. Fields that need new work

### 6.1 Where — the destination

`updateGroupTrip` deliberately excludes destination (`groupTripsService.ts:895-902`).
`setTripDestination` (`:445`) already upserts on `trip_id`, so it handles an update with no
change. The sheet reuses the wizard's place picker.

Changing the country can make an existing visa requirement wrong, and it moves the trip in the
explore feed. The §3.5 popup covers the traveler-facing half of that.

### 6.2 Visibility — no migration needed

`visibility` is a plain `text` column with `default 'public'` and **no CHECK constraint**
(`20260525000002_group_trips_a_columns.sql:8`). `explore_feed` already filters
`visibility IS NULL OR visibility = 'public'`
(`20260701010000_explore_feed_sort_by_participants.sql:58`).

So writing `'link_only'` removes the trip from explore with zero SQL. v1 assumed a migration
was needed. It is not.

The toggle says what it does: people already booked keep their access; the trip just stops
showing in explore.

---

## 7. Safety rules

These are validation, not popups. They stop states the database would otherwise accept.

### 7.1 Spots cannot go below the booked count

The capacity trigger (`20260617000000_lock_capacity_check_triggers.sql`) fires **BEFORE
INSERT on `group_trip_participants`** only. It never runs when the trip row itself is updated.
So today a host can set max to 4 on a trip with 9 people. The database accepts it, the trip is
over capacity, and no one can ever join again. A silent, confusing state.

**The floor is `participant_count`**, the trigger-maintained column on `group_trips`
(`20260531000004_group_trips_participant_counts.sql`). It includes the host and it counts
everyone holding a spot, paid or not.

> v1 said the floor should be "travelers with a paid deposit". That is wrong for this codebase.
> `max_participants` is compared against `participant_count` everywhere else — `isFull` on the
> detail screen, the join trigger — so a floor built on a different number would let the client
> accept a value the database then rejects. A traveler who joined and has not paid yet still
> occupies a spot. Paid-deposit count is the right number for the §3.5 popup, not for capacity.

- Raising is always fine.
- Lowering to exactly `participant_count` is fine. Say so: "This closes the trip — all 12 spots
  are taken."
- Lowering below it is blocked. The stepper floor is `participant_count`: "12 people are on
  this trip. Remove someone first."
- Back the floor with a **trigger on `group_trips`**, not only the client. A client-only floor
  repeats the pre-2026-06 capacity hole. It has to be a trigger and not a CHECK: trips that are
  already over capacity exist today, and a CHECK cannot be added to a table that violates it.
  The trigger guards the transition only.
- The operator's escape hatch is removing a traveler, which involves a refund — SPEC.md open
  question #3. This screen must not become a back door around that.

### 7.2 Freeze existing prices before changing the trip price

**This is new in v2. Payments shipped on 2026-08-03 and changed the picture.**

`group_trip_participants.price_total_usd` and `deposit_usd` are the per-traveler frozen price
(`20260803000000_operator_trip_payments.sql:127-129`). `operator_traveler_amount_due` resolves
what a traveler owes as:

```sql
coalesce(p.price_total_usd, t.cost_per_person) as price
```

**Most of this is already handled.** `trg_freeze_traveler_price`
(`20260803000000_operator_trip_payments.sql:418`) fires `BEFORE INSERT` on
`group_trip_participants` and copies the trip price onto the row at join time. So on a trip
that is already `payment_mode = 'managed'`, every new joiner gets their own frozen price and a
later price edit cannot reach them. That trigger is also the sole authority on those two
columns — a traveler cannot PATCH their own row to `price_total_usd = 0`.

**The hole it leaves:** that trigger explicitly writes `null` when the trip is **not** managed:

```sql
if v_mode is distinct from 'managed' then
  new.price_total_usd := null;
  new.deposit_usd     := null;
```

So everyone who joined while the trip was `offline` still has `null`. The moment the operator
switches the trip to `managed` and sets a price, those travelers are on the fallback. Editing
`cost_per_person` after that silently changes what every one of them owes.

Rule: **before writing a new `cost_per_person` on a managed trip, freeze the old one.**
Backfill `price_total_usd` (and `deposit_usd` from `deposit_amount`) with the current values
for every non-host participant who is still null. Then write the new price.

One RPC, `operator_freeze_trip_prices(p_trip_id)`, in one transaction. It must be
`SECURITY DEFINER` and re-check `is_trip_host()` itself — the only UPDATE policy on
`group_trip_participants` is self-only, so a host has no RLS path to another traveler's row.
This is the same reason `operator_set_traveler_price`
(`20260803000100_operator_set_traveler_price.sql`, wrapped by `saveTravelerPrice` at
`tripPaymentsService.ts:207`) is definer. Its UPDATE passes cleanly through
`trg_freeze_traveler_price` because that trigger's UPDATE branch leaves a host's write alone.

Other price rules that still hold:

- The payment ledger is append-only and records what was actually charged. A price edit never
  rewrites it.
- **FX:** keep the trip's own frozen `budget_fx_rate` on save
  (`CreateTripFlowA.tsx` does this at `:1949-1953`). Never re-fetch a live rate — that would
  move the canonical USD amount on an edit that only touched a photo.
- `budget_min`, `budget_max` and `cost_per_person` are always canonical USD. `budget_currency`
  is only the operator's input currency.
- Lowering the price after people paid the old one raises "do they get the difference back?" —
  a refund question, SPEC.md open question #3. Not answered here.

### 7.3 Deposit must not exceed the price

The database already enforces it: `group_trips_deposit_not_over_price` and, per traveler,
`gtp_deposit_not_over_total`. Validate in the sheet so the operator gets a sentence instead of
a Postgres error.

### 7.4 Reuse the wizard's other validation rules

So the two screens never disagree:

- Age: 16–99, max ≥ min, span ≥ `AGE_WINDOW_BY_STYLE[style]`. The DB has a matching CHECK —
  both change together.
- Dates: end on or after start. Month mode needs a month and a length.
- Title, description, cover: required, non-empty.
- Stay: if the gate is Yes, name + link + photo are all required.
- Price: greater than 0. Budget range: min ≤ max.

---

## 8. Save and failure

Each sheet saves on its own, so there is no multi-write ordering problem.

- Most rows: one `updateGroupTrip(tripId, patch)` with only the fields that row owns.
- Where: `setTripDestination(tripId, geo)` only.
- Price: freeze (§7.2), then `updateGroupTrip`.
- Cover: upload the image first, then write the row. Skip the upload when the URI is already
  remote (`isRemoteUrl`).
- Manage rows: their existing sheets already do their own writes. Do not wrap them.

After a successful write: patch the local cache (`patchTripCache`,
`TripDetailScreen.tsx:1042`), then invalidate the trip detail and trips list queries.

On failure: keep the sheet open with the operator's input intact, and show the error through
`showErrorAlert` / `friendlyErrorMessage` (`src/utils/friendlyError.ts`). Never
`Alert.alert(title, e.message)`.

An image that uploaded before a failed row update is orphaned in storage. Harmless — a retry
reuses the already-remote URL. Worth a cleanup job later, not a blocker.

Two devices editing at once: last write wins. Acceptable for one operator.

---

## 9. Edge cases

- **Trip already started** — dates and price edits are close to meaningless. Warn, or hide.
- **A traveler mid-onboarding** — Overview fields (photos, description, vibe) are harmless.
  Dates, price, destination and capacity change the deal they are part-way through accepting.
  Their client must re-fetch, so a stale trip does not sit on screen through a whole onboarding.
- **A payment in flight** — the amount charged must be the amount quoted. Checkout carries a
  price snapshot; §7.2's freeze is what makes that snapshot exist.
- **Moving the dates** — requirement deadlines are stored relative to departure, so they move
  with the trip. Pushing later is usually right. Pulling earlier can land a deadline in the
  past and make everyone instantly overdue with no warning. Before saving a date change, show
  what it does: "3 deadlines move. 1 lands in the past."
- **Cover photo replaced** — the old image stays in storage. Same as today. Fine.

---

## 10. Files

### New

- `src/screens/operator/OperatorTripEditScreen.tsx` — the screen.
- `src/components/trips/sheets/` — four new sheet bodies: Where, Spots, Price/Deposit,
  Visibility.
- `src/services/operator/operatorTripsService.ts` — the price freeze for §7.2 plus thin
  wrappers for the trip and destination writes. §7.1 needs no read: `participant_count` is
  already on the trip row.
- SQL, applied **by hand in the Supabase SQL editor** (never `supabase db push`): the capacity
  floor trigger on `group_trips` (§7.1) and `operator_freeze_trip_prices` (§7.2).

### Changed

- `src/navigation/RootNavigator.tsx` — new `OperatorEditTrip` route.
- `src/screens/trips/TripDetailScreen.tsx` — one new `menuItems` entry at `:1570`.

### Extracted, not duplicated

`CreateTripFlowA.tsx` is over 5,000 lines. Pull these out so the wizard and the edit screen
share one copy:

| What | Where it is now | Extract to |
|---|---|---|
| Trip row → form values (`stateFromTrip`) | `CreateTripFlowA.tsx:602` | `src/services/trips/tripFormMapping.ts` |
| Validation rules (age span, dates, stay, price) | `validateStep`, `:1667-1817` | `src/services/trips/tripValidation.ts` |
| Date helpers (`toISODate`, `parseISODate`, `expandMonthRange`, `formatLongDate`) | `:437-489`, already re-inlined once in `TripEditSheets.tsx:30-60` | `src/utils/tripDates.ts` |

Already extracted — reuse as-is: everything in `src/components/trips/sheets/`, and
`src/services/trips/priceInclusions.ts`.

### Untouched

`group_trips` and every `group_trip_*` table keep their RLS and `is_trip_host()`. The peer-host
wizard keeps its locks.

---

## 11. Open questions

Settled in v2: notifications (§3.4, "nothing automatic"), Plan scope (§3.1, "included"), save
model (§3.3, "per-sheet"), visibility migration (§6.2, "not needed").

| # | Question | Owner | Blocks |
|---|---|---|---|
| 1 | 🔴 Eyal to sign off on Plan editing living in this screen (§3.1 reverses his "Plan is plan"). | Eyal | Nothing technically — but he asked for the opposite. |
| 2 | 🟡 Is a price change allowed at all once someone has paid? §7.2 makes it *safe*; it does not make it *allowed*. | Eyal & Ohad | The refund conversation, SPEC.md #3. |
| 3 | 🟡 Does a moved trip re-open a deadline that had already passed? | Eyal & Ohad | §9. Already open in the workbench `onb-req`. |
| 4 | 🟡 When does the §3.6 trust unlock get a guard rail? The edit log that would feed it was cut 2026-07-23. | Eyal | Not a v1 blocker. Becomes one as operator count grows. |
| 5 | 🟡 The price block's shape depends on the pricing model (SPEC.md #1 — flat / room types / add-ons). | Design-partner operators | The Price section. Build it swappable. |
