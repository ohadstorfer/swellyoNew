---
name: in-app-banner-overlay-review
description: 2026-07-04 review outcome for the WhatsApp-style in-app banner feature (bellBannerSource, notificationsRealtimeHub, InAppBannerHost, MessagingProvider banner pass) — verdict and known accepted minors
metadata:
  type: project
---

Reviewed the full in-app-banner-overlay feature (spec at
`docs/superpowers/specs/2026-07-04-in-app-banner-overlay-design.md`) as a whole change (5 new files +
6 modified files: AppContent.tsx, MessagingProvider.tsx, NotificationCenter.tsx, ConversationsScreen.tsx,
registerLogoutHandlers.ts, pushNotificationService.ts). Verdict: ready to commit, no Critical/Important
findings. `npx jest src/services/notifications src/services/messaging` → 76/76 pass. `npx tsc --noEmit`
introduces zero new errors (diffed against `git stash` baseline — only line-number shifts in pre-existing
errors).

**Why worth remembering:** this is the reference case for how the realtime-hub consolidation (2 bell
subs → 1) and the zero-new-subscription message banner (piggybacking on `handleInboxChange`) were verified
clean — logout teardown, user-switch restart, and double-notify (native push suppressed via
`shouldShowForegroundNotification` reverting to suppress-all) all check out. One real (if low-severity)
regression found: the hub's INSERT/UPDATE handlers dropped the `row?.id` guard the old
`notificationsService.subscribe()` had — see [[channel-consolidation-drops-guards]]. Accepted-as-shipped
minors: redundant `as any` casts in ConversationsScreen's two `messagePreviewText()` call sites (the
`Message` type is already structurally compatible, cast is dead weight); banner title has no "— Group Chat"
fallback for untitled groups even though the `onPress` chat-open param does; `is_system` messages banner
like normal messages (list view already special-cases `is_system`, banner pass doesn't); the very first
message of a brand-new conversation never banners by design (anti-storm guard skips conversations absent
from the pre-sync snapshot) — this is spec-mandated, not a bug.

**How to apply:** if a future session touches `bellBannerSource.ts`, `notificationsRealtimeHub.ts`,
`inAppBannerBus.ts`, or the banner pass in `MessagingProvider.handleInboxChange`, these known minors are
still open unless a later commit fixed them — check current code before assuming they're resolved.
