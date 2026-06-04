---
name: supabase-error-alerting-layer-by-layer
description: Feasibility + effort assessment for catching any Supabase error (DB, PostgREST, Edge Functions, Auth, Storage, Realtime) and firing alerts — layer by layer with Log Drains as the catch-all
metadata:
  type: reference
---

# Supabase Error Alerting — Layer-by-Layer Feasibility

Researched June 2026.

## Layer 1: Database / Postgres

### What's catchable via pg_net + triggers
- pg_net can call HTTP endpoints from triggers (async, non-blocking)
- CRITICAL NUANCE: pg_net queues requests in net.http_request_queue (a DB write). That write is part of the current transaction. If the transaction ROLLS BACK, the pg_net call is rolled back too — request never fires.
- For errors caught in an EXCEPTION handler: code in the handler CAN run pg_net.http_post(), and IF the outer transaction commits normally after handling, the request DOES fire.
- For unhandled errors that abort the transaction: pg_net call CANNOT fire because there's nothing to commit.
- Net result: pg_net inside EXCEPTION blocks = partial coverage. You can alert on errors your own code catches gracefully. Constraint violations, RLS denials, unexpected exceptions that abort the transaction = NOT alertable via pg_net.
- Also: "cannot commit while a subtransaction is active" — you can't force-flush a pg_net call mid-exception.

### What's NOT catchable at DB layer
- External client query errors (client times out, network drops)
- RLS denials — these are returned as errors to the client, not DB-side events
- Constraint violations on statements that abort the transaction
- DB-level connection errors

### Database Webhooks
- Fire ONLY on INSERT/UPDATE/DELETE success
- Do NOT fire on errors, RLS violations, or failed statements
- This is a hard architectural fact, not a configuration option

### Postgres log_min_messages
- You can set PostgreSQL logging levels (ERROR, FATAL, PANIC), but these write to the Postgres log file, not a webhook
- Readable in Supabase dashboard Logs Explorer (postgres_logs table)
- Only accessible programmatically via Log Drains (see below)

### Effort: Hard (for custom trigger approach) / Impossible (for transaction-abort errors)

## Layer 2: PostgREST / API Gateway

- PostgREST logs all requests to edge_logs (queryable in Logs Explorer)
- Errors (4xx/5xx) appear in API gateway logs with status codes
- NO server-side webhook mechanism to fire on API errors — you can query after the fact but can't trigger a real-time alert
- Only way to get real-time alerting on PostgREST errors = Log Drains streaming to a destination that supports alerting (Sentry, Datadog, etc.)
- Client-side: supabase-js returns error objects; you can instrument globally on the client
- Effort: No native server-side hook. Only Log Drains for server-side real-time.

## Layer 3: Edge Functions (Deno)

- Full try/catch available. Standard pattern: wrap handler in try/catch, call Sentry or a Discord/Slack webhook in catch block.
- Uncaught exceptions (WORKER_ERROR) ARE logged to function_logs and function_edge_logs — visible in dashboard
- Sentry Deno SDK works but has a limitation: no scope separation between requests (no Deno.serve instrumentation), so breadcrumbs can leak between concurrent requests. Use withScope() to isolate.
- Platform-level invocation failures (function not found, quota exceeded) show as FunctionsRelayError / FunctionsFetchError on the client side. These are surfaced in edge_logs but not in function-level logs.
- Effort: Trivial for try/catch + Sentry/webhook. Moderate if you want to catch every platform-level failure too.

## Layer 4: Auth / Storage / Realtime

- Auth: Auth activity logged to auth_logs. No native alerting hook. Auth failures visible in dashboard. Only way to alert = Log Drains.
- Storage: Storage API activity in storage_logs. Same — no native alert. Log Drains only.
- Realtime: WebSocket events in realtime_logs. Same.
- None of these three have per-event webhooks or programmatic error notification mechanisms outside Log Drains.
- Effort: Hard (nothing to instrument). Log Drains is the only path.

## Layer 5: Log Drains — The True Catch-All

### What it captures
All 6 layers: Postgres (query execution, connection events, errors), API Gateway (PostgREST/GraphQL requests + responses), Auth (login, tokens, MFA, sessions), Storage (uploads, downloads, transforms, access), Edge Functions (invocations, traces, errors), Realtime (WebSocket, broadcast, presence).

### Plan requirement
Pro plan add-on. NOT included in base Pro. NOT available on Free.

### Pricing (as of June 2026)
- $60/drain/project/month base
- + $0.20 per million log events
- + $0.09 per GB egress
- NOT covered by Spend Cap (can run over)

### Destinations
Datadog, Grafana Loki, Sentry (as logs only — NOT as error events, important gotcha), AWS S3, Axiom, generic HTTP endpoint (custom)

### Filtering
- NO source-side filtering by severity — all log levels are streamed, no way to say "only send ERROR+"
- Filtering must happen at the destination (Sentry log rules, Datadog filters, etc.)
- Stream labels include log source automatically (postgres, auth, etc.) — no config needed for source filtering

### Gotchas
- Sentry destination: logs are ingested as Sentry Logs, NOT as Sentry error events. "Ingesting Supabase logs as Sentry errors is currently not supported." You can set up monitors/alerts on log patterns in Sentry, but it's log-based alerting, not error-based.
- HTTP webhook endpoint: requests are UNSIGNED (future signing planned). Batched max 250 logs or 1s intervals. Gzip supported. Can route to an Edge Function — but that creates an infinite loop risk if the Edge Function itself logs.
- Log volume: all 6 layers at full verbosity = high event count. $0.20/million looks cheap but adds up at scale.

## The Honest Verdict

There is NO single switch that says "notify me on any error of any kind." The reality:

1. FREE / without Log Drains: You must instrument each layer separately.
   - Edge Functions: trivial (try/catch + Sentry/Slack webhook in code)
   - DB trigger errors: partially catchable via pg_net in EXCEPTION handlers, but transaction-abort errors cannot be caught this way
   - PostgREST, Auth, Storage, Realtime errors: NOT alertable in real-time without Log Drains. Dashboard-visible after the fact only.

2. WITH Log Drains ($60+/mo Pro add-on): Gets you a unified stream of all logs from all layers into a single destination. Then set up alerting rules in that destination (Sentry, Datadog, etc.) to filter for errors. This is the closest thing to "any error, one place" — but it's reactive (logs flowing in) not event-driven (webhook fires), and you still need to configure alert rules in the destination.

## Practical Recommendation for Swellyo

Given Pro plan (assumed), best approach is layered:
1. Add try/catch + Slack/Discord webhook call (or Sentry) to ALL Edge Functions (trivial, ~10 min per function)
2. Add global supabase-js error interceptor on client (catches PostgREST 5xx returned to client)
3. Consider Log Drains ($60/mo) only if you want Auth/Storage/Realtime errors and DB-level errors to be centrally observable — not strictly necessary at early stage
4. Do NOT rely on pg_net + trigger for error alerting — too unreliable, too narrow in what it catches

**Why:**
