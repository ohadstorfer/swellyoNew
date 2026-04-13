# Web Researcher Agent Memory

- [User Blocking System Research](research_user_blocking.md) — DB schema, UX behavior (WhatsApp/Instagram/Mastodon), Apple 1.2 requirements, Supabase RLS patterns, unblocking UX
- [Apple Sign In — Expo + Supabase](research_apple_sign_in.md) — Apple Developer Console setup, Supabase config, native vs OAuth, iOS/Android/web differences, gotchas
- [Expo Push Notifications + Supabase](research_push_notifications.md) — SDK 54 setup, token storage, FCM v1, APNs via EAS, Edge Function code, DM trigger via DB Webhook, foreground suppression
- [RNGH Custom Slider Thumb Jump Bug](research_rngh_custom_slider.md) — Root cause: use event.x + onLayout, not startX + translationX; definitive fix with code
- [expo-image-picker Android allowsEditing](research_expo_image_picker_android.md) — Crop overlay invisible on Android (light mode, transparent toolbar bug), workarounds: config plugin, Platform.OS gate, or expo-image-manipulator post-crop
- [Android Keyboard Handling — Chat Apps + Expo SDK 54](research_android_keyboard_chat.md) — adjustResize+edgeToEdge=broken on Android 15+; use react-native-keyboard-controller; dynamic behavior hook as fallback
- [Photo/Media Permissions — iOS & Android Store Requirements](research_photo_permissions.md) — Apple NSPhotoLibraryUsageDescription rules, Google Play May 2025 enforcement, expo-image-picker READ_MEDIA injection bug (SDK 54), permission primer UX, canAskAgain=false/Open Settings pattern
- [Age Gate + DOB Onboarding — Industry Patterns](research_age_gate_dob_onboarding.md) — Ask DOB once, pre-fill+lock profile field; underage in Step 2 = terminate session; Tinder/Bumble/Hinge all lock DOB after signup; Apple/Google API requirements
- [Force LTR Layout — React Native / Expo](research_force_ltr.md) — Multi-layer: JS module level + guarded reload + native MainApplication.kt + AndroidManifest supportsRtl=false + iOS AppDelegate
- [Bottom Safe Area Insets — Android](research_bottom_safe_area_android.md) — SafeAreaView vs hook, double-padding in tabs, fixed buttons, FAB, chat input, Android 15 bottom=0 bug (SDK 54)
- [Android Edge-to-Edge — Expo SDK 54](research_android_edge_to_edge.md) — SDK 54 defaults on, mandatory Android 16+; useSafeAreaInsets for bottom padding; Modal nav bar bug; bottom inset=0 bugs on Android 13-15; Samsung S10 defaults to 3-button nav
- [Android Nav Bar Insets — Full Guide](research_android_nav_bar_insets.md) — edgeToEdge mechanics, 3-button(48dp)/2-button(30dp)/gesture(24dp) heights, SafeAreaView vs hook, edges prop, double-padding bug, bottom=0 fix (RNSC 5.2+)
- [Google Sign-In Account Picker — react-native-google-signin](research_google_signin_account_picker.md) — force picker via signOut+signIn, Supabase session gotcha, signOut vs revokeAccess, v13+ API, Original vs Universal/OneTap APIs
- [expo-video v2 Performance & Preloading](research_expo_video_performance.md) — createVideoPlayer pool + replace() for Android decoder reuse, bufferOptions tuning, HLS vs MP4, onFirstFrameRender, black-screen bug
