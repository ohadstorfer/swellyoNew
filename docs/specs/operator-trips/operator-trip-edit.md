# Operator trip editing

**Status:** Draft v1, 2026-07-22.
**Data model:** extends `hosting_style='C'` group trips. An operator trip IS a `group_trips` row. Overrides SPEC.md §5.
**Parent:** `SPEC.md` §4.2 "Simple trip management".
**Workbench:** `docs/operator-trips-workbench.html` — features `edit-trip`, `unlock`, `notify-change`, `comms`.
**Siblings:** `docs/specs/operator-trips/requirements-model.md` (not written yet — its content lives in the workbench `onb-req` feature for now).

---

## 1. Summary

An operator publishes a trip. Then something changes. The dates move. The price goes up. A photo is bad. Today the only way to change a trip is the creation wizard in edit mode, and that wizard locks several fields on purpose.

This spec adds a dedicated **Edit trip** screen for operator trips. It is reached from the 3-dot menu on the trip Overview. It is flat and direct — not the wizard with a flag flipped.

Scope is the **Overview only**: everything the operator filled during the creation flow. Photos, dates, surf levels, board types, description, price fields, capacity, stay. Eyal was explicit: *"Plan is plan. I'm talking about editing only the trip's overview."* Gear items, requirements, tasks and other Plan content are out of scope for this screen.

Operators may edit fields peer hosts cannot. See §2 "The trust decision".

**Mobile only.** Desktop is read and review only (SPEC.md §2).

**Data model:** an operator trip IS a `group_trips` row with `hosting_style='C'`. There is no separate operator model. This spec edits that same row's Overview. This overrides SPEC.md §5. Where the creation flow is shared, we **extract** the shared piece — we do not copy it. See §8.

---

## 2. What is editable and what is not

"Peer host today" = what `CreateTripFlowA.tsx` actually does when `editMode` is true (`editMode = !!initialTrip`, line 1215). Every "Locked" claim below carries its line number. "Operator v1" = what this spec proposes.

