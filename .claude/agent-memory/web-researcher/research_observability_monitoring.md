---
name: research_observability_monitoring
description: Full 2026 comparison — error tracking (Sentry/Bugsnag/Crashlytics/Embrace), synthetic/uptime monitoring (Checkly/UptimeRobot/Better Stack/Hyperping), Maestro Cloud scheduling, Supabase-native observability, DIY pg_cron approach. Pricing + free tiers confirmed.
metadata:
  type: reference
---

# Observability & Synthetic Monitoring — 2026 Research

## Bucket 1: Passive Error / Crash Tracking

### Sentry
- Free: 5k errors/mo, 1 user, 30-day retention
- Team: $26/mo — 50k errors, unlimited users, Slack integration, Seer AI debugger
- Expo 54 integration: official @sentry/react-native/expo config plugin; source maps upload automatically on EAS native builds; OTA (eas update) requires manual upload of source maps after each publish
- Known Expo 54 bug: SentryUserFeedbackIntegration build failure (iOS, issue #5222), closed as duplicate of #5099 — core crash tracking unaffected. SENTRY_ALLOW_FAILURE not respected in some EAS configs.
- Best in class: symbolication, breadcrumbs, release health. Mature RN SDK.

### Bugsnag
- Free: 7,500 events/mo
- First paid: $59/mo (Team)
- Pro: "stability score" is better than Sentry for mobile-first teams. iOS/Android/RN SDKs strong.
- Con: expensive jump from free to paid vs Sentry.

### Firebase Crashlytics
- Free: unlimited (truly free, no quotas)
- Expo managed workflow: works via @react-native-firebase/crashlytics + EAS dev build (config plugin approach); does NOT require bare workflow ejection
- Pro: completely free, Google ecosystem, excellent native crash symbolication
- Con: no web dashboard for RN JS errors; heavier Firebase setup overhead; not in Expo Go

### Embrace
- Free: up to 1M sessions/year, 5 users, 3-day data retention
- Paid: $80/mo minimum ($0.80/1k sessions)
- Pro: session-level mobile observability (network, user journey)
- Con: 3-day retention on free makes post-incident debugging hard; $80/mo minimum is steep

### PostHog (error tracking module)
- Free: 100k errors/mo (most generous free tier)
- Already installed (posthog-react-native)
- CRITICAL BUG: March 2026 GitHub issue #3294 — captureException broken in RN because library does `error instanceof Event` which doesn't exist in RN. PR #3296 was opened but status unresolved as of research date.
- Do NOT rely on PostHog for RN crash tracking until this is confirmed fixed.

### LogRocket
- Primarily web-focused; mobile RN support exists but weak; not recommended for mobile-primary app.

---

## Bucket 2: Synthetic / API / Uptime Monitoring

### Checkly
- Free (Hobby): 10 uptime monitors, 10k API check runs/mo, 1k browser runs/mo, 2-min min interval, 6 locations
- First paid (Starter): $24/mo — 50 monitors, 25k API runs, 3k browser runs, 1-min interval
- Multi-step API checks: YES, fully programmable (Node.js), chain login -> token -> assert pattern. Cookie forwarding between steps automatic.
- Multi-step on Hobby: unclear from docs whether multistep checks count against API run quota or are paid-only — needs verification
- Best fit for this stack: write a Deno/JS check that hits Supabase Edge Functions with auth token

### Better Stack (Uptime)
- Free: 10 monitors + 10 heartbeats, 30-second check frequency, email+Slack alerts, 1 status page
- Paid: $25/mo for additional 50 monitors
- Pro: 30-second checks on free tier (vs UptimeRobot's 5 min), heartbeat monitoring for cron jobs
- Con: no multi-step API scripting; simple HTTP ping/keyword only

### UptimeRobot
- Free: 50 monitors, 5-minute interval, personal/non-commercial only (restricted in 2025)
- Paid: $7/mo (Solo, 10 monitors, 1-min interval) or $29/mo (Team, 100 monitors)
- Pro: most generous free monitor count
- Con: free tier now restricted to personal use; 5-min interval too slow for production alerting; no scripted checks

### Hyperping
- Free: 20 monitors, 5-min interval, 18 global locations
- Paid: $24/mo (Essentials, 50 monitors, 30-sec interval); $74/mo (Pro, includes 10 browser/Playwright checks)
- Multi-step: browser/Playwright checks from Pro tier only ($74/mo)
- Pro: clean UI, good free tier, status page included
- Con: no multi-step API scripting on free or Essentials

### Cronitor
- Free: 5 monitors only
- Paid: $20/mo (Developer, 20 monitors); $50/mo (Business)
- Best for: cron job + heartbeat monitoring specifically
- Con: very limited free tier; per-monitor pricing climbs fast

### Grafana Cloud (Supabase integration)
- Free: 3 users, 10k metric series, Prometheus scrape supported
- Supabase exposes ~200 Prometheus metrics at https://<project-ref>.supabase.co/customer/v1/privileged/metrics
- Grafana Cloud deploys an agent to scrape and can alert on DB CPU, connections, WAL, query stats
- Email alerting requires configuring notification channels
- Good for infra-level DB monitoring; not for Edge Function business logic checks

---

## Bucket 3: Mobile UI Synthetic Testing on a Schedule

### Maestro Cloud
- Local CLI + Studio: free, open source
- Cloud: $250/device/month (iOS or Android), $125/browser/month
- 7-day free trial on Cloud; no ongoing free tier for Cloud
- Scheduled runs: pricing is by concurrent device slot, not per run — $250/mo covers unlimited runs on 1 device
- Already have Maestro MCP + .maestro/ flows — local runs are free; Cloud is only needed for scheduled CI/remote runs
- Verdict: $250/mo is NOT budget-compatible at $0-30/mo target. Use local runs manually or in CI instead.

### Firebase Test Lab
- Free: 30 min/day on real physical devices (Spark plan); Blaze: $5/device/hour ($0.083/min) beyond free
- No scheduling mechanism — triggered by CI or manual, not time-based
- Con: no Maestro integration (uses Robo/XCTest/Espresso); would require rewriting flows

### BrowserStack App Automate
- No free tier for App Automate (only 30-min trial)
- Paid: $129/mo (Automate Desktop annual) or $199/mo (Desktop + Mobile annual)
- Way over budget.

---

## Bucket 4: Supabase-Native Monitoring

### What Supabase provides natively (free tier)
- Logs: 7-day retention, queryable via Logflare in Studio dashboard
- Metrics: Prometheus-compatible endpoint (~200 series), beta, available to all plans
- Studio dashboards: built-in per-product metrics (requests, egress, response time)
- NO native alerting: Supabase itself does not send email/Slack when something breaks
- NO log-based alerts: Logflare/Log Drains are the only bridge to external alerting, and Log Drains are a Pro add-on ($25/mo base + $60/mo for Log Drains = $85+/mo)

### DIY pg_cron + pg_net + Edge Function synthetic checks
- pg_cron invokes Edge Function via pg_net HTTP POST on a schedule (even every minute)
- The monitoring function can hit critical endpoints, assert responses, log results to a table, and call another Edge Function to send email via Resend/SendGrid
- Cost: $0 extra (included in Supabase free/pro plan)
- Effort: ~4-8 hours to build a minimal version (3-5 probes + email alert Edge Function)
- GOTCHA: pg_cron + pg_net error handling is undocumented — failed HTTP requests do NOT raise exceptions by default; you must poll `net.http_get_queue` or check `_http_response` table manually
- GOTCHA: if Postgres itself goes down, your monitoring also stops (no external watchdog)
- GOTCHA: pg_net is fire-and-forget; you cannot await a response in the same transaction
- Good for: heartbeat pings to Edge Functions, OpenAI API reachability, key DB table sanity checks
- Bad for: being your only monitoring layer (blind spot if DB is down)

### Supabase status webhooks
- Supabase has a public status page at status.supabase.com with webhook subscription for platform incidents
- Sign up for incident alerts at no cost

---

## Bucket 5: DIY Approach — Realistic Effort Estimate

Full DIY stack (pg_cron + monitoring Edge Function + email alerts):
- 1 Edge Function: `health-monitor` — hits 3-5 critical endpoints, checks OpenAI, checks Google Maps
- 1 pg_cron job: runs every 5 minutes calling health-monitor
- Results table: logs pass/fail per endpoint per run
- Alert logic: if 2 consecutive failures → call send-alert Edge Function → Resend email
- Estimated build time: 6-10 hours
- Recurring cost: $0
- Blind spot: cannot detect Supabase Postgres down events (monitor stops with the DB)
- To close blind spot: add one $7/mo UptimeRobot monitor on the Supabase project URL as an external watchdog

---

## Recommended Budget Stack for $0-30/mo (Mobile Primary)

Layer 1 — Error tracking: Sentry free (5k errors/mo). If that's not enough, upgrade to Team at $26/mo which includes Slack. Setup: ~2 hours, works cleanly with EAS via config plugin + SENTRY_AUTH_TOKEN secret.

Layer 2 — Backend synthetic: Checkly Hobby (free) — write 2-3 multistep API checks against critical Edge Functions. Covers the "is the app alive" question from an external perspective, 6 global locations.

Layer 3 — DB/infra heartbeat: Supabase's own Prometheus metrics endpoint + Grafana Cloud free tier (10k series) for DB CPU/connection alerts. OR skip Grafana and rely on the DIY pg_cron approach for business-logic checks + one UptimeRobot free monitor as external watchdog.

Layer 4 — Mobile UI testing: Run Maestro flows locally via CLI before each release. Maestro Cloud at $250/mo is out of budget; skip scheduled Cloud runs for now.

Total: $0/mo (Sentry free + Checkly free + Grafana free + UptimeRobot free). Upgrade to Sentry Team ($26/mo) as soon as Slack alerting is needed or error volume exceeds 5k/mo.

**Why I'm an existing user:**
- PostHog already installed: do not use for crash tracking (March 2026 RN bug, issue #3294)
- Maestro already configured: run locally pre-release, not on Cloud at this budget
