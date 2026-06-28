---
name: rnbt-native-bottom-tabs-full-api
description: Exhaustive prop-by-prop API reference + bare workflow gotchas + screens version conflict for react-native-bottom-tabs (Callstack) on Expo SDK 54 / RN 0.81 / New Architecture iOS.
metadata:
  type: reference
---

# react-native-bottom-tabs — Full Reference + Bare Workflow Gotchas (June 2026)

## BARE WORKFLOW / EAS BUILD CRITICAL FINDINGS (Added June 2026)

### 1. Config Plugin — iOS-only finding
The `app.plugin.js` for react-native-bottom-tabs is **Android-only**. It only modifies `android/app/src/main/res/values/styles.xml` to apply Material3 theme. It makes ZERO iOS changes. For iOS bare workflow with committed `ios/` and prebuild skipped, the config plugin not running is irrelevant — CocoaPods autolinking handles everything. The plugin IS already in the project's `app.json` but won't run (harmless for iOS, matters for Android).

### 2. iOS Deployment Target
The library's podspec sets iOS minimum to **14.0**. The project Podfile defaults to `15.1`. No conflict. No manual changes needed.

### 3. react-native-screens Version — THE CRITICAL TRAP
- React Navigation docs say `react-native-screens >= 4.25.0` is required
- BUT: react-native-screens 4.25.x sets `peerDependencies: "react-native": ">=0.82.0"` — project is on **0.81**
- react-native-screens 4.24.0 had a **known build failure** on iOS New Architecture (#3682 — undeclared `RNSBottomTabsScreenComponentView` identifiers)
- react-native-bottom-tabs' own **podspec does NOT declare react-native-screens as a dependency** at all (only `SwiftUIIntrospect ~> 1.0`)
- The library uses SwiftUI TabView directly on iOS — it is architecturally independent from react-native-screens at the native pod level
- **Practical conclusion**: `react-native-screens 4.16` (the SDK 54 default) works for basic iOS tab navigation. The 4.25 requirement in the docs is for `tabBarMinimizeBehavior` (iOS 26+ collapse), experimental `SafeAreaView insetType="interface"`, and Android distinct selected icons. DO NOT bump screens to 4.24 (build failure) or 4.25 (RN 0.82 required).

### 4. SwiftUIIntrospect — New Transitive Dep
`SwiftUIIntrospect ~> 1.0` is pulled in as a pod dep of react-native-bottom-tabs. It is NOT in the current Podfile.lock. The next pod install will fetch and compile it — adds build time but no failure.

### 5. PNG Icon Tinting
Default `tabBarIconRenderingMode: 'template'` on iOS = PNG used as alpha-mask, tinted with `tabBarActiveTintColor`. Works fine for monochrome PNGs.
- **iOS 26 BUG #439**: `tabBarInactiveTintColor` applies to labels only, NOT icon color on iOS 26+. Open as of June 2026.
- Use `experimental_bakedTintColors` prop (added v1.3.0) for iOS 26 color handling.

### 6. Content Under the Tab Bar (Content Insets)
- Content DOES render underneath the native tab bar. This is UITabBarController's default.
- `useBottomTabBarHeight()` from `@react-navigation/bottom-tabs` returns **0 or throws** for native bottom tabs — the native height is not exposed to JS (issue #3627, open).
- **Fix**: Use `useSafeAreaInsets().bottom` from `react-native-safe-area-context` — iOS automatically includes the tab bar height in the bottom inset.

### 7. tabBarHidden
- `tabBarItemHidden` (per-screen) hides individual tabs from the bar.
- To hide the ENTIRE bar at runtime, use the `tabBar` prop with a custom renderer or null.
- iPad + iPadOS 26+: Bug #463 where extra toolbar appears even when hidden (iPhone is unaffected).

### 8. New Architecture / SDK 54 Known Issues
- **Issue #466**: Slow tab switching when leaving a tab that contains a nested native-stack navigator.
- **Issue #12755**: Blank screen with `animation` prop + `detachInactiveScreens: true` (use with caution).
- **Issue #12963**: Content becomes blank after navigating 2-3 levels deep and switching tabs (Android and iOS).
- **Issue #505**: KeyboardAvoidingView content renders under native tab bar on iOS 26 (Liquid Glass).
- **Issue #433**: Tab bar forced to light mode on iOS 26 with "Reduce Transparency" accessibility setting.

### 9. Android Material3 Theme (Config Plugin Skipped)
Since prebuild is skipped (bare workflow), `styles.xml` won't be auto-updated. For Android Material3 pill indicator, manually set `AppTheme` parent to `Theme.Material3.DayNight.NoActionBar` in `android/app/src/main/res/values/styles.xml`. Without this, the bottom nav bar renders without the pill indicator (visual degradation, not crash).

### 10. iOS 26 Liquid Glass Constraints
On iOS 26+: `tabBarStyle.backgroundColor` is silently ignored (OS controls Liquid Glass). `tabBarBlurEffect` ignored. `tabBarInactiveTintColor` broken for icons (#439). Bar background not overridable by any prop.

---

Library: `react-native-bottom-tabs` + `@bottom-tabs/react-navigation`  
Docs: https://oss.callstack.com/react-native-bottom-tabs/  
GitHub: https://github.com/callstack/react-native-bottom-tabs  
DeepWiki: https://deepwiki.com/callstack/react-native-bottom-tabs

Underlying native: SwiftUI `TabView` on iOS/iPadOS/tvOS/visionOS/macOS; Material `BottomNavigationView` on Android.  
New Architecture (Fabric) only since v1.0. Old Arch support removed.  
Web: NOT supported — must fall back to `@react-navigation/bottom-tabs`.

---

## Dual API Surface

**A. Standalone `TabView`** — used without React Navigation.  
Props sit directly on `<TabView>`. Route-level config goes in the `routes` array objects.  
Required props: `navigationState` (index + routes array), `renderScene`, `onIndexChange`.

**B. React Navigation adapter** — `createNativeBottomTabNavigator` from `@bottom-tabs/react-navigation`.  
Navigator-level options sit on `<Tab.Navigator>`. Per-screen options sit in `<Tab.Screen options={}>`.

Many props exist in both; naming sometimes differs (e.g., `tabLabelStyle` standalone vs `tabBarLabelStyle` in React Navigation).

---

## 1. ICONS

### Icon formats accepted
| Format | How to pass | iOS | Android |
|--------|-------------|-----|---------|
| PNG (local) | `require('./icon.png')` | YES | YES |
| SVG (local) | `require('./icon.svg')` — loaded via Coil SVG decoder on Android | YES | YES |
| Remote URL | `{ uri: 'https://...' }` | YES | YES |
| SF Symbol (system icon) | `{ sfSymbol: 'house.fill' }` | YES (OS-native) | NO |
| Material Symbol | `{ type: 'materialSymbol', name: 'home' }` — needs expo-symbols plugin | NO | YES |
| Custom React element | NOT SUPPORTED in any form | NO | NO |

### Active vs inactive icons
- **Standalone TabView**: set `focusedIcon` and `unfocusedIcon` separately on each route object.
- **React Navigation**: `tabBarIcon` receives `{ focused: boolean, color: string }` — return different ImageSource or SF Symbol per state.
- **Android caveat**: BottomNavigationView uses ONE icon for both states; inactive tinting is applied via color only, not a separate drawable.

### tabBarIconRenderingMode (iOS only, React Navigation screen option)
Controls how iOS applies tinting to raster/SVG icons:
- `'template'` (default when tint color set): iOS treats image as a mask; applies tabBarActiveTintColor as tint. Single-color icons only.
- `'original'`: Preserves image's original colors. Tint color ignored. Use for multicolor/gradient icons.
- Android: ignored (always renders original colors).

### Icon size
FIXED by OS. Not settable. iOS: ~25pt; Android: 24dp. No prop controls this.

---

## 2. COLORS

### tabBarActiveTintColor
Both platforms. Color string. Sets active tab's icon tint AND label color.  
Default: iOS = system blue; Android = theme primary color.

### tabBarInactiveTintColor
- Android: fully works on icon AND label.
- iOS 18 and below: works on icon AND label.
- **iOS 26+: BUG (issue #439) — applies to labels only, NOT icons.** The SwiftUI `.tintColor()` modifier overrides the inactive icon color. PR #527 is open. No workaround confirmed yet.
- Default: ~50% blend of text+card theme colors.

### tabBarStyle.backgroundColor
- Android: YES — controllable.
- iOS 18 and below: YES — controllable.
- **iOS 26+ (Liquid Glass): NOT OVERRIDABLE.** OS controls it automatically. Property accepted but silently ignored. Intentional Apple design decision.

### tabBarStyle.shadowColor (iOS 18 and below only)
Sets the separator/shadow line color. iOS 26+: OS-controlled, not overridable.

### tabBarBlurEffect (iOS 18 and below only)
Values: `'none' | 'systemDefault' | 'extraLight' | 'light' | 'dark' | 'regular' | 'prominent' | 'systemUltraThinMaterial' | 'systemThinMaterial' | 'systemMaterial' | 'systemThickMaterial' | 'systemChromeMaterial'`  
iOS 26+: Liquid Glass replaces this; prop is ignored. Android: NOT supported.

### translucent (TabView standalone, iOS only)
Boolean. Makes bar semi-transparent (blurs content underneath). Default: true (system default on iOS).

### activeIndicatorColor / tabBarActiveIndicatorColor (Android only)
Colored pill behind active tab. Color string. Default: system accent.

### tabBarActiveIndicatorEnabled (Android only)
Boolean. Shows/hides the active indicator pill entirely. Default: true.

### tabBarRippleColor (Android only)
Color of ripple effect on tap. Color string.

### barTintColor (TabView standalone, Android)
Bar background color alias on Android.

---

## 3. LABELS / TEXT

### labeled (TabView standalone) / tabBarLabelVisibilityMode (React Navigation, Android)
- **labeled** (both platforms): boolean. `false` = icon-only, no labels. Default: `true`.
- **tabBarLabelVisibilityMode** (Android only, React Navigation navigator option): `'auto' | 'selected' | 'labeled' | 'unlabeled'`. Mirrors Android's `LabelVisibilityMode`. `'unlabeled'` = icon-only.

### tabLabelStyle (TabView) / tabBarLabelStyle (React Navigation)
Style object for tab labels. Supported: `fontFamily`, `fontSize`, `fontWeight`, `fontStyle`.
- Both platforms.
- Font must be system-available or loaded via expo-font.
- Font SIZE is configurable (unlike icon size).
- Applies globally to all tabs' labels (not per-tab individually).

### tabBarLabel (React Navigation, per screen option)
String. Overrides `title` for the tab label. Default: falls back to `title`.

### Long label behavior
OS-truncated at fixed width. No wrapping possible. Not configurable.

### Label position
- iOS: FIXED below icon. Cannot place label beside icon. OS-locked.
- Android: Below by default; compact inline layout (icon + label side-by-side) is an OS-level behavior, not directly controllable via a prop.

---

## 4. BAR SHAPE / SIZE / POSITION

### Bar width
FIXED — full screen width always. No floating/narrower bar. UITabBarController and BottomNavigationView span full width by OS contract.

### Bar height
OS-controlled. Not settable via props. Approximately 49pt on iOS, 56dp on Android.  
Access current height via `useBottomTabBarHeight()` hook from the library.

### Floating / rounded corners
NOT SUPPORTED. Bar is pinned flush to the bottom. No border-radius, no margins, no floating pill via props. If you need this: use JS `@react-navigation/bottom-tabs` with a custom `tabBar` prop.

### scrollEdgeAppearance (iOS only, TabView standalone)
`'default' | 'opaque' | 'transparent'`. Controls bar appearance when scroll view's edge is at the bottom.

### sidebarAdaptable (iOS 18+, TabView standalone)
Boolean. On iPad/macOS/tvOS, converts tab bar to a sidebar panel.

### tabBarControllerMode (iOS 18+, React Navigation navigator option)
`'auto' | 'tabBar' | 'tabSidebar'`. Forces sidebar vs tab bar mode on iPad. Default: `'auto'`.

### tabBarMinimizeBehavior / minimizeBehavior (iOS 26+ ONLY)
`'automatic' | 'onScrollDown' | 'onScrollUp' | 'never'`  
Tab bar collapses to a compact floating pill during scroll. Requires react-native-screens 4.25+.  
IMPORTANT: FlashList/LegendList require a method-swizzling patch to make UIKit detect their scroll views. See gist: github.com/pugson/0ea6124c2590984793a8a6afbfcaa1f4

### bottomAccessory / renderBottomAccessoryView (iOS 26+ ONLY)
Function returning a React element rendered as accessory below the tab bar.  
React Navigation: `bottomAccessory({ placement: 'regular' | 'inline' }) => ReactElement`  
`'regular'` = below bar, `'inline'` = inside the minimized pill.

### tabBarSystemItem (iOS only, React Navigation per-screen option)
Pre-built iOS system tab items with native icons + localized titles:  
`'bookmarks' | 'contacts' | 'downloads' | 'favorites' | 'featured' | 'history' | 'more' | 'mostRecent' | 'mostViewed' | 'recents' | 'search' | 'topRated'`  
`'search'` gets special treatment on iOS 26+ (dedicated search tab integration).

### role (iOS 18+, React Navigation per-screen option)
`'search'` — marks a tab as the system search tab.

### ignoresTopSafeArea (TabView standalone)
Boolean. Toggles top safe area handling on the bar. Default: false.

### disablePageAnimations (both platforms)
Boolean. Disables cross-fade transition between tabs on switch. Default: false.

### hapticFeedbackEnabled (both platforms)
Boolean. Adds haptic feedback on tab press. Default: false.

---

## 5. ANIMATION

Tab switch animation: ENTIRELY OS-CONTROLLED. Zero JS-thread involvement.

- iOS: UITabBarController handles cross-dissolve between tab content. iOS 26+ Liquid Glass indicator movement (bubble moves to pressed tab, returns to active tab) is 100% native, runs out-of-process via backboardd/CAAnimation.
- Android: BottomNavigationView handles indicator slide and ripple.

**There is NO control over animation duration, easing curve, or active-indicator motion speed.**  
The only binary: `disablePageAnimations: true` to turn all tab-switch animation off.

See [[research_native_tab_animation_smoothness]] — why native tabs are smooth is precisely why you can't touch the animation.

---

## 6. BADGES

### tabBarBadge (React Navigation per-screen / badge in route object for standalone)
`string | number`. A single space `' '` renders a dot badge (no visible text).  
On React Navigation: `tabBarBadge: true` also renders a dot.

### tabBarBadgeBackgroundColor (Android ONLY, React Navigation)
Color string. Sets badge background. On iOS: OS-controlled (system red).

### tabBarBadgeTextColor (Android ONLY, React Navigation)
Color string. Sets badge text color. On iOS: OS-controlled (white).

### tabBarBadgeStyle (React Navigation)
`{ backgroundColor, color }`. Maps to above two on Android. On iOS, badge color/style is OS-controlled regardless.

### iOS badge
Badge color (red background, white text) is set by UITabBarItem — not overridable via library props.

---

## 7. NUMBER OF TABS

- **Android hard limit: 5 tabs.** BottomNavigationView enforces this at the native level. Passing >5 routes raises a warning; library caps/trims the array. NO "More" tab on Android — you must restructure navigation.
- **iOS**: UITabBarController natively shows a "More" item at >5, but react-native-bottom-tabs behavior at >5 on iOS is not explicitly documented/supported. Design for 4-5 max for cross-platform parity.
- **Both**: route array is capped at 100 on Android with a console warning.

---

## 8. REACT NAVIGATION v7 INTEGRATION

Package: `@bottom-tabs/react-navigation` (version-synced with core)  
Import: `import { createNativeBottomTabNavigator } from '@bottom-tabs/react-navigation'`  
Requirements: RN 0.79+, Expo SDK 53+, react-native-screens 4.25.0+

### Navigator-level options (on `<Tab.Navigator screenOptions={}>` or `<Tab.Navigator>` props)

| Prop | Type | iOS | Android | Default | Notes |
|------|------|-----|---------|---------|-------|
| `backBehavior` | `'firstRoute' \| 'initialRoute' \| 'order' \| 'history' \| 'fullHistory' \| 'none'` | both | both | `'firstRoute'` | |
| `tabBarStyle.backgroundColor` | color string | iOS ≤18 | YES | system | iOS 26+: ignored |
| `tabBarActiveTintColor` | color string | YES | YES | blue/primary | |
| `tabBarInactiveTintColor` | color string | YES (icons broken iOS 26+) | YES | muted | issue #439 |
| `tabBarBlurEffect` | string enum | iOS ≤18 | NO | — | iOS 26+: ignored |
| `tabBarLabelStyle` | `{fontFamily, fontSize, fontWeight}` | YES | YES | system | |
| `tabBarLabelVisibilityMode` | `'auto' \| 'selected' \| 'labeled' \| 'unlabeled'` | NO | YES | `'auto'` | Android only |
| `tabBarActiveIndicatorColor` | color string | NO | YES | primary | |
| `tabBarActiveIndicatorEnabled` | boolean | NO | YES | true | |
| `tabBarRippleColor` | color string | NO | YES | — | |
| `tabBar` | render function | both | both | native | disables native bar |
| `sidebarAdaptable` | boolean | iOS 18+ | NO | false | iPad sidebar |
| `tabBarControllerMode` | `'auto' \| 'tabBar' \| 'tabSidebar'` | iOS 18+ | NO | `'auto'` | |
| `tabBarMinimizeBehavior` | `'automatic' \| 'onScrollDown' \| 'onScrollUp' \| 'never'` | iOS 26+ | NO | — | patch needed for FlashList |
| `hapticFeedbackEnabled` | boolean | both | both | false | |
| `disablePageAnimations` | boolean | both | both | false | |
| `labeled` | boolean | both | both | true | icon-only mode |
| `scrollEdgeAppearance` | `'default' \| 'opaque' \| 'transparent'` | YES | NO | `'default'` | |
| `translucent` | boolean | YES | NO | true (system) | |
| `ignoresTopSafeArea` | boolean | YES | — | false | |

### Per-screen options (on `<Tab.Screen options={}>`)

| Prop | Type | iOS | Android | Default | Notes |
|------|------|-----|---------|---------|-------|
| `title` | string | both | both | screen name | fallback for label |
| `tabBarLabel` | string | both | both | title | |
| `tabBarIcon` | `({ focused, color }) => ImageSource` | both | both | — | required for icons |
| `tabBarIconRenderingMode` | `'original' \| 'template'` | YES | NO | `'template'` | |
| `tabBarBadge` | `string \| number` | both | both | — | `' '` = dot |
| `tabBarBadgeBackgroundColor` | color string | NO | YES | red | |
| `tabBarBadgeTextColor` | color string | NO | YES | white | |
| `tabBarItemHidden` | boolean | both | both | false | hides tab |
| `tabBarActiveTintColor` | color string | both | both | — | per-tab override |
| `tabBarButtonTestID` | string | both | both | — | |
| `tabBarSystemItem` | string enum | YES | NO | — | iOS system items |
| `role` | `'search'` | iOS 18+ | NO | — | |
| `lazy` | boolean | both | both | true | defer render |
| `freezeOnBlur` | boolean | both | both | false | suspend renders |
| `sceneStyle` | `StyleProp<ViewStyle>` | both | both | — | scene wrapper style |
| `preventsDefault` | boolean | both | both | false | block tab switch |
| `tabBarSelectionEnabled` | boolean | both | both | true | |
| `popToTopOnBlur` | boolean | both | both | false | |
| `bottomAccessory` | `({ placement }) => Element` | iOS 26+ | NO | — | |

---

## EXPO SETUP

- NOT supported in Expo Go — requires a dev build or production build.
- app.json: `"plugins": ["react-native-bottom-tabs"]`
- For Expo Router: wrap with `withLayoutContext` from Expo Router.
- Android: change `styles.xml` parent to `Theme.Material3.DayNight.NoActionBar` for pill indicator.
- Material Symbols on Android: add `expo-symbols` plugin separately for font injection.
- Compatible with Expo SDK 54 (project's current SDK). Requires New Architecture.

---

## iOS 26 Liquid Glass — Known Open Issues (June 2026)

- #439: tabBarInactiveTintColor doesn't apply to icons, only labels. PR #527 open.
- #429: Active tint color not adapting to dark/light content on scroll.
- #505: Bar renders on top of KeyboardAvoidingView content.
- #433: Bar forced to light mode when "Reduce Transparency" is enabled.
- minimizeBehavior + FlashList/LegendList: requires method-swizzling patch (not merged into lib).

---

## EDITABLE vs OS-FIXED SUMMARY

**Editable:**
Active/inactive tint color; bar background (Android + iOS ≤18); blur effect type (iOS ≤18); label visibility; label font (family, size, weight); badge text + badge colors (Android only); icon format (PNG/SVG/SF Symbol/Material Symbol); icon rendering mode (iOS); separate focused/unfocused icons; sidebar mode (iOS 18+); minimize-on-scroll (iOS 26+); haptic feedback; disable page animations; accessory view below bar (iOS 26+).

**OS-FIXED / NOT CONFIGURABLE:**
Icon size (~25pt iOS / 24dp Android); bar height (~49pt iOS / 56dp Android); bar width (always full screen); rounded corners on bar; floating bar position; tab switch animation speed/curve/easing (100% OS); active indicator motion on Android (OS); Liquid Glass indicator motion on iOS 26 (OS); bar background on iOS 26+ (OS Liquid Glass auto-adapts); badge colors on iOS (system red/white); inactive icon tint on iOS 26+ (BUG); label position (always below icon on iOS).

## Verdict for custom designs

If the design requires: floating pill shape, custom bar height, custom background on iOS 26+, custom animation, arbitrary React icons, or a colored bar that doesn't use the OS Liquid Glass — use JS `@react-navigation/bottom-tabs` with a `tabBar` prop for a fully custom renderer instead. This library is the right choice only when you want native OS appearance.
