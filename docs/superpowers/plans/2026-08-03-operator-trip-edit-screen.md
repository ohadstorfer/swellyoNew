# Operator Trip Edit Screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an operator (a `hosting_style='C'` trip host) one screen, reached from the trip's 3-dot menu, where they can change every field of their published trip.

**Architecture:** A new card route (`OperatorEditTrip`) renders a list of rows grouped into sections. Each row shows only its name and a chevron. Tapping opens a bottom sheet (or a full screen for cover photo and destination) that holds its own draft and has its own Save button, which writes to Supabase immediately and closes. There is no global Save. One generic wrapper — `EditFieldSheet` — supplies the draft, the dirty check, validation, an optional confirm popup, and the Save footer, so each row is a thin declaration around a sheet body that already exists.

**Tech Stack:** React Native 0.81 / Expo 54 / React 19, React Navigation native-stack, TanStack Query v5, Supabase (Postgres + RLS + RPC), Jest (`jest-expo`).

**Spec:** `docs/specs/operator-trips/operator-trip-edit.md` (v2, 2026-08-03). Read it before starting. Section references below (§) point at it.

## Global Constraints

- **Never run `git commit`, `git add -A`, `git commit -a`, or `git reset --hard`.** Ohad edits files in parallel and commits by hand. Every task ends by listing the files it changed, nothing more.
- **Never run `supabase db push`.** SQL goes into a migration file. Ohad applies it by hand (Supabase SQL editor, or `supabase db query --linked -f <file>`). The Supabase MCP `execute_sql` is read-only — fine for checking, useless for applying.
- **Every new Postgres function must pin `set search_path = public, extensions, pg_temp`.** 46 existing functions were hardened this way; a new one without it is a regression.
- **Every new RPC needs explicit grants.** `EXECUTE` was revoked from `public` project-wide, so a new function is a 403 for clients until you `grant execute ... to authenticated`. Also `revoke execute ... from anon, public` — `create or replace` re-grants `PUBLIC` every time.
- **Fonts:** `ff(family, weight)` from `src/theme/fonts.ts`. Never bare `fontFamily` + `fontWeight` — iOS silently renders Regular.
- **Colours:** existing tokens from the surrounding files. Do not declare a new local `COLORS` block.
- **Two sheet families, two different close behaviours — do not assume they match.** `EditFieldSheet` (this plan's own wrapper) blocks every close path while a save is in flight: `onClose={saving ? () => {} : onClose}`. The reused `TripEditSheets.tsx` components (`EditTextSheet`, `EditCoverSheet`, `EditAccommodationSheet`) do **not** — they pass the raw `onClose` straight to `WizardBottomSheet`, which wires it to the backdrop tap, Android back and drag-to-dismiss unguarded. So a swipe-down mid-save unmounts the sheet and discards the draft while the `onSave` promise keeps running. This is pre-existing behaviour, equally reachable today from `TripDetailScreen`'s host edit pills; this plan does not fix it. Do not claim the guarantee holds for the `TripEditSheets` family.
- **Memoise every object/array prop passed to a `TripEditSheets` sheet.** `EditDatesSheet`'s reset effect depends on `initial`'s *reference*, not on the closed→open edge (`TripEditSheets.tsx:365-370`), unlike `EditFieldSheet` which guards with a `prevVisible` ref. An inline object literal gets a new identity on every parent re-render, so any background query resolving while the sheet is open silently reverts the operator's in-progress edit. `useMemo` keyed on the underlying scalar fields — not on `trip` itself, since the query can hand back a new object for unchanged data.
- **Never seed a sheet from a `trip` that has not loaded.** `EditAccommodationSheet` has no `dirty` gate — only `valid = kind && name.trim()`. If it opens while `trip` is null, `initial` is all-empty and a save writes whatever the operator typed over the real `accommodation_*` columns. Gate the rows (or the screen) on the trip being loaded rather than relying on the cache happening to be warm.
- **New bottom sheets:** wrap in `BottomSheetShell` (`src/components/BottomSheetShell.tsx`). Never `WizardBottomSheet`. **`BottomSheetShell` is headless** — it owns only the Modal, the scrim, the slide and the swipe. Every consumer must render its own white surface (`backgroundColor: '#FFFFFF'` + top radii) **and** its own `paddingBottom: Math.max(insets.bottom, 16) + N`. Miss either and the sheet renders on the bare scrim or its footer hides under the Android nav bar — both invisible to `tsc` and `jest`, visible only on device. Full reference pattern: `src/components/trips/RejectDocumentSheet.tsx`. In this plan only `EditFieldSheet` talks to the shell directly; the `*SheetContent` bodies render inside it and must not add a surface of their own.
- **Errors:** `showErrorAlert` / `friendlyErrorMessage` from `src/utils/friendlyError.ts`. Never `Alert.alert(title, e.message)`. The real signature is `showErrorAlert(title: string, e: unknown, fallback: string)` — title FIRST, then the caught error, then the fallback sentence.
- **Money:** `cost_per_person`, `deposit_amount`, `budget_min`, `budget_max` are always canonical USD. `budget_currency` is only the operator's input currency. Never re-fetch an FX rate on an edit — `budget_fx_rate` is frozen per trip.
- **Verification:** `npx tsc --noEmit` and `npm test` after every task. There is **no simulator or Maestro testing in this project** — Ohad tests on device. Never claim a UI works because it compiles; say "type-checks, needs a device check".
- **Owner-only.** This screen is gated on `trip.host_id === currentUserId` — the operator of record — NOT on `isHost`/`isTripHost()`, which is flat multi-host and includes every promoted admin. Reason: `group_trips` UPDATE RLS is `is_trip_host(id)` (`20260708000000_group_trip_multiple_hosts.sql:165`), so any co-host can write `cost_per_person`, and this screen is the first UI anywhere that edits a published trip's price. It follows the C3 ruling already applied to `operator_set_traveler_price`: money follows `host_id`, not the host team. Ohad's call, 2026-08-03; he may loosen it to per-row gating later.
- **Signatures verified on 2026-08-03 during Task 5 — the plan's earlier guesses were wrong. Use these:**
  - `useTripCore` lives in `src/hooks/trips/useTripDetail.ts`, NOT `useTripQueries.ts`. Signature `(tripId, currentUserId: string | null)`, and it returns `TripCoreData = { trip, participants, myRequest }` — so the trip is `data?.trip ?? null`, not `data`.
  - `tripsKeys` IS in `src/hooks/trips/useTripQueries.ts`.
  - `currentUserId` comes from `useOnboarding()`: `const { user } = useOnboarding(); const currentUserId = user?.id?.toString() ?? null;` — the pattern every trip-adjacent screen uses.
  - `uploadTripImage` lives in `src/services/storage/storageService.ts`, NOT `groupTripsService.ts`. Signature `(imageUri: string, userId: string, kind: 'hero' | 'accommodation' = 'hero') => Promise<UploadResult>` where `UploadResult = { success: boolean; url?: string; error?: string }`. Check `res.success && res.url` and throw otherwise; it needs a userId, so guard on a signed-in user first.
  - `EditAccommodationSheet`'s `AccommodationInitial` is UI-shaped, not DB-shaped: `{ kind: AccommodationKind | null; name: string; url: string; photoUri: string | null }`. Map both directions by hand; `accommodation_type` is an array column, written as `[kind]`.
- **Scope:** operator trips only (`hosting_style === 'C'`). Peer A/B trips and the existing create wizard keep their current locks. The only exception is Task 13, which points the wizard at shared validation without changing its behaviour.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/services/trips/tripValidation.ts` | **New.** Pure field rules — age span, dates, stay, price, deposit, spots floor. No React, no Supabase. |
| `src/services/trips/__tests__/tripValidation.test.ts` | **New.** Tests for the above. |
| `supabase/migrations/20260803100000_operator_trip_edit_guards.sql` | **New.** Capacity floor CHECK + `operator_freeze_trip_prices` RPC. Applied by hand. |
| `src/services/operator/operatorTripsService.ts` | **New.** The three DB calls this screen needs: price freeze, trip update, destination update. |
| `src/services/operator/__tests__/operatorTripsService.test.ts` | **New.** Tests for the pure parts and the call ordering. |
| `src/components/trips/edit/EditFieldSheet.tsx` | **New.** The generic draft + validate + confirm + Save wrapper every row uses. |
| `src/components/trips/edit/EditRow.tsx` | **New.** One row: name + chevron. No value. |
| `src/components/trips/edit/EditSection.tsx` | **New.** A titled group of rows. |
| `src/screens/operator/OperatorTripEditScreen.tsx` | **New.** The screen — sections, rows, and the sheet mounts. |
| `src/components/trips/sheets/SpotsSheetContent.tsx` | **New.** Stepper with the participant-count floor. |
| `src/components/trips/sheets/PriceSheetContent.tsx` | **New.** Price per person + deposit. |
| `src/components/trips/sheets/VisibilitySheetContent.tsx` | **New.** Listed / link-only toggle. |
| `src/screens/operator/OperatorEditDestinationScreen.tsx` | **New.** Full-screen place picker for Where. |
| `src/navigation/navigationRef.ts:15` | **Modify.** Add `OperatorEditTrip` and `OperatorEditDestination` to `RootStackParamList`. |
| `src/navigation/RootNavigator.tsx` | **Modify.** Register both routes. |
| `src/screens/trips/TripDetailScreen.tsx:1570` | **Modify.** One new `menuItems` entry. |
| `src/screens/trips/CreateTripFlowA.tsx` | **Modify (Task 13 only).** Point `validateStep` at `tripValidation.ts`. |

---

## Task 1: Shared field validation rules

The wizard's rules live inside `validateStep` (`CreateTripFlowA.tsx:1667-1817`), a 150-line
callback that also sets React error state. The new screen cannot call it. Extract the rules as
pure functions so both screens agree, and so they are testable without rendering anything.

**Files:**
- Create: `src/services/trips/tripValidation.ts`
- Test: `src/services/trips/__tests__/tripValidation.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `validateAgeRange(ageMin: number | null, ageMax: number | null, ageWindow: number): string | null`
  - `validateDates(input: { mode: 'exact' | 'months'; startDate: string | null; endDate: string | null; months: string[]; durationDays: number | null }): string | null`
  - `validateStay(input: { specificStaySelected: boolean; name: string | null; url: string | null; imageUrl: string | null }): string | null`
  - `validatePrice(costPerPerson: number | null): string | null`
  - `validateDeposit(depositAmount: number | null, costPerPerson: number | null): string | null`
  - `validateSpots(maxParticipants: number | null, participantCount: number): string | null`
  - Every one returns `null` when valid, or a sentence for the user when not.

- [ ] **Step 1: Write the failing test**

Create `src/services/trips/__tests__/tripValidation.test.ts`:

```ts
// Pure rules — no supabase mock needed, the module imports nothing from config.
import {
  validateAgeRange,
  validateDates,
  validateStay,
  validatePrice,
  validateDeposit,
  validateSpots,
} from '../tripValidation';

describe('validateAgeRange', () => {
  it('accepts a range wider than the window', () => {
    expect(validateAgeRange(25, 35, 4)).toBeNull();
  });

  it('accepts a range exactly the window wide', () => {
    expect(validateAgeRange(25, 29, 4)).toBeNull();
  });

  it('rejects a range narrower than the window', () => {
    expect(validateAgeRange(25, 27, 4)).toMatch(/4 years/);
  });

  it('rejects max below min', () => {
    expect(validateAgeRange(35, 25, 4)).toMatch(/older/);
  });

  it('rejects ages outside 16-99', () => {
    expect(validateAgeRange(15, 30, 4)).toMatch(/16/);
    expect(validateAgeRange(20, 100, 4)).toMatch(/99/);
  });

  // An operator who has not opened the age sheet yet has nulls. That is not an
  // error on its own — the screen decides whether the field is required.
  it('accepts nulls', () => {
    expect(validateAgeRange(null, null, 4)).toBeNull();
  });

  // Half-filled sheet. Nothing in the database enforces the 16-99 floor, so a
  // one-sided value has to be caught here or not at all.
  it('still bounds a lone minimum', () => {
    expect(validateAgeRange(5, null, 4)).toMatch(/16/);
  });

  it('still bounds a lone maximum', () => {
    expect(validateAgeRange(null, 120, 4)).toMatch(/99/);
  });

  it('accepts an in-range lone value', () => {
    expect(validateAgeRange(25, null, 4)).toBeNull();
    expect(validateAgeRange(null, 40, 4)).toBeNull();
  });
});

describe('validateDates', () => {
  it('accepts an end date after the start', () => {
    expect(validateDates({
      mode: 'exact', startDate: '2026-09-01', endDate: '2026-09-08',
      months: [], durationDays: null,
    })).toBeNull();
  });

  it('accepts a one-day trip (same start and end)', () => {
    expect(validateDates({
      mode: 'exact', startDate: '2026-09-01', endDate: '2026-09-01',
      months: [], durationDays: null,
    })).toBeNull();
  });

  it('rejects an end date before the start', () => {
    expect(validateDates({
      mode: 'exact', startDate: '2026-09-08', endDate: '2026-09-01',
      months: [], durationDays: null,
    })).toMatch(/after/);
  });

  it('rejects exact mode with no dates', () => {
    expect(validateDates({
      mode: 'exact', startDate: null, endDate: null, months: [], durationDays: null,
    })).toMatch(/dates/);
  });

  it('accepts month mode with a month and a length', () => {
    expect(validateDates({
      mode: 'months', startDate: null, endDate: null,
      months: ['2026-09'], durationDays: 7,
    })).toBeNull();
  });

  it('rejects month mode with no month', () => {
    expect(validateDates({
      mode: 'months', startDate: null, endDate: null, months: [], durationDays: 7,
    })).toMatch(/month/);
  });

  it('rejects month mode with no trip length', () => {
    expect(validateDates({
      mode: 'months', startDate: null, endDate: null,
      months: ['2026-09'], durationDays: null,
    })).toMatch(/long/);
  });
});

describe('validateStay', () => {
  // The gate is off — the operator is not naming a specific place, so the three
  // detail fields are irrelevant even when empty.
  it('accepts anything when the specific-stay gate is off', () => {
    expect(validateStay({
      specificStaySelected: false, name: null, url: null, imageUrl: null,
    })).toBeNull();
  });

  it('accepts a complete stay when the gate is on', () => {
    expect(validateStay({
      specificStaySelected: true,
      name: 'Casa Surf',
      url: 'https://casasurf.example',
      imageUrl: 'https://cdn.example/a.jpg',
    })).toBeNull();
  });

  it('rejects a stay missing its name', () => {
    expect(validateStay({
      specificStaySelected: true, name: '  ', url: 'https://x.example',
      imageUrl: 'https://cdn.example/a.jpg',
    })).toMatch(/name/i);
  });

  it('rejects a stay missing its link', () => {
    expect(validateStay({
      specificStaySelected: true, name: 'Casa Surf', url: null,
      imageUrl: 'https://cdn.example/a.jpg',
    })).toMatch(/link/i);
  });

  it('rejects a stay missing its photo', () => {
    expect(validateStay({
      specificStaySelected: true, name: 'Casa Surf',
      url: 'https://x.example', imageUrl: null,
    })).toMatch(/photo/i);
  });
});

describe('validatePrice', () => {
  it('accepts a positive price', () => {
    expect(validatePrice(1200)).toBeNull();
  });

  it('rejects zero', () => {
    expect(validatePrice(0)).toMatch(/more than/);
  });

  it('rejects a negative price', () => {
    expect(validatePrice(-5)).toMatch(/more than/);
  });

  it('rejects an unset price', () => {
    expect(validatePrice(null)).toMatch(/price/i);
  });
});

describe('validateDeposit', () => {
  // Mirrors the DB CHECK group_trips_deposit_not_over_price. Catching it here
  // gives the operator a sentence instead of a Postgres constraint error.
  it('accepts a deposit below the price', () => {
    expect(validateDeposit(300, 1200)).toBeNull();
  });

  it('accepts a deposit equal to the price', () => {
    expect(validateDeposit(1200, 1200)).toBeNull();
  });

  it('rejects a deposit above the price', () => {
    expect(validateDeposit(1500, 1200)).toMatch(/more than the price/);
  });

  it('rejects a negative deposit', () => {
    expect(validateDeposit(-1, 1200)).toMatch(/negative|zero or more/i);
  });

  // No deposit is a valid trip — the traveler pays in one go.
  it('accepts no deposit', () => {
    expect(validateDeposit(null, 1200)).toBeNull();
  });

  // The DB CHECK also passes when the price is null, so this must too.
  it('accepts a deposit when no price is set yet', () => {
    expect(validateDeposit(300, null)).toBeNull();
  });
});

describe('validateSpots', () => {
  it('accepts raising the cap', () => {
    expect(validateSpots(20, 12)).toBeNull();
  });

  it('accepts lowering the cap to exactly the participant count', () => {
    expect(validateSpots(12, 12)).toBeNull();
  });

  // The whole point of the floor: the join trigger only fires on INSERT into
  // group_trip_participants, so the DB would happily accept 4 on a 12-person
  // trip and leave it permanently unjoinable.
  it('rejects lowering the cap below the participant count', () => {
    expect(validateSpots(4, 12)).toMatch(/12 people/);
  });

  it('accepts an unset cap', () => {
    expect(validateSpots(null, 12)).toBeNull();
  });

  it('rejects a cap below 2', () => {
    expect(validateSpots(1, 0)).toMatch(/at least 2/);
  });

  it('rejects a cap above 50', () => {
    expect(validateSpots(51, 0)).toMatch(/50/);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx jest src/services/trips/__tests__/tripValidation.test.ts`
Expected: FAIL — `Cannot find module '../tripValidation'`.

- [ ] **Step 3: Write the implementation**

Create `src/services/trips/tripValidation.ts`:

```ts
/**
 * Field rules shared by the create wizard and the operator Edit trip screen.
 *
 * Pure on purpose: no React, no Supabase, no i18n. Each function returns null
 * when the value is fine, or one sentence to show the operator when it is not.
 *
 * Two of these mirror a database CHECK — validateDeposit
 * (group_trips_deposit_not_over_price) and validateAgeRange (the age span
 * CHECK). When either CHECK changes, change the function in the same commit or
 * the operator gets a raw Postgres error instead of a sentence.
 */

const MIN_AGE = 16;
const MAX_AGE = 99;
const MIN_SPOTS = 2;
const MAX_SPOTS = 50;

export function validateAgeRange(
  ageMin: number | null,
  ageMax: number | null,
  ageWindow: number,
): string | null {
  // Each end is bounded on its own, BEFORE the both-must-be-set guard. No DB
  // CHECK enforces the 16-99 floor — the migrations only carry `age_max >=
  // age_min` and the span rule, and both of those pass when either end is null.
  // So this function is the only thing standing between a half-filled sheet
  // (min typed, max not yet) and an out-of-range age reaching the row.
  if (ageMin != null && ageMin < MIN_AGE) return `The youngest age is ${MIN_AGE}.`;
  if (ageMax != null && ageMax > MAX_AGE) return `The oldest age is ${MAX_AGE}.`;
  // The comparison rules need both ends. An operator who has not opened the age
  // sheet yet has two nulls, and that is not an error on its own.
  if (ageMin == null || ageMax == null) return null;
  if (ageMax < ageMin) return 'The oldest age has to be older than the youngest.';
  if (ageMax - ageMin < ageWindow) {
    return `Make the age range at least ${ageWindow} years wide.`;
  }
  return null;
}

