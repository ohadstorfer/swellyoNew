# Codebase Researcher Memory Index

- [User Profile](user_profile.md) — Ohad (ohad branch); preferences for brevity and autonomy, no sim/Maestro testing
- [Blocking Feature Research](project_blocking_feature.md) — Full findings on where blocking needs to be wired in
- [Explore feed pagination internals](project_explore_feed_pagination_internals.md) — explore_feed RPC ORDER BY/cursor, useTripQueries limit+1 probe, TripsScreen prefetch, isAppend reorder risk, participant_count already materialized
- [Join-request notification gaps](project_join_request_notification_gaps.md) — useTripRealtime refocus-invalidate skips detailRequests key; TripMembersScreen/TripDetail share one query key but differ in mount lifecycle; ProfileScreen's getIncomingJoinRequest bypasses cache entirely; only-ohad gate status unverified live
- [Fullscreen image zoom building blocks](reference_fullscreen_image_zoom_building_blocks.md) — FullscreenImageViewer.tsx (swipe-dismiss, chat photos) + AvatarCropModal.native.tsx (pinch/pan pattern) are the reusable pieces; no lightbox lib installed; ProfileImage in ProfileScreen has no Pressable wrapper yet
- [Message banner vs bell foreground gate](reference_message_banner_vs_bell_foreground_gate.md) — shouldShowForegroundNotification only special-cases data.type==='message'; bell/dispatch-notification-queue pushes carry data.type=real NotificationType so stay suppressed in foreground; no generic route-tracker exists, only the conversationId ref pattern
