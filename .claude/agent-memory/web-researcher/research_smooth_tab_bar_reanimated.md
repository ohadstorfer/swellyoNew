---
name: smooth-tab-bar-reanimated
description: Instagram-quality smooth bottom tab bar — React Navigation v7, Reanimated 3, lazy/detach config, UI-thread animation, JS-thread blocking, pill indicator technique, real limits
metadata:
  type: reference
---

# Instagram-Quality Smooth Bottom Tab Bar — RN + Expo + Reanimated 3

## Swellyo context
- Reanimated 3.15.1 (NOT v4 — feature flags unavailable)
- React Navigation v7, Expo SDK 54, RN 0.81, New Architecture ON

---

## 1. React Navigation tab loading config

| Prop | Default | Effect |
|------|---------|--------|
| `lazy` | `true` (bottom-tab-navigator) | First visit mounts screen; subsequent = visibility toggle |
| `lazy={false}` | — | All tabs mount at startup; switching = guaranteed visibility toggle, NO remount |
| `detachInactiveScreens` | `true` | Detaches idle screens from view hierarchy to save memory |
| `freezeOnBlur` | `false` | Stops re-renders on blurred tabs; does NOT stop websockets |

**For maximum tab-switch smoothness**: `lazy={false}` on all tabs ensures switching is purely a display:none/display:block toggle. The cost is higher startup memory. `detachInactiveScreens={true}` can be left on — it detaches the view but keeps JS state alive so switching still feels instant.

**React Navigation v7 addition**: `preloadDistance` prop on tab-view lets you preload adjacent lazy tabs N routes ahead. Default 0.

---

## 2. Reanimated 3 — staying on the UI thread

### What runs 100% on UI thread (immune to JS blocking)
- `useSharedValue` + `useAnimatedStyle` + `withTiming` / `withSpring`
- All math inside `worklet` functions
- Gesture handler callbacks

### What CAN still stutter even with Reanimated
1. **Animating layout props** (width, height, top, left) — triggers layout recalculation every frame. The Reanimated maintainer (tomekzaw) confirmed: "Reanimated needs to re-calculate the layout of the whole tree on each animation frame, so it's a bit slower than animating only non-layout props."
2. **Reading SharedValue from JS thread** (`sv.value` outside worklet) — blocks JS until value fetched from UI thread.
3. **New Architecture regression (SDK 53+/RN 0.81)** — Margelo + Software Mansion confirmed: animating with Fabric causes excessive shadow node cloning (hundreds of nodes per frame, even for untouched ones) and unnecessary layout passes for opacity/transform changes. Margelo fixed Discord's case by 26% jank reduction.
4. **Too many animated components simultaneously** — docs say >100 on low-end Android causes perf degradation.

### The critical fix for Swellyo (New Architecture + RN 0.81)
Feature flags `DISABLE_COMMIT_PAUSING_MECHANISM` and `USE_COMMIT_HOOK_ONLY_FOR_REACT_COMMITS` fix the new arch regressions — BUT they require **Reanimated 4.x**. Swellyo is on 3.15.1. The fixes are not available without upgrading.

---

## 3. Pill indicator — correct animation technique

**Wrong**: Animate `width` — triggers full layout recalculation, NOT compositable, falls back to JS thread in old animated API.

**Correct**: Use `transform: [{ translateX: withTiming(targetX) }]` for position + a fixed-width pill shape. If the pill must resize (like Instagram), also animate width BUT through Reanimated useAnimatedStyle — this moves width animation to UI thread even though it costs a layout pass.

**Best approach for a fixed-tab layout** (equal tab widths):
```
pill position = withTiming(tabIndex * tabWidth)
```
One SharedValue, one useAnimatedStyle, zero JS involvement during animation. The pill position update happens entirely on the UI thread.

**If dynamic widths needed** (variable label lengths): measure onLayout, store widths in array, animate translateX to that position. Still works fine.

---

## 4. Deferred navigation — should you delay navigate()?

