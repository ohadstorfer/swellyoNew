---
name: error-monitoring-alerting
description: Error monitoring and alerting options for Swellyo — Sentry vs PostHog vs custom; covers RN/Expo 54, Supabase Edge Functions, pricing, and alerting channels
metadata:
  type: project
---

## Decision context
Web is live with real users; mobile pre-launch. Already using PostHog. Need developer alerts (Slack/email) when end users hit errors.

## Sentry for React Native / Expo 54
- Package: `@sentry/react-native` (NOT the deprecated `sentry-expo`; deprecated since SDK 50/Jan 2024)
- Config plugin: `@sentry/react-native/expo` added to app.json plugins array
- Setup wizard: `npx @sentry/wizard@latest -i reactNative`
- Source maps: upload automatically during EAS build for native; web source map upload does NOT work automatically
- Web: @sentry/react-native supports react-native-web but some features differ from @sentry/react
- Known Expo 54 gotcha: SentryUserFeedbackIntegration unavailable on iOS (issue #5222); peer dependency conflict was fixed post-6.20.0
- React 19 gotcha: web builds fail with createContext error in some navigation libraries — unrelated to Sentry itself but can obscure crash reports
- Sentry Deno SDK import: `import * as Sentry from 'https://deno.land/x/sentry/index.mjs'` — Deno.serve instrumentation NOT supported; must wrap handler in try/catch + captureException + await Sentry.flush(2000)

## Sentry Pricing (2025/2026)
- Developer (free): 5,000 errors/mo, 1 user only, 30-day retention, email alerts only — NO Slack
- Team ($26/mo): 50,000 errors/mo, Slack + third-party integrations unlocked
- Business ($80/mo): 100,000 errors/mo
- Slack integration is gated behind Team plan ($26/mo minimum)

## Supabase Log Drains (for piping to Sentry)
- Available as add-on for Pro, Team, Enterprise (now available on Pro as of March 2026)
- Cost: $60/mo per drain + per-event billing (~$0.0822/hr)
- Captures: Postgres, Auth, Storage, Edge Functions, Realtime, API Gateway logs
- Supported destinations: Sentry, Datadog, Loki, Axiom, AWS S3, OTLP, generic HTTP
- No filtering at source — everything flows; filter inside Sentry
- Config: Project Settings > Integrations > Log Drains > select Sentry > paste DSN

## PostHog Error Tracking
- Free tier: 100,000 exceptions/month (vs Sentry's 5,000)
- Already integrated: since PostHog is already in use, zero new SDK required
- Slack alerts: supported — issue created, reopened, volume spike, threshold
- Critical limitation: no native Android/iOS crash capture — JS-only exceptions
- GitHub issue #3294 (March 2026): error tracking not working out of the box in RN due to `error instanceof Event` check failing (browser API not available in RN)
- GitHub issue #2656: open feature request for native crash capture — not yet shipped
- PostHogErrorBoundary: provided for React render errors
- Autocapture: uncaught JS exceptions + unhandled promise rejections + console errors

## Custom lightweight option
- Architecture: ErrorBoundary + global JS handler (ErrorUtils.setGlobalHandler) + try/catch on promises → POST to Supabase Edge Function → Edge Function calls Slack incoming webhook
- react-native-exception-handler: captures fatal native crashes on JS thread (not true native crashes)
- Effort: ~2-4 hours for JS errors only; native crash capture requires native module and a dev build
- Con: no grouping, no deduplication, no stack trace symbolication, no historical data

## Alternatives
- Bugsnag: 7,500 free events/mo, good RN support, $59/mo for teams — not worth it over Sentry Team at $26
- Rollbar: $13/mo entry, solid RN support — fewer features than Sentry, smaller ecosystem
- Highlight.io: React Native in beta, open-source self-hostable — immature for RN
- LogRocket: session replay focused, expensive, not optimized for mobile

## Recommendation for Swellyo
Best path: Sentry Team ($26/mo) for frontend + Edge Functions, with Supabase Log Drain to Sentry for infrastructure. PostHog error tracking can be enabled as supplementary given it's already installed, but treat it as secondary because of the native crash gap and the March 2026 RN bug.

**Why:** [Relates to [[expo-push-notifications]] pattern of prioritizing proven managed services over DIY]
**How to apply:** Use Sentry as primary; PostHog as backup/supplement; skip custom unless cost is blocker
