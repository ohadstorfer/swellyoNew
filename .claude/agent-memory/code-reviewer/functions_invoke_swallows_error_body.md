---
name: functions-invoke-swallows-error-body
description: supabase.functions.invoke returns data=null on any non-2xx, so an edge function's `{ error: "..." }` body never reaches the client — every `data?.error` fallback in src/ is dead code.
metadata:
  type: reference
---

Verified in `node_modules/@supabase/functions-js/dist/main/FunctionsClient.js`
(supabase-js ^2.110.7): `if (!response.ok) throw new FunctionsHttpError(response)`
→ the catch returns `{ data: null, error }`. `error.message` is the fixed string
`"Edge Function returned a non-2xx status code"`.

Consequences to check on every edge-function call site:
- A carefully worded 400/403 body (`{ error: 'Already paid' }`,
  `'The organiser cannot accept payments yet'`) is **discarded**. The user sees
  the generic message.
- Patterns like `if (error) throw error; if (!data?.url) throw new Error(data?.error ?? ...)`
  are dead on the error path — `data` is always null there.
- To recover the body: `const body = await (error as any).context?.json().catch(() => null)`
  (`.context` is the raw `Response`; newer versions also return it as `response`).

Call sites in `src/`: `services/trips/groupTripsService.ts`,
`services/trips/tripPaymentsService.ts`, `services/surftrips/surftripsService.ts`,
`services/analytics/analyticsTripsService.ts`,
`services/analytics/analyticsDashboardService.ts` — all currently lose the body.
Pairs with [[friendly-error-alerts]] style rules: the fix is to unwrap the body,
not to surface `error.message`.