The community consensus is: **with Reanimated, you do NOT need to delay navigate()**. The animation runs on the UI thread independent of JS. Even if navigate() causes a heavy JS render, the animation will finish without stutter as long as:
- You animate only transform/opacity (not width/height)
- You're on New Architecture without the Fabric regression bug

The `runOnJS` pattern (fire navigate() inside the withTiming callback) is the only case where navigation waits for animation to finish. This is NOT generally recommended for tabs because:
- It makes switching feel slow to the user
- It's the wrong mental model — the animation should accompany navigation, not gate it

**InteractionManager.runAfterInteractions**: Known bug — callbacks never fire in production/release builds (react-native-screens issue #579). Do not rely on this for tab navigation.

**The actual needed pattern**: Start animation via SharedValue update. Immediately call navigate(). The JS render of the new screen happens on JS thread but does NOT interrupt the UI-thread animation. This is the whole point of Reanimated.

---

## 5. Has anyone achieved Instagram-level smoothness in RN?

### What exists
- `gorhom/react-native-animated-tabbar` — 60FPS with Reanimated, last release June 2021. Stale; Reanimated v5 only.
- `adithyavis/reanimated-tab-view` — newer, Reanimated-based, smooth jump animations without blank flash
- Watermelon Messenger blog series — uses transform-based approach, confirms native-thread smoothness
- Multiple blog implementations using `withTiming` + `translateX` — all confirm they achieve smooth animation

### Honest assessment: Can RN match native?
**For the animation itself (sliding pill)**: YES, with Reanimated 3+ and transform-based animation on New Architecture. The pill movement is visually indistinguishable from native when done correctly.

**For tab screen switching (content beneath the tab bar)**: SOMETIMES — depends on how heavy the screen is. React Native's hard ceiling: JS renders are single-threaded, and when a screen first mounts with a heavy component tree, a JS-thread pause of 50-200ms can happen. During this pause, the Reanimated animation continues smoothly, but the screen content appears white/blank or shows a flicker. This is a fundamental RN limitation.

The Margelo Discord case shows even well-funded production apps on New Architecture face this. The fix for the new-arch-specific regression requires RN 0.85 (SDK 56) or Reanimated 4.2+.

---

## 6. Known gotchas / pitfalls

- **New Architecture performance regression is real and active in SDK 54 / RN 0.81.** Reanimated has open issues from Sep 2025 confirming this. The fix is Reanimated 4.2+ static feature flags, unavailable on v3.15.
- **Width animation via useAnimatedStyle IS on UI thread** but still costs a layout pass — avoid if possible.
- **`detachInactiveScreens=true` + `lazy=false` can conflict**: detach removes view hierarchy but the screen stays JS-mounted. Fast switch after detach may show a brief flash before re-attach. Test on device.
- **`freezeOnBlur` is safe for Realtime/Supabase** — it freezes renders not JS subscriptions. Swellyo can use it safely per prior research.
- **`runAfterInteractions` does NOT reliably fire in production** (known RNScreens bug #579).
- **Reanimated 4 requires New Architecture only** — cannot upgrade to v4 without committing to New Arch fully (Swellyo already on New Arch via SDK 54, so upgrade path is open).

---

## 7. Sources
- https://reactnavigation.org/docs/bottom-tab-navigator/
- https://docs.swmansion.com/react-native-reanimated/docs/guides/performance/
- https://docs.swmansion.com/react-native-reanimated/docs/guides/feature-flags/
- https://github.com/software-mansion/react-native-reanimated/discussions/3211
- https://github.com/software-mansion/react-native-reanimated/issues/8250
- https://blog.margelo.com/margelo-discord-react-native-performance
- https://github.com/react-navigation/react-navigation/issues/10858
- https://github.com/software-mansion/react-native-reanimated/issues/7822
- https://dev.to/baptistearnaud/animated-sliding-tab-bar-in-react-native-58pb
- https://medium.com/@victorvarghese/watermelon-messenger-1-tabbar-transitions-using-react-navigation-reanimated-gesture-handler-728d904da0b8
- https://reactnative.dev/blog/2026/04/07/react-native-0.85
- https://github.com/software-mansion/react-native-reanimated/discussions/8950