| Field | Column | Peer host today (wizard edit mode) | Operator v1 | Where the lock lives |
|---|---|---|---|---|
| Cover photo | `hero_image_url` | Editable | Editable | — (also editable inline via `EditCoverSheet`) |
| Trip name | `title` | Editable | Editable | — |
| Description | `description` | Editable | Editable | — (also inline via `EditTextSheet`) |
| **Destination** | `destination` (own table, set by `setTripDestination`) | **LOCKED** | **Editable — unlocked** | `CreateTripFlowA.tsx:2126` placeholder `'Locked'`, `:2131` `disabled={editMode}`, `:2139` map disabled, `:2162-2166` footnote "Destination can't be changed after a trip is created.", `:1590` validation skipped, and `updateGroupTrip` never writes it at all (`groupTripsService.ts:889-892`) |
| Dates mode | `dates_set_in_stone` | Editable | Editable | — |
| Exact dates | `start_date` / `end_date` | Editable | Editable | inline `EditDatesSheet` only when `isLooseFlow && !hasExactDates` (`TripDetailViewRedesigned.tsx:429`) |
| Month range | `date_months` | Editable | Editable | — |
| Trip length | `duration_days` | Editable | Editable | — |
| **Max participants** | `max_participants` | Editable, no floor check | **Editable, with a floor** | Client stepper `:2266-2299` clamps 2–50 only. Nothing checks bookings. See §7.3 |
| Surf levels | `target_surf_levels` | Editable | Editable | — |
| Board types | `target_surf_styles` | Editable | Editable | — |
| Wave shape | `wave_shapes` | Editable | Editable | — |
| Wave size | `wave_size_min` / `wave_size_max` | Editable | Editable | — |
| Age range | `age_min` / `age_max` | Editable | Editable | span rule `AGE_WINDOW_BY_STYLE`, `:1578` |
| How it works | `trip_structure` | Editable | Editable | — |
| Vibe | `trip_vibes` | Editable | Editable | — |
| Stay type | `accommodation_type` | Editable | Editable | — |
| **"Specific stay?" gate** | `specific_stay_selected` | **LOCKED** | **Editable — unlocked** | `:2369` `canToggle = !editMode`, `:2419-2421` helper "Locked from when you first published.", `:2448` "No" card disabled. "Yes" stays tappable only so the details sheet opens |
| Stay name / link / photo | `accommodation_name` / `_url` / `_image_url` | Editable (when gate is Yes) | Editable | — |
| **AI budget estimate** | `budget_tier` | **UNAVAILABLE** | Not used by operators | `:1446` estimate early-returns, `:1702` skipped on Next, `:2744` forces the manual branch, `:595` preloads `manualBudget: true`, `:2821` "Back to AI estimate" hidden. **Side effect:** `:1851` writes `budget_tier: null` whenever `manualBudget` is true, so a peer host who edits an AI-tier trip silently wipes its tier |
| Budget range | `budget_min` / `budget_max` | Editable (manual only) | Editable | — |
| FX rate | `budget_fx_rate` | Frozen to the trip's own rate | Frozen — same rule | `:1513` and `:1796`. Never re-fetch on edit |
| **Fixed price** | `cost_per_person` | Editable (Flow C) | Editable — see §7.4 | canonical USD; operator inputs ₪ or $ per `budget_currency` |
| What's included | `price_inclusions` | Editable (Flow C) | Editable | — |
| Host familiarity | `host_destination_familiarity` / `host_stay_familiarity` | Editable (Flow B/C) | Operator profile, not per trip | — |
| Host lead note | `host_lead_note` | Editable | Editable | also inline via `EditTextSheet` |
| **Hosting style / flow** | `hosting_style` | **Not editable** | **Not editable** | `:1220` derived from `initialTrip`; it decides the whole step order |
| **Visibility** | `visibility` | **Not editable** — hardcoded | **Editable — reuses the existing `visibility` column, values `'public'` \| `'link_only'` (decided 2026-07-23)** | `:1865` writes `'public'` on every save, no UI exists. Operator trips need the toggle per SPEC.md §2 |
| Status | `status` | Not in the edit flow | Not in this screen | separate menu actions (Complete / Cancel) |
| Gear | `personal_gear_host_suggestion` | Not in the edit flow | **Out of scope** | Plan content |
| Requirements | new table | n/a | **Out of scope** | see `requirements-model.md` |

### The trust decision — read this before shipping

Two fields are locked for peer hosts on purpose: **destination** and the **specific-stay gate**. They are locked because people joined the trip based on them.

Operators get both. Eyal: *"operators is different. These are businesses, our partners… we can trust them, at least at the start, when there's a limited number of them."* Ohad agreed.

> ⚠️ **This is trust-at-small-scale, not a permission model.** It works because we can name every operator. It stops working the moment operators sign up without Eyal in the loop. Before the operator count grows past a handful, revisit this section and decide what needs a guard rail: a change log, an approval step, or a hard lock like peer hosts have.

Cheap thing that makes the revisit possible: log every edit now. See §8.

---

## 3. Entry point and navigation

1. Operator opens their trip. They land on **Overview**.
2. They tap the 3-dot (⋮) in the header. The menu is built in `TripDetailScreen.tsx:1371-1426` as `menuItems`.
3. A new entry appears — **Edit trip**, icon `create-outline`, in the host-actions group (`group: 2`), shown only when the viewer is the operator and the trip is not cancelled or completed.
4. Tapping it pushes a full screen.

Route: a new `OperatorEditTrip` entry in `RootNavigator.tsx`. Mirror `EditTripCardScreen` (`RootNavigator.tsx:199-229`) — same header shape (back chevron, centered "Edit trip"), but it renders the new screen instead of `CreateTripWizard`.

On save, invalidate the operator trip detail query and pop back to Overview. The operator sees their change immediately.

Existing inline "Edit" pills on Overview (cover, description, about-host, and the conditional dates/stay pills in `TripDetailViewRedesigned.tsx:502-934`) stay as they are. They are a fast path for one field. The Edit trip screen is the full surface. Both write through the same service function.