export type DatesInput = {
  mode: 'exact' | 'months';
  startDate: string | null; // ISO yyyy-mm-dd
  endDate: string | null;   // ISO yyyy-mm-dd
  months: string[];         // yyyy-mm
  durationDays: number | null;
};

export function validateDates(input: DatesInput): string | null {
  if (input.mode === 'exact') {
    if (!input.startDate || !input.endDate) return 'Pick the trip dates.';
    // ISO yyyy-mm-dd sorts the same as it compares, so a string compare is
    // correct here and skips every timezone question a Date would raise.
    if (input.endDate < input.startDate) {
      return 'The end date has to be on or after the start date.';
    }
    return null;
  }
  if (input.months.length === 0) return 'Pick at least one month.';
  if (input.durationDays == null || input.durationDays <= 0) {
    return 'Say how long the trip is.';
  }
  return null;
}

export type StayInput = {
  specificStaySelected: boolean;
  name: string | null;
  url: string | null;
  imageUrl: string | null;
};

export function validateStay(input: StayInput): string | null {
  if (!input.specificStaySelected) return null;
  if (!input.name?.trim()) return 'Add the name of the stay.';
  if (!input.url?.trim()) return 'Add a link to the stay.';
  if (!input.imageUrl?.trim()) return 'Add a photo of the stay.';
  return null;
}

export function validatePrice(costPerPerson: number | null): string | null {
  if (costPerPerson == null) return 'Set the price per person.';
  if (costPerPerson <= 0) return 'The price has to be more than 0.';
  return null;
}

export function validateDeposit(
  depositAmount: number | null,
  costPerPerson: number | null,
): string | null {
  if (depositAmount == null) return null;
  if (depositAmount < 0) return 'The deposit has to be zero or more.';
  // Matches the DB CHECK, which also passes when the price is null.
  if (costPerPerson == null) return null;
  if (depositAmount > costPerPerson) {
    return 'The deposit cannot be more than the price.';
  }
  return null;
}

/**
 * `participantCount` is group_trips.participant_count — the trigger-maintained
 * live count, host included. It is the same number max_participants is compared
 * against everywhere else (isFull on the detail screen, the join trigger), so a
 * floor built on anything else would let the client accept a value the database
 * then rejects. Someone who joined and has not paid still holds a spot.
 */
