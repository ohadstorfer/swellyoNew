---
name: client-sql-amount-due-mirror
description: tripPaymentsService.amountDue claims to mirror operator_traveler_amount_due() but the deposit branch diverges — re-diff the two on any payments change
metadata:
  type: project
---

`src/services/trips/tripPaymentsService.ts` opens with "⚠️ These functions
mirror `operator_traveler_amount_due()`. If one changes, the other must." As of
2026-08-03 they do not agree on the `deposit` step:

- SQL: `case p_kind when 'deposit' then deposit` — the trip price is never
  consulted, and an unknown kind yields NULL.
- Client: returns null whenever `totalUsd` is null, before the deposit branch,
  and treats **any** non-`deposit` step as `balance`.

**Why:** the UI reads the client copy (Plan tab amount) while checkout and the
pay-state RPC read the SQL. A disagreement shows the traveler no figure while
the server happily bills them, or vice-versa.

**How to apply:** on any change to prices, deposits, or pay kinds, diff the two
implementations line by line rather than trusting the header comment. Same class
of drift as [[channel-consolidation-drops-guards]].
