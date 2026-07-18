# Swellyo — Global & Cross-Cutting UX Audit

Domain: navigation, headers, tab bar, modals/sheets, global loading, error handling, toasts/alerts, media viewers, theming, fonts, insets. Bar: WhatsApp / Instagram polish.

Scope reviewed: `App.tsx`, `src/components/AppContent.tsx`, `src/navigation/RootNavigator.tsx`, `MainHeader.tsx`, `HeaderLogoIcon.tsx`, `LoadingScreen.tsx`, `ConversationLoadingScreen.tsx`, `BottomSheetShell.tsx`, `FadeInView.tsx`, `FullscreenImageViewer.tsx`, `FullscreenVideoPlayer.tsx`, `ImagePreviewModal.tsx`, `GalleryPermissionOverlay.tsx`, `Button.tsx`, `Input.tsx`, `CountrySearchModal.tsx`, `DateOfBirthSheet.tsx`, `PostHogErrorBoundary.tsx`, `InAppBannerHost.tsx`, `friendlyError.ts`, `theme/fonts.ts`, `keyboardAvoidingView.ts`, `TutorialContext.tsx`.

---

## Top 5 most impactful fixes

1. **🔴 No global crash-recovery boundary — any render error = permanent white screen.** The only class boundary (`PostHogErrorBoundary`) *re-throws* everything that isn't a PostHog string match. Add a real top-level `Sentry.ErrorBoundary`/class boundary with a branded "Something went wrong — Reload" fallback.
2. **🟠 Global `StatusBar style="light"` renders invisible (white) status-bar icons on every light screen** (onboarding, welcome, loading, permission overlays are `#FCFCFC`/white). Make status-bar style per-screen (dark on light screens, light on the `#212121` header screens).
3. **🟠 Font weights silently fall back to Regular/system on iOS across ~700 call sites.** 728 bare `fontFamily:` usages vs 316 `ff()`. Bare `fontFamily:'Montserrat' + fontWeight:'700'` renders Montserrat *Regular* on iOS (documented in `fonts.ts`). Headlines/buttons look thinner than Figma app-wide.
4. **🟠 No shared success/confirmation feedback + raw error leaks in logout.** 282 `Alert.alert` calls, 49 generic `'Error'` titles, and two logout paths interpolate raw `result.error` into the alert body. There is no success-toast primitive — only the push-style banner. Add a lightweight toast and route the leaks through `friendlyError`.
5. **🟠 Reusable primitives (`Button`, `Input`) are effectively unused; buttons/colors are ad-hoc per screen.** Button radii vary (`full` / 24 / 12 / 8), and "dark" is spelled `#212121`, `#333333`, `#222B30`, `#090909` interchangeably. Consolidate into a real `<Button variant>` + design tokens.

---

## 1. Global loading & app boot

- **🟡 White frame on cold boot while fonts load.** `App.tsx:117` returns `null` until `fontsReady`. On native this is a blank window before `WelcomeScreen` mounts. Prefer holding the native splash (`expo-splash-screen` `preventAutoHideAsync`) until fonts + session restore resolve, instead of an unstyled `null`.
- **🟡 Session-restore loading reuses `WelcomeScreen` with `isCheckingAuth`** (`AppContent.tsx:2022`, `2339`). Works, but the "loading" and "logged-out landing" states are the same component — brittle, and any WelcomeScreen render cost is paid on the hot boot path.
- **🔵 `LoadingScreen.tsx` is 1050 lines**, ~400 of them web-only `<video>` DOM hacks (control-hiding CSS injection, MutationObserver, multi-timeout `setPlaysInline`). Very hard to maintain; a lot of this belongs in a small web-video helper. On a mobile-first product (per memory, mobile is the live product) this is disproportionate.
- **🟢 Good:** branded video loading experience, `FadeInView` reveal wrapper follows a sound motion spec, explore/detail prefetch on entering the app (`AppContent.tsx:1744`).

## 2. Navigation

- **🟠 No React Navigation `linking` config.** `NavigationContainer` (`App.tsx:141`) has no `linking` prop; all deep links are parsed by hand in `AppContent.tsx` (`parseInviteFromUrl` 204, share intake, `getInitialURL` 237) and fed through bespoke `requested*`/`pending*` state machines. This is a large surface (invite links, group-trip links, share intake, push taps) with no URL→screen mapping and **no state restoration** — a killed app never restores its nav stack. Consider migrating the deep-link cases to a `linking.config` so cold-start routing is declarative.
- **🟡 `backBehavior="none"` on the bottom tabs** (`RootNavigator.tsx:534`). Android hardware-back from a tab does not return to the previously-selected tab; combined with the manual mirror it can feel like back "does nothing" or exits. Verify Android back behavior on Lineup/Profile.
- **🟡 Floating Swelly avatar position is hand-tuned magic** (`RootNavigator.tsx:511` `bottom: 96`, comment "Tuned visually on device"). Device-dependent; will misalign over the tab bar on devices with different bar heights. Anchor to `insets.bottom` + measured bar height.
- **🟡 Active-tab is derived by digging into nested navigator state** (`RootNavigator.tsx:436-442`) and mirrored back into `AppContent` via effects. It works but is fragile; the `?? 'Trips'` fallbacks mean a state-shape change silently mis-reports the active tab.
- **🟢 Good:** cards-over-tabs architecture is clean, tab screens stay mounted (scroll/realtime preserved), `hapticFeedbackEnabled` + `minimizeBehavior` on iOS 26 bar, mount-safe consumption of cold-start requests.

