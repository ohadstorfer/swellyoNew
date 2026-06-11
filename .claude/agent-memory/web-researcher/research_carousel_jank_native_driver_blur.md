---
name: carousel-jank-native-driver-blur
description: RN 0.81 horizontal scroll carousel jank — JS-thread scrollX.setValue vs Animated.event+useNativeDriver, and live BlurView (UIVisualEffectView) inside animated/transformed cards
metadata:
  type: reference
---

## Topic
Diagnosing scroll jank in a React Native (0.81, Expo 54, Hermes) horizontal FlatList carousel that:
1. Drives scrollX via onScroll + setValue (no useNativeDriver)
2. Per-item scale/opacity/rotate/translateX/translateY are scrollX.interpolate(...)
3. Each card contains a live expo-blur BlurView (intensity=20, tint="dark")

## Hypothesis 1 — JS-thread scrollX.setValue: CONFIRMED real, well-documented

**The exact mechanism:**
Without useNativeDriver, the RN Animated API runs on a requestAnimationFrame loop on the JS thread:
- JS thread: calculate new value → JS thread: pass via setNativeProps → JS-to-Native bridge → UIView updated
This bridge round-trip happens on EVERY FRAME. With the JS driver, "if [the JS thread] is blocked the animation will skip frames" (RN 2017 blog).

The "frame behind" problem: when tracking scroll position via JS onScroll+setValue, there is an inherent async delay. The scroll event fires on native, crosses the bridge to JS, JS calls setValue, JS calls setNativeProps, bridge back to native. All of this must complete within 16ms. Any JS work (React renders, timers) delays the chain and produces dropped frames or visible "one frame behind" lag.

**With useNativeDriver + Animated.event:**
The entire animation graph is serialized to native once before scroll starts. Native CADisplayLink drives value updates entirely on the UI thread. No JS involvement per frame. "Once the animation has started, the JS thread can be blocked and the animation will still run smoothly." (RN official blog).

**scrollEventThrottle:**
When using useNativeDriver + Animated.event, set scrollEventThrottle={1} not {16}. The 2017 blog explicitly recommends "1 here to make sure no events are ever missed." With JS driver, {16} is fine (one event per frame budget); with native driver, {1} costs nothing on the UI thread and ensures the native value stays in sync.

**Supported properties with useNativeDriver on RN 0.81 / Hermes / Fabric:**
All of these work: transform.scale, transform.rotate (including string-form like '45deg'), transform.translateX, transform.translateY, opacity. Docs: "you can only animate non-layout properties: things like transform and opacity will work, but Flexbox and position properties will not." rotate is a transform subproperty, fully supported.

**Hermes/Fabric caveat:**
RN issue #44514 (0.74.1 new arch) reports that useNativeDriver=true caused choppiness on new arch, opposite of old arch. This was labeled "not planned" and closed without resolution — the behavior may be specific to that version's new arch enablement. RN 0.81 is the stable new-arch release; Reanimated docs note "performance regressions of animations" after enabling New Architecture resolved in 0.80+ with feature flags. The current community consensus is: use Reanimated v3 worklets for scroll-driven animations in new arch, not legacy Animated.

**Listener option:**
`Animated.event([...], { useNativeDriver: true, listener: myJsCallback })` does NOT defeat the native driver. The native value update still happens on the UI thread. The JS listener callback fires separately on the JS thread and can incur JS overhead, but the visual animation remains native. "No, using a listener doesn't automatically make your animation non-native."

## Hypothesis 2 — Live BlurView inside animated card: CONFIRMED real, partially documented

**The iOS mechanism (UIVisualEffectView = CABackdropLayer):**
expo-blur uses UIVisualEffectView on iOS. Under the hood this is a CABackdropLayer that:
1. Captures the content behind it in the window compositor (windowserver process, not app process)
2. Downscales the captured content
3. Applies horizontal + vertical Gaussian blur passes
4. Upscales + tints and composites

This involves multiple GPU render passes: the WWDC 2014 session measured 18.15ms for full-screen extra-light blur on iPad 3rd gen — already exceeding a 16.67ms frame budget at 60fps, on that hardware. "The filter cost is actually very expensive... Keep the bounds of the view as small as possible."

**What happens when the parent view transforms each frame:**
When a parent CALayer is scaled/rotated/translated via animation, the CABackdropLayer must re-sample the underlying content on each frame to maintain the correct blur of whatever is behind the card at its new position/size. The backdrop sampling is not a cached static texture — it captures the actual compositor content behind the view at render time. This means every scroll frame triggers: position update → backdrop re-capture → multi-pass blur → composite. With 2 blur views visible simultaneously, this doubles the cost.

Apple's own warning: "UIVisualEffectView objects need to be combined as part of the content they are layered on top of in order to look correct." Setting alpha < 1 on any superview "causes many effects to look incorrect or not show up at all" — the system cannot do a simple offscreen-pass optimization.