---

## 4. Screen layout

One screen. One scroll. No steps. Header: back chevron, "Edit trip", a **Save** button on the right.

Six sections, in Overview's own order. Text fields are inline. Everything else is a row that opens a sheet.

1. **Photos** — cover thumbnail + Change.
2. **The basics** — trip name, description, Where ›, When ›, Spots (stepper).
3. **Who it's for** — Surf level ›, Boards ›, The wave ›, Age ›.
4. **The trip** — How it works ›, Vibe ›, Stay type ›, Your stay ›.
5. **Price** — price per person (inline), What's included ›.
6. **Visibility** — listed in explore (toggle).

### How this is simpler than the wizard

| Wizard | Edit screen |
|---|---|
| 5–6 steps, Next between each | one scroll, no steps |
| Progress chrome, step titles, subtitles | section headers only |
| Strict-sequential audience gating (`:2051-2055`) and a one-time intro modal (`:1310`) | none — everything is already set |
| AI budget estimate step with loading + retry | none — the operator types their price |
| Preview step rendering a full trip card (`:3028`) | none — Overview is the preview, one tap back |
| Draft autosave to AsyncStorage (`:1407`, `:1693`) | none — either you save or you don't |
| "Publish" and a published/share screen | "Save" and back to Overview |
| Validates the whole step before letting you move on | validates only what you touched, on Save |

Rows that open a sheet keep the same sheet. The sheet bodies are **already extracted** into `src/components/trips/sheets/` (`LevelsSheetContent`, `StyleSheetContent`, `WaveSheetContent`, `AgeSheetContent`, `WhenSheetContent`, `HowItWorksSheetContent`, `VibeSheetContent`, `StayTypeSheetContent`, `SpecificStaySheetContent`, `IncludesSheets`). Reuse them. Do not copy them.

### UI rules (project conventions, not optional)

- Sheets: wrap the extracted contents in **`BottomSheetShell`** (`src/components/BottomSheetShell.tsx`). Do **not** use `WizardBottomSheet` — it is a hand-rolled `Modal` with its own backdrop. Migrating the wizard's own sheets is out of scope; just don't add a new one.
- Fonts: **`ff(family, weight)`** from `src/theme/fonts.ts`. Never bare `fontFamily` + `fontWeight` — iOS renders Regular.
- Colours: existing tokens. Do not re-declare a local `COLORS` block the way `CreateTripFlowA.tsx:402` does.
- Android modals need `navigationBarTranslucent`; `BottomSheetShell` already handles it.

---

## 5. Save, validation, and failure

### Save

- The **Save** button in the header is disabled until something changes.
- Save sends a **diff patch** — only the fields the operator touched. Not the whole row. This keeps an untouched `budget_fx_rate` from drifting (the bug `:1796` guards against) and keeps the change set small enough to describe in a notification later (§6).
- One `updateOperatorTrip(tripId, patch)` call. Destination, if changed, is a second call to its own writer (destination lives in its own table — `updateGroupTrip` deliberately excludes it, `groupTripsService.ts:889-892`).
- Images upload **before** the row update, same order as `CreateTripFlowA.tsx:1740-1783`. Skip the upload when the URI is already remote (`isRemoteUrl`).
- On success: patch the local cache optimistically (copy the `patchTripCache` pattern at `TripDetailScreen.tsx:896-902`), invalidate the trip detail and trips-list queries, then pop back.

### Validation

Only validate what changed. Reuse the wizard's rules so the two screens never disagree:

- Age: 16–99, max ≥ min, span ≥ `AGE_WINDOW_BY_STYLE[style]` (`:1571-1583`). The DB has a matching CHECK — both must change together.
- Dates: end on or after start (`:1599-1606`). Month mode needs a month and a length.
- Title, description, cover: required, non-empty (`:1609-1612`).
- Stay: if the gate is Yes, name + link + photo are all required (`:1617-1630`).
- Price: > 0 (`:1637-1640`). Budget range: min ≤ max (`:1653`).
- **Spots: new floor.** See §7.3.

