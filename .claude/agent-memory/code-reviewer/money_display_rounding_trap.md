---
name: money-display-rounding-trap
description: formatPrice rounds ₪ to the nearest 100 (display-only) — safe for browsing prices, wrong for an amount the user is about to be charged
metadata:
  type: project
---

`formatPrice()` in `src/utils/currency.ts` routes Israeli viewers through
`usdToIlsDisplay` → `roundIlsForDisplay`, which snaps to the nearest **₪100**
(nearest ₪10 under ₪50). Stripe Checkout charges in **USD**.

**Why:** the helper was written for browsing (trip cards, budget chips) where a
tidy round number reads better. Operator-trip payment rows reuse it, so an
Israeli traveler can be shown "₪4,200" and then land on a Stripe page charging
"$1,393" — a figure that is both a different currency and up to ₪50 off.

**How to apply:** when reviewing any UI that shows an amount the user is about
to pay (pay rows, checkout confirmations, receipts), do not accept `formatPrice`
without asking whether the shown figure equals the charged figure. Browsing
prices are fine. See also [[pg-greatest-ignores-null]] for the sibling
"0 vs null" money trap.
