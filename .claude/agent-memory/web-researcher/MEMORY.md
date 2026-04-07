# Web Researcher Agent Memory

- [User Blocking System Research](research_user_blocking.md) — DB schema, UX behavior (WhatsApp/Instagram/Mastodon), Apple 1.2 requirements, Supabase RLS patterns, unblocking UX
- [Apple Sign In — Expo + Supabase](research_apple_sign_in.md) — Apple Developer Console setup, Supabase config, native vs OAuth, iOS/Android/web differences, gotchas
- [Expo Push Notifications + Supabase](research_push_notifications.md) — SDK 54 setup, token storage, FCM v1, APNs via EAS, Edge Function code, DM trigger via DB Webhook, foreground suppression
- [RNGH Custom Slider Thumb Jump Bug](research_rngh_custom_slider.md) — Root cause: use event.x + onLayout, not startX + translationX; definitive fix with code
- [expo-image-picker Android allowsEditing](research_expo_image_picker_android.md) — Crop overlay invisible on Android (light mode, transparent toolbar bug), workarounds: config plugin, Platform.OS gate, or expo-image-manipulator post-crop