Errors render inline on the field, and the screen scrolls to the first one. Save stays disabled while any error is showing.

### Failure

- Row update fails → keep the screen open, keep every local edit, show the alert through `showErrorAlert` / `friendlyErrorMessage` (`src/utils/friendlyError.ts`). Never `Alert.alert(title, e.message)`.
- Image uploaded but the row update failed → the uploaded file is orphaned in storage. Harmless, and retrying reuses the already-remote URL. Worth a cleanup job later; not a v1 blocker.
- Destination write fails after the row update succeeded → the trip is half-saved. Do the destination write **first**, then the row update, so the failure order is the harmless one.
- Two devices editing at once: last write wins. Acceptable for one operator. If it ever bites, add an `updated_at` precondition to the update.

---

## 6. 🔴 OPEN — do joined travelers get notified?

**Nothing is decided here. Do not pick one while building. Owner: Eyal & Ohad.**

The question: an operator changes the dates, the price, or the destination after people have already joined and paid a deposit. Do those travelers hear about it?

Silence is not really an option — the workbench says so plainly ("If operators can edit fields people joined on the basis of, silence is not an option"). But *which* fields count as material, and *how* the message lands, is undecided. So is whether a price change is even allowed once someone has paid (§7.4).

### The options, and what each costs

**A. Nothing. Operator tells people themselves.**
Cost: zero build. The operator already has group chat, admin updates and (per SPEC.md §2) a 1:1 DM. Risk: a traveler discovers the new dates by opening the app. That is exactly the trust failure the unlock decision (§2 "The trust decision") is betting against.

**B. Nudge the operator at save time.**
On Save, if a material field changed, show a sheet: "You changed the dates. Tell your travelers?" with a prefilled admin update they can edit or skip.
Cost: small. Admin updates already exist (`group_trip_admin_updates` + `tg_notify_admin_update` trigger, `20260601010000_notification_center.sql:184-202`) and the operator model mirrors that pattern. One sheet, one prefilled string. Keeps the human in the loop, which suits partners we trust. Risk: they skip it.

**C. Automatic notification on material change.**
Save writes the change, a trigger fans out a notification to every booking.
Cost: a new `notification_type` enum value, a template row (`20260611000200_notification_templates.sql`), a trigger on `group_trips` that diffs OLD vs NEW, and a rule for what counts as material. Also a debounce — an operator fixing a typo three times must not send three pushes. Risk: noisy, and an automatic "the price changed" push with no explanation is worse than no push.