export function validateSpots(
  maxParticipants: number | null,
  participantCount: number,
): string | null {
  if (maxParticipants == null) return null;
  if (maxParticipants < MIN_SPOTS) return `A trip needs at least ${MIN_SPOTS} spots.`;
  if (maxParticipants > MAX_SPOTS) return `The most spots you can set is ${MAX_SPOTS}.`;
  if (maxParticipants < participantCount) {
    return `${participantCount} people are on this trip. Remove someone first.`;
  }
  return null;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx jest src/services/trips/__tests__/tripValidation.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors from these two files.

- [ ] **Step 6: Report, do not commit**

List the two files created. Ohad reviews and commits.

---

## Task 2: SQL guards — capacity floor and price freeze

Two database changes the screen depends on. Both must be applied before Tasks 9 and 10 can be
tested against real data, but the file can be written now.

**Why each exists:**

- **Capacity floor.** `20260617000000_lock_capacity_check_triggers.sql` fires `BEFORE INSERT on
  group_trip_participants` only. It never runs when the trip row is updated, so today a host can
  set `max_participants` to 4 on a trip with 9 people. The row is accepted, the trip is over
  capacity, and nobody can ever join again. Task 9 adds a client floor; this is the half that a
  client bug cannot get around.
- **Price freeze.** `trg_freeze_traveler_price`
  (`20260803000000_operator_trip_payments.sql:418`) already copies the trip price onto a
  participant row at join time — but **only when `payment_mode = 'managed'`**. When the trip is
  offline it writes `null` on purpose. So everyone who joined while the trip was offline is
  still on the `coalesce(p.price_total_usd, t.cost_per_person)` fallback in
  `operator_traveler_amount_due`, and once the operator switches the trip to managed, editing
  `cost_per_person` silently changes what all of them owe. This RPC closes that gap by pinning
  those rows to the current price before the edit lands.

**Files:**
- Create: `supabase/migrations/20260803100000_operator_trip_edit_guards.sql`

**Interfaces:**
- Produces: RPC `operator_freeze_trip_prices(p_trip_id uuid) returns integer` — the number of
  participant rows it froze. Callable by `authenticated`; it re-checks `is_trip_host()` itself.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260803100000_operator_trip_edit_guards.sql`:

```sql
-- Operator "Edit trip" screen — the two guards the client cannot enforce alone.
-- Spec: docs/specs/operator-trips/operator-trip-edit.md §7.1 and §7.2
--
-- APPLY BY HAND. Never `supabase db push` on this project — 168 local files are
-- unregistered and a push would replay them.
--   supabase db query --linked -f supabase/migrations/20260803100000_operator_trip_edit_guards.sql

begin;

-- ══════════════════════════════════════════════════════════════════
-- 1. Capacity floor
-- ══════════════════════════════════════════════════════════════════
-- participant_count is trigger-maintained and includes the host, so it is the
-- same number the UI shows as "X/Y going". A trigger, not a CHECK: a CHECK
-- cannot be added to a table that already violates it, and trips that are
-- already over capacity exist. This only guards the transition.
create or replace function public.tg_group_trips_capacity_floor()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
begin
  -- No comparison against `old` here, on purpose. The trigger already fires
  -- only when max_participants is in the SET list, so "did they touch the cap"
  -- is answered by the trigger definition, not by the condition. Comparing
  -- against old is also actively wrong: max_participants is nullable ("no cap"),
  -- and `coalesce(old.max_participants, new.max_participants)` collapses to
  -- `new < new` — always false — so an uncapped trip with 9 people could be
  -- capped at 4 and the guard would never fire. That is the exact case this
  -- trigger exists to block.
  --
  -- The rule that survives: any cap below the live count leaves the trip over
  -- capacity, whichever direction it came from. A host digging a trip out of an
  -- already-bad state must go to at least participant_count — anything less is
  -- still over capacity.
  if new.max_participants is not null
     and new.max_participants < coalesce(new.participant_count, 0)
  then
    raise exception
      'max_participants (%) is below the % people already on this trip',
      new.max_participants, new.participant_count
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- SECURITY INVOKER keeps this off the PostgREST RPC surface for anon, but
-- `create or replace` still hands PUBLIC an execute grant every time.
revoke execute on function public.tg_group_trips_capacity_floor()
  from public, anon, authenticated;

drop trigger if exists trg_group_trips_capacity_floor on public.group_trips;
create trigger trg_group_trips_capacity_floor
  before update of max_participants on public.group_trips
  for each row
  execute function public.tg_group_trips_capacity_floor();

-- ══════════════════════════════════════════════════════════════════
-- 2. Freeze existing travelers' prices
-- ══════════════════════════════════════════════════════════════════
-- Call this BEFORE writing a new cost_per_person. Every joined traveler whose
-- price_total_usd is still null is pinned to the price they joined at, so the
-- edit applies to new bookings only.
--
-- trg_freeze_traveler_price (section 8 of 20260803000000) already does this at
-- JOIN time — but only for payment_mode = 'managed'; on an offline trip it
-- writes null deliberately. This function covers the rows that trigger left
-- null: everyone who joined before the operator switched collection on.
--
-- SECURITY DEFINER because the only UPDATE policy on group_trip_participants is
-- self-only (auth.uid() = user_id) — a host has no RLS path to another
-- traveler's row. Same reason operator_set_traveler_price is definer. The
-- UPDATE below passes cleanly through trg_freeze_traveler_price: its UPDATE
-- branch leaves a host's write untouched.
--
-- host_id, NOT is_trip_host(). This mirrors the C3 ruling already applied to
-- operator_set_traveler_price (20260803000100): `is_trip_host` is flat
-- multi-host and includes every promoted admin, while `group_trips.host_id` is
-- the single operator of record — the one `operator_payout_accounts` pays.
-- This function writes the same money columns, so it takes the same gate.
create or replace function public.operator_freeze_trip_prices(p_trip_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_mode    text;
  v_price   numeric;
  v_deposit numeric;
  v_frozen  integer;
begin
  select payment_mode, cost_per_person, deposit_amount
    into v_mode, v_price, v_deposit
    from public.group_trips
   where id = p_trip_id and host_id = auth.uid()
   for update;

  if not found then
    raise exception 'not your trip' using errcode = '42501';
  end if;

  -- An offline trip collects nothing through Swellyo and its pay requirements
  -- are deactivated, so there is no amount for anyone to owe. Freezing here
  -- would pin prices that nothing reads.
  if v_mode is distinct from 'managed' then
    return 0;
  end if;

  -- Nothing to freeze against. A trip with no price has no traveler relying on
  -- the fallback, so this is a no-op rather than an error.
  if v_price is null then
    return 0;
  end if;

  update public.group_trip_participants
     set price_total_usd = v_price,
         -- Only pin a deposit when the trip has one. Writing 0 would turn "pay
         -- it all at once" into "you already paid a 0 deposit", which reads the
         -- same to the math but loses the distinction.
         deposit_usd = coalesce(deposit_usd, v_deposit)
   where trip_id = p_trip_id
     and price_total_usd is null
     and role <> 'host';

  get diagnostics v_frozen = row_count;
  return v_frozen;
end;
$$;

-- EXECUTE was revoked from public project-wide, so without this grant every
-- client call is a 403. The revoke comes first because `create or replace`
-- re-grants PUBLIC on every run.
revoke execute on function public.operator_freeze_trip_prices(uuid) from public, anon;
grant  execute on function public.operator_freeze_trip_prices(uuid) to authenticated;

commit;
```

- [ ] **Step 2: Check the SQL parses without applying it**

Run: `npx supabase db query --linked --file supabase/migrations/20260803100000_operator_trip_edit_guards.sql --dry-run 2>&1 | head -20`

If `--dry-run` is not supported by the installed CLI, skip this step and say so —
do **not** fall back to running it for real.

- [ ] **Step 3: Hand the file to Ohad**

Say exactly this, and stop:

> `supabase/migrations/20260803100000_operator_trip_edit_guards.sql` is ready. It is **not
> applied**. Apply it in the Supabase SQL editor, or with
> `supabase db query --linked -f supabase/migrations/20260803100000_operator_trip_edit_guards.sql`.
> Tasks 9 and 10 cannot be tested against real data until it is applied.

- [ ] **Step 4: Report, do not commit**

---

## Task 3: Operator trips service

The three database calls the screen makes. Kept out of the screen so the screen holds no
Supabase knowledge and this file can be tested on its own.

There is deliberately **no** booked-count read here. `participant_count` is already on the trip
row the screen loads (trigger-maintained, `20260531000004_group_trips_participant_counts.sql`),
and it is the number `max_participants` is compared against everywhere else. An extra query
against a different definition would only give the client a floor the database disagrees with.

**Files:**
- Create: `src/services/operator/operatorTripsService.ts`
- Test: `src/services/operator/__tests__/operatorTripsService.test.ts`

**Interfaces:**
- Consumes: `updateGroupTrip`, `setTripDestination`, `TripDestinationGeo` from
  `src/services/trips/groupTripsService.ts` (`:902`, `:445`).
- Produces:
  - `freezeTripPrices(tripId: string): Promise<number>` — rows frozen.
  - `updateOperatorTripPrice(tripId: string, patch: { cost_per_person?: number | null; deposit_amount?: number | null }): Promise<void>` — freeze, then write.
  - `updateOperatorTrip(tripId: string, patch: UpdateGroupTripInput): Promise<void>` — plain passthrough for every non-price field.
  - `setOperatorTripDestination(tripId: string, geo: TripDestinationGeo): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `src/services/operator/__tests__/operatorTripsService.test.ts`:

```ts
// The service module imports the supabase client at module scope, so it has to
// be mocked before the import — same shape as
// src/services/trips/__tests__/tripPaymentsService.test.ts.
const mockRpc = jest.fn();

jest.mock('../../../config/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

const mockUpdateGroupTrip = jest.fn();
jest.mock('../../trips/groupTripsService', () => ({
  updateGroupTrip: (...args: unknown[]) => mockUpdateGroupTrip(...args),
  setTripDestination: jest.fn(),
}));

import { freezeTripPrices, updateOperatorTripPrice } from '../operatorTripsService';

beforeEach(() => {
  mockRpc.mockReset();
  mockUpdateGroupTrip.mockReset();
});

describe('freezeTripPrices', () => {
  it('returns the number of rows the RPC froze', async () => {
    mockRpc.mockResolvedValue({ data: 3, error: null });
    await expect(freezeTripPrices('trip-1')).resolves.toBe(3);
    expect(mockRpc).toHaveBeenCalledWith('operator_freeze_trip_prices', { p_trip_id: 'trip-1' });
  });

  it('throws when the RPC errors', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'not the host of this trip' } });
    await expect(freezeTripPrices('trip-1')).rejects.toThrow('not the host of this trip');
  });

  // The RPC returns 0 for an offline trip and for a trip with no price. That is
  // a real answer, not a missing one, so it must not become null.
  it('returns 0 rather than null when nothing was frozen', async () => {
    mockRpc.mockResolvedValue({ data: 0, error: null });
    await expect(freezeTripPrices('trip-1')).resolves.toBe(0);
  });
});

describe('updateOperatorTripPrice', () => {
  it('freezes before it writes', async () => {
    const order: string[] = [];
    mockRpc.mockImplementation(async () => { order.push('freeze'); return { data: 2, error: null }; });
    mockUpdateGroupTrip.mockImplementation(async () => { order.push('update'); });

    await updateOperatorTripPrice('trip-1', { cost_per_person: 1500 });

    expect(order).toEqual(['freeze', 'update']);
  });

  // If the freeze fails, writing the new price would be exactly the silent
  // repricing this whole function exists to stop.
  it('does not write the price when the freeze fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(updateOperatorTripPrice('trip-1', { cost_per_person: 1500 })).rejects.toThrow('boom');
    expect(mockUpdateGroupTrip).not.toHaveBeenCalled();
  });

  it('passes the patch straight through to updateGroupTrip', async () => {
    mockRpc.mockResolvedValue({ data: 0, error: null });
    mockUpdateGroupTrip.mockResolvedValue(undefined);
    await updateOperatorTripPrice('trip-1', { cost_per_person: 1500, deposit_amount: 300 });
    expect(mockUpdateGroupTrip).toHaveBeenCalledWith('trip-1', {
      cost_per_person: 1500,
      deposit_amount: 300,
    });
  });
});

```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx jest src/services/operator/__tests__/operatorTripsService.test.ts`
Expected: FAIL — `Cannot find module '../operatorTripsService'`.

- [ ] **Step 3: Write the implementation**

Create `src/services/operator/operatorTripsService.ts`:

```ts
/**
 * Database calls for the operator "Edit trip" screen.
 * Spec: docs/specs/operator-trips/operator-trip-edit.md
 *
 * Everything here is operator-trip only (hosting_style = 'C'). Peer trips keep
 * going through groupTripsService directly.
 */
import { supabase } from '../../config/supabase';
import {
  updateGroupTrip,
  setTripDestination,
  type UpdateGroupTripInput,
  type TripDestinationGeo,
} from '../trips/groupTripsService';

/**
 * Pin every joined traveler to the price they joined at. See spec §7.2.
 *
 * trg_freeze_traveler_price already does this at join time for a trip that is
 * already 'managed'. This covers the rows it deliberately left null: everyone
 * who joined while the trip was still 'offline'. Without it, editing
 * cost_per_person silently reprices all of them.
 *
 * Returns how many rows were frozen. 0 is a real answer — an offline trip, or a
 * trip with no price, or one where everybody is already frozen.
 */
export async function freezeTripPrices(tripId: string): Promise<number> {
  const { data, error } = await supabase.rpc('operator_freeze_trip_prices', {
    p_trip_id: tripId,
  });
  if (error) {
    console.error('[operatorTripsService] freezeTripPrices error:', error);
    throw new Error(error.message);
  }
  return data ?? 0;
}

/**
 * The only sanctioned way to change a trip's price. Freezes first, then writes.
 * If the freeze throws, the price is NOT written — a half-done reprice is worse
 * than none.
 */
export async function updateOperatorTripPrice(
  tripId: string,
  patch: { cost_per_person?: number | null; deposit_amount?: number | null },
): Promise<void> {
  await freezeTripPrices(tripId);
  await updateGroupTrip(tripId, patch as UpdateGroupTripInput);
}

/** Every field that is not the price. A plain passthrough — kept here so the
 *  screen imports one service, not two. */
export async function updateOperatorTrip(
  tripId: string,
  patch: UpdateGroupTripInput,
): Promise<void> {
  await updateGroupTrip(tripId, patch);
}

/** Destination lives in group_trip_destinations; updateGroupTrip deliberately
 *  excludes it (groupTripsService.ts:895-902). setTripDestination already
 *  upserts on trip_id, so this handles a change as well as a first write. */
export async function setOperatorTripDestination(
  tripId: string,
  geo: TripDestinationGeo,
): Promise<void> {
  await setTripDestination(tripId, geo);
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx jest src/services/operator/__tests__/operatorTripsService.test.ts`
Expected: PASS.

If `TripDestinationGeo` is not exported from `groupTripsService.ts`, export it there — do not
redeclare it.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Report, do not commit**

---

## Task 4: Screen shell, route, and menu entry

The screen with every row visible and inert. Nothing opens yet. This is the task that makes the
feature reachable, so Ohad can look at the layout on a device before any sheet is wired.

**Files:**
- Create: `src/components/trips/edit/EditRow.tsx`
- Create: `src/components/trips/edit/EditSection.tsx`
- Create: `src/components/trips/edit/EditFieldSheet.tsx`
- Create: `src/screens/operator/OperatorTripEditScreen.tsx`
- Modify: `src/navigation/navigationRef.ts` — `RootStackParamList`
- Modify: `src/navigation/RootNavigator.tsx`
- Modify: `src/screens/trips/TripDetailScreen.tsx:1570` — `menuItems`

**Interfaces:**
- Consumes: `validateSpots` etc. from Task 1 (not used yet), `fetchBookedCount` from Task 3
  (not used yet).
- Produces:
  - `EditRow: React.FC<{ label: string; onPress: () => void; disabled?: boolean }>`
  - `EditSection: React.FC<{ title: string; children: React.ReactNode }>`
  - `EditFieldSheet<T>` — see its code below for the exact prop type. Tasks 5–11 all use it.
  - Route `OperatorEditTrip: { tripId: string }`.

- [ ] **Step 1: Add the route types**

In `src/navigation/navigationRef.ts`, inside `RootStackParamList` (next to the existing
`EditTrip` entry around line 20), add:

```ts
  /** Operator-only flat edit screen for a hosting_style='C' trip. Distinct from
   *  EditTrip, which reopens the create wizard and is peer-trip only. */
  OperatorEditTrip: { tripId: string };
  /** Full-screen place picker pushed from the Edit trip screen's "Where" row. */
  OperatorEditDestination: { tripId: string };
```

- [ ] **Step 2: Build the three shared pieces**

Create `src/components/trips/edit/EditSection.tsx`:

```tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ff } from '../../../theme/fonts';

export const EditSection: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <View style={styles.section}>
    <Text style={styles.title}>{title}</Text>
    <View style={styles.rows}>{children}</View>
  </View>
);

const styles = StyleSheet.create({
  section: { marginTop: 28 },
  title: {
    fontFamily: ff('Inter', '700'),
    fontSize: 13,
    letterSpacing: 0.6,
    color: '#7B7B7B',
    textTransform: 'uppercase',
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  rows: { backgroundColor: '#FFFFFF' },
});
```

Create `src/components/trips/edit/EditRow.tsx`:

```tsx
import React from 'react';
import { Text, StyleSheet, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ff } from '../../../theme/fonts';

/**
 * One row of the Edit trip screen: the field name and a chevron. No value.
 *
 * Deliberately different from ProfileEditPanel's InlineField (:1363), which
 * renders a value too. Values are left out here because every sheet writes on
 * its own Save, so there is no pending state a row would need to show, and a
 * trip field's value is usually a list that does not fit on one line.
 */
export const EditRow: React.FC<{
  label: string;
  onPress: () => void;
  disabled?: boolean;
}> = ({ label, onPress, disabled = false }) => (
  <Pressable
    style={({ pressed }) => [styles.row, pressed && !disabled && styles.rowPressed]}
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    accessibilityLabel={label}
  >
    <Text style={[styles.label, disabled && styles.labelDisabled]}>{label}</Text>
    <View style={styles.spacer} />
    <Ionicons name="chevron-forward" size={18} color={disabled ? '#D6D6D6' : '#B0B0B0'} />
  </Pressable>
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E4E4E4',
  },
  rowPressed: { backgroundColor: '#F6F6F6' },
  label: { fontFamily: ff('Inter', '400'), fontSize: 16, color: '#222B30' },
  labelDisabled: { color: '#B0B0B0' },
  spacer: { flex: 1 },
});
```

Create `src/components/trips/edit/EditFieldSheet.tsx`:

```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { BottomSheetShell } from '../../BottomSheetShell';
import { ff } from '../../../theme/fonts';
import { showErrorAlert } from '../../../utils/friendlyError';

