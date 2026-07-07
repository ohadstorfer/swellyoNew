# Group Trip Multi-Currency Pricing (₪ / $)

**Date:** 2026-07-06
**Status:** Approved design — ready for implementation plan

## Goal

Show group trip prices in **shekels (₪)** to Israeli users and **US dollars ($)** to
everyone else. Israeli operators/admins set prices in ₪; non-Israeli operators set
prices in $. The USD↔ILS exchange rate is captured **once**, at the moment the price
is set (or estimated), and frozen onto the trip forever — it never re-fetches or
drifts afterward.

This is intentionally simple. There are no professional trip operators yet, and for
crew/leader trips the price is only an estimation, so estimation-grade accuracy is
acceptable.

## Decisions (locked)

1. **Operator input currency is automatic by country — no toggle.**
   Operator's `profile.country_from == "Israel"` → they enter/see **₪ only**.
   Everyone else → **$ only**. Admins follow the same country rule as operators.
2. **Viewers see all trips in one currency, by their own country.**
   Viewer `country_from == "Israel"` → sees **every** trip in ₪.
   Everyone else (including users with no country set) → sees every trip in $.
3. **Rate is frozen at write time.** The rate used is whatever it is at the moment the
   operator sets the price, or the moment the AI estimates the range. Stored on the
   trip. Never updated afterward. No live/display-time conversion.
4. **USD is the canonical stored currency.** All amounts persist in USD; the frozen
   rate converts to ₪ for display when needed.
5. **Rounded to the nearest whole number.** No decimals in displayed prices.

## Data Model

Table `public.group_trips` already has:
- `budget_min`, `budget_max` (integer, nullable) — AI/manual range, **treated as USD**
- `cost_per_person` (numeric, nullable) — Flow C fixed price, **treated as USD**
- `budget_currency` (text, default `'USD'`) — currency the operator *entered* in
- `budget_tier`, `price_inclusions` — unchanged

**Add one column** (additive migration, no data loss):
- `budget_fx_rate numeric` — ILS per 1 USD, captured at the moment the price/estimate
  is written. Nullable (null = "no ₪ conversion available, treat as legacy USD").

**Column semantics after this change:**
- `budget_min` / `budget_max` / `cost_per_person` = canonical **USD** amounts.
  When an Israeli operator enters ₪, the value is converted to USD once (using the
  fetched rate) and stored here.
- `budget_currency` = what the operator typed (`'ILS'` or `'USD'`). Used **only** to
  prefill the edit screen in the operator's own currency and to know whether the
  entered value was native.
- `budget_fx_rate` = frozen ILS-per-USD rate for this trip.

**Why USD-canonical + one frozen-rate column** (instead of storing both ₪ and $
amounts in parallel columns):
- The server-side Explore budget filter already operates in USD on
  `budget_min`/`budget_max` — keeping USD canonical means **zero RPC/filter change**.
- One additive column instead of three, and no dual-write-on-edit sync burden.
- The only cost is a small (≈1–2 shekel) double-rounding wobble when an Israeli-entered ₪ price
  is round-tripped USD→₪ for display. Acceptable for estimation-grade prices.

## Rate Source

A small client helper, e.g. `src/utils/exchangeRate.ts`:
- `fetchUsdToIls(): Promise<number>` — fetches the current USD→ILS rate from a free,
  no-key public API (e.g. `https://open.er-api.com/v6/latest/USD` → `rates.ILS`).
- On any failure (network, bad response, non-finite number) returns a **hardcoded
  fallback constant** (`FALLBACK_USD_TO_ILS ≈ 3.7`). Never throws — pricing must never
  be blocked by FX.
- Called exactly once per trip, at write time. The result is persisted into
  `budget_fx_rate`. It is **never** called again for an existing trip.

Two write entry points capture the rate:
1. **Manual price set** (Flow C fixed price, or manual Flow A/B range) — client fetches
   the rate at submit time.
2. **AI estimate** — when the AI budget range is applied to the trip, the rate at that
   moment is captured and frozen alongside it.

## Operator Input (`src/screens/trips/CreateTripFlowA.tsx`)

- Derive input currency from `profile.country_from`: `"Israel"` → ₪, else $.
  No toggle UI.
- The budget step subtitle and any `$`/symbol labels reflect the derived currency
  (₪ for Israeli operators, $ otherwise). Update the hardcoded "in USD" copy.
