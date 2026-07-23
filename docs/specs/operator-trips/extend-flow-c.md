# Extend flow C into the operator product

**Data model:** extends `hosting_style = 'C'` group trips. Overrides SPEC.md §5.

**Status:** spec only. No code changed.
**Reframed:** 2026-07-22. See `docs/operator-trips-workbench.html`, features `visibility` and `g-arch`.

## Why

Group trips have three hosting styles: `A` Crew, `B` Captain, `C` Operator. The new paid Operator
product is **not** a separate data model. An operator trip **is** a `group_trips` row with
`hosting_style = 'C'`. Everything flow C already has — the pricing step, the inclusions model, the
Explore deck — is the foundation the operator features build on.

So this is an **extend**, not a rebuild. We add columns and child tables around the existing C
trip; we do not touch A or B, and we do not create a rival "Operator" concept. "Operator" already
means C, and it keeps meaning C.

Live count 2026-07-22: **A = 12 active + 3 cancelled, B = 3 active, C = 1 active.** That single C
trip is simply the first operator trip. It gains the new capabilities as they land. No migration,
no owner conversation, no reclassification.

---

## 1. What flow C already is (the base we build on)

Flow C is already a rich, working flow — this is a head start, not a liability. It owns a whole
wizard step (`renderPricingStep`, ~119 lines), ten bottom sheets (~160 lines of JSX), its own
Explore deck ("Trip Operators"), the entire `priceInclusions.ts` model (348 lines) plus
`IncludesSheets.tsx`, and ~10 real behaviour branches in the wizard (exact dates only, stay
required, About-you step, no AI budget call, fixed per-person price, rich inclusions).

Real branches, excluding comments: ~28 in the create wizard, 12 in the detail views, 4 in Explore,
7 vocabulary maps. All of it stays. The operator features attach to it.

Key property that makes extension cheap: the read path is **not** gated on C.
`TripDetailViewRedesigned` shows the price chip and the "What's included" sheet whenever
`cost_per_person != null`, never checking hosting style (line 351). Only the write path is C-only.
So new operator display (deposit, requirements, documents) can key off data presence the same way.

---

## 2. Inventory — what already exists for flow C and gets extended

Every place that branches on `'C'` or renders "Operator". This is the surface the operator
features hook into.

### 2.1 Vocabulary

`src/services/trips/tripVocabulary.ts`

| Line | What |
|---|---|
| 2-9 | Header comment "Crew · Captain · Operator" |
| 14-18 | `TRIP_TYPE_WORD.C = 'Operator'` |
| 21-25 | `TRIP_TYPE_PILL.C = 'Operator'` |
| 28-32 | `TRIP_TYPE_COLOR.C = '#E0A800'` — **no importers today** |
| 38-42 | `TRIP_TYPE_GRADIENT.C` (metallic gold) |
| 45-49 | `TRIP_TYPE_BYLINE.C = 'By an operator'` |
| 52-56 | `TRIP_ROLE_NOUN.C = 'the operator'` — **no importers today** |
| 59-72 | `TRIP_CHOOSER.C` — "Operator" / "For surf trip operating businesses." |

`docs/trip-vocabulary-spec.md` — section "3. OPERATOR (C)" (~57-70) and the cross-surface table.

### 2.2 Service / types

`src/services/trips/groupTripsService.ts`

| Line | What |
|---|---|
| 6 | `export type HostingStyle = 'A' \| 'B' \| 'C'` |
| 101 | `hosting_style` on `GroupTrip` |
| 144-146 | comment "Flow C pricing" + `cost_per_person`, `price_inclusions` |
| 155 | comment "Flow B … Null for Flow A/C" |
| 382 | `EXPLORE_TRIP_SELECT` includes `hosting_style` — keep, no branch |

### 2.3 Chooser and Explore

`src/screens/trips/TripsScreen.tsx`

| Line | What |
|---|---|
| 36 | imports `TRIP_CHOOSER`, `TRIP_TYPE_PILL`, `TRIP_TYPE_GRADIENT` |
| **84** | `HOSTING_STYLE_OPTIONS` third card, key `'C'`, image `Images.createTrip.tripOperator` |
| 372-378 | `TRIP_TYPE` map — `C: { label: 'Operator', icon: 'briefcase-outline' }` |
| 396-397 | lookup with `?? TRIP_TYPE.A` fallback (already safe for unknown styles) |
| 476, 644, 966-967, 1013-1016 | comments about colours / the operator subset |
| **983** | `const operatorTrips = filtered.filter(t => t.hosting_style === 'C')` |
| **1058-1072** | `"Trip Operators"` section title + a second `TripDeck` |
| 1557 | renders `HOSTING_STYLE_OPTIONS` |