export type ConfirmCopy = { title: string; message: string; confirmLabel: string };

export type EditFieldSheetProps<T> = {
  visible: boolean;
  title: string;
  /** Seeded into the draft each time the sheet goes closed -> open. */
  initial: T;
  onClose: () => void;
  /** Writes to the database. Throwing keeps the sheet open with the draft intact. */
  onSave: (value: T) => Promise<void>;
  /** Null when the draft is fine, otherwise the sentence to show. */
  validate?: (value: T) => string | null;
  /** Return copy to make Save ask first (spec §3.5 — Where and When). Return
   *  null to save straight away. */
  confirm?: (value: T) => ConfirmCopy | null;
  /** Compares draft to initial. Defaults to a JSON compare, which is right for
   *  the plain objects and arrays every field here uses. */
  isDirty?: (draft: T, initial: T) => boolean;
  children: (draft: T, setDraft: (next: T) => void) => React.ReactNode;
};

/**
 * The one sheet wrapper every row on the Edit trip screen uses.
 *
 * It owns: the local draft, the closed->open reseed, the dirty check that gates
 * Save, validation, the optional confirm popup, the saving spinner, and the
 * error alert. That leaves each row in the screen a ten-line declaration around
 * a body component that already exists in src/components/trips/sheets/.
 *
 * The reseed is on the closed->open EDGE, not on every `initial` change: a
 * React Query refetch mid-edit would otherwise wipe what the operator typed.
 * Same reason ProfileEditSurfStyleScreen uses a prevVisibleRef (:101-110).
 */
export function EditFieldSheet<T>({
  visible,
  title,
  initial,
  onClose,
  onSave,
  validate,
  confirm,
  isDirty,
  children,
}: EditFieldSheetProps<T>) {
  const [draft, setDraft] = useState<T>(initial);
  const [saving, setSaving] = useState(false);
  const prevVisible = useRef(false);

  useEffect(() => {
    if (visible && !prevVisible.current) {
      setDraft(initial);
      setSaving(false);
    }
    prevVisible.current = visible;
  }, [visible, initial]);

  const dirty = isDirty
    ? isDirty(draft, initial)
    : JSON.stringify(draft) !== JSON.stringify(initial);
  const error = validate ? validate(draft) : null;

  const write = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } catch (e) {
      showErrorAlert('Could not save', e, 'Something went wrong saving this change.');
    } finally {
      setSaving(false);
    }
  }, [draft, onSave, onClose]);

  const handleSave = useCallback(() => {
    if (error) return;
    const ask = confirm?.(draft) ?? null;
    if (!ask) {
      void write();
      return;
    }
    Alert.alert(ask.title, ask.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: ask.confirmLabel, style: 'destructive', onPress: () => void write() },
    ]);
  }, [confirm, draft, error, write]);

  const canSave = dirty && !error && !saving;

  return (
    <BottomSheetShell
      visible={visible}
      onClose={saving ? () => {} : onClose}
      avoidKeyboard
      swipeToDismiss={false}
    >
      {({ panHandlers }) => (
        <View style={[styles.surface, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <View style={styles.grabWrap} {...panHandlers}>
            <View style={styles.grabber} />
            <Text style={styles.title}>{title}</Text>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            {children(draft, setDraft)}
            {!!error && dirty && <Text style={styles.error}>{error}</Text>}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={!canSave}
              accessibilityRole="button"
              accessibilityLabel="Save"
            >
              {saving
                ? <ActivityIndicator size="small" color="#FFFFFF" />
                : <Text style={styles.saveText}>Save</Text>}
            </Pressable>
          </View>
        </View>
      )}
    </BottomSheetShell>
  );
}

const styles = StyleSheet.create({
  // BottomSheetShell is HEADLESS — it owns only the Modal, the scrim, the slide
  // and the swipe. Every consumer renders its own white surface and its own
  // bottom inset padding. Without the surface, this content sits directly on the
  // 0.45 black scrim; without the padding, androidNavBarNudge slides the Save
  // button under the Android nav bar. Both only show up on device, so tsc and
  // jest will not catch either. Reference: src/components/trips/RejectDocumentSheet.tsx
  surface: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
  },
  grabWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 12, gap: 8 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E4E4E4' },
  title: { fontFamily: ff('Inter', '700'), fontSize: 18, color: '#212121' },
  body: { flexShrink: 1 },
  bodyContent: { paddingHorizontal: 20 },
  error: {
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    color: '#C0392B',
    marginTop: 12,
  },
  footer: { paddingHorizontal: 20, paddingTop: 12 },
  saveBtn: {
    height: 52,
    borderRadius: 26,
    backgroundColor: '#0788B0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: { backgroundColor: '#CFCFCF' },
  saveText: { fontFamily: ff('Inter', '700'), fontSize: 16, color: '#FFFFFF' },
});
```

`insets` comes from `useSafeAreaInsets()` (`react-native-safe-area-context`) — add the import
and the hook call alongside the other hooks.

Three things above are load-bearing and are not style preferences:

- **`styles.surface`** — `BottomSheetShell` renders no background of its own.
- **`paddingBottom: Math.max(insets.bottom, 16) + 8`** — the shell nudges the sheet down by
  `insets.bottom` on Android to work around expo/expo#39749.
- **the render-prop form with `panHandlers` on the grabber, plus `swipeToDismiss={false}`** —
  the body scrolls, and a whole-sheet drag target fights the `ScrollView`.

`avoidKeyboard` is there because Task 10's price sheet puts `TextInput`s in this body.

- [ ] **Step 3: Build the screen with every row inert**

Create `src/screens/operator/OperatorTripEditScreen.tsx`. Every row's `onPress` is
`() => {}` for now; Tasks 5–12 replace them one section at a time.

```tsx
import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/navigationRef';
import { EditSection } from '../../components/trips/edit/EditSection';
import { EditRow } from '../../components/trips/edit/EditRow';
import { ff } from '../../theme/fonts';

type Props = NativeStackScreenProps<RootStackParamList, 'OperatorEditTrip'>;

export default function OperatorTripEditScreen({ route, navigation }: Props) {
  const { tripId } = route.params;
  const noop = () => {};

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={28} color="#222B30" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit trip</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <EditSection title="Photos">
          <EditRow label="Cover photo" onPress={noop} />
        </EditSection>

        <EditSection title="The basics">
          <EditRow label="Trip name" onPress={noop} />
          <EditRow label="Description" onPress={noop} />
          <EditRow label="Where" onPress={noop} />
          <EditRow label="When" onPress={noop} />
          <EditRow label="Spots" onPress={noop} />
        </EditSection>

        <EditSection title="Who it's for">
          <EditRow label="Surf level" onPress={noop} />
          <EditRow label="Boards" onPress={noop} />
          <EditRow label="The wave" onPress={noop} />
          <EditRow label="Age" onPress={noop} />
        </EditSection>

        <EditSection title="The trip">
          <EditRow label="How it works" onPress={noop} />
          <EditRow label="Vibe" onPress={noop} />
          <EditRow label="Stay type" onPress={noop} />
          <EditRow label="Your stay" onPress={noop} />
          <EditRow label="About you" onPress={noop} />
        </EditSection>

        <EditSection title="Price">
          <EditRow label="Price per person" onPress={noop} />
          <EditRow label="Deposit" onPress={noop} />
          <EditRow label="What's included" onPress={noop} />
        </EditSection>

        <EditSection title="Visibility">
          <EditRow label="Listed in explore" onPress={noop} />
        </EditSection>

        <EditSection title="Manage">
          <EditRow label="Requirements" onPress={noop} />
          <EditRow label="Group gear" onPress={noop} />
          <EditRow label="Packing suggestions" onPress={noop} />
          <EditRow label="Admin updates" onPress={noop} />
        </EditSection>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F6F6' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
  },
  backBtn: { padding: 4 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: ff('Inter', '700'),
    fontSize: 17,
    color: '#222B30',
  },
  scroll: { paddingBottom: 24 },
});
```

`tripId` is unused in this step. Leave it destructured — Task 5 uses it. If the lint rule for
unused vars fails the build, prefix it (`const { tripId: _tripId }`) and undo that in Task 5.

- [ ] **Step 4: Register the route**

In `src/navigation/RootNavigator.tsx`, add the import next to the other trip screen imports:

```tsx
import OperatorTripEditScreen from '../screens/operator/OperatorTripEditScreen';
```

and register it beside the existing `EditTrip` screen (around line 784):

```tsx
<RootStack.Screen
  name="OperatorEditTrip"
  component={OperatorTripEditScreen}
  options={{ presentation: 'card' }}
