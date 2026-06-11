# R6 — Cross-Cutting Navigation Concerns

_Research area: cross-cutting. Prepared for the react-navigation v7 migration._

---

## A. Push Notifications → Navigation

### Service layer
- **`src/services/notifications/pushNotificationService.ts`** — singleton.
  - Completely skipped on web (`Platform.OS === 'web'` guard on every method).
  - Registers Expo push token to Supabase `surfers.expo_push_token`.
  - `setupNotificationHandlers(getCurrentConversationId, onNotificationTap)` installs an `addNotificationResponseReceivedListener`. The callback receives `NotificationTapPayload { type, conversationId, tripId, requestId, stage, decision }`.

### Tap dispatch (AppContent.tsx:377–403)
`onNotificationTap` is wired directly into `AppContent` state:
- `payload.tripId` present → sets `pendingTripDetailId`, `pendingTripFocus` (via `tripFocusForNotification`), `setShowTrips(true)`, clears `selectedConversation`.
- `payload.conversationId` present → sets `pendingNotificationConversationId`; `ConversationsStack` reads this prop and reacts to it.

### `TripDetailFocus` type
Defined in `src/services/notifications/notificationsService.ts:55–63`. Values: `overview | commit | updates | gear | your-gear | requests | gear-requests | breakdown`. `tripFocusForNotification()` at line 70 maps notification type + stage/decision to one of these. This is the single source of truth used by both push taps and the NotificationCenter bell.

### Cold-start handling
`Linking.getInitialURL()` is called in AppContent for **invite URLs** only (not push notifications). For push cold-start, `expo-notifications` delivers the tap via `addNotificationResponseReceivedListener` on the first event loop tick after the app mounts — same path as a warm tap. No separate cold-start push resolver exists; the handler fires after `shouldShowConversations` becomes true because `setupNotificationHandlers` is in a `useEffect` gated on `Platform.OS !== 'web'` with no auth guard on the effect itself (it runs on mount).

**Migration impact**: `onNotificationTap` callback sets AppContent boolean state. In the new architecture it needs to call `navigation.navigate(...)` instead. The `pendingTripDetailId` / `pendingTripFocus` / `pendingNotificationConversationId` state variables must become navigation calls. Since the service fires before any screen is mounted (cold start), the navigator must be ready — use `navigationRef` pattern.

### NotificationCenter panel mechanics
`src/components/notifications/NotificationCenter.tsx`:
- Self-contained bell + full-screen right-side drawer component.
- Uses RN `Modal` (`visible={open}`, `transparent`, `animationType="none"`) with a manual `Animated.Value` slide.
- Swipe-to-dismiss via `PanResponder` (old API, not RNGH). Responds to horizontal drag, closes if `dx > 40% of width` or velocity > 0.4 px/ms.
- Close callback calls `onOpenTrip(tripId, focus)` → this is plumbed from AppContent as a prop.
- **Not a navigator screen** — it lives as an overlay inside the conversations header. Post-migration it stays as-is; `onOpenTrip` becomes a `navigation.navigate` call in its prop site.

---

## B. Deep Links

### URL scheme
`app.json:10` — scheme `swellyo`. No `linking` prop on `NavigationContainer` (it is `independent={true}` with no linking config — see Section F).

### What URLs exist
| URL pattern | Platform | Handler |
|---|---|---|
| `swellyo://` (bare scheme) | Native | expo-auth-session OAuth redirect only |
| `https://swellyo-invite.netlify.app/?surftrip=<id>&t=<token>` | Native | AppContent deep link |
| `https://swellyo-invite.netlify.app/?grouptrip=<tripId>` | Native | AppContent deep link |
| `?code=<pkce_code>` (query param on web origin) | Web | Supabase PKCE OAuth handler |

### Native deep link processing (AppContent.tsx:155–288)
- `Linking.getInitialURL()` on cold start + `Linking.addEventListener('url')` for warm.
- `parseInviteFromUrl()` extracts `surftrip`, `t` (token), `grouptrip` params.
- Persisted to `AsyncStorage` (`pendingSurftripInvite`, `pendingGroupTripInvite`) to survive kill-and-restart during signup.
- Post-auth resolvers (separate `useEffect`s) consume the pending IDs once `user !== null && (isComplete || isDemoUser)`.
- **No react-navigation `linking` config** — all routing is manual state mutation.
- iOS: `associatedDomains: applinks:swellyo-invite.netlify.app` (Universal Links). Android: `intentFilters` for the same host.

