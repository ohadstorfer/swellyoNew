---
name: sync-native
description: Analyze a native screen and all its inner components/libraries, compare web vs native behavior and UI, identify differences, and directly implement fixes to make native visually indistinguishable from web
user_invocable: true
arguments: "[screen_name] - Optional: specific screen file name, like WelcomeScreen. If omitted, lists all screens and asks which to process."
---

# Sync Native Screen to Match Web Design

You are analyzing a React Native Expo screen and ALL of its inner components, views, and libraries. You must compare how each part looks and behaves on web vs native, identify all UI and behavior differences, and directly implement the necessary fixes to make the native version visually indistinguishable from the web version.

## Context about this project
- React Native Expo app with web support via `react-native-web`
- Screens are in `src/screens/`, components in `src/components/`
- Styling uses `StyleSheet.create()` with theme from `src/styles/theme.ts`
  - Key tokens: `colors` (brandTeal, backgroundGray, textPrimary, etc.), `spacing` (xs:4, sm:8, md:16, lg:24, xl:32, xxl:40), `typography`, `borderRadius`, `shadows`
- Platform-specific code uses `Platform.OS` checks
- Some components have `.native.tsx` / `.web.tsx` variants (Metro auto-resolution)
- Responsive utilities in `src/utils/responsive.ts` — hooks: `useIsMobile`, `useIsDesktopWeb`, `useScreenDimensions`; breakpoints: xs:320, sm:375, md:414, lg:768, xl:1024
- Key libraries: expo-linear-gradient, react-native-paper, react-native-reanimated, react-native-svg, react-native-vector-icons
- **Styling rule**: All styles MUST use `StyleSheet.create()` with tokens from `src/styles/theme.ts`. Do NOT introduce inline magic numbers.

## Input
The argument is the screen name. If not provided, list screens from `src/screens/` and ask which to process.

## Process

### Phase 1: Audit (Screen + All Inner Components + Libraries)

1. **Read the screen file** completely (`src/screens/{ScreenName}.tsx`)
2. **Identify every imported component** from `src/components/` and list them
3. **Read each imported component** file completely
4. **Check for platform-specific variants**: Use a single Glob `src/components/{ComponentA,ComponentB,ComponentC}*.tsx` to check all at once
5. **Scan for Platform.OS checks** — only note the ones that create visual or functional differences between web and native. Skip harmless ones like `cursor: 'pointer'`.
6. **Only read `theme.ts` or `responsive.ts` if you need to look up a specific token** — the key values are listed in the Context section above.
7. **For every component, view, and library used**:
   - Analyze how it renders and behaves on web
   - Analyze how it renders and behaves on native
   - Note ANY UI or behavioral differences (layout, styling, interaction, rendering)

### Phase 2: Find and Fix Discrepancies

Scan the actual code and only check items from the reference list below that are **relevant to what you see**. Don't check for SVGs if there are none. Don't check Google Sign-In if there's no auth. Focus on what's actually in the code.