`src/assets/images/index.ts:93` → `create-trip/trip-operator.png`, used only by the C card.

### 2.4 Create wizard — the deep part

`src/screens/trips/CreateTripFlowA.tsx`

| Line | What |
|---|---|
| 98, 106-107, 114 | imports `PriceInclusions`, `normalizePriceInclusions`, `IncludesSheets` |
| 145-147 | draft-version comments (v4→v5 priceInclusions, v5→v6 hostingStyle) |
| 156 | `STEPS_BASE = ['audience','basics','vibez','budget','preview']` |
| 163 | `AGE_WINDOW_BY_STYLE` has a `C` key (all three are 4 — harmless) |
| 274-284 | `SheetKey` union: 10 keys `incMeals … incCustom`, commented "Flow C" |
| 293, 344, 353, 392 | wizard state carries `hostingStyle` + `priceInclusions` |
| 529-534, 557, 602 | `stateFromTrip` restores `price_inclusions`, operator currency |
| 1201, 1212, 1217-1220 | props + `operatorCurrency` (₪ for Israeli hosts) |
| **1227** | `const isFixedFlow = effectiveStyle === 'C'` — the master flag |
| 1230 | `requiresSpecificStay = isLeaderFlow \|\| isFixedFlow` |
| 1233 | `hasAboutYou = isLeaderFlow \|\| isFixedFlow` |
| 1237-1241 | step list inserts `aboutYou` for B and C |
| 1373-1376 | effect pins `datesMode` to `'exact'` for C |
| 1635-1642 | budget-step validation: C requires a positive fixed price |
| 1702 | C skips the AI budget estimate |
| 1798-1810, 1853-1854 | save: null budget range, fixed price, `price_inclusions` |
| 2012-2026 | step title "Pricing", ₪/USD subtitles, About-you subtitle |
| 2408-2410 | stay helper copy (Captain vs "everyone") |
| 2601-2622 | inclusion state helpers (`setInclusions`, custom list) |
| **2624-2742** | `renderPricingStep()` — the whole C pricing step |
| 2743 | `if (isFixedFlow) return renderPricingStep();` |
| 2993 | "Why surfers can trust your operation" |
| 3067-3074 | preview VM gets `priceInclusions` / null budget |
| 3426 | `lockCalendar={isFixedFlow}` |
| **3564-3723** | the ten `WizardBottomSheet` inclusion sheets |

`src/screens/trips/CreateTripWizard.tsx` — router only, types `HostingStyle`, no `'C'` literal.
No change needed. `src/hooks/useTripWizardDraft.ts:26` — comment only.

### 2.5 Trip detail

`src/screens/trips/TripDetailScreen.tsx`

| Line | What |
|---|---|
| 241, 246 | VM gets `priceInclusions`, `hostingStyle` |
| 248 | `leader` block only when `hosting_style === 'B'` |
| 1560, 1572 | comments naming "Trip Operator" / "Captain + Operator" |
| **1930-1937** | `EditTextSheet` "About you" copy branches on `'C'` |

`src/components/trips/TripDetailViewRedesigned.tsx` — the **live** detail view

| Line | What |
|---|---|
| 39-42, 75 | imports inclusions + vocabulary |
| 327-328 | `priceInclusionSections` / `priceInclusionAddOns` |
| 336-337 | coloured type tag word + gradient |
| **349** | `const isOperator = vm.hostingStyle === 'C'` |
| 352 | `isPlannedTogether = hostingStyle === 'A'` |
| 361-377 | price chip: C shows "Price" + "What's included" instead of a budget vibe |
| 421-426 | `isLooseFlow = A \|\| B` — C excluded from host "Set dates / Set stay" pills |
| 432-446, 1414 | host-badge comments naming Trip Operator |
| 628-629 | `'About the operator'` vs `'About the Captain'` |
| 693-694 | empty-bio placeholder branches on operator |
| 961 | the "What's included" sheet |