### Web deep link processing
- `?code=` param → Supabase PKCE callback. Checked in `AppContent` (line 444), `useAuthGuard.ts`, `supabaseAuthService.ts`. After exchange, `window.history.replaceState` cleans the URL (`supabaseAuthService.ts:132,144`).
- No web-side route-based deep linking. The entire app renders at `/` (Netlify SPA). There are no URL path segments that map to screens.
- `OnboardingContext.tsx:53–55` reads `window.location.pathname` and `window.location.hash` to detect `swelly_chat` route on web.

**Migration impact**: If react-navigation on web updates `window.location` to reflect screen state, it could clash with the manual `window.history.replaceState` calls in auth and the `window.location` reads in OnboardingContext. The `NavigationContainer` has `independent={true}` — this was intentionally set to prevent react-navigation from touching the browser URL at all. See Section F.

---

## C. BackHandler

Two usages in `src/components/MapPickerModal.tsx`:

1. **`MapPopover` (line 145)**: Android-only guard. When `visible && Platform.OS === 'android'`, intercepts hardware back to call `onClose()` and return `true` (consume). Effect deps: `[visible, onClose]`.

2. **`MapPickerModal` (line 240)**: Same pattern — Android-only, `visible` guard, calls `onCancel()`.

No other `BackHandler` usage found in `src/`. No screens or overlays outside MapPickerModal override Android hardware back.

**Migration impact**: With react-navigation v7's Stack, Android hardware back pops the stack by default. `MapPickerModal` is a component (not a screen), rendered inside screens as a `Modal`. Its `BackHandler` will race with the navigator's own back handler. The `return true` (consume) in MapPickerModal should win because it's registered while the modal is open and it's the last listener. But verify that the navigator wrapper doesn't also register a back handler that fires first. Use `useFocusEffect` + `BackHandler` priority ordering after migration.

---

## D. Gesture / Animation Inventory

### Screen-level horizontal swipe-back gestures (custom, will conflict with navigator swipe)

| Component | File | Gesture type | Dismisses to |
|---|---|---|---|
| TripPlanningChatScreen | `src/screens/TripPlanningChatScreen.tsx:350` | `Gesture.Pan()` with `manualActivation`, right-swipe dismiss | calls `onChatComplete` → AppContent hides overlay |
| ProfileScreen | `src/screens/ProfileScreen.tsx:961` | `Gesture.Pan()` with `manualActivation + simultaneousWithExternalGesture(nativeGesture)`, right-swipe dismiss | calls `onBack` prop |
| NotificationCenter panel | `src/components/notifications/NotificationCenter.tsx:198` | `PanResponder` (old API), rightward drag | closes drawer |
| ImagePreviewModal | `src/components/ImagePreviewModal.tsx:123` | `Gesture.Pan()`, vertical swipe | calls `onClose` |
| FullscreenVideoPlayer | `src/components/FullscreenVideoPlayer.tsx:138` | `Gesture.Pan()`, vertical swipe | calls `onClose` |
| FullscreenImageViewer | `src/components/FullscreenImageViewer.tsx:69` | `Gesture.Pan()`, vertical swipe | calls `onClose` |
| VideoPreviewModal | `src/components/VideoPreviewModal.tsx:175` | `Gesture.Pan()`, vertical swipe | calls `onClose` |
| ProfileEditPanel | `src/components/ProfileEditPanel/ProfileEditPanel.tsx:1633` | `Gesture.Pan()`, long-press-then-drag | lifestyle keyword reorder |
| AvatarCropModal (native) | `src/components/AvatarCropModal.native.tsx:119` | `Gesture.Pan()` | image crop pan |
| TravelExperienceSlider | `src/components/TravelExperienceSlider.tsx:129` | `Gesture.Pan()` | slider drag |
| CustomSlider | `src/components/CustomSlider.tsx:137` | `PanGestureHandler` (old API) | slider drag |
| RangeSlider | `src/components/trips/RangeSlider.tsx:157,195` | `Gesture.Pan()` (two handles) | slider drag |
| WaveShapeSlider | `src/components/trips/WaveShapeSlider.tsx:131` | `Gesture.Pan()` | slider drag |
| SwipeToReplyWrapper | `src/components/SwipeToReplyWrapper.tsx:31` | `Gesture.Pan()`, right-swipe only, per-message | triggers reply |