/>
```

Match the surrounding `RootStack.Screen` calls exactly — if they pass `options` differently
(e.g. a shared `screenOptions`), follow that instead of adding a conflicting one.

- [ ] **Step 5: Add the 3-dot menu entry**

In `src/screens/trips/TripDetailScreen.tsx`, inside the `menuItems` array (starts `:1570`), add
this **after** the `complete` entry and **before** `cancel`, so it lands in the host group:

```tsx
      // Edit trip — the operator OF RECORD only, on a hosting_style 'C' trip.
      // Deliberately trip.host_id and not isHost: isHost is flat multi-host
      // (every promoted admin), and this screen edits cost_per_person, which
      // group_trips' own UPDATE policy would otherwise let any co-host change.
      // Same reasoning as operator_set_traveler_price's C3 fix. Peer A/B hosts
      // keep the inline Overview pills; the wizard's edit mode stays
      // unreachable for them, exactly as it is today.
      (isTripOwner && isOperatorTrip && !isLocked) && {
        key: 'edit',
        icon: 'create-outline' as const,
        label: 'Edit trip',
        group: 2,
        onPress: () => {
          setMenuVisible(false);
          navigation.dispatch(StackActions.push('OperatorEditTrip', { tripId: trip.id }));
        },
      },
```

Add the owner check next to `isOperatorTrip` (`:485`):

```tsx
// The operator of record — the one operator_payout_accounts pays. NOT isHost,
// which is flat multi-host. See the plan's Global Constraints.
const isTripOwner = !!currentUserId && trip?.host_id === currentUserId;
```

`isOperatorTrip` already exists at `:485`. Check how the other entries dismiss the menu and
navigate — if they use a different call than `navigation.dispatch(StackActions.push(...))`,
copy theirs. If `navigation` is not in scope in that file, use the same mechanism the `share`
or `chat` entries use.

- [ ] **Step 6: Type-check and test**

Run: `npx tsc --noEmit && npm test`
Expected: no new errors, existing tests still pass.

- [ ] **Step 7: Report, do not commit**

Say: "Route and menu entry are in and the screen type-checks. **Needs a device check** — open
an operator trip, tap ⋮, tap Edit trip, confirm the list looks right. Rows do nothing yet."

---

## Task 5: Wire the plain text, photo and stay rows

Six rows whose sheets already exist in `TripEditSheets.tsx`. No new sheet bodies.

**Files:**
- Modify: `src/screens/operator/OperatorTripEditScreen.tsx`

**Interfaces:**
- Consumes: `EditTextSheet`, `EditCoverSheet`, `EditAccommodationSheet` from
  `src/components/trips/TripEditSheets.tsx` (`:157`, `:248`, `:487`);
  `updateOperatorTrip` from Task 3; `useTripCore` / `tripsKeys` from
  `src/hooks/trips/useTripQueries.ts`.
- Produces: the `trip`, `patch`, and `openSheet` state pattern Tasks 6–11 extend.

- [ ] **Step 1: Load the trip and add the shared save helper**

In `OperatorTripEditScreen.tsx`, replace the body of the component (keep the header and
`ScrollView` markup) with this scaffolding above the `return`:

```tsx
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTripCore } from '../../hooks/trips/useTripQueries';
import { tripsKeys } from '../../hooks/trips/useTripQueries';
import { updateOperatorTrip } from '../../services/operator/operatorTripsService';
import { uploadTripImage } from '../../services/trips/groupTripsService';
import {
  EditTextSheet,
  EditCoverSheet,
  EditAccommodationSheet,
} from '../../components/trips/TripEditSheets';

/**
 * Which sheet is open. Tasks 6, 7, 9, 10, 11 and 12 each add their own keys to
 * this union as they wire their rows — if a `setSheet('x')` does not compile,
 * the key is missing from here.
 */
type SheetKey =
  | 'cover' | 'title' | 'description' | 'stay' | 'aboutYou'
  | null;

// ...inside the component:
  const queryClient = useQueryClient();
  const { data: trip } = useTripCore(tripId);
  const [sheet, setSheet] = useState<SheetKey>(null);
  const close = useCallback(() => setSheet(null), []);

  /** One place every row's save goes through: write, then refresh what the rest
   *  of the app is showing. Throwing is intentional — EditFieldSheet and the
   *  TripEditSheets both keep themselves open when onSave rejects. */
  const save = useCallback(
    async (patch: Parameters<typeof updateOperatorTrip>[1]) => {
      await updateOperatorTrip(tripId, patch);
      await queryClient.invalidateQueries({ queryKey: tripsKeys.detail(tripId) });
      queryClient.invalidateQueries({ queryKey: tripsKeys.all });
    },
    [tripId, queryClient],
  );
```

Check `useTripCore`'s real signature and return shape before using it — if it takes an options
object or returns a different key than `data`, match it.

- [ ] **Step 2: Point the six rows at the sheets**

Replace those rows' `onPress={noop}`:

```tsx
<EditRow label="Cover photo"  onPress={() => setSheet('cover')} />
<EditRow label="Trip name"    onPress={() => setSheet('title')} />
<EditRow label="Description"  onPress={() => setSheet('description')} />
<EditRow label="Your stay"    onPress={() => setSheet('stay')} />
<EditRow label="About you"    onPress={() => setSheet('aboutYou')} />
```

- [ ] **Step 3: Mount the sheets**

Just before the closing `</SafeAreaView>`:

```tsx
      <EditCoverSheet
        visible={sheet === 'cover'}
        onClose={close}
        onSave={async (localUri) => {
          // Upload first, then write the row — same order as the wizard
          // (CreateTripFlowA.tsx). A file uploaded before a failed row update is
          // orphaned in storage; harmless, and a retry reuses the remote URL.
          const url = await uploadTripImage(localUri, 'hero');
          await save({ hero_image_url: url });
        }}
      />

      <EditTextSheet
        visible={sheet === 'title'}
        title="Trip name"
        label="Save"
        initialValue={trip?.title ?? ''}
        maxLength={80}
        onClose={close}
        onSave={(value) => save({ title: value.trim() })}
      />

      <EditTextSheet
        visible={sheet === 'description'}
        title="Description"
        label="Save"
        initialValue={trip?.description ?? ''}
        maxLength={2000}
        onClose={close}
        onSave={(value) => save({ description: value.trim() })}
      />

      <EditTextSheet
        visible={sheet === 'aboutYou'}
        title="About you"
        label="Save"
        initialValue={trip?.host_lead_note ?? ''}
        maxLength={1000}
        onClose={close}
        onSave={(value) => save({ host_lead_note: value.trim() })}
      />

      <EditAccommodationSheet
        visible={sheet === 'stay'}
        initial={{
          specific_stay_selected: trip?.specific_stay_selected ?? false,
          accommodation_name: trip?.accommodation_name ?? null,
          accommodation_url: trip?.accommodation_url ?? null,
          accommodation_image_url: trip?.accommodation_image_url ?? null,
        }}
        onClose={close}
        onSave={(next) => save(next)}
      />
```

Read `EditTextSheet` (`:143-157`), `EditCoverSheet` (`:241-252`) and `EditAccommodationSheet`
(`:476-491`) prop types first and match them exactly — the shapes above are from a grep, not a
full read. In particular `EditAccommodationSheet` takes an `AccommodationInitial`; use that
type, do not invent the field names.

**Do not pass `specificOnly`.** `TripDetailScreen` passes it so peer hosts cannot flip the
gate. Operators can (spec §3.6), so the type picker stays visible here.

- [ ] **Step 4: Type-check and test**

Run: `npx tsc --noEmit && npm test`

- [ ] **Step 5: Report, do not commit**

Say which rows now work and that they **need a device check**.

---

## Task 6: Wire the "Who it's for" and "The trip" rows

Seven rows whose bodies exist in `src/components/trips/sheets/`. Those bodies are controlled —
`{ selected, onChange }` and nothing else, no draft and no Save — which is exactly what
`EditFieldSheet` supplies.

**Files:**
- Modify: `src/screens/operator/OperatorTripEditScreen.tsx`

**Interfaces:**
- Consumes: `EditFieldSheet` (Task 4), `validateAgeRange` (Task 1),
  `LevelsSheetContent` (`{ selected: SurfLevel[]; onChange }`),
  `StyleSheetContent`, `WaveSheetContent`, `WaveSizeSheetContent`,
  `AgeSheetContent` (`{ ageMin; ageMax; ageWindow; onChange; error? }`),
  `HowItWorksSheetContent`, `VibeSheetContent` (`{ selected: TripVibeSlug[]; onChange }`),
  `StayTypeSheetContent` (`{ selected: AccommodationKind | null; onChange; error? }`).

- [ ] **Step 1: Extend the sheet key union and add the rows**

```tsx
type SheetKey =
  | 'cover' | 'title' | 'description' | 'stay' | 'aboutYou'
  | 'levels' | 'boards' | 'wave' | 'age'
  | 'howItWorks' | 'vibe' | 'stayType'
  | null;
