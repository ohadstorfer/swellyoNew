---
name: native-bottom-tabs-migration-review
description: Findings from reviewing the @bottom-tabs/react-navigation native tab bar migration (commit 636ba03) and related Android/onboarding native changes, range 9a5f1a0..a2b1b3e (iOS 1.3.1 / Android build 29).
metadata:
  type: project
---

Swellyo migrated from JS `@react-navigation/bottom-tabs` + a custom `FloatingTabBar`/`TripsBottomNav` pill to the native `@bottom-tabs/react-navigation` (react-native-bottom-tabs) bar. Reviewed clean overall — focus-gating (`useFocusEffect` for realtime) is unaffected because the new navigator still uses `useNavigationBuilder`/`TabRouter` under the hood, same lifecycle events.

Things worth re-checking if this area comes up again:
- `TripsBottomNav.tsx`'s `useTripsBottomNavControl()` (progress/collapse/onVerticalScroll) is now dead weight — still wired in `AppContent.tsx` and `TripsScreen.tsx` even though the component it drove (`FloatingTabBar`) was deleted in favor of the native bar's own `minimizeBehavior="onScrollDown"`. Harmless, but a recurring cleanup candidate — matches [[dead_imports_pattern]] (TripsScreen tends to accumulate dead code from deleted overlay/nav mechanisms).
- `Tab.Navigator initialRouteName` changed from `"Lineup"` to `"Trips"` in the same migration commit — a real landing-tab UX change bundled quietly into infra work. Worth flagging even when it looks intentional/consistent, since it's the kind of thing that should get an explicit callout rather than ride along silently.
- **Why:** this project commits native `android/`/`ios/` folders and skips `expo prebuild` (documented in `android/app/src/main/res/values/styles.xml`). Any `app.json` `"plugins"` entry (e.g. `react-native-bottom-tabs`, `@bacons/apple-targets`) is INERT at build time unless someone runs prebuild — the real effect must be hand-mirrored into the native files. Confirmed in this review that they did this correctly for the Material3 theme (and deliberately deviated from the plugin's default `DayNight` to `Light`, well documented). This is the single most important "bare workflow — native folders win" trap in this repo: **always check whether an `app.json` plugin change was also manually applied to the native folder it claims to configure.**
- **How to apply:** when reviewing `app.json` plugin additions/changes, grep the corresponding native file (styles.xml, Info.plist, AndroidManifest.xml, Podfile) for the setting the plugin would have injected, don't assume prebuild ran.