- Manual entry:
  - Israeli operator types ₪. At submit, `usd = round(ils / rate)` is stored in
    `budget_min`/`budget_max`/`cost_per_person`; `budget_currency = 'ILS'`;
    `budget_fx_rate = rate`.
  - Non-Israeli operator types $. Stored directly as USD; `budget_currency = 'USD'`;
    `budget_fx_rate = rate` (still captured, so Israeli viewers can see ₪).
- Replaces the 3 hardcoded `'USD'` literals in `resolveBudget()` / Flow C write.
- Edit mode prefills the operator's native currency: Israeli operator sees the ₪ value
  reconstructed as `round(usd * budget_fx_rate)`; others see the USD value.
- **AI estimator itself is unchanged** — it keeps prompting/returning USD. USD is
  canonical, so no change is needed to `supabase/functions/estimate-trip-budget`.
  The Israeli operator simply sees the estimated range converted to ₪ in the UI.

## Display — Central Formatter

New shared helper `src/utils/formatPrice.ts`:

```
formatPrice(usdAmount: number, fxRate: number | null, viewerCountry?: string): string
```
- Viewer is Israeli (`viewerCountry === "Israel"`) **and** `fxRate` is present →
  `₪` + `round(usdAmount * fxRate).toLocaleString()`.
- Otherwise → `$` + `round(usdAmount).toLocaleString()`.
- A range helper `formatPriceRange(min, max, fxRate, viewerCountry)` mirrors the
  existing `formatBudgetRange` branches (`"₪5,500-₪7,300"`, `"₪5,500+"`,
  `"up to ₪7,300"`), currency-aware.

Viewer country comes from `useUserProfile().profile.country_from`.

**Replace these currently-hardcoded `$` sites with the formatter:**
- `src/components/trips/TripDetailView.tsx` — `formatBudgetRange` (lines ~218–223) and
  the fixed-price lines (~557, ~580).
- `src/components/trips/TripDetailViewRedesigned.tsx` — its duplicated inline `$` logic
  (~321, ~352). Consolidate onto the shared helper.
- `src/screens/trips/TripsScreen.tsx` — trip card price line (~379–381).
- `src/components/trips/BudgetTierCardsBig.tsx` / `BudgetTierCards.tsx` —
  `formatMoney()` (~64). During creation these show the currency the operator is
  entering in (₪ for Israeli operators), not the viewer rule.

## Explore Budget Filter

- The `explore_feed` RPC and its `band_lo`/`band_hi` USD thresholds are **unchanged**
  — it keeps filtering canonical USD `budget_min`/`budget_max`.
- Only the **chip label text** (`TripsScreen.tsx` ~814–815, `BUDGET_THRESHOLD`) is
  converted to ₪ for Israeli viewers, using a representative/current rate (the same
  fallback constant is fine here — labels are approximate by nature). No server change,
  no migration for the filter.

## Migration

`supabase/migrations/2026070610XXXX_group_trips_budget_fx_rate.sql`:
- `ALTER TABLE public.group_trips ADD COLUMN budget_fx_rate numeric;`
- Backfill existing rows with a one-time snapshot rate constant (existing data is all
  USD; safe — no real operators yet). Rows may also be left null and treated as
  "USD-only, no ₪ conversion" if preferred; decide during implementation.
- Applied manually via SQL editor per project convention (never `supabase db push`).

## Out of Scope (YAGNI)

- Live/periodic rate refresh, rate history, or per-trip rate re-evaluation.
- Currencies other than ILS/USD.
- Making the AI estimator reason in ILS.
- Currency-aware server-side filtering (the USD filter stays; only labels localize).
- Any i18n framework — this is a targeted currency feature, not localization.

## Acceptance Criteria

1. An Israeli operator (`country_from == "Israel"`) creating a trip enters the price in
   ₪; a non-Israeli operator enters it in $. No currency toggle appears.
2. On write, `budget_fx_rate` is populated (real rate, or fallback on FX failure), and
   canonical amounts are stored in USD.
3. An Israeli viewer sees **every** trip's price in ₪; every other viewer sees **every**
   trip's price in $. All displayed prices are whole numbers.
4. A trip's displayed prices do not change over time as real FX moves — the frozen rate
   governs forever.
5. The Explore budget filter still returns the same trips as before (USD filtering
   unchanged); Israeli viewers see the chip labels in ₪.
6. Editing a trip prefills the operator's native currency.
7. FX API failure never blocks trip creation (fallback constant used).