```

```tsx
<EditRow label="Surf level"   onPress={() => setSheet('levels')} />
<EditRow label="Boards"       onPress={() => setSheet('boards')} />
<EditRow label="The wave"     onPress={() => setSheet('wave')} />
<EditRow label="Age"          onPress={() => setSheet('age')} />
<EditRow label="How it works" onPress={() => setSheet('howItWorks')} />
<EditRow label="Vibe"         onPress={() => setSheet('vibe')} />
<EditRow label="Stay type"    onPress={() => setSheet('stayType')} />
```

- [ ] **Step 2: Mount the simple list sheets**

Two of the seven, to show the shape. Follow it for `boards` (`StyleSheetContent` →
`target_surf_styles`), `howItWorks` (`HowItWorksSheetContent` → `trip_structure`) and
`stayType` (`StayTypeSheetContent` → `accommodation_type`).

```tsx
      <EditFieldSheet<string[]>
        visible={sheet === 'levels'}
        title="Surf level"
        initial={trip?.target_surf_levels ?? []}
        onClose={close}
        onSave={(next) => save({ target_surf_levels: next })}
        validate={(next) => (next.length === 0 ? 'Pick at least one surf level.' : null)}
      >
        {(draft, setDraft) => (
          <LevelsSheetContent selected={draft as SurfLevel[]} onChange={setDraft} />
        )}
      </EditFieldSheet>

      <EditFieldSheet<string[]>
        visible={sheet === 'vibe'}
        title="Vibe"
        initial={trip?.trip_vibes ?? []}
        onClose={close}
        onSave={(next) => save({ trip_vibes: next })}
        validate={(next) => (next.length === 0 ? 'Pick at least one vibe.' : null)}
      >
        {(draft, setDraft) => (
          <VibeSheetContent selected={draft as TripVibeSlug[]} onChange={setDraft} />
        )}
      </EditFieldSheet>
```

Import `SurfLevel`, `TripVibeSlug` and `AccommodationKind` from wherever the sheet content
files import them — do not redeclare them. If the generic cast is awkward, type the
`EditFieldSheet` instance with the real element type (`EditFieldSheet<SurfLevel[]>`) instead of
casting inside.

- [ ] **Step 3: Mount the two-value sheets (wave, age)**

```tsx
      <EditFieldSheet<{ shapes: string[]; sizeMin: number | null; sizeMax: number | null }>
        visible={sheet === 'wave'}
        title="The wave"
        initial={{
          shapes: trip?.wave_shapes ?? [],
          sizeMin: trip?.wave_size_min ?? null,
          sizeMax: trip?.wave_size_max ?? null,
        }}
        onClose={close}
        onSave={(next) => save({
          wave_shapes: next.shapes,
          wave_size_min: next.sizeMin,
          wave_size_max: next.sizeMax,
        })}
      >
        {(draft, setDraft) => (
          <>
            <WaveSheetContent
              selected={draft.shapes}
              onChange={(shapes) => setDraft({ ...draft, shapes })}
            />
            <WaveSizeSheetContent
              min={draft.sizeMin}
              max={draft.sizeMax}
              onChange={(next) => setDraft({ ...draft, sizeMin: next.min, sizeMax: next.max })}
            />
          </>
        )}
      </EditFieldSheet>

      <EditFieldSheet<{ ageMin: number | null; ageMax: number | null }>
        visible={sheet === 'age'}
        title="Age"
        initial={{ ageMin: trip?.age_min ?? null, ageMax: trip?.age_max ?? null }}
        onClose={close}
        onSave={(next) => save({ age_min: next.ageMin, age_max: next.ageMax })}
        validate={(next) => validateAgeRange(next.ageMin, next.ageMax, AGE_WINDOW)}
      >
        {(draft, setDraft) => (
          <AgeSheetContent
            ageMin={draft.ageMin}
            ageMax={draft.ageMax}
            ageWindow={AGE_WINDOW}
            onChange={setDraft}
            error={validateAgeRange(draft.ageMin, draft.ageMax, AGE_WINDOW) ?? undefined}
          />
        )}
      </EditFieldSheet>
```

`AGE_WINDOW` is `4` for every hosting style today (`CreateTripFlowA.tsx:191`,
`AGE_WINDOW_BY_STYLE`). Import that constant if it is exported; if it is not, export it from
`CreateTripFlowA.tsx` rather than writing `4` here — the DB CHECK and this number have to move
together.

`WaveSizeSheetContent`'s prop names above are a guess. **Read the file first** and use its real
props.

- [ ] **Step 4: Type-check and test**

Run: `npx tsc --noEmit && npm test`

- [ ] **Step 5: Report, do not commit**

---

## Task 7: The When row and its confirm popup

`EditDatesSheet` already exists and already writes the five date columns. What is new is the
confirm popup (spec §3.5) and the fact that this row is available on a C trip at all —
`TripDetailViewRedesigned.tsx:429-430` hides the inline dates pill for C.

**Files:**
- Modify: `src/screens/operator/OperatorTripEditScreen.tsx`

**Interfaces:**
- Consumes: `EditDatesSheet` + its `DatesInitial` / `DatesPatch` types
  (`TripEditSheets.tsx:334`, `:343`, `:350`); `resolveDeadlineDate` from
  `src/services/trips/tripDocumentsService.ts`; `useTripDocuments` from
  `src/hooks/trips/useTripQueries.ts`.
- Produces: `participantCount`, `joinedCount`, `confirmMaterialChange` — Tasks 8 and 9 reuse
  all three.

- [ ] **Step 1: Derive the two counts from the trip row**

No query. `participant_count` is already on the trip and is trigger-maintained.

```tsx
  // participant_count includes the host. It is what max_participants is
  // compared against everywhere else (isFull, the join trigger), so the spots
  // floor has to use this exact number — see spec §7.1.
  const participantCount = trip?.participant_count ?? 0;
  // Everyone who is not the host: the people a material change needs telling.
  const joinedCount = Math.max(0, participantCount - 1);
```

- [ ] **Step 2: Wire the row and mount the sheet with a confirm**

Add `'when'` to the `SheetKey` union first.


`EditDatesSheet` is not an `EditFieldSheet`, so it has no `confirm` hook. Put the popup in the
`onSave` handler instead, and only resolve after the write so the sheet stays open on Cancel.

```tsx
<EditRow label="When" onPress={() => setSheet('when')} />
```

```tsx
      <EditDatesSheet
        visible={sheet === 'when'}
        initial={{
          start_date: trip?.start_date ?? null,
          end_date: trip?.end_date ?? null,
          dates_set_in_stone: trip?.dates_set_in_stone ?? false,
          date_months: trip?.date_months ?? [],
          duration_days: trip?.duration_days ?? null,
        }}
        onClose={close}
        onSave={(patch) => confirmMaterialChange(
          'Change the dates?',
          [
            `${joinedCount} travelers joined on the old dates. Make sure you tell them about this change.`,
            describeDeadlineShift(patch),
          ].filter(Boolean).join('\n\n'),
          'Change it',
          () => save(patch),
        )}
      />
```

- [ ] **Step 2b: Add the deadline-impact line**

Spec §9: requirement deadlines are stored relative to departure, so moving the trip moves all
of them. Pulling the trip earlier can land a deadline in the past, which makes everyone who
owed that item instantly overdue with no warning. The operator has to see that before they
commit.

Add above the `return`:

```tsx
import { resolveDeadlineDate } from '../../services/trips/tripDocumentsService';

  const requirementsQuery = useTripDocuments(tripId);

  /**
   * One sentence about what a new start date does to the requirement deadlines,
   * or '' when there is nothing to say. Spec §9.
   *
   * It only reports; it does not change anything. Whether a deadline that has
   * already passed re-opens when the trip moves later is still an OPEN question
   * (spec §11 #3) — do not decide it here.
   */
  const describeDeadlineShift = useCallback(
    (patch: { start_date?: string | null }): string => {
      const nextStart = patch.start_date ?? null;
      const rows = requirementsQuery.data ?? [];
      if (!nextStart || !trip?.start_date || nextStart === trip.start_date || rows.length === 0) {
        return '';
      }
      const today = new Date().toISOString().slice(0, 10);
      let moved = 0;
      let inThePast = 0;
      for (const row of rows) {
        const next = resolveDeadlineDate(row, nextStart);
        if (!next) continue;
        moved += 1;
        if (next < today) inThePast += 1;
      }
      if (moved === 0) return '';
      const head = `${moved} ${moved === 1 ? 'deadline moves' : 'deadlines move'}.`;
      if (inThePast === 0) return head;
      return `${head} ${inThePast} ${inThePast === 1 ? 'lands' : 'land'} in the past.`;
    },
    [requirementsQuery.data, trip?.start_date],
  );
```

Read `resolveDeadlineDate`'s real signature in `tripDocumentsService.ts` before using it — the
call above assumes `(requirement, startDateISO) => string | null`. If it takes different
arguments or returns a `Date`, match it and compare dates accordingly.

- [ ] **Step 3: Add the shared confirm helper**

Put this above the `return` in the screen. Both this task and Task 8 use it.

```tsx
  /**
   * Spec §3.5. Ask before writing a field people joined on the basis of.
   *
   * Returns a promise that REJECTS on Cancel, because every sheet in this
   * screen treats a rejected onSave as "stay open, keep the draft" — which is
   * exactly what Cancel should do. The rejection carries a marker so the
   * error alert can be skipped; a cancel is not a failure.
   *
   * Skips the popup entirely when the operator is the only person on the trip.
   */
  const confirmMaterialChange = useCallback(
    (title: string, message: string, confirmLabel: string, run: () => Promise<void>) => {
      if (joinedCount === 0) return run();
      return new Promise<void>((resolve, reject) => {
        Alert.alert(title, message, [
          { text: 'Cancel', style: 'cancel', onPress: () => reject(CANCELLED) },
          {
            text: confirmLabel,
            style: 'destructive',
            onPress: () => { run().then(resolve, reject); },
          },
        ], { cancelable: false });
      });
    },
    [joinedCount],
  );
```

`CANCELLED` is imported from `EditFieldSheet.tsx` — see the next step. Do not declare a second
copy in the screen; the check is by identity, so two symbols would never match.

- [ ] **Step 4: Add the CANCELLED marker and make the sheet ignore it**

In `src/components/trips/edit/EditFieldSheet.tsx`, add at module scope:

```tsx
/** Marker for "the operator backed out of a confirm popup". A cancel is not a
 *  failure, so it must not raise an error alert. Checked by identity, never
 *  shown to anyone. Lives here because EditFieldSheet is the only place that
 *  has to tell the two apart. */