**D. Automatic, and the traveler must acknowledge.**
Like C, plus the change sits on the traveler's trip until they tap "Got it". For dates or price after payment this is close to a re-consent.
Cost: highest. New state per booking per change, a UI surface for it, and a decision about what happens to someone who never acknowledges. Straight into refund territory (SPEC.md open question #3).

### What has to be settled either way

- The list of material fields. Candidates: dates, price, destination, capacity, visibility. Not: description wording, a new photo.
- Whether "material" is a property of the field or of the size of the change (a $20 price bump vs a $600 one).
- Whether a price change is permitted at all once money has moved. This is the same conversation as refunds — SPEC.md open question #3.

---

## 7. Edge cases

### 7.1 Editing a trip while travelers are mid-onboarding

A traveler is on the passport step when the operator saves a new price.

- Overview fields (photos, description, vibe) are harmless. Their client re-fetches and moves on.
- Dates, price, destination and capacity change the deal they are part-way through accepting.
- Their app may be holding a cached trip row. The operator's save must bump something the traveler's client watches, so a stale trip does not sit on screen through a whole onboarding.
- If a payment is **in flight** — a checkout session open, a charge authorised but not captured — the amount charged must be the amount they were quoted. The checkout has to carry a price snapshot, not read the trip row at capture time. Whether a price edit should be blocked while a session is open depends on where payment sits in the flow (SPEC.md open question #2).

### 7.2 Moving the dates when deadlines are relative to departure

Requirement deadlines are stored **relative to departure** and displayed as real dates — "30 days before departure". See the requirements model (workbench `onb-req`; `docs/specs/operator-trips/requirements-model.md` when it is written). That design exists precisely so moving a trip keeps every deadline correct.

Consequences of a date edit:

- Push the trip **later** → every deadline moves later. Usually right.
- Pull the trip **earlier** → deadlines move earlier, and some may land in the past. Everyone who owed that item is instantly overdue, with no warning and no chance to act.
- A deadline that had **already passed**, on a trip that then moves later — does the requirement quietly re-open? **This is already flagged OPEN in the workbench** (`onb-req` → "Does a moved trip move its deadlines?", owner Eyal & Ohad). Do not decide it here.

Minimum this screen must do: before saving a date change, show what it does to the deadlines. "3 deadlines move. 1 lands in the past." Let the operator see it before they commit. That is true whichever way the open question lands.

### 7.3 Reducing capacity below the number already booked

Today, on peer trips, nothing stops this. The capacity trigger (`20260617000000_lock_capacity_check_triggers.sql:127-176`) fires **`BEFORE INSERT` on `group_trip_participants`** only. It reads `max_participants`, locks the trip row, counts, and rejects the join. It never runs when the trip row itself is updated. So a host can set max to 4 on a trip with 9 people and the database accepts it. The trip is then over capacity and no new joins are possible — a silent, confusing state.

For operator trips the same hole must not be dug. A **spot is secured by the deposit** (SPEC.md §2), so "booked" means bookings in `deposit_paid` or later, not everyone who started onboarding.

Proposed behaviour:

- **Raising capacity** is always fine.
- **Lowering to exactly the booked count** is fine. It closes the trip to new bookings. Say so: "This closes the trip — all 12 spots are taken."
- **Lowering below the booked count** is blocked in the UI. The stepper floor is the booked count, with a line explaining why: "12 travelers have secured a spot. Remove someone first."
- Back the floor with a **DB check on `group_trips`**, not just the client. A client-only floor is the same mistake as the pre-2026-06 capacity hole.
- The operator's real escape hatch is to remove a traveler (SPEC.md §4.3 already lists "remove from trip"). That path involves refunding money, which is **SPEC.md open question #3**. Do not let this screen become a back door around it.
- Race: two people paying deposits while the operator lowers the cap. The check must read the count under the same row lock the join path uses.

### 7.4 Changing the price after someone has paid

The dangerous version of this bug is quiet, not loud.

If a traveler's outstanding balance is computed as `trip.cost_per_person − sum(payments)`, then editing the trip price silently changes what an already-booked traveler owes. Raise the price by $300 and twelve people wake up owing $300 more, with no one having decided that.

Rules:

- **The traveler's row snapshots its price (decided 2026-07-23).** There is no bookings table. `price_snapshot` is a column on `group_trip_participants` — that table already carries per-person state like `commitment_status` — and ships together with the payments migration (payment timing and method will be decided later on). Make it a hard requirement: balance owed = `price_snapshot − sum(ledger)`. Never `trip.price − paid`.
- **A price edit applies to future bookings only.** Existing bookings keep the price they were booked at.
- The payment ledger is append-only and records what was actually charged. It is never rewritten by a price edit. Good — that means the money history stays true no matter what the operator does to the field.
- **FX:** for an operator pricing in ₪, keep using the trip's own frozen `budget_fx_rate` on save, exactly as `:1796` does. Re-fetching a live rate would move the canonical USD amount on an edit that only touched a photo.
- Lowering the price after people paid the old one raises "do they get the difference back?" That is a refund question — **SPEC.md open question #3**. Not answered here.
- The price field shape is itself unsettled: flat per person vs room types vs add-ons is **SPEC.md open question #1**. Build the price block as one self-contained section so it can be swapped when that lands.
- Whether a price edit should be allowed at all once money has moved is part of §6.

### 7.5 Smaller ones

- **Cancelled or completed trip** → no Edit trip entry in the menu.
- **Trip already started** → dates and price edits are close to meaningless. Consider hiding them, or at least warning.
- **Destination change** → touches more than one thing. It moves the trip in the explore feed, and visa is decided per trip (workbench `onb-req`), so a country change can make an existing visa requirement wrong. Flag it at save time.
- **Visibility listed → private** → the trip disappears from explore. People already booked keep their access. Say that on the toggle.
- **Cover photo replaced** → the old image stays in storage. Same as today. Fine.

---

## 8. Files to create or change

### New

- `src/screens/operator/OperatorTripEditScreen.tsx` — the screen.
- `src/services/operator/operatorTripsService.ts` — `updateOperatorTrip(tripId, patch)`, `setOperatorTripDestination(tripId, geo)`, and the booked-count read the capacity floor needs. (This file is already anticipated in SPEC.md §10.)
- SQL, applied **by hand in the Supabase SQL editor** (never `supabase db push`): the capacity check from §7.3 on `group_trips`, plus — recommended — a `group_trip_edit_log` (trip_id, operator_id, changed_fields JSONB, old/new, timestamp). The log is cheap now and it is the only thing that makes the §2 "The trust decision" trust revisit possible later. It also gives §6 its "what changed" payload for free.

### Changed

- `src/navigation/RootNavigator.tsx` — new `OperatorEditTrip` route, modelled on `EditTripCardScreen` (line 199).
- The operator trip detail screen's 3-dot menu — one new `menuItems` entry, following `TripDetailScreen.tsx:1371-1426`.

### Extracted, not duplicated

`CreateTripFlowA.tsx` is 4,661 lines. Copying any of it into the edit screen means two places to fix every bug. Pull these out to shared modules and have **both** the wizard and the edit screen import them:

| What | Where it is now | Extract to |
|---|---|---|
| Trip row → form values (`stateFromTrip`) | `CreateTripFlowA.tsx:529-605` | `src/services/trips/tripFormMapping.ts` |
| Form values → update patch (the `editable` object) | `:1822-1866` | same module, as a diff-producing function |
| `SummaryRow`, `DeetsRow` | `:626-…` | `src/components/trips/rows/` |
| Date helpers (`toISODate`, `parseISODate`, `expandMonthRange`, `formatLongDate`) | `:437-489` — and already re-inlined once in `TripEditSheets.tsx:30-60` | `src/utils/tripDates.ts` |
| Chip formatters (`levelChips`, `styleChips`, `waveChips`, `ageChips`, `formatWhenSummary`) | `:1100-1191` | `src/components/trips/tripSummaryFormat.ts` |
| Validation rules (age span, dates, stay, price) | `:1560-1670` | `src/services/trips/tripValidation.ts` |

Already extracted — reuse as-is: everything in `src/components/trips/sheets/`, and `src/services/trips/priceInclusions.ts`.

### Untouched

`group_trips`, every `group_trip_*` table, their RLS, and `is_trip_host()`. The peer-host wizard keeps its locks exactly as they are — this spec does not unlock anything for peer hosts.

---

## 9. Open questions

| # | Question | Owner | Blocks |
|---|---|---|---|
| 1 | 🔴 **Are joined travelers notified when a material field changes?** Which fields count, and which of options A–D in §6. | Eyal & Ohad | Ship gate for the unlock. Editing without an answer means silent changes to a paid trip. |
| 2 | 🔴 Is a price change allowed at all once someone has paid? | Eyal & Ohad | §7.4, and the refund conversation (SPEC.md #3). |
| 3 | 🟡 Does a moved trip re-open a deadline that had already passed? | Eyal & Ohad | §7.2. Already OPEN in the workbench `onb-req`. |
| 4 | 🟡 When does the §2 "The trust decision" trust unlock get a guard rail, and what shape? | Eyal | Not a v1 blocker. Becomes one as operator count grows. |
| 5 | 🟡 Does the operator need a "changed since you joined" marker on Overview, so a traveler can see what moved? | Eyal & Ohad | Depends on how #1 lands. |
| 6 | 🟡 The price block's shape depends on the pricing model (SPEC.md #1 — flat / room types / add-ons). | Design-partner operators | The Price section of the screen. Build it swappable. |
