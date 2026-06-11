---
name: nav-migration-pattern
description: openTripCard does not clear selectedConversation; DM overlay renders above navigator and can hide pushed trip cards
metadata:
  type: project
---

`openTripCard` in AppContent only clears showTripPlanningChat/Copy and sets requestedTab + requestedTripCard. It does NOT call `setSelectedConversation(null)`. The DM/group-chat overlay (`activeOverlay`) renders via `StyleSheet.absoluteFill` above `RootNavigator`, so any pushed TripDetail card is invisible under it.

Call sites that clear selectedConversation manually before calling openTripCard: push-notification handler (line 390), invite resolver (line 285), handleOpenTripDetailFromChat (line 1419).

Call sites that do NOT clear it: handleJoinDecisionPrimary (line 1127). This is a pre-existing bug, not introduced in Phase 2.

**Why:** Legacy overlay architecture — selectedConversation drives an absolute overlay above the navigator. Until chat moves into the navigator (Phase 3), every openTripCard call site needs to manually clear selectedConversation first.

**How to apply:** When reviewing any new call site of openTripCard, verify selectedConversation is cleared before the call.
