---
name: edge-fn-secret-fail-open
description: Edge functions that gate on a shared secret must check the env var is non-empty; TextEncoder().encode(undefined) is zero bytes, so a missing HMAC secret becomes a guessable empty key.
metadata:
  type: project
---

Any Supabase edge function whose only auth is a shared secret (`ADMIN_FUNCTION_SECRET`,
`STRIPE_WEBHOOK_SECRET`, an HMAC key) must verify the env var is present and non-empty
before comparing. `Deno.env.get('X')!` is a type assertion, not a runtime check.

Verified in this repo (2026-08-03): `new TextEncoder().encode(undefined)` returns a
**zero-length** byte array, so an unset HMAC secret imported via `crypto.subtle.importKey`
becomes an **empty key that anyone can guess and sign with** — the function fails *open*,
not closed.

**Why:** deploying a function and setting its secret are two separate manual steps here
(see [[payments-migration-review]]); the window where the function is live and the secret
is unset is real, and for `stripe-webhook` that window means anyone on the internet can
write rows to the payment ledger with the service role.

**How to apply:** the house pattern already exists in
`supabase/functions/purge-group-documents/index.ts`:
`if (!(expected.length > 0 && provided === expected) && !bearerOk) return 401`.
Require the same shape in every new secret-gated function. Flag `Deno.env.get(...)!`
followed by a direct comparison as fail-open.
