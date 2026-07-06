---
name: banner-pass-dm-guard-gap
description: In-app message banner's onPress for DMs can pass otherUserId='' when conv.other_user is missing, unlike ConversationsScreen's cold-notification-tap path which explicitly guards this
metadata:
  type: project
---

`MessagingProvider.handleInboxChange`'s banner pass (`showInAppBanner` call, ~line 820) builds
`onPress: () => pushRootCard('ChatCard', { otherUserId: isDirect ? senderMember?.user_id ?? '' : '', ... })`.
If `conv.other_user` is missing at banner-fire time, this silently opens `DirectMessageScreen` with
`otherUserId=''` — presence tracking and `reportedUserId={otherUserId}` (report-user flow) both go
through this prop and only guard with `if (otherUserId)`, so they'd silently no-op rather than crash.

Contrast: `ConversationsScreen.tsx`'s pending-notification-tap effect (added 2026-07 for the cold-start
notification-tap race) explicitly guards `if (conv.is_direct && !conv.other_user) return;` before opening.
The banner-tap path has no equivalent guard.

**Why low severity, not critical:** the banner only fires for a conversation already present in the
*previous* synced snapshot (see `prevById` check in `handleInboxChange` — first message of a brand-new
conversation never banners by design), so `other_user` is normally already enriched from an earlier full
sync. Only reachable if enrichment permanently failed for a conversation still in the list.

**How to apply:** if a future session touches the banner's `onPress` builder or the DM-open path, consider
adding the same `other_user` presence guard (or skip the banner outright if `other_user` is missing on a
direct conversation) for parity with the notification-tap path. Related: [[in-app-banner-overlay-review]],
[[channel-consolidation-drops-guards]] (same family: guard dropped/missing during a feature build-out).
