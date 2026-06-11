# Code Reviewer Memory

- [Nav migration pattern](nav_migration_pattern.md) — openTripCard in AppContent does not clear selectedConversation; overlays above the navigator can hide pushed cards.
- [Dead imports pattern](dead_imports_pattern.md) — TripsScreen tends to accumulate dead Reanimated imports (SlideInRight, SlideOutRight) when overlay code is deleted; styles also linger.
- [AppContent effect dep risk](appcontent_effect_deps.md) — Effects in AppContent that call openTripCard/requestTab must include them in deps; they are stable useCallbacks with [] deps today but this is fragile if they grow deps.