export const CANCELLED = Symbol('cancelled');
```

and change `write`'s catch so a cancel is not treated as a failure:

```tsx
    } catch (e) {
      if (e !== CANCELLED) showErrorAlert('Could not save', e, 'Something went wrong saving this change.');
    } finally {
```

Then import it in the screen:

```tsx
import { EditFieldSheet, CANCELLED } from '../../components/trips/edit/EditFieldSheet';
```

`TripEditSheets`' own catch blocks already swallow errors and stay open, so they need no
change — verify that by reading `EditDatesSheet`'s `handleSave` before moving on.

- [ ] **Step 5: Type-check and test**

Run: `npx tsc --noEmit && npm test`

- [ ] **Step 6: Report, do not commit**

Say: "When row wired with the confirm popup. **Needs a device check** — the popup must appear
only when someone has paid a deposit, and Cancel must leave the sheet open with the new dates
still typed in."

---

## Task 8: The Where row — destination

A full screen, not a sheet: the place picker needs a map and a search list. It also gets the
§3.5 popup, and it writes to a different table.

**Files:**
- Create: `src/screens/operator/OperatorEditDestinationScreen.tsx`
- Modify: `src/screens/operator/OperatorTripEditScreen.tsx`
- Modify: `src/navigation/RootNavigator.tsx`

**Interfaces:**
- Consumes: `setOperatorTripDestination` (Task 3), the wizard's place picker components
  (`MultiPlaceAutocompleteInput`, `MapPickerModal` — check what `CreateTripFlowA.tsx:2529-2565`
  actually renders and reuse the same ones), `confirmMaterialChange` pattern from Task 7.
- Produces: route `OperatorEditDestination: { tripId: string }`.

- [ ] **Step 1: Read what the wizard's destination step renders**

Read `src/screens/trips/CreateTripFlowA.tsx:2529-2565`. Note which components it uses and what
shape it builds before calling `setTripDestination`. Reuse those components. Do not copy the
step's markup wholesale — take the picker, leave the wizard chrome.

- [ ] **Step 2: Build the screen**

Create `src/screens/operator/OperatorEditDestinationScreen.tsx` with the same header shape as
`OperatorTripEditScreen` (back chevron, centered "Where"), the picker from Step 1 seeded from
the trip's current destination, and a Save button pinned at the bottom.

The picker markup depends on what Step 1 found, so it is not written out here. The save path
is, because it is the part that must not be improvised:

```tsx
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTripCore } from '../../hooks/trips/useTripDetail';
import { tripsKeys } from '../../hooks/trips/useTripQueries';
import { useOnboarding } from '../../context/OnboardingContext';
import { setOperatorTripDestination } from '../../services/operator/operatorTripsService';
import { showErrorAlert } from '../../utils/friendlyError';