`src/components/trips/TripDetailView.tsx` — **dead render path.** Nothing renders this component;
only `TripDetailVM`, `BOARD_SHORT`, `formatDateRange` are imported from it (`TripDetailScreen:74`,
`CreateTripFlowA:86`, `ShareTripStorySheet:17`, `TripDetailViewRedesigned:74`). It still holds C
code at 209-212 (`TRIP_TYPE_LABEL`), 555-556, 563, 913. This is genuine dead code — a good
separate cleanup, unrelated to the operator work. Do not build new features against it.

`src/components/trips/sheets/IncludesSheets.tsx` — 5 sheet bodies (`ActivitiesSheetContent`,
`WellnessSheetContent`, `SurfFilmSheetContent`, `VideoAnalysisSheetContent`,
`CustomInclusionSheetContent`). Used by the C pricing step; reusable by new operator sheets.

`src/navigation/RootNavigator.tsx:218` — passes `trip.hosting_style` through. No branch.

### 2.6 Database

| File / object | What |
|---|---|
| `20260414000000_create_group_trips.sql:13` | `check (hosting_style in ('A','B','C'))` — C already legal, no change |
| same, 60-62 | old per-style age windows — **superseded** by `20260701000000_uniform_age_window_4.sql` |
| `20260525000001_group_trips_flow_b_columns.sql` | added `cost_per_person` (a **Flow B** column) and legacy `price_includes text[]` |
| feed RPCs (`20260615120000`, `20260616120000`, `20260616130000`, `20260701010000`, `20260703000000`, `20260707000000`) | all **return** `hosting_style`; **none branch on it**. New operator columns must be added to these RPC return lists to reach the client. |
| `supabase/tests/*.sql` | fixtures insert `'A'`. Unaffected. |

**No edge function reads `hosting_style`** (grepped `supabase/functions/`).

---

## 3. The one existing flow-C trip

It simply becomes the first operator trip as features land. No migration, no reclassification, no
owner conversation. When deposit config / requirements / documents ship, that row can carry them
like any other C trip.

If you want to look at it (optional, read-only):

```sql
select t.id, t.title, t.status, t.cost_per_person,
       t.price_inclusions is not null as has_inclusions,
       t.participant_count, t.host_id
from public.group_trips t
where t.hosting_style = 'C';
```

---

## 4. `priceInclusions.ts` — keep in place, build on it

**Keep it where it is. Do not move it, do not fork it.**

The header calls it "the model for Flow C". The finding is now simpler than that: `cost_per_person`
and the inclusions were added on the **Flow B** columns migration (`20260525000001`), so the model
is not even C-specific. It is:

- one JSONB column (`group_trips.price_inclusions`), opaque to the DB, never filtered in SQL, grows
  without a migration — exactly the shape the operator "What's included" needs, and
- read style-agnostically (§1).

Action: the operator features import this module directly — `PriceInclusions`,
`priceInclusionSections`, `priceInclusionAddOns`, `normalizePriceInclusions` are pure functions
over a plain object. Reuse `IncludesSheets.tsx` for any new inclusion-style sheets. A second copy
is how things drift; there is no second copy.

---

## 5. What to ADD to flow C

New capabilities attach to the existing C trip. Two shapes: a few **columns** on `group_trips`, and
new **child tables** keyed by `trip_id` (+ `user_id` where it is per-participant), exactly like the
existing `group_trip_participants` / `group_trip_destinations` pattern. Nothing on A/B changes.

### 5.1 Columns on `group_trips` — nothing added yet (decided 2026-07-23)

Applied by hand in the Supabase SQL editor — never `supabase db push`.

- **Deposit config — deferred.** Nothing is added to `group_trips` for deposits until payment
  timing and method are decided (payment timing and method will be decided later on). When it
  lands, it will be one `deposit_amount` column in canonical USD, reusing the existing
  `budget_currency` + frozen `budget_fx_rate` — no `deposit_currency` column. A `payment_rail`
  value ('stripe' | 'israeli') is decided together with payments. Null for A/B and for
  un-configured C trips (read path already tolerates nulls).
- **Visibility — decided 2026-07-23.** The existing `visibility` column is reused for the operator
  listing toggle: new value `'link_only'` next to `'public'`. No `operator_visibility` column.
  Explore queries add `where visibility = 'public'` when the toggle ships. See workbench feature
  `visibility` (locked in SPEC.md): operators distribute their own link by default, listing is
  the opt-in growth lever.

