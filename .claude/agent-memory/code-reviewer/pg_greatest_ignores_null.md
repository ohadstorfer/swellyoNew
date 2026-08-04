---
name: pg-greatest-ignores-null
description: Postgres GREATEST/LEAST ignore NULL arguments, so greatest(x, 0) turns an unknown value into 0 — never use them to floor a nullable amount.
metadata:
  type: reference
---

In PostgreSQL, `GREATEST` and `LEAST` ignore NULL inputs; the result is NULL only if
*every* argument is NULL. So `greatest(null, 0)` is `0`, not `null` — unlike most other
SQL dialects and unlike arithmetic.

**Why it matters here:** this codebase has several "amount due" / "amount owed" functions
that treat NULL as "no price set, nothing is due yet" and 0 as "fully satisfied". Wrapping
such an expression in `greatest(expr, 0)` silently converts the first meaning into the
second, which downstream reads as `approved` / paid. See [[payments-migration-review]] for
the live instance.

**How to apply:** when reviewing SQL that floors a nullable money/quantity column, require
an explicit null guard around the floor:
`case when <expr> is null then null else greatest(<expr>, 0) end`.
Flag any bare `greatest(<nullable>, 0)` in a function whose callers branch on `is null`.