**expo-blur official docs on performance:**
No explicit "avoid animating transforms on parent" warning in the Expo docs. The docs state:
- "You can animate this property [intensity] using react-native-reanimated"
- Known issue: "blur effect does not update when BlurView is rendered before dynamic content is rendered using, for example, FlatList"
- `experimentalBlurMethod` is Android-only. No iOS equivalent.
- On Android SDK < 31, uses "much less efficient RenderScript API" — but this is iOS-specific research

**Community evidence:**
- react-native-blur issue #46: "FPS drops... even in small lists (e.g. 6 elements)" with BlurView in scrollable lists. Using `shouldRasterizeIOS` did not help.
- expo/expo issue #23504: BlurView with intensity > 0 breaks NativeStackNavigator animations and ScrollView.overScrollMode on Android — demonstrates how BlurView interacts destructively with animated/transition contexts.
- The noise Image overlay stacked on top of BlurView adds another compositing layer per frame.

**What the "scale" property on CABackdropLayer controls:**
The CABackdropLayer `scale` property controls "the sampling size of the underlying contents." Setting it to 2.0 causes "notably slow rendering." This is the internal knob behind blur quality vs performance, inaccessible from RN.

## Ranking: Which is the dominant cause?

**Hypothesis 1 (JS driver) is likely the dominant cause with easier fix and more certain impact.**
Reasoning:
- It runs on EVERY FRAME for EVERY VISIBLE ITEM's transform. With 3 visible items × 5 transform properties = 15 interpolation evaluations per frame, all crossing the bridge.
- The fix is a one-line change (useNativeDriver: true + Animated.event syntax) with zero visual change.
- It is 100% within RN's control and has a canonical, tested solution.

**Hypothesis 2 (BlurView) is likely a compounding cause, not the sole culprit.**
Reasoning:
- UIVisualEffectView does incur per-frame GPU cost when the backdrop content changes, and a card being scaled/rotated constantly changes what is "behind" the view from the compositor's perspective.
- But iOS hardware GPU handles this relatively well on modern devices (iPhone 12+) compared to older hardware.
- The risk is: the COMBINATION of both (JS-thread blocked + GPU-heavy blur) is what pushes you over the frame budget.
- If you fix H1 and still see jank, H2 is the remaining culprit.

## Third common cause: non-memoized renderItem

Not applicable here if getItemLayout is set. But: if `renderItem` is defined inline (not wrapped in useCallback), the function reference changes every parent render, causing FlatList to re-render all items. With scale/opacity interpolations inside each item, this triggers expensive re-computation. Wrap renderItem in useCallback and wrap the item component in React.memo.

Shadow rendering: iOS `shadowColor`/`shadowRadius` without `shadowPath` set triggers offscreen render passes per item during scroll. Relevant if cards have shadows.

## Canonical fix pattern

```
// 1. Replace scrollX.setValue in onScroll with:
onScroll={Animated.event(
  [{ nativeEvent: { contentOffset: { x: scrollX } } }],
  { useNativeDriver: true }
)}
scrollEventThrottle={1}  // not 16

// 2. If you also need a JS callback (e.g. for active index tracking):
// Add it as the listener option — does NOT defeat native driver:
onScroll={Animated.event(
  [{ nativeEvent: { contentOffset: { x: scrollX } } }],
  { useNativeDriver: true, listener: (e) => { setActiveIndex(...) } }
)}

// 3. For BlurView mitigation during scroll:
// Option A: Replace live BlurView with semi-transparent dark overlay while scrolling
// (set a state flag on scroll start/end, swap BlurView for <View style={{backgroundColor: 'rgba(0,0,0,0.5)'}} />)
// Option B: Static pre-blurred image as card background (baked blur, not live)
// Option C: Reduce to 1 BlurView (center card only), no blur on peeking neighbors
```

## Sources
- https://reactnative.dev/blog/2017/02/14/using-native-driver-for-animated (canonical bridge/UI thread explanation)
- https://reactnative.dev/docs/animations (supported properties, Animated.event + listener)
- https://github.com/facebook/react-native/issues/44514 (new arch useNativeDriver choppiness, closed without fix)
- https://asciiwwdc.com/2014/sessions/419 (WWDC 2014 UIVisualEffectView GPU pass cost)
- https://aditya.vaidyam.me/blog/2018/02/17/ (CABackdropLayer mechanics, scale property)
- https://github.com/Kureev/react-native-blur/issues/46 (BlurView fps drops in lists, shouldRasterizeIOS ineffective)
- https://github.com/expo/expo/issues/23504 (BlurView breaks animated transitions)
- https://blog.flaviocaetano.com/post/using-native-and-non-native-animations-together/ (listener option does not defeat native driver)
- https://docs.expo.dev/versions/latest/sdk/blur-view/ (official expo-blur docs)
- https://developer.apple.com/documentation/uikit/uivisualeffectview (alpha < 1 warning)