Every new display column must be added to the feed RPC return lists (§2.6) or it never reaches the
client.

### 5.2 New child tables (keyed by `trip_id`, sometimes `+ user_id`)

Definitions live on the trip. There is **no per-traveler state table** — requirement state always
derives from the evidence tables below: documents (upload), acknowledgements (acknowledge),
medical form `completed_at` (medical), payment ledger (pay). Decided 2026-07-23. This mirrors the
one-list requirements model (workbench `g-arch` — which is why `operator_trip_tasks` was dropped).

- **`group_trip_requirements`** — the operator's required items/answers for a trip (definitions
  only). See **requirements-model.md**.
- **`group_trip_documents`** — files the operator issues or collects (itineraries, invoices).
  Keyed by `trip_id`, optionally `user_id` for per-participant docs. Plus
  **`group_trip_document_reviews`** as the review audit trail. See **documents-storage.md**.
- **`group_trip_waiver_versions`** — append-only waiver texts/PDFs, one row per version. See
  **waiver-medical.md**.
- **`group_trip_acknowledgements`** — immutable "I agree" records, serving the waiver AND custom
  acknowledge requirements. `trip_id + user_id`. See **waiver-medical.md**.
- **`group_trip_medical_forms`** — per-participant medical data. `trip_id + user_id`, tight RLS
  (participant + host only). See **waiver-medical.md**.
- **`group_trip_payment_events`** — append-only ledger of deposits/payments/refunds. `trip_id +
  user_id`, insert-only, never updated in place. Sketch only — payment timing and method will be
  decided later on. See **approval-review.md**.
- **`group_trip_edit_log`** — recommended: append-only record of operator edits. See
  **operator-trip-edit.md** §8.

### 5.3 RLS

New tables get their **own** RLS helpers. They may **call** the existing `is_trip_host(trip_id)` /
`is_trip_participant(trip_id)` helpers to decide access, but they **must never modify** those
functions — A/B trips depend on them. Typical shape: host can read/write all rows for their trip;
a participant can read/write only their own `user_id` row. Follow the append-only rule for
`group_trip_payment_events` (insert allowed, update/delete denied).

Cross-references: **requirements-model.md**, **documents-storage.md**, **approval-review.md**,
**waiver-medical.md** — the per-feature specs. This file is the data-model umbrella they sit under.

---

## 6. Order of operations

Migrations are applied **by hand in the Supabase SQL editor**. Never `supabase db push`.
All client code below is **JS-only and OTA-able unless a new native dependency is introduced** (a
document picker or payment SDK would make a step native — call it out when that step is specced).

1. **Add columns + child tables (DB, by hand).** Additive, nullable, no change to A/B rows or to
   existing RLS helpers. Safe to apply before any UI exists.
2. **Extend the feed RPCs** to return the new display columns (§2.6) so the client can read them.
3. **Extend the wizard / detail view** behind the existing `isFixedFlow` / `isOperator` branches
   (§2.4, §2.5) to capture and show the new data. Reuse `priceInclusions.ts` and `IncludesSheets`.
4. **Per-feature work** proceeds in its own spec (requirements, documents, medical, payments),
   each attaching to the tables from step 1.

No constraint change is needed — `'C'` is already legal. No A/B path is touched at any step.

---

## 7. Open questions

1. Is there money attached to the one existing C trip outside the app? Only matters for how its
   first operator features are rolled out — not blocking.
2. ~~Deposit column shape: reuse `visibility` for the listing toggle, or add `operator_visibility`?~~
   **Resolved 2026-07-23.** `visibility` is reused: new value `'link_only'` next to `'public'`, no
   `operator_visibility` column; explore queries add `where visibility = 'public'` when the toggle
   ships. Deposits: nothing is added to `group_trips` until payment timing and method are decided
   (payment timing and method will be decided later on); when added it is one `deposit_amount` in
   canonical USD, reusing `budget_currency` + frozen `budget_fx_rate` — no `deposit_currency`.
3. Do the new inclusion-style operator sheets reuse `IncludesSheets.tsx` as-is, or need new bodies?
4. Cold start in Explore: `explore_feed` sorts by participant count, so a brand-new listed operator
   trip lands at the bottom and is never seen (workbench `visibility`, open). Affects whether the
   "Trip Operators" deck (`TripsScreen:1058-1072`) is enough or needs its own ranking.
