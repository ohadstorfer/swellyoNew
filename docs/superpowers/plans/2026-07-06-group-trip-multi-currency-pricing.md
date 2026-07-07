# Group Trip Multi-Currency Pricing (₪ / $) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show group trip prices in ₪ to Israeli users and $ to everyone else, with the USD↔ILS rate frozen once at price-set time and never re-fetched.

**Architecture:** USD stays the canonical stored currency. One new column `group_trips.budget_fx_rate` (ILS per 1 USD) is captured at write time. An Israeli operator enters ₪; it's converted to USD once and stored. Display picks currency by the viewer's `country_from` and converts USD→₪ using the trip's frozen rate. The server-side Explore filter is untouched (stays USD); only its chip labels localize.

**Tech Stack:** React Native 0.81 / Expo 54 / TypeScript, Supabase (Postgres), Jest (jest-expo preset), free no-key FX API (`open.er-api.com`).

## Global Constraints

- **USD is canonical.** `budget_min`, `budget_max`, `cost_per_person` are always stored in USD. Never store ₪ in those columns.
- **Israeli detection is an exact string match:** `country_from === 'Israel'`. Null/missing country → treated as non-Israeli (USD).
- **Rounding:** all displayed prices are whole numbers (`Math.round`), no decimals.
- **Rate is frozen:** fetched at most once per trip write, stored in `budget_fx_rate`, never re-fetched for an existing trip. On FX failure, use `FALLBACK_USD_TO_ILS = 3.7`. Pricing must never throw/block on FX.
- **Do NOT `git commit`** — Ohad reviews and commits manually. Where a step says "Commit", instead stage the changes (`git add`) and stop for Ohad's review. Never `supabase db push`; migrations are applied by hand via the SQL editor.
- **Currency symbols:** `$` for USD, `₪` for ILS. Thousands separators via `toLocaleString('en-US')`.

---

## File Structure

- **Create** `src/utils/currency.ts` — pure currency helpers (detection, conversion, formatting). No side effects.
- **Create** `src/utils/exchangeRate.ts` — async `fetchUsdToIls()` with fallback constant.
- **Create** `src/utils/__tests__/currency.test.ts` — unit tests for the pure helpers.
- **Create** `src/utils/__tests__/exchangeRate.test.ts` — unit tests for the fetch + fallback.
- **Create** `supabase/migrations/20260706120000_group_trips_budget_fx_rate.sql` — additive column + backfill (reference copy; applied manually).
- **Modify** `src/services/trips/groupTripsService.ts` — add `budget_fx_rate` to `GroupTrip`, `CreateGroupTripInput`, and the editable-columns allowlist.
- **Modify** `src/screens/trips/CreateTripFlowA.tsx` — operator currency detection, fetch+hold rate, ₪→USD conversion on save, write `budget_fx_rate`, ₪ edit prefill, ₪ display during creation.
- **Modify** `src/components/trips/BudgetTierCardsBig.tsx` and `src/components/trips/BudgetTierCards.tsx` — currency-aware money formatting via props.
- **Modify** `src/components/trips/TripDetailView.tsx` — `formatBudgetRange`/fixed-price via central formatter; VM gains `budgetFxRate`.
- **Modify** `src/components/trips/TripDetailViewRedesigned.tsx` — consolidate onto central formatter.
- **Modify** `src/screens/trips/TripDetailScreen.tsx` — map `trip.budget_fx_rate` into the VM.
- **Modify** `src/screens/trips/TripsScreen.tsx` — trip-card price via formatter; Explore budget chip labels localized.

---

## Task 1: Pure currency helpers

**Files:**
- Create: `src/utils/currency.ts`
- Test: `src/utils/__tests__/currency.test.ts`

**Interfaces:**
- Produces:
  - `FALLBACK_USD_TO_ILS: number` (= 3.7)
  - `isIsraeli(country: string | null | undefined): boolean`
  - `usdToIls(usd: number, rate: number): number` — rounded whole number
  - `ilsToUsd(ils: number, rate: number): number` — rounded whole number
  - `formatPrice(usdAmount: number | null | undefined, fxRate: number | null | undefined, viewerCountry: string | null | undefined): string | null`
  - `formatPriceRange(usdMin: number | null | undefined, usdMax: number | null | undefined, fxRate: number | null | undefined, viewerCountry: string | null | undefined): string | null`