## 3. Error boundaries & crash handling

- **🔴 No user-facing crash recovery.** `PostHogErrorBoundary.tsx:34` `throw error` for anything not matching `navigation state|PostHog|useNavigationState`. So a render crash in any screen propagates to the root with no fallback UI → white screen. `Sentry.wrap` (App.tsx:82) reports to Sentry but renders nothing on error. **Add a top-level error boundary with a branded recovery screen** ("Something went wrong" + Reload button that resets nav / re-mounts the tree). This is the single biggest polish gap vs WhatsApp/IG, which never show a blank screen.
- **🟠 No global network-offline indicator.** `friendlyError` produces a good per-action "check your connection" message, but there is no ambient offline banner (WhatsApp's "Connecting…" / "No internet" bar). Realtime-heavy app; users get silence when the socket drops. Add a `@react-native-community/netinfo`-driven top strip.
- **🟢 Good:** chat has local `ChatErrorBoundary` + `SafeMessageBubble`; Sentry is wired with sensible noise filtering.

## 4. Alerts & toasts

- **🟠 Raw error text leaked in logout alerts.** `ConversationsScreen.tsx:600` and `SettingsScreen.tsx:79`: `Alert.alert('Error', \`Failed to logout: ${result.error || 'Unknown error'}\`)` — `result.error` is un-sanitized. Route through `friendlyErrorMessage`.
- **🟡 49 generic `Alert.alert('Error', …)` titles** (e.g. `ConversationsScreen.tsx:567`, `WelcomeScreen.tsx:753`, `ProfileScreen.tsx:1513+`). Generic "Error" titles read as developer errors, not product copy. Prefer contextual titles ("Couldn't send", "Upload failed") — the `friendlyError` file already models this.
- **🟠 No success/confirmation toast primitive.** 282 `Alert.alert` calls carry both errors *and* confirmations through the blocking OS alert. There is no non-blocking "Saved" / "Copied" / "Sent" affordance — only `InAppBannerHost`, which is push-notification-shaped and web-disabled. A small toast/snackbar would remove dozens of blocking alerts.
- **🟢 Good:** `friendlyError.ts` is well-designed (technical-pattern + network-pattern detection, length/newline heuristics) and adopted in 137 places.

## 5. Modals & sheets

- **🟠 Inconsistent sheet adoption.** `BottomSheetShell` is excellent and used in 18 places, but there are **53 raw `<Modal>`** usages. Fullscreen viewers, `GalleryPermissionOverlay`, `LoadingScreen` consent modal, `ImagePreviewModal`, age-block overlay (`AppContent.tsx:1999`) all hand-roll Modal + backdrop + animation, so backdrop opacity, dismiss gesture, and Android nav-bar handling differ sheet-to-sheet.
- **🟡 Age-block overlay is a bare inline `<View>` alert** (`AppContent.tsx:1999-2018`) with hardcoded styles and a hidden 3s long-press unblock — not a Modal, no animation, uses `RNText` (system font). Low-traffic but jarring.
- **🟡 `BottomSheetShell` `avoidKeyboard` uses `behavior="height"` on Android** (`BottomSheetShell.tsx:144`) — known to clip inputs on fixed-height sheets (matches the memory note about `UserSearchModal` keyboard clipping). Verify each `avoidKeyboard` sheet.
- **🟢 Good:** `BottomSheetShell` separates scrim-fade from sheet-slide, swipe-to-dismiss, `onDismissed` iOS teardown gating for pickers, and a documented Android nav-bar transform workaround for expo/expo#39749. `CountrySearchModal` and `DateOfBirthSheet` correctly use it.

## 6. Media viewers

- **🟠 Fullscreen image viewer has no pinch-to-zoom.** `FullscreenImageViewer.tsx` supports only swipe-to-dismiss (pan Y). WhatsApp/IG both pinch-zoom + pan a zoomed image. Also **no share/save action** and **no gesture support on web** (`:143` renders static content). Add pinch-zoom (reanimated pinch + pan) and a share/save button.
- **🟡 Two separate fullscreen media components** (`FullscreenImageViewer`, `FullscreenVideoPlayer`) with duplicated dismiss-gesture logic (`DISMISS_DISTANCE=120`, `DISMISS_VELOCITY=800` copy-pasted). Fine, but no shared media-viewer shell → drift risk.
- **🟢 Good:** `FullscreenVideoPlayer` is genuinely polished — instant poster from cache (never opens on black), delayed loader (no spinner flash), custom seek bar with live scrub on iOS, documented Android scrub degradation pending expo-video 55.

## 7. Theming & fonts

- **🟠 No dark mode anywhere.** 0 `useColorScheme` / `prefers-color-scheme` usages; `StatusBar style="light"` is global (`App.tsx:130`). Acceptable as a product decision, but then light screens have the wrong status-bar tint (see Top-5 #2).
- **🟠 ~700 bare-font call sites render wrong weight on iOS.** `fonts.ts:8-13` documents that iOS ignores `fontWeight` for custom fonts, yet 728 sites still use bare `fontFamily` + `fontWeight`. Examples in the files I read: `LoadingScreen.tsx:814/827/840` (`'Montserrat'` + `fontWeight:'700'` → Regular), `GalleryPermissionOverlay.tsx:122` (`fontFamily: undefined` → system font body), `RootNavigator.tsx:395`, `Button.tsx:55` (`fontWeight:'bold'`, no family → system). Sweep to `ff()`.
- **🟡 `allowFontScaling=false` set globally** (`App.tsx:84-87`) — pins to Figma px but disables Dynamic Type entirely (accessibility regression). The code acknowledges this; consider a capped `maxFontSizeMultiplier` instead.
- **🟢 Good:** `ff()` + `fs()` (Android small-text taper) is a thoughtful parity system; `useAppFonts` blocks first paint to avoid a system-font flash.

## 8. Insets & safe areas

- **🟠 `LoadingScreen` fakes safe-area with a magic `90`** (`LoadingScreen.tsx:609` `const safeAreaInsets = Platform.OS === 'web' ? 0 : 90`) instead of `useSafeAreaInsets()`. Wrong on notchless, small, and large devices → mis-sized video/layout.
- **🟡 Header top padding hardcoded** (`MainHeader.tsx:116` `paddingTop: web?16:8`) relies on the screen's own `SafeAreaView edges={['top']}` — correct, but the pattern is repeated per screen rather than owned centrally, so a screen that forgets `edges={['top']}` collides with the notch.
- **🟢 Good:** most screens use `react-native-safe-area-context`; `InAppBannerHost` and `FullscreenVideoPlayer` correctly use `insets.top/bottom`.

## 9. Consistency

- **🟠 Shared primitives unused.** `Button.tsx` and `Input.tsx` are near-dead (every screen hand-rolls `TouchableOpacity`/`TextInput`). Consequences: button radius varies (`borderRadius.full` in LoadingScreen, `24` in age-block, `12` in GalleryPermissionOverlay, `8` in LoadingScreen consent), and `Button.tsx` itself renders system-font bold text. Build a real variant-based `<Button>` and migrate.
- **🟡 Color-token drift.** Raw literals dominate: 266 `#FFFFFF`, 246 `#333333`, 57 `#212121`, 55 `#222B30`, 48 `#7B7B7B`. "Dark" is at least 4 different hexes; back-chevron color is `#222B30` (RootNavigator EditTrip) but headers are `#212121`. Centralize in `styles/theme` and enforce.
- **🟢 Good:** `MainHeader` genuinely unifies the two top-level screens; `HeaderLogoIcon` is a pixel-exact shared mark.

## 10. Perceived performance & polish

- **🟡 `AppContent.tsx` is 2353 lines** and owns routing, deep links, share intake, onboarding step handlers, join-decision queue, and nav context. The file itself documents multiple past freezes caused by its re-render fan-out (`:1801`, `:1849`, `:1818` perf watchdog). High regression risk on any change here; candidate for decomposition into providers/hooks.
- **🟡 Verbose `console.log` on hot user paths in production** (e.g. `handleStartConversation` logs ~10 lines per tap, `AppContent.tsx:1522-1576`). Gate behind `__DEV__`.
- **🟡 `handleStep1Back` / `handleWelcomeBack` wrap synchronous `setCurrentStep` in try/catch + `setTimeout` retries** (`AppContent.tsx:1608-1642`, `2130-2196`) — defensive scaffolding around React state that suggests earlier race bugs; adds latency (500ms–1s guard resets) and complexity.
- **🟢 Good:** haptics on tab bar, spring-based interruptible banner, reduce-motion respected in `FadeInView`/`InAppBannerHost`, sheet transitions are UI-thread driven, keyboard handled via keyboard-controller KAV with Expo Go fallback.

---

## Quick-win checklist

- [ ] Add top-level branded `ErrorBoundary` with reload (🔴)
- [ ] Per-screen `StatusBar` style (dark on light screens) (🟠)
- [ ] Route logout alerts through `friendlyErrorMessage` (🟠, `ConversationsScreen.tsx:600`, `SettingsScreen.tsx:79`)
- [ ] Add offline banner via NetInfo (🟠)
- [ ] Pinch-zoom + share on `FullscreenImageViewer` (🟠)
- [ ] Replace `LoadingScreen.tsx:609` magic `90` with real insets (🟠)
- [ ] Add a toast primitive; demote confirmation `Alert`s (🟠)
- [ ] Font sweep bare `fontFamily`→`ff()`, starting with buttons/headlines (🟠)
- [ ] Real `<Button>`/`<Input>` + color tokens (🟠)
- [ ] Add React Navigation `linking` config for deep links (🟡)
