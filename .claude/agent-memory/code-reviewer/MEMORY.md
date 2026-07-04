# Code Reviewer Memory

- [Nav migration pattern](nav_migration_pattern.md) — openTripCard in AppContent does not clear selectedConversation; overlays above the navigator can hide pushed cards.
- [Dead imports pattern](dead_imports_pattern.md) — TripsScreen tends to accumulate dead Reanimated imports (SlideInRight, SlideOutRight) when overlay code is deleted; styles also linger.
- [AppContent effect dep risk](appcontent_effect_deps.md) — Effects in AppContent that call openTripCard/requestTab must include them in deps; they are stable useCallbacks with [] deps today but this is fragile if they grow deps.
- [renderItem deps miss new props](rendercallback_deps_pattern.md) — TripDeck renderItem useCallback missed userId when card prop was added; adding props to rendered components must be reflected in callback deps.
- [Notification foreground gate pattern](notification_foreground_gate_pattern.md) — module-level "screen open" flags gate push banners; check single-instance route, live getter (not captured), background short-circuit.
- [Channel consolidation drops guards](channel_consolidation_drops_guards.md) — merging N subscriptions into 1 shared hub silently drops per-call-site defensive guards (e.g. `row?.id` check); diff old vs new line-by-line, don't trust "handlers stay identical".
- [In-app banner overlay review (2026-07-04)](in_app_banner_overlay_review.md) — ready-to-commit verdict + open minors (as-any casts, missing group-title fallback, is_system not excluded from banners) for bellBannerSource/notificationsRealtimeHub/InAppBannerHost/MessagingProvider banner pass.