### Critical: ConversationsStack uses `react-native-screen-transitions`
`src/navigation/ConversationsStack.tsx:3–4` imports `createBlankStackNavigator` from `react-native-screen-transitions/blank-stack` and `Transition` from `react-native-screen-transitions`. This is the ONE existing react-navigation stack in the app.
- `slideFromRightOptions` uses a custom `screenStyleInterpolator` worklet that slides screens in from the right.
- `gestureActivationArea: 'edge'` restricts swipe-back to left edge, leaving the message body free for `SwipeToReplyWrapper`.
- `enableNativeScreens={false}` — native screens disabled in this stack.
- On web, the stack is bypassed entirely: `ConversationsStack` renders `<ConversationsScreen>` directly (line 72–74).
- `independent` flag on `Stack.Navigator` (line 79) means this inner stack has its own navigation state isolated from the outer `NavigationContainer`.

### Reanimated screen-level entering/exiting animations
The navigator would normally replace these. Current usage:
- `TripsScreen` (line 1346–1347): `SlideInRight.duration(280)` / `SlideOutRight.duration(220)` on an `Animated.View` wrapping the CreateTrip wizard pane — **not a screen-level animation**, it's a component inside the screen.
- `CreateTripWizardChrome` (line 364): `Animated.View` with step-enter/exit animations (entering/exiting props). Also component-level.
- `DirectMessageScreen` + `DirectGroupChat`: `FadeIn`/`FadeOut` on individual message elements and UI sub-components — not screen transitions.
- All other `FadeIn`/`FadeOut`/`FadeInUp` usages are on sub-views, not screens.
- No `SlideInRight` is used on any AppContent overlay or screen directly — the overlay swap is instantaneous (boolean swap with `absoluteFill`).

### Carousels (horizontal scrolling, gesture-interacting)
`src/components/BoardCarousel.tsx`, `DestinationCardsCarousel.tsx`, `DestinationCardsCarouselCopy.tsx`, `MatchedUsersCarousel.tsx`, `BudgetCardsCarousel.tsx`, `VideoCarousel.tsx`, `onboarding/DestinationsCarousel.tsx` — all are `FlatList`/`ScrollView` with `horizontal`. No custom gesture handlers. No conflict with navigator swipe.

---

## E. Web Platform

### `.web.tsx` files
- `src/components/CountryPickerWrapper.web.tsx` — stub that exports `CountryPicker = null`, `Country = null`, `CountryCode = null`. Used as Metro web alias to prevent native country-picker library from loading on web.

### `.native.tsx` files
- `src/components/CountryPickerWrapper.native.tsx` — real country picker.
- `src/components/AvatarCropModal.native.tsx` — native-only image crop modal.

### Platform.OS === 'web' branches affecting navigation/screens
- **`ConversationsStack.tsx:72`**: On web, renders `<ConversationsScreen>` directly (no inner Stack). DM navigation is absent — `selectedConversation` state in AppContent handles it instead.
- **`AppContent.tsx:157`**: Linking listener skipped on web.
- **`AppContent.tsx:378`**: Push notification handlers skipped on web.
- **`AppContent.tsx:434–463`**: OAuth `?code=` detection on web — sets `isCheckingAuth=true` to block premature WelcomeScreen render.
- **`pushNotificationService.ts:43`**: Entire registration skipped on web.
- **`MapPickerModal.tsx:225`**: On web, `window.addEventListener('message')` instead of native bridge.
- **`TripPlanningChatScreen.tsx:351`**: Swipe-back gesture disabled on web (`.enabled(Platform.OS !== 'web')`).

### What react-navigation on web would change for the Netlify build
Currently `NavigationContainer` is `independent={true}` with **no `linking` config** — this is intentional to prevent react-navigation from modifying `window.location`. The app is a pure SPA at `/`. Adding react-navigation URL routing post-migration would:
1. Cause react-navigation to push path segments like `/trips`, `/profile` to the browser URL.
2. Conflict with the manual `window.history.replaceState` calls in `supabaseAuthService.ts` (auth cleanup) and `OnboardingContext.tsx` (`window.location.pathname` reads for route detection).
3. Break Netlify's SPA fallback unless a catch-all redirect is added.

**Recommendation**: Keep `independent={true}` and omit `linking` config post-migration to preserve current web behavior. All web "routing" stays as AppContent boolean state, as it is now.

---

## F. App.tsx — Provider Nesting & NavigationContainer Config

File: `App.tsx` (repo root).

### Provider stack (outermost → innermost)
```
Sentry.wrap
  GestureHandlerRootView         ← required for RNGH v2
    MaybeKeyboardProvider        ← react-native-keyboard-controller KeyboardProvider
                                    (skipped in Expo Go, loaded via require)
      SafeAreaProvider           ← react-native-safe-area-context
        NavigationContainer      ← independent={true}, no linking config
          PostHogErrorBoundary
            QueryClientProvider
              PostHogProvider    ← conditional on isNavigationReady (waits for onReady)
                [OnboardingProvider, UserProfileProvider, MessagingProvider, TutorialProvider]
                  AppContent
                  StatusBar
```