**Priority order:**
1. **Layout & structure** (broken layouts, missing elements, wrong positioning)
2. **Interactions** (buttons/handlers that don't work on native)
3. **Typography & spacing** (wrong fonts, sizes, spacing)
4. **Visual polish** (shadows, gradients, animations, hover states)

For each issue found, apply the fix immediately.

#### Rules:
- Do NOT change web behavior — only bring native up to match web
- **Minimize diff size** — prefer small, targeted changes over rewrites
- **Prefer cross-platform solutions first** — only add `Platform.OS` checks when no single expression works on both platforms

- **Functionality Safety (CRITICAL)**:
  - Do NOT break existing logic, state, or handlers
  - After each change, verify:
    - All `onPress` / handlers are still connected
    - No web-only APIs are used (`window`, `document`, `localStorage`)
    - Navigation still works correctly
    - No props or state variables were removed or disconnected

- **Reuse Existing Implementations First**:
  - If a working implementation exists elsewhere (e.g., another screen), reuse or adapt it
  - Do NOT recreate logic or UI from scratch if it already exists in the codebase

- **Library Alignment**:
  - If a library behaves differently between web and native:
    - Prefer using a cross-platform-compatible approach
    - If needed, override or adapt the native implementation to match web behavior
    - Do NOT remove a library unless a safe replacement exists

- **Shared components**:
  - Before modifying any component in `src/components/`, grep for all files that import it
  - Ensure compatibility with all usages
  - If a change may break other screens, create a safe variant or conditional logic instead of modifying the base behavior

- Do NOT refactor unrelated code or restructure components
- Do NOT rewrite files unless absolutely necessary

- After each fix:
  - Ensure the file compiles (no TypeScript or import errors)
  - Ensure JSX structure remains valid

- Do NOT proceed to lower priority fixes if higher priority issues are still broken

#### Reference Checklist (check only what's relevant to the screen)

**Dynamic Layout Calculations (CRITICAL — check these FIRST):**
- [ ] **SafeAreaView + Dimensions mismatch** — If the screen uses `SafeAreaView`, any height calculation based on `Dimensions.get('window').height` or `useScreenDimensions().height` will be WRONG on native. `SafeAreaView` consumes ~90px of insets (status bar + home indicator) but `Dimensions` returns the FULL window height. On web, `window.innerHeight` is the actual viewport so there's no mismatch. **Fix**: subtract ~90px from `screenHeight` on native in any dynamic height calculation.
- [ ] **Any function that computes heights/widths/positions dynamically** — trace through the logic and verify it produces correct values on BOTH platforms. These often break on native due to SafeAreaView insets or missing platform branches.
- [ ] **Content overflowing flex containers via transforms** — When children use `translateY`, `scale`, or negative margins that push them outside their flex parent's bounds: (1) On native, later siblings paint ON TOP of overflow. **Fix**: add `zIndex: 1` to the overflowing container. (2) `overflow: 'hidden'` clips the overflow — on native, change to `overflow: Platform.OS === 'web' ? 'hidden' : 'visible'` if overflow should be visible.
- [ ] **ScrollView/FlatList vertical clipping** — Native ScrollView/FlatList clip content to bounds by default. If children use transforms extending beyond, add `style: { overflow: 'visible' }` on native.

**Layout & Styling:**
- [ ] `overflow: 'hidden'` / `overflow: 'scroll'` — check interaction with transforms and flex siblings
- [ ] `position: 'fixed'` — not supported on native, use `position: 'absolute'`
- [ ] CSS `vh`/`vw` units — use `Dimensions` or `useScreenDimensions()`
- [ ] `boxShadow` — use `elevation` (Android) + `shadowColor/Offset/Opacity/Radius` (iOS)
- [ ] `hover` states — web-only, need `Pressable` with `onPressIn`/`onPressOut` for native
- [ ] `transition` / CSS animations — use `react-native-reanimated` or `Animated` API
- [ ] `backdropFilter` — not supported on native, use `expo-blur`
- [ ] `border` shorthand — native requires `borderWidth`, `borderColor`, `borderStyle` separately
- [ ] **Percentage `height` without definite parent** — silently ignored on native if parent lacks explicit height or `flex: 1`
- [ ] `zIndex` — works differently on Android (requires `elevation`). Check if needed for overflow stacking.

**Typography & Text Rendering:**
- [ ] Font family — verify custom fonts load on native
- [ ] Font weight — some weights need explicit font files on native
- [ ] `lineHeight` — must be a number on native (not a string)
- [ ] **Text style inheritance** — On web, text styles inherit from parent `<View>`. On native, they do NOT — only from parent `<Text>`. **Fix**: move text styles onto the `<Text>` component itself.
- [ ] **View nested inside Text** — crashes on native, works on web. Restructure the component tree.

**Images & Media:**
- [ ] Image sources — relative URLs won't resolve on native; need full URLs or `require()`
- [ ] Image `resizeMode` — verify it matches CSS `object-fit` behavior
- [ ] **Android Image `borderRadius`** — needs `overflow: 'hidden'` on Android to clip

**Animations:**
- [ ] **`useNativeDriver` limitations** — On native, `useNativeDriver: true` ONLY supports `transform` and `opacity`. Other properties CRASH. On web, it's a no-op. **Fix**: use `useNativeDriver: false` or `react-native-reanimated`.

**Interactions & Navigation:**
- [ ] `onClick` vs `onPress` — ensure RN-compatible handlers
- [ ] Scroll behavior — verify snap points work on native
- [ ] Keyboard handling — `KeyboardAvoidingView` needed on native
- [ ] `window.location`/`window.open` — use `Linking.openURL` on native
- [ ] `window.confirm`/`window.alert` — use `Alert.alert()` on native
- [ ] `localStorage` — use AsyncStorage on native
- [ ] `navigator.clipboard` — use `expo-clipboard` on native
- [ ] `<input type="file">` — use `expo-image-picker` on native

### Phase 3: Summary

After completing all fixes, output a brief summary listing each file modified and what was changed (1 line per fix). Flag any remaining issues that need manual device testing.

## Important Notes

- **Always read before editing** — understand the full context of each file
- **Use sub-agents** to parallelize reading multiple component files when needed
- **Preserve web behavior** — never break the web version while fixing native
- **Be thorough with components** — trace the full import tree, a component may import other components