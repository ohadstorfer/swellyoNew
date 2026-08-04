---
name: requirement-catalog-drives-wizard
description: Adding a kind to REQUIREMENT_ORDER silently adds an operator-tappable toggle to the create-trip Requirements step, and one bad row kills the whole batch insert
metadata:
  type: project
---

`CreateTripFlowA.tsx`'s Requirements step renders `REQUIREMENT_ORDER.map(...)` with no filter, so **any kind added to `REQUIREMENT_ORDER` in `tripDocumentsService.ts` immediately becomes a user-tappable requirement card** in the wizard. The Stripe-payments work added `deposit` and `balance` to that array while driving those same rows from the budget step's `paymentMode`, creating two independent paths to the same row.

**Why this is dangerous:** `createRequirements()` does one `.insert(rows)` for the whole batch, and the publish call site wraps it in `try { } catch { console.warn }`. A single bad row (unique-index violation on `uq_group_trip_req_kind_per_trip (trip_id, kind) where kind <> 'custom'`, or the `trg_pay_requires_managed_trip` / `trg_passport_requires_operator_trip` triggers) rejects the entire statement, and the trip publishes with **zero** requirements, silently. A waiver PDF uploaded just before the insert is orphaned too.

**How to apply:** when reviewing anything that touches `REQUIREMENT_ORDER`, `REQUIREMENT_CATALOG` or the kinds passed to `createRequirements`, check (a) whether the new kind should be filtered out of the wizard's toggle list, (b) whether the assembled kinds array can contain duplicates, and (c) whether the swallowed catch is hiding a whole-batch failure.

**Update (Task 11, 2026-08-03):** `tripDocumentsService.ts` now exports `isPayKind(kind)` = `REQUIREMENT_CATALOG[kind]?.reqType === 'pay'`. That is the canonical test — flag any new hardcoded `k === 'deposit' || k === 'balance'`. `CreateTripFlowA` (`DOCUMENT_REQUIREMENT_ORDER`) and `PlanSections.tsx` still use their own inline equivalents.

**Second gotcha, easy to miss:** a *managed* trip does not necessarily have both pay rows. `CreateTripFlowA` publishes `['deposit','balance']` only when a deposit amount was entered; a single-payment trip gets `['balance']` alone. So any UI that renders pay kinds gated on `paymentMode === 'managed'` alone will show a phantom Deposit card for a row that does not exist, and a save against it silently no-ops. Gate on an actual existing active row, not on `payment_mode`.