### Key flags on NavigationContainer
- `independent={true}` — isolates this container's state from any parent navigator; also **prevents react-navigation from touching `window.location` on web** (this is the reason it was set).
- `onReady` — sets `isNavigationReady=true`, which gates the PostHogProvider mount. Prevents `useNavigationState` errors in PostHog's navigation tracking.
- No `linking` prop.
- No `theme` prop.
- No `ref` prop (no `navigationRef` created).

### MaybeKeyboardProvider
`const MaybeKeyboardProvider = isExpoGo ? ({children}) => <>{children}</> : require('react-native-keyboard-controller').KeyboardProvider`

This is a **conditional require at module level** in `App.tsx`. In Expo Go it is a passthrough; in dev/prod builds it wraps the entire tree with `KeyboardProvider`. This is required for `useReanimatedKeyboardAnimation` in `DirectMessageScreen`, `DirectGroupChat`, and `ChatScreen`.

---

## G. Keyboard Libraries

### Confirmed present: `react-native-keyboard-controller` v1.18.5
_Verified in `package.json:73`._

Usage:
- `KeyboardProvider` wraps entire app in `App.tsx` (except Expo Go).
- `KeyboardAvoidingView` from the library replaces RN's built-in KAV in dev/prod builds (via `src/utils/keyboardAvoidingView.ts`).
- `KeyboardGestureArea` used in `DirectGroupChat` and `DirectMessageScreen` for Android interactive-dismiss.
- `KeyboardStickyView` exported from `keyboardAvoidingView.ts` but not actively imported in screens (available).
- `useReanimatedKeyboardAnimation` used in `DirectMessageScreen.tsx:21`, `DirectGroupChat.tsx:21`, `ChatScreen.tsx:18` — drives `paddingBottom` that tracks keyboard height on the UI thread.

**Migration impact**: `useReanimatedKeyboardAnimation` is sensitive to transform ancestors. There is an explicit comment in `DirectMessageScreen.tsx:3862` and `DirectGroupChat.tsx:3788`:
> "On iOS in react-native-keyboard-controller v1.18.5, wrapping the chat in a react-native-screen-transitions transformed view breaks the keyboard animation"

The existing workaround (KAV not used, paddingBottom driven by `useReanimatedKeyboardAnimation`) must be preserved. If react-navigation v7 uses `react-native-screens` transforms on the chat screen, the keyboard behavior will break. Use `gestureEnabled: false` or ensure the chat screen is not inside a transformed stack slide. The current ConversationsStack uses `enableNativeScreens={false}` to avoid this — that setting must be preserved (or an equivalent workaround applied) post-migration.

---

## Counts Summary

| Category | Count |
|---|---|
| Screen-level horizontal swipe-dismiss gestures (custom) | 2 (TripPlanningChatScreen, ProfileScreen) |
| Vertical swipe-dismiss modal gestures | 3 (ImagePreview, FullscreenVideo, FullscreenImageViewer, VideoPreview) |
| Per-message swipe gesture | 1 (SwipeToReplyWrapper, inside chat screens) |
| BackHandler usages | 2 (both in MapPickerModal, Android-only) |
| `.web.tsx` platform override files | 1 (CountryPickerWrapper) |
| `.native.tsx` platform override files | 2 (CountryPickerWrapper, AvatarCropModal) |
| Push notification nav payload types | 7 (TripDetailFocus values) + conversationId path |
| Deep link URL patterns handled | 3 (surftrip invite, grouptrip invite, OAuth ?code=) |
| Stacks using react-native-screen-transitions | 1 (ConversationsStack) |
| Files importing `useReanimatedKeyboardAnimation` | 3 (DirectMessageScreen, DirectGroupChat, ChatScreen) |

---

## Top 10 Migration-Relevant Facts

1. **NavigationContainer is `independent={true}` with no `linking` config** — intentional to block URL mutation on web. Do not add a `linking` config without auditing `window.history.replaceState` calls in auth and `window.location` reads in OnboardingContext.

2. **`react-native-keyboard-controller` v1.18.5 is confirmed in use** — `KeyboardProvider` wraps the whole app. Chat screens use `useReanimatedKeyboardAnimation` which breaks when inside a screen-transitions transform. `ConversationsStack` uses `enableNativeScreens={false}` as the existing workaround. This setting must be preserved or an equivalent applied for the chat screens post-migration.