**Display rule:** viewer is Israeli AND `fxRate` is a finite positive number → ₪, amount `= usdToIls(usd, fxRate)`. Otherwise → $, amount `= Math.round(usd)`. `formatPriceRange` mirrors the existing branches: both → `"₪5,500-₪7,300"` / `"$5,500-$7,300"`, min only → `"…+"`, max only → `"up to …"`, both null → `null`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/utils/__tests__/currency.test.ts
import {
  FALLBACK_USD_TO_ILS,
  isIsraeli,
  usdToIls,
  ilsToUsd,
  formatPrice,
  formatPriceRange,
} from '../currency';

describe('currency helpers', () => {
  it('detects Israel exactly, treats null/other as non-Israeli', () => {
    expect(isIsraeli('Israel')).toBe(true);
    expect(isIsraeli('United States')).toBe(false);
    expect(isIsraeli(null)).toBe(false);
    expect(isIsraeli(undefined)).toBe(false);
    expect(isIsraeli('israel')).toBe(false); // exact match only
  });

  it('converts and rounds to whole numbers', () => {
    expect(usdToIls(100, 3.7)).toBe(370);
    expect(ilsToUsd(370, 3.7)).toBe(100);
    expect(usdToIls(486.4, 3.7)).toBe(1800); // 486.4*3.7=1799.68 -> 1800
    expect(ilsToUsd(1800, 3.7)).toBe(486); // 1800/3.7=486.48 -> 486
  });

  it('formats a single price by viewer country', () => {
    expect(formatPrice(500, 3.7, 'Israel')).toBe('₪1,850');
    expect(formatPrice(500, 3.7, 'United States')).toBe('$500');
    expect(formatPrice(500, 3.7, null)).toBe('$500');
    expect(formatPrice(null, 3.7, 'Israel')).toBeNull();
  });

  it('falls back to $ for Israeli viewer when rate is missing/invalid', () => {
    expect(formatPrice(500, null, 'Israel')).toBe('$500');
    expect(formatPrice(500, 0, 'Israel')).toBe('$500');
  });

  it('formats ranges in the viewer currency', () => {
    expect(formatPriceRange(1500, 2000, 3.7, 'United States')).toBe('$1,500-$2,000');
    expect(formatPriceRange(1500, 2000, 3.7, 'Israel')).toBe('₪5,550-₪7,400');
    expect(formatPriceRange(1500, null, 3.7, 'United States')).toBe('$1,500+');
    expect(formatPriceRange(null, 2000, 3.7, 'United States')).toBe('up to $2,000');
    expect(formatPriceRange(null, null, 3.7, 'Israel')).toBeNull();
  });

  it('exposes the fallback constant', () => {
    expect(FALLBACK_USD_TO_ILS).toBe(3.7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/utils/__tests__/currency.test.ts`
Expected: FAIL — cannot find module `../currency`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/utils/currency.ts
// Multi-currency pricing helpers for group trips.
// USD is the canonical stored currency; ₪ is derived via a per-trip frozen rate.
// Israeli users (country_from === 'Israel') see ₪, everyone else sees $.

export const FALLBACK_USD_TO_ILS = 3.7;

const ISRAEL = 'Israel';

/** True only for the exact profile country string 'Israel'. Null/other → false. */
export function isIsraeli(country: string | null | undefined): boolean {
  return country === ISRAEL;
}

function validRate(rate: number | null | undefined): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0;
}

/** USD → ₪, rounded to a whole shekel. */
export function usdToIls(usd: number, rate: number): number {
  return Math.round(usd * rate);
}

/** ₪ → USD, rounded to a whole dollar. */
export function ilsToUsd(ils: number, rate: number): number {
  return Math.round(ils / rate);
}

function symbolAndAmount(
  usd: number,
  fxRate: number | null | undefined,
  viewerCountry: string | null | undefined,
): { symbol: string; amount: number } {
  if (isIsraeli(viewerCountry) && validRate(fxRate)) {
    return { symbol: '₪', amount: usdToIls(usd, fxRate) };
  }
  return { symbol: '$', amount: Math.round(usd) };
}

/** Format one USD amount in the viewer's currency, whole numbers only. */
export function formatPrice(
  usdAmount: number | null | undefined,
  fxRate: number | null | undefined,
  viewerCountry: string | null | undefined,
): string | null {
  if (usdAmount == null) return null;
  const { symbol, amount } = symbolAndAmount(usdAmount, fxRate, viewerCountry);
  return `${symbol}${amount.toLocaleString('en-US')}`;
}

/** Format a USD min/max range in the viewer's currency. */
export function formatPriceRange(
  usdMin: number | null | undefined,
  usdMax: number | null | undefined,
  fxRate: number | null | undefined,
  viewerCountry: string | null | undefined,
): string | null {
  if (usdMin == null && usdMax == null) return null;
  if (usdMin != null && usdMax != null) {
    return `${formatPrice(usdMin, fxRate, viewerCountry)}-${formatPrice(usdMax, fxRate, viewerCountry)}`;
  }
  if (usdMin != null) return `${formatPrice(usdMin, fxRate, viewerCountry)}+`;
  return `up to ${formatPrice(usdMax, fxRate, viewerCountry)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/utils/__tests__/currency.test.ts`
Expected: PASS (all assertions).

- [ ] **Step 5: Stage for review**

```bash
git add src/utils/currency.ts src/utils/__tests__/currency.test.ts
# Do NOT commit — Ohad reviews and commits.
```

---

## Task 2: Exchange-rate fetch with fallback

**Files:**
- Create: `src/utils/exchangeRate.ts`
- Test: `src/utils/__tests__/exchangeRate.test.ts`

**Interfaces:**
- Consumes: `FALLBACK_USD_TO_ILS` from `src/utils/currency.ts`.
- Produces: `fetchUsdToIls(): Promise<number>` — resolves to a finite positive rate, never rejects.

- [ ] **Step 1: Write the failing test**

```typescript
// src/utils/__tests__/exchangeRate.test.ts
import { fetchUsdToIls } from '../exchangeRate';
import { FALLBACK_USD_TO_ILS } from '../currency';

describe('fetchUsdToIls', () => {
  afterEach(() => {
    // @ts-ignore
    global.fetch = undefined;
  });

  it('returns the live ILS rate on success', async () => {
    // @ts-ignore
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: 'success', rates: { ILS: 3.65 } }),
    });
    await expect(fetchUsdToIls()).resolves.toBe(3.65);
  });

  it('falls back when the network throws', async () => {
    // @ts-ignore
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    await expect(fetchUsdToIls()).resolves.toBe(FALLBACK_USD_TO_ILS);
  });

  it('falls back when the rate is missing or non-finite', async () => {
    // @ts-ignore
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: 'success', rates: {} }),
    });
    await expect(fetchUsdToIls()).resolves.toBe(FALLBACK_USD_TO_ILS);
  });

  it('falls back on a non-ok response', async () => {
    // @ts-ignore
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(fetchUsdToIls()).resolves.toBe(FALLBACK_USD_TO_ILS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/utils/__tests__/exchangeRate.test.ts`
Expected: FAIL — cannot find module `../exchangeRate`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/utils/exchangeRate.ts
// Fetches the current USD->ILS rate once, at trip price-set time.
// Never throws: on any failure returns FALLBACK_USD_TO_ILS so pricing is never blocked.
import { FALLBACK_USD_TO_ILS } from './currency';

const RATE_URL = 'https://open.er-api.com/v6/latest/USD';

export async function fetchUsdToIls(): Promise<number> {
  try {
    const res = await fetch(RATE_URL);
    if (!res.ok) return FALLBACK_USD_TO_ILS;
    const data = await res.json();
    const rate = data?.rates?.ILS;
    if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
      return rate;
    }
    return FALLBACK_USD_TO_ILS;
  } catch {
    return FALLBACK_USD_TO_ILS;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/utils/__tests__/exchangeRate.test.ts`
Expected: PASS.

- [ ] **Step 5: Stage for review**

```bash
git add src/utils/exchangeRate.ts src/utils/__tests__/exchangeRate.test.ts
```

---

## Task 3: Database migration — `budget_fx_rate`

**Files:**
- Create: `supabase/migrations/20260706120000_group_trips_budget_fx_rate.sql`

**Interfaces:**
- Produces: `public.group_trips.budget_fx_rate numeric` (nullable) — ILS per 1 USD, frozen at write time.

Note: this repo does NOT auto-apply migrations (`supabase db push` is forbidden; remote history is frozen). The file is a reference copy — it is applied **by hand** in the Supabase SQL editor. There is no automated test; verification is a SQL query.

- [ ] **Step 1: Write the migration file**

```sql
-- 20260706120000_group_trips_budget_fx_rate.sql
-- Multi-currency pricing: freeze the USD->ILS rate on each trip at price-set time.
-- USD stays canonical in budget_min/budget_max/cost_per_person; this rate derives ₪.

alter table public.group_trips
  add column if not exists budget_fx_rate numeric;

comment on column public.group_trips.budget_fx_rate is
  'ILS per 1 USD, captured once when the price was set/estimated. Never updated. '
  'Used to display ₪ to Israeli viewers. Null = legacy USD-only trip.';

-- Backfill existing rows with a one-time snapshot rate so Israeli viewers see ₪
-- on pre-existing trips too. Safe: all existing amounts are USD, no real operators yet.
update public.group_trips
  set budget_fx_rate = 3.7
  where budget_fx_rate is null;
```

- [ ] **Step 2: Apply it manually**

Paste the SQL into the Supabase dashboard SQL editor and run it. (Ask Ohad to run it, or run via the granted MCP `execute_sql` only if he approves.)

- [ ] **Step 3: Verify the column exists and is backfilled**

Run this in the SQL editor:

```sql
select count(*) as total,
       count(budget_fx_rate) as with_rate,
       min(budget_fx_rate) as min_rate,
       max(budget_fx_rate) as max_rate
from public.group_trips;
```

Expected: `with_rate == total` and rates around `3.7`.

- [ ] **Step 4: Stage the reference file**

```bash
git add supabase/migrations/20260706120000_group_trips_budget_fx_rate.sql
```

---

## Task 4: Service types + editable-columns allowlist

**Files:**
- Modify: `src/services/trips/groupTripsService.ts` (`GroupTrip` interface ~line 145; `CreateGroupTripInput` ~lines 133-136; editable-columns list ~line 383)

**Interfaces:**
- Consumes: nothing new.
- Produces: `GroupTrip.budget_fx_rate: number | null`; `CreateGroupTripInput.budget_fx_rate: number | null`; `budget_fx_rate` accepted by `updateGroupTrip`.

- [ ] **Step 1: Add `budget_fx_rate` to the `GroupTrip` interface**

Locate the `budget_tier` line inside the `GroupTrip` interface (~line 145) and add below it:

```typescript
  budget_tier: string | null; // 'low' | 'medium' | 'high' — the tier the host picked
  budget_fx_rate: number | null; // ILS per 1 USD, frozen at price-set time (null = legacy USD-only)
```

- [ ] **Step 2: Add `budget_fx_rate` to `CreateGroupTripInput`**

Locate the `budget_tier` line inside `CreateGroupTripInput` (~line 136) and add below it:

```typescript
  budget_tier: string | null;
  budget_fx_rate: number | null;
```

- [ ] **Step 3: Add `budget_fx_rate` to the editable-columns allowlist**

Find the string-array allowlist near line 383 that contains `'cost_per_person', 'budget_min', 'budget_max'`. Add `'budget_fx_rate'` (and `'budget_currency'` if not already present) to it:

```typescript
  'cost_per_person', 'budget_min', 'budget_max', 'budget_currency', 'budget_fx_rate',
```

(If the file passes the whole `editable` object through without an allowlist, skip this step — verify by reading the `updateGroupTrip` body.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no NEW errors referencing `budget_fx_rate` or `groupTripsService.ts`. (Pre-existing unrelated errors, if any, are out of scope.)

- [ ] **Step 5: Stage for review**

```bash
git add src/services/trips/groupTripsService.ts
```

---

## Task 5: Write path — operator currency, rate capture, ₪→USD conversion

**Files:**
- Modify: `src/screens/trips/CreateTripFlowA.tsx` (`resolveBudget` ~1474-1492; save payloads ~1738-1740, 1777-1781, 1830-1837; edit prefill ~588-589)

**Interfaces:**
- Consumes: `fetchUsdToIls` (Task 2), `isIsraeli`, `ilsToUsd`, `usdToIls` (Task 1), `useUserProfile().profile.country_from`.
- Produces: trips written with USD canonical amounts + `budget_currency` (operator currency) + `budget_fx_rate` (frozen rate). Later tasks (7) read `budget_fx_rate` back for display.

**Behavior:**
- `operatorCurrency = isIsraeli(profile?.country_from) ? 'ILS' : 'USD'`.
- A single `fxRate` is fetched once and held in component state (used both for in-flow ₪ display in Task 6 and frozen at save). Fetch it when the budget step is first shown; default to `FALLBACK_USD_TO_ILS` until it resolves.
- On save: manual ₪ entries (manual range + fixed price) are converted to USD via `ilsToUsd(value, fxRate)`. AI tier ranges are already USD — stored as-is. `budget_currency = operatorCurrency`, `budget_fx_rate = fxRate`.
- Edit prefill: Israeli operator sees ₪ (`usdToIls(trip.budget_*, trip.budget_fx_rate)`); others see the USD value unchanged.

- [ ] **Step 1: Import the helpers**

At the top of `CreateTripFlowA.tsx` (with the other `src/utils` imports):

```typescript
import { fetchUsdToIls } from '../../utils/exchangeRate';
import { FALLBACK_USD_TO_ILS, isIsraeli, ilsToUsd, usdToIls } from '../../utils/currency';
```

(Confirm `useUserProfile` is already imported; if not, add `import { useUserProfile } from '../../context/UserProfileContext';` and read `const { profile } = useUserProfile();` alongside the other hooks.)

- [ ] **Step 2: Derive operator currency and hold a frozen rate**

Near the other `useState`/derived values (e.g. by the `budgetEstimate` state ~line 1363), add:

```typescript
const operatorCurrency: 'ILS' | 'USD' = isIsraeli(profile?.country_from) ? 'ILS' : 'USD';
const [fxRate, setFxRate] = useState<number>(FALLBACK_USD_TO_ILS);
// Freeze the rate once, when the operator reaches the budget step. Israeli operators
// need it to display/convert ₪; non-Israeli operators still store it so Israeli
// VIEWERS can later see ₪ on this trip.
useEffect(() => {
  let cancelled = false;
  fetchUsdToIls().then((r) => {
    if (!cancelled) setFxRate(r);
  });
  return () => {
    cancelled = true;
  };
}, []);
```

- [ ] **Step 3: Make `resolveBudget` return USD canonical + currency + rate**

Replace the `resolveBudget` body (~1474-1492) with a version that converts ₪ manual entries to USD and reports the operator currency + rate:

```typescript
const resolveBudget = useCallback((): {
  min: number | null;
  max: number | null;
  currency: 'ILS' | 'USD' | null;
  fxRate: number;
} => {
  // AI tier ranges are already USD — store as-is regardless of operator currency.
  if (budgetEstimate && state.budgetTier && !state.manualBudget) {
    const r = budgetEstimate.ranges[state.budgetTier];
    return {
      min: Math.round(r.min),
      max: Math.round(r.max),
      currency: operatorCurrency,
      fxRate,
    };
  }
  // Manual entry is in the operator's currency. Convert ₪ -> USD for canonical storage.
  const rawMin = state.budgetManualMin ? parseInt(state.budgetManualMin, 10) : null;
  const rawMax = state.budgetManualMax ? parseInt(state.budgetManualMax, 10) : null;
  const toUsd = (v: number | null): number | null =>
    v == null ? null : operatorCurrency === 'ILS' ? ilsToUsd(v, fxRate) : v;
  const min = toUsd(rawMin);
  const max = toUsd(rawMax);
  return {
    min,
    max,
    currency: min != null || max != null ? operatorCurrency : null,
    fxRate,
  };
}, [
  budgetEstimate,
  state.budgetTier,
  state.manualBudget,
  state.budgetManualMin,
  state.budgetManualMax,
  operatorCurrency,
  fxRate,
]);
```

- [ ] **Step 4: Convert the fixed price and write `budget_fx_rate` in both payloads**

For the Flow C fixed-price branch (~1738-1742), convert ₪→USD and capture currency/rate:

```typescript
const budget = isFixedFlow
  ? { min: null, max: null, currency: operatorCurrency, fxRate }
  : resolveBudget();
const rawFixed =
  isFixedFlow && state.costPerPerson ? parseInt(state.costPerPerson, 10) : null;
const fixedPrice =
  rawFixed == null ? null : operatorCurrency === 'ILS' ? ilsToUsd(rawFixed, fxRate) : rawFixed;
```

Then in BOTH write payloads add `budget_fx_rate` next to `budget_currency`:

- Update payload (~1779):
```typescript
          budget_currency: budget.currency,
          budget_fx_rate: budget.fxRate,
```
- Create payload (~1832):
```typescript
          budget_currency: budget.currency,
          budget_fx_rate: budget.fxRate,
```

- [ ] **Step 5: Prefill edit fields in the operator's currency**

At the edit prefill (~588-589) where `budget_min`/`budget_max` seed the manual fields, convert USD→₪ for Israeli operators so they edit in ₪ (which Step 3 converts back on save):

```typescript
// Israeli operators edit in ₪; stored values are USD, so convert up using the trip's frozen rate.
const editRate = initialTrip?.budget_fx_rate ?? FALLBACK_USD_TO_ILS;
const toEditCurrency = (usd: number | null): number | null =>
  usd == null ? null : operatorCurrency === 'ILS' ? usdToIls(usd, editRate) : usd;
// ...then seed the manual-min/max (and costPerPerson) state from toEditCurrency(trip.budget_min) etc.
```

Apply `toEditCurrency` wherever `initialTrip.budget_min`, `initialTrip.budget_max`, and `initialTrip.cost_per_person` seed the corresponding string state fields. (Read the exact prefill lines around 588-589 and the `costPerPerson` prefill, and wrap each numeric seed.)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors in `CreateTripFlowA.tsx`.

- [ ] **Step 7: Manual device check (Ohad)**

No automated UI test (per project convention, UI is verified on-device). Verify:
- As a non-Israeli operator: create a fixed-price $500 trip → DB row has `cost_per_person=500`, `budget_currency='USD'`, `budget_fx_rate≈live`.
- As an Israeli operator (`country_from='Israel'`): enter ₪1800 → DB row has `cost_per_person=round(1800/rate)`, `budget_currency='ILS'`, `budget_fx_rate` set. Re-open edit → field shows ~₪1800.

- [ ] **Step 8: Stage for review**

```bash
git add src/screens/trips/CreateTripFlowA.tsx
```

---

## Task 6: Show ₪ to Israeli operators during creation

**Files:**
- Modify: `src/components/trips/BudgetTierCardsBig.tsx` (`formatMoney` ~62-65; component props)
- Modify: `src/components/trips/BudgetTierCards.tsx` (same pattern)
- Modify: `src/screens/trips/CreateTripFlowA.tsx` (pass currency/rate props; budget-step copy "in USD")

**Interfaces:**
- Consumes: `usdToIls` (Task 1); `operatorCurrency`, `fxRate` (Task 5).
- Produces: tier cards + budget-step labels rendered in ₪ for Israeli operators.

**Behavior:** the tier ranges are USD (from the estimator). For Israeli operators, display them as ₪ using `usdToIls(value, fxRate)`. Pass `currency`/`fxRate` as props so the cards stay presentational.

- [ ] **Step 1: Make `formatMoney` currency-aware in `BudgetTierCardsBig.tsx`**

Add optional props to the component (`currency?: 'ILS' | 'USD'`, `fxRate?: number`, default `'USD'`/`FALLBACK_USD_TO_ILS`), then replace `formatMoney` (~62-65):

```typescript
import { FALLBACK_USD_TO_ILS, usdToIls } from '../../utils/currency';

// inside the component, given props `currency` and `fxRate`:
const formatMoney = (usd: number): string => {
  if (!Number.isFinite(usd)) return '-';
  if (currency === 'ILS') {
    return '₪' + usdToIls(usd, fxRate ?? FALLBACK_USD_TO_ILS).toLocaleString('en-US');
  }
  return '$' + Math.round(usd).toLocaleString('en-US');
};
```

(Move `formatMoney`/`formatRange` inside the component body if they are currently module-level, so they can read the props.)

- [ ] **Step 2: Apply the same change to `BudgetTierCards.tsx`**

Repeat Step 1's pattern in `BudgetTierCards.tsx` (it has the identical `formatMoney` `'$'` implementation).

- [ ] **Step 3: Pass currency/rate from `CreateTripFlowA.tsx`**

Where `<BudgetTierCardsBig ... />` (and `BudgetTierCards` if used) is rendered, pass:

```tsx
currency={operatorCurrency}
fxRate={fxRate}
```

- [ ] **Step 4: Localize the budget-step copy and manual-input symbol**

In the budget step meta (~line 170, `budget: { title: 'Budget', subtitle: 'Per person, in USD.' }`), make the subtitle currency-aware:

```typescript
budget: {
  title: 'Budget',
  subtitle: operatorCurrency === 'ILS' ? 'Per person, in ₪.' : 'Per person, in USD.',
},
```

(If `STEPS_BASE`/step meta is module-level and can't read `operatorCurrency`, compute the subtitle at render where the step header is shown instead.) Also update any `$`-prefixed manual-input adornment / `costPerPerson` input label to show `₪` when `operatorCurrency === 'ILS'`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Manual device check (Ohad)**

As an Israeli operator, the tier cards and budget-step copy show ₪ values; as a non-Israeli operator they show $ (unchanged from today).

- [ ] **Step 7: Stage for review**

```bash
git add src/components/trips/BudgetTierCardsBig.tsx src/components/trips/BudgetTierCards.tsx src/screens/trips/CreateTripFlowA.tsx
```

---

## Task 7: Viewer display via central formatter

**Files:**
- Modify: `src/screens/trips/TripDetailScreen.tsx` (VM build ~235-239)
- Modify: `src/components/trips/TripDetailView.tsx` (`formatBudgetRange` ~218-223; VM type ~139-143; fixed-price ~557, ~580; render sites ~564)
- Modify: `src/components/trips/TripDetailViewRedesigned.tsx` (~320-321, ~328, ~348-354)
- Modify: `src/screens/trips/TripsScreen.tsx` (`formatTripPrice` ~378-384)

**Interfaces:**
- Consumes: `formatPrice`, `formatPriceRange` (Task 1); `GroupTrip.budget_fx_rate` (Task 4); viewer country via `useUserProfile().profile.country_from`.
- Produces: all trip prices rendered in the viewer's currency.

**Key point:** every price surface needs the **viewer's country** and the **trip's `budget_fx_rate`**. The VM must carry `budgetFxRate`.

- [ ] **Step 1: Add `budgetFxRate` to the VM type and builder**

In `TripDetailView.tsx`, add to the VM type near `budgetMin` (~143):

```typescript
  budgetMin?: number | null;
  budgetMax?: number | null;
  budgetFxRate?: number | null;
```

In `TripDetailScreen.tsx` VM build (~237-239), add:

```typescript
  budgetMin: trip.budget_min,
  budgetMax: trip.budget_max,
  budgetFxRate: trip.budget_fx_rate,
```

- [ ] **Step 2: Replace `formatBudgetRange` usage with the currency-aware formatter**

`formatBudgetRange` in `TripDetailView.tsx` (~218-223) currently takes `(min, max)` and hardcodes `$`. Rather than change its signature everywhere, replace its call sites with `formatPriceRange`. At the top of `TripDetailView.tsx`:

```typescript
import { formatPrice, formatPriceRange } from '../../utils/currency';
import { useUserProfile } from '../../context/UserProfileContext';
```

Inside the component, get the viewer country:

```typescript
const { profile } = useUserProfile();
const viewerCountry = profile?.country_from ?? null;
```

Replace the budget label (~564):

```typescript
const budgetLabel = formatPriceRange(vm.budgetMin ?? null, vm.budgetMax ?? null, vm.budgetFxRate ?? null, viewerCountry);
```

Replace the fixed-price strings (~557 and ~580):

```typescript
// ~557
const priceLabel = formatPrice(vm.costPerPerson ?? null, vm.budgetFxRate ?? null, viewerCountry);
// ~580
value: formatPrice(vm.costPerPerson ?? null, vm.budgetFxRate ?? null, viewerCountry) ?? '',
```

Delete the now-unused `formatBudgetRange` export from `TripDetailView.tsx` **only after** confirming no other file imports it (Task 7 Step 3 removes the one remaining importer).

- [ ] **Step 3: Consolidate `TripDetailViewRedesigned.tsx` onto the formatter**

At the top, import the formatter + profile (drop the `formatBudgetRange` import from `./TripDetailView`, line 67):

```typescript
import { formatPrice, formatPriceRange } from '../../utils/currency';
import { useUserProfile } from '../../context/UserProfileContext';
```

Add `const { profile } = useUserProfile(); const viewerCountry = profile?.country_from ?? null;` inside the component. Then:

```typescript
// ~320-321
const priceLabel = formatPrice(vm.costPerPerson ?? null, vm.budgetFxRate ?? null, viewerCountry);
// ~328
const budgetLabel = formatPriceRange(vm.budgetMin ?? null, vm.budgetMax ?? null, vm.budgetFxRate ?? null, viewerCountry);
// ~352 chip value
value: formatPrice(vm.costPerPerson ?? null, vm.budgetFxRate ?? null, viewerCountry) ?? '',
```

- [ ] **Step 4: Trip card price in `TripsScreen.tsx`**

`formatTripPrice` (~378-384) takes a `GroupTrip` and hardcodes `$`. Make it currency-aware by threading the viewer country (read once in the screen via `useUserProfile`) and the trip's `budget_fx_rate`:

```typescript
import { formatPrice, formatPriceRange } from '../../services/../utils/currency'; // use the correct relative path: '../../utils/currency'

const formatTripPrice = (trip: GroupTrip, viewerCountry: string | null): string | null => {
  if (trip.cost_per_person != null) {
    return formatPrice(trip.cost_per_person, trip.budget_fx_rate, viewerCountry);
  }
  return formatPriceRange(trip.budget_min, trip.budget_max, trip.budget_fx_rate, viewerCountry);
};
```

Update the caller(s) of `formatTripPrice(trip)` to `formatTripPrice(trip, viewerCountry)`, where `viewerCountry` comes from `useUserProfile().profile?.country_from ?? null` in the `TripsScreen`/`ExploreTripCard` scope. If `ExploreTripCard` is a separate component, read the profile there or pass `viewerCountry` as a prop.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors; no dangling `formatBudgetRange` import.

- [ ] **Step 6: Manual device check (Ohad)**

- Israeli viewer: trip cards, trip detail (both view variants), fixed-price chips all show ₪ (converted from USD via the trip's frozen rate).
- Non-Israeli viewer: everything shows $ exactly as before.

- [ ] **Step 7: Stage for review**

```bash
git add src/screens/trips/TripDetailScreen.tsx src/components/trips/TripDetailView.tsx src/components/trips/TripDetailViewRedesigned.tsx src/screens/trips/TripsScreen.tsx
```

---

## Task 8: Localize the Explore budget filter chip labels

**Files:**
- Modify: `src/screens/trips/TripsScreen.tsx` (chip labels ~814-815)

**Interfaces:**
- Consumes: `usdToIls`, `FALLBACK_USD_TO_ILS`, `isIsraeli` (Task 1); `BUDGET_THRESHOLD` (existing).
- Produces: chip labels reading `₪Xk` for Israeli viewers. **RPC filtering is unchanged** (stays USD).

**Behavior:** the server still filters against `BUDGET_THRESHOLD` in USD (`exploreFilterPredicates.ts`, `explore_feed` RPC) — do NOT touch that. Only relabel the chips. Use the fallback constant for the label conversion (labels are approximate by nature; there is no single trip rate here).

- [ ] **Step 1: Compute the localized threshold label**

Near the chip definitions (~814-815) in `TripsScreen.tsx`:

```typescript
import { FALLBACK_USD_TO_ILS, isIsraeli, usdToIls } from '../../utils/currency';

// viewerCountry already read for Task 7
const budgetChipUnit = isIsraeli(viewerCountry)
  ? `₪${Math.round(usdToIls(BUDGET_THRESHOLD, FALLBACK_USD_TO_ILS) / 1000)}k`
  : `$${BUDGET_THRESHOLD / 1000}k`;
```

Then update the chip labels:

```typescript
{ id: 'b:below', label: `Below ${budgetChipUnit}`, kind: 'budget', value: 'below' },
{ id: 'b:above', label: `Above ${budgetChipUnit}`, kind: 'budget', value: 'above' },
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual device check (Ohad)**

Israeli viewer sees "Below ₪…k / Above ₪…k"; non-Israeli sees "Below $Xk / Above $Xk". Filtering returns the same trips for both (USD threshold unchanged).

- [ ] **Step 4: Full test + typecheck sweep**

Run: `npx jest src/utils/__tests__/ && npx tsc --noEmit`
Expected: currency + exchangeRate suites PASS; no new type errors.

- [ ] **Step 5: Stage for review**

```bash
git add src/screens/trips/TripsScreen.tsx
```

---

## Self-Review Notes

- **Spec coverage:** operator input by country (Tasks 5, 6) ✓; viewer display rule (Task 7) ✓; frozen rate at write (Tasks 2, 5) ✓; USD canonical + one column (Tasks 3, 4) ✓; rounding to whole numbers (Task 1) ✓; central formatter replacing ~6 hardcoded `$` sites (Tasks 6, 7) ✓; Explore filter labels only, RPC unchanged (Task 8) ✓; migration + backfill (Task 3) ✓.
- **Israeli operator uses AI estimate:** stored range stays USD, `budget_currency='ILS'`, displayed ₪ via frozen rate — consistent on view and edit.
- **Legacy trips:** backfilled to rate 3.7 (Task 3), so Israeli viewers see ₪ on them too; the display code also tolerates null `budget_fx_rate` (falls back to $).
- **No toggle** anywhere — currency is fully determined by `country_from`, per the locked decision.
- **Testing honesty:** Tasks 1-2 are TDD unit tests. Tasks 3-8 are DB/UI/integration verified by `tsc` + on-device checks by Ohad (project convention: no simulator/Maestro UI testing).