// ...inside the component:
  const queryClient = useQueryClient();
  const { user } = useOnboarding();
  const currentUserId = user?.id?.toString() ?? null;
  // useTripCore is in hooks/trips/useTripDetail.ts and returns { trip, ... }
  const { data } = useTripCore(tripId, currentUserId);
  const trip = data?.trip ?? null;
  const [picked, setPicked] = useState<TripDestinationGeo | null>(null);
  const [saving, setSaving] = useState(false);

  const joinedCount = Math.max(0, (trip?.participant_count ?? 0) - 1);
  const canSave = !!picked && !saving;

  const write = useCallback(async () => {
    if (!picked) return;
    setSaving(true);
    try {
      await setOperatorTripDestination(tripId, picked);
      await queryClient.invalidateQueries({ queryKey: tripsKeys.detail(tripId) });
      queryClient.invalidateQueries({ queryKey: tripsKeys.all });
      navigation.goBack();
    } catch (e) {
      showErrorAlert('Could not save', e, 'Something went wrong saving this change.');
    } finally {
      setSaving(false);
    }
  }, [picked, tripId, queryClient, navigation]);

  const handleSave = useCallback(() => {
    if (!canSave) return;
    if (joinedCount === 0) { void write(); return; }
    // The visa line is here because a country change can make an existing visa
    // requirement wrong — spec §6.1. It is a warning, not an action: this screen
    // does not touch requirements.
    Alert.alert(
      'Change where the trip goes?',
      `${joinedCount} travelers joined for the old place. Make sure you tell them about this change.\n\nA visa requirement may no longer be right.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Change it', style: 'destructive', onPress: () => void write() },
      ],
    );
  }, [canSave, joinedCount, write]);
```

The Save button is `disabled={!canSave}`. Seed `picked` from the trip's current destination if
the picker needs an initial value, but keep the Save button gated on the operator having
actually chosen something — a screen that opens with Save already enabled invites an accidental
no-op write that still fires the popup.

- [ ] **Step 3: Register the route and wire the row**

In `RootNavigator.tsx`, next to `OperatorEditTrip`:

```tsx
<RootStack.Screen
  name="OperatorEditDestination"
  component={OperatorEditDestinationScreen}
  options={{ presentation: 'card' }}
/>
```

In `OperatorTripEditScreen.tsx`:

```tsx
<EditRow
  label="Where"
  onPress={() => navigation.navigate('OperatorEditDestination', { tripId })}
/>
```

- [ ] **Step 4: Type-check and test**

Run: `npx tsc --noEmit && npm test`

- [ ] **Step 5: Report, do not commit**

Say: "Where row wired. **Needs a device check** — confirm the picker seeds with the trip's
current place, that Save writes it, and that the trip's location updates on the Overview."

---

## Task 9: The Spots row

**Files:**
- Create: `src/components/trips/sheets/SpotsSheetContent.tsx`
- Modify: `src/screens/operator/OperatorTripEditScreen.tsx`

**Interfaces:**
- Consumes: `validateSpots` (Task 1), `participantCount` (Task 7), `EditFieldSheet` (Task 4).
- Produces: `SpotsSheetContent: React.FC<{ value: number | null; participantCount: number; onChange: (next: number) => void }>`.

- [ ] **Step 1: Build the stepper**

Create `src/components/trips/sheets/SpotsSheetContent.tsx`:

```tsx
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ff } from '../../../theme/fonts';

const MIN_SPOTS = 2;
const MAX_SPOTS = 50;

/**
 * How many people can be on the trip.
 *
 * The minus button stops at the number of people already on the trip. That is
 * the same floor validateSpots enforces and the same one the DB trigger
 * enforces — spec §7.1. Three layers saying one thing, on purpose: the button
 * makes the wrong value hard to reach, the validator explains it, and the
 * trigger makes it impossible.
 */
export const SpotsSheetContent: React.FC<{
  value: number | null;
  participantCount: number;
  onChange: (next: number) => void;
}> = ({ value, participantCount, onChange }) => {
  const current = value ?? Math.max(MIN_SPOTS, participantCount);
  const floor = Math.max(MIN_SPOTS, participantCount);
  const canDecrease = current > floor;
  const canIncrease = current < MAX_SPOTS;

  const note =
    participantCount === 0
      ? ''
      : current === participantCount
        ? `This closes the trip — all ${current} spots are taken.`
        : `${participantCount} of ${current} spots are taken.`;

  return (
    <View style={styles.wrap}>
      <View style={styles.stepper}>
        <Pressable
          style={[styles.btn, !canDecrease && styles.btnDisabled]}
          onPress={() => onChange(current - 1)}
          disabled={!canDecrease}
          accessibilityRole="button"
          accessibilityLabel="Fewer spots"
        >
          <Ionicons name="remove" size={22} color={canDecrease ? '#222B30' : '#CFCFCF'} />
        </Pressable>

        <Text style={styles.value}>{current}</Text>

        <Pressable
          style={[styles.btn, !canIncrease && styles.btnDisabled]}
          onPress={() => onChange(current + 1)}
          disabled={!canIncrease}
          accessibilityRole="button"
          accessibilityLabel="More spots"
        >
          <Ionicons name="add" size={22} color={canIncrease ? '#222B30' : '#CFCFCF'} />
        </Pressable>
      </View>

      {!!note && <Text style={styles.note}>{note}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { paddingVertical: 12, gap: 16 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28 },
  btn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#CFCFCF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: { borderColor: '#E4E4E4' },
  value: { fontFamily: ff('Inter', '700'), fontSize: 32, color: '#222B30', minWidth: 60, textAlign: 'center' },
  note: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#7B7B7B', textAlign: 'center' },
});
```

If the wizard has its own spots stepper (`CreateTripFlowA.tsx`, search `max_participants`),
match its visual weights so the two screens do not look like different products.

- [ ] **Step 2: Mount it**

Add `'spots'` to the `SheetKey` union, then:

```tsx
<EditRow label="Spots" onPress={() => setSheet('spots')} />
```

```tsx
      <EditFieldSheet<number | null>
        visible={sheet === 'spots'}
        title="Spots"
        initial={trip?.max_participants ?? null}
        onClose={close}
        onSave={(next) => save({ max_participants: next })}
        validate={(next) => validateSpots(next, participantCount)}
      >
        {(draft, setDraft) => (
          <SpotsSheetContent
            value={draft}
            participantCount={participantCount}
            onChange={setDraft}
          />
        )}
      </EditFieldSheet>
```

The client floor and the Task 2 trigger say the same thing on purpose. The trigger is what a
client bug cannot get around; this is what gives the operator a sentence instead of an error.

- [ ] **Step 3: Type-check and test**

Run: `npx tsc --noEmit && npm test`

- [ ] **Step 4: Report, do not commit**

Say: "Spots row wired. **Needs a device check, and Task 2's SQL must be applied first** — with
the trigger live, confirm that lowering below the participant count is refused by the sheet, and
that a direct DB update is refused by the trigger."

---

## Task 10: The Price, Deposit and What's included rows

The riskiest row on the screen. Read spec §7.2 before writing a line.

**Files:**
- Create: `src/components/trips/sheets/PriceSheetContent.tsx`
- Modify: `src/screens/operator/OperatorTripEditScreen.tsx`

**Interfaces:**
- Consumes: `validatePrice`, `validateDeposit` (Task 1); `updateOperatorTripPrice` (Task 3);
  `EditFieldSheet` (Task 4).
- Produces: `PriceSheetContent: React.FC<{ costPerPerson: number | null; depositAmount: number | null; currency: string | null; onChange: (next: { costPerPerson: number | null; depositAmount: number | null }) => void; error?: string }>`.

- [ ] **Step 1: Build the body**

Create `src/components/trips/sheets/PriceSheetContent.tsx`:

```tsx
import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { ff } from '../../../theme/fonts';

type Value = { costPerPerson: number | null; depositAmount: number | null };

/** '' -> null, so clearing the field means "not set" and not 0. Anything that
 *  is not a finite number is also null — a half-typed '1.' must not become 1. */
function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[^0-9.]/g, '');
  if (cleaned.trim() === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Price per person and deposit.
 *
 * Both numbers are canonical USD. `currency` is shown as a label only — it is
 * the operator's input currency, and converting here would fight the frozen
 * budget_fx_rate. Never touch that rate from this screen (spec §7.2).
 */
export const PriceSheetContent: React.FC<{
  costPerPerson: number | null;
  depositAmount: number | null;
  currency: string | null;
  onChange: (next: Value) => void;
  error?: string;
}> = ({ costPerPerson, depositAmount, currency, onChange, error }) => (
  <View style={styles.wrap}>
    <View style={styles.block}>
      <Text style={styles.label}>Price per person</Text>
      <View style={styles.field}>
        <Text style={styles.prefix}>{currency ?? 'USD'}</Text>
        <TextInput
          style={styles.input}
          value={costPerPerson == null ? '' : String(costPerPerson)}
          onChangeText={(t) => onChange({ costPerPerson: parseAmount(t), depositAmount })}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor="#A0A0A0"
          accessibilityLabel="Price per person"
        />
      </View>
    </View>

    <View style={styles.block}>
      <Text style={styles.label}>Deposit</Text>
      <View style={styles.field}>
        <Text style={styles.prefix}>{currency ?? 'USD'}</Text>
        <TextInput
          style={styles.input}
          value={depositAmount == null ? '' : String(depositAmount)}
          onChangeText={(t) => onChange({ costPerPerson, depositAmount: parseAmount(t) })}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor="#A0A0A0"
          accessibilityLabel="Deposit"
        />
      </View>
      <Text style={styles.hint}>Leave the deposit empty if travelers pay in one go.</Text>
    </View>

    {!!error && <Text style={styles.error}>{error}</Text>}
  </View>
);

const styles = StyleSheet.create({
  wrap: { paddingVertical: 8, gap: 20 },
  block: { gap: 8 },
  label: { fontFamily: ff('Inter', '700'), fontSize: 14, color: '#222B30' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#CFCFCF',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 52,
  },
  prefix: { fontFamily: ff('Inter', '400'), fontSize: 15, color: '#7B7B7B' },
  input: { flex: 1, fontFamily: ff('Inter', '400'), fontSize: 16, color: '#222B30' },
  hint: { fontFamily: ff('Inter', '400'), fontSize: 12, color: '#7B7B7B' },
  error: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#C0392B' },
});
```

- [ ] **Step 2: Mount one sheet for both rows**

Price and deposit are one database concern — the `deposit_amount <= cost_per_person` CHECK ties
them — so both rows open the same sheet. That is not a shortcut; splitting them would let an
operator save a deposit that the next price edit invalidates.

Add `'price'` to the `SheetKey` union, then:

```tsx
<EditRow label="Price per person" onPress={() => setSheet('price')} />
<EditRow label="Deposit"          onPress={() => setSheet('price')} />
```

```tsx
      <EditFieldSheet<{ costPerPerson: number | null; depositAmount: number | null }>
        visible={sheet === 'price'}
        title="Price"
        initial={{
          costPerPerson: trip?.cost_per_person ?? null,
          depositAmount: trip?.deposit_amount ?? null,
        }}
        onClose={close}
        onSave={async (next) => {
          // updateOperatorTripPrice freezes every existing traveler's price
          // BEFORE writing the new one. Never call updateOperatorTrip with
          // cost_per_person directly — see spec §7.2.
          await updateOperatorTripPrice(tripId, {
            cost_per_person: next.costPerPerson,
            deposit_amount: next.depositAmount,
          });
          await queryClient.invalidateQueries({ queryKey: tripsKeys.detail(tripId) });
          queryClient.invalidateQueries({ queryKey: tripsKeys.all });
        }}
        validate={(next) =>
          validatePrice(next.costPerPerson)
          ?? validateDeposit(next.depositAmount, next.costPerPerson)
        }
      >
        {(draft, setDraft) => (
          <PriceSheetContent
            costPerPerson={draft.costPerPerson}
            depositAmount={draft.depositAmount}
            currency={trip?.budget_currency ?? 'USD'}
            onChange={setDraft}
            error={
              (validatePrice(draft.costPerPerson)
                ?? validateDeposit(draft.depositAmount, draft.costPerPerson))
              ?? undefined
            }
          />
        )}
      </EditFieldSheet>
```

- [ ] **Step 3: Wire "What's included"**

Its body already exists — `src/components/trips/sheets/IncludesSheets.tsx` — and the
list-shaping helpers are in `src/services/trips/priceInclusions.ts`. It writes
`price_inclusions` and has no relationship to the price number, so it is its own sheet.

Add `'includes'` to the `SheetKey` union, then:

```tsx
<EditRow label="What's included" onPress={() => setSheet('includes')} />
```

```tsx
      <EditFieldSheet<string[]>
        visible={sheet === 'includes'}
        title="What's included"
        initial={trip?.price_inclusions ?? []}
        onClose={close}
        onSave={(next) => save({ price_inclusions: next })}
      >
        {(draft, setDraft) => (
          <IncludesSheetContent selected={draft} onChange={setDraft} />
        )}
      </EditFieldSheet>
```

`IncludesSheets.tsx` exports more than one component — read it and use the one the wizard's
budget step renders, with its real prop names. `IncludesSheetContent` above is a placeholder
name; replace it with whatever the file actually exports.

No `validate` here on purpose: an empty inclusions list is a legitimate answer.

- [ ] **Step 4: Type-check and test**

Run: `npx tsc --noEmit && npm test`

- [ ] **Step 5: Report, do not commit**

Say: "Price, Deposit and What's included wired. **Needs a device check, and Task 2's SQL must
be applied first.** The
check that matters: on a trip with a traveler whose `price_total_usd` is null, change the
price, then confirm in the database that the traveler's `price_total_usd` now holds the **old**
price, not the new one."

---

## Task 11: The Visibility row

**Files:**
- Create: `src/components/trips/sheets/VisibilitySheetContent.tsx`
- Modify: `src/screens/operator/OperatorTripEditScreen.tsx`

**Interfaces:**
- Consumes: `EditFieldSheet` (Task 4).
- Produces: `VisibilitySheetContent: React.FC<{ value: string; onChange: (next: string) => void }>`.

- [ ] **Step 1: Build the body**

Create `src/components/trips/sheets/VisibilitySheetContent.tsx`:

```tsx
import React from 'react';
import { View } from 'react-native';
import { SheetOptionCard } from './SheetOptionCard';

const OPTIONS = [
  {
    key: 'public',
    title: 'Listed in explore',
    desc: 'Anyone browsing trips can find this one.',
  },
  {
    key: 'link_only',
    title: 'Link only',
    desc: 'Only people you send the link to can see it. Travelers who already joined keep their access.',
  },
] as const;

/**
 * Where the trip shows up. Writes group_trips.visibility.
 *
 * 'link_only' needs no migration: the column has no CHECK, and explore_feed
 * already filters `visibility is null or visibility = 'public'`
 * (20260701010000_explore_feed_sort_by_participants.sql:58). Writing the value
 * drops the trip out of explore on its own.
 */
export const VisibilitySheetContent: React.FC<{
  value: string;
  onChange: (next: string) => void;
}> = ({ value, onChange }) => (
  <View style={{ gap: 12, paddingVertical: 8 }}>
    {OPTIONS.map((o) => (
      <SheetOptionCard
        key={o.key}
        title={o.title}
        desc={o.desc}
        selected={value === o.key}
        onPress={() => onChange(o.key)}
      />
    ))}
  </View>
);
```

Read `SheetOptionCard`'s real props before using it — the four above are a guess from how the
other sheet contents render option lists. Match its signature rather than changing the card.

No migration is needed: `visibility` is a plain text column with no CHECK, and `explore_feed`
already filters `visibility IS NULL OR visibility = 'public'`
(`20260701010000_explore_feed_sort_by_participants.sql:58`). Writing `'link_only'` drops the
trip out of explore on its own.

- [ ] **Step 2: Mount it**

Add `'visibility'` to the `SheetKey` union, then:

```tsx
<EditRow label="Listed in explore" onPress={() => setSheet('visibility')} />
```

```tsx
      <EditFieldSheet<string>
        visible={sheet === 'visibility'}
        title="Visibility"
        initial={trip?.visibility ?? 'public'}
        onClose={close}
        onSave={(next) => save({ visibility: next })}
      >
        {(draft, setDraft) => <VisibilitySheetContent value={draft} onChange={setDraft} />}
      </EditFieldSheet>
```

- [ ] **Step 3: Type-check and test**

Run: `npx tsc --noEmit && npm test`

- [ ] **Step 4: Report, do not commit**

Say: "Visibility row wired. **Needs a device check** — set link-only, then confirm the trip is
gone from Explore but still opens for a joined traveler."

---

## Task 12: The Manage section

Four rows that reach the Plan tab's own editors. Three of them already have full-screen routes,
so they navigate rather than mount a sheet.

**Files:**
- Modify: `src/screens/operator/OperatorTripEditScreen.tsx`

**Interfaces:**
- Consumes: `ManageRequirementsSheet`
  (`{ visible, onClose, tripId, startDateISO, requirements, isOperatorTrip, paymentMode, onSaved }`
  — copy the mount at `TripDetailScreen.tsx:2235-2244`);
  `useTripDocuments` from `src/hooks/trips/useTripQueries.ts`;
  existing routes `ManageGear: { tripId }`, `ManageSuggestedGear: { tripId }`,
  `TripUpdates: { tripId }` (all in `navigationRef.ts`).

- [ ] **Step 1: Wire the three navigate-only rows**

```tsx
<EditRow label="Group gear"          onPress={() => navigation.navigate('ManageGear', { tripId })} />
<EditRow label="Packing suggestions" onPress={() => navigation.navigate('ManageSuggestedGear', { tripId })} />
<EditRow label="Admin updates"       onPress={() => navigation.navigate('TripUpdates', { tripId })} />
```

These three already save on their own, inside their own screens. Nothing new is written here —
that is the point of §3.1: the operator finds them in one place, and the code stays in one
place.

Check each route actually exists in `RootStackParamList` before wiring it. If
`ManageSuggestedGear` or `TripUpdates` needs more params than `tripId`, pass what it needs.

- [ ] **Step 2: Mount the requirements sheet**

`requirementsQuery` already exists — Task 7 added it for the deadline-impact line. Reuse it,
do not declare a second one.

```tsx
import { ManageRequirementsSheet } from '../../components/trips/ManageRequirementsSheet';

const NO_REQUIREMENTS: never[] = [];
```

Add `'requirements'` to the `SheetKey` union, then:

```tsx
<EditRow label="Requirements" onPress={() => setSheet('requirements')} />
```

```tsx
      <ManageRequirementsSheet
        visible={sheet === 'requirements'}
        onClose={close}
        tripId={tripId}
        startDateISO={trip?.start_date ?? null}
        requirements={requirementsQuery.data ?? NO_REQUIREMENTS}
        isOperatorTrip
        paymentMode={trip?.payment_mode ?? 'offline'}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: tripsKeys.detailDocuments(tripId) });
          close();
        }}
      />
```

`ManageRequirementsSheet` has its own Save and its own delete rules — switching a requirement
off runs `removeRequirement()`, which keeps the row as `is_active = false` when a traveler has
already uploaded against it, so a passport file is never stranded. **Do not reimplement any of
that here.** Mount it and pass its props.

Read `useTripDocuments`'s real name and return shape first — the hook list at
`TripDetailScreen.tsx:127-133` is the source of truth.

- [ ] **Step 3: Type-check and test**

Run: `npx tsc --noEmit && npm test`

- [ ] **Step 4: Report, do not commit**

Say: "Manage section wired. **Needs a device check** — all four rows should land on the same
editors the Plan tab uses, and Requirements should save and reflect on the Plan tab."

---

## Task 13: Point the wizard at the shared validation

The last step of §10's "extracted, not duplicated". Until this is done, the age, date, stay and
price rules exist twice and will drift.

**Files:**
- Modify: `src/screens/trips/CreateTripFlowA.tsx:1667-1817` (`validateStep`)

- [ ] **Step 1: Record the current behaviour before touching it**

Read `validateStep` end to end. Write down, for each `case`, which rule fires and what message
it sets. This is a live file behind a shipped flow — the goal is that the wizard behaves
**identically** afterwards.

- [ ] **Step 2: Replace the rule bodies, keep the error plumbing**

Inside each `case`, replace the inline condition with a call to the Task 1 function and set the
existing error state from its return. For example, where the age rule reads roughly
`if (ageMax - ageMin < ageWindow) { setErr('...'); return false; }`, it becomes:

```ts
        const ageError = validateAgeRange(ageMin, ageMax, ageWindow);
        if (ageError) { setErr(ageError); return false; }
```

Keep every `setErr` target, every `return false`, and the step order exactly as they are. Only
the condition and the message move.

If a wizard message differs from the Task 1 message, prefer the Task 1 wording and note the
change in the report — one wording per rule is the point. If a wizard rule has **no**
equivalent in Task 1, leave it inline and say which one.

- [ ] **Step 3: Type-check and run the whole suite**

Run: `npx tsc --noEmit && npm test`
Expected: everything passes. This file has no direct test, which is exactly why Step 1 matters.

- [ ] **Step 4: Report, do not commit**

Say: "Wizard now shares `tripValidation.ts`. **Needs a device check on the create flow, not
just the edit screen** — walk a new trip through every step and confirm each validation message
still fires when it should."

---

## Done means

- An operator opens their C trip, taps ⋮, sees **Edit trip**, and lands on a screen of
  name-only rows.
- Every row opens something. Every sheet saves on its own and closes.
- Changing dates or destination asks first, when someone has paid a deposit.
- Spots cannot go below `participant_count` — refused by the sheet and by the database.
- Changing the price freezes every existing traveler at the price they joined at.
- A peer A/B trip is unchanged: no Edit entry, same wizard, same locks.