3. **ConversationsStack already uses react-navigation** (`react-native-screen-transitions/blank-stack`). On web it bypasses the stack entirely and renders `ConversationsScreen` directly. This split must be preserved or the web fallback re-implemented.

4. **Push notification tap sets AppContent boolean state** — `pendingTripDetailId`, `pendingTripFocus`, `pendingNotificationConversationId`. These must become `navigation.navigate()` calls post-migration. Since there is no `navigationRef`, one must be created and attached to `NavigationContainer`.

5. **`tripFocusForNotification()` and `TripDetailFocus` type** are the single source of truth for both push taps and bell-tap navigation. They remain valid post-migration — just the call site changes from setState to navigate.

6. **Two custom right-swipe-back gestures** exist on `TripPlanningChatScreen` and `ProfileScreen`. If these become stack screens, their custom Pan gestures will conflict with the navigator's built-in swipe-back. Disable `gestureEnabled` on those routes, or remove the custom gesture and rely on the navigator.

7. **`SwipeToReplyWrapper` uses `Gesture.Pan` with `activeOffsetX: [-999, 15]`** inside the chat FlatList. ConversationsStack already uses `gestureActivationArea: 'edge'` to prevent conflict. This constraint must be preserved on the chat screen route options post-migration.

8. **NotificationCenter panel is a `Modal`-based drawer**, not a screen. It calls `onOpenTrip` prop to trigger navigation. It is not a route — it stays as a component overlay. Post-migration, `onOpenTrip` becomes `navigation.navigate('TripDetail', { tripId, focus })`.

9. **Deep link handling is entirely manual** (no `linking` config). Invite links (`swellyo-invite.netlify.app`) are processed by `AppContent` via `Linking.getInitialURL` + event listener, persisted to AsyncStorage, and resolved post-auth. This system is independent of react-navigation and requires no changes unless the team wants to integrate it.

10. **Web has no URL routing** — the entire app renders at `/`. Adding react-navigation's web URL integration post-migration requires a Netlify `_redirects` catch-all and auditing every `window.location` access in the codebase.

---

## Landmines

### CRITICAL — keyboard-controller + screen transforms
`useReanimatedKeyboardAnimation` in the DM screens breaks when wrapped in a react-native-screens animated container (the iOS UIKit transform). The current fix (`enableNativeScreens={false}` in ConversationsStack) must be applied to whichever stack the chat screens land in post-migration, or keyboard animation will regress on iOS.

### CRITICAL — no navigationRef
`App.tsx` creates no `navigationRef`. Push notification taps and deep link resolvers set AppContent state. After migration, navigation from outside React tree (push tap fires before any screen mounts on cold start) requires a `navigationRef` passed to `NavigationContainer` and consumed by the notification service / deep link handlers.

### HIGH — `independent={true}` on inner ConversationsStack
`ConversationsStack` sets `independent` on its `Stack.Navigator`. This makes it a completely isolated navigation tree. If the outer stack and inner stack both try to handle Android back, behavior is undefined. The inner stack's `independent` flag may need to be removed if it becomes a nested navigator within the new outer stack.

### HIGH — ProfileScreen custom swipe conflicts with navigator swipe
`ProfileScreen` implements its own `Gesture.Pan` right-swipe dismiss. If it becomes a stack screen with `gestureEnabled: true`, both gestures fire. The custom gesture uses `manualActivation` + `simultaneousWithExternalGesture(nativeGesture)` — it will not automatically cede to the navigator. Must set `gestureEnabled: false` on the ProfileScreen route.

### MEDIUM — TripPlanningChatScreen persistent mount
TripPlanningChatScreen and TripPlanningChatScreenCopy are mounted with `display: 'none'` when not frontmost (see AppContent:1931–1979). This preserves websocket subscriptions and chat state across Profile/DM navigation. A navigator would unmount screens on back — this will regress unless the screens are kept in the navigator history (not popped) or moved outside the stack entirely.

### MEDIUM — `MaybeKeyboardProvider` conditional require
`App.tsx:63` uses `require('react-native-keyboard-controller').KeyboardProvider` at module evaluation time (not inside a component). If the module is absent in a particular build variant, this throws at startup, not lazily. Ensure the build never strips `react-native-keyboard-controller` from the bundle.

### LOW — web `window.location.pathname` check in OnboardingContext
`OnboardingContext.tsx:53–55` reads `window.location.pathname` to detect the `swelly_chat` route. If react-navigation starts writing path segments to the URL (e.g. `/trips`, `/lineup`), this check could produce false positives. Safe while `independent={true}` and no `linking` config.
