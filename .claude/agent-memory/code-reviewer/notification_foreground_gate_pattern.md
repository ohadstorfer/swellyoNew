---
name: notification-foreground-gate-pattern
description: Pattern used for push foreground-suppression flags (currentConversationIdRef, notificationsScreenOpenRef) and how to review additions to it
metadata:
  type: project
---

`shouldShowForegroundNotification()` in `src/services/notifications/pushNotificationService.ts` is a pure
function gated by a small set of module-level "is the user looking at X" flags (e.g.
`currentConversationIdRef` for chat, `notificationsScreenOpen`/`isNotificationsScreenOpen()` in
`notificationsService.ts` for the bell panel, set via `useFocusEffect` in the relevant screen). This is the
established pattern for any future "suppress banner when already viewing Y" feature in this codebase.

**Why:** reviewed 2026-07-02 bell-notification-banners feature; found it correctly follows the existing
message-banner pattern (2026-06-30) with no integration seams: the screen route in question
(`NotificationsPanel`) is a single named stack route so there's no multi-instance race on the module flag,
`setupNotificationHandlers`'s new getter param is read live (not captured at setup time) so effect-dep
omission is safe, and `clearToken()` nulls the instance-level getter reference (defaults to `false` via
`?? false`) consistent with the existing `getCurrentConversationId` nulling on logout.

**How to apply:** when reviewing a new addition to this gate, check (1) the type union → `Record<Union, true>`
exhaustiveness trick if a new notification-type set is added (compile error forces the set to be updated when
the union grows — good pattern to expect/require), (2) whether the screen behind the new flag can ever be
mounted more than once simultaneously (if yes, a single shared module boolean is wrong — needs a counter or
per-instance ref), (3) that background-push behavior (`isForeground === false`) short-circuits before the new
flag is consulted, since background pushes must stay OS-rendered and untouched by any of this.
