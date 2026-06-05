---
name: keyboard-aware-scroll-view-form
description: KeyboardAwareScrollView from react-native-keyboard-controller — props, failure modes, floating footer pattern, Reanimated animation conflicts, imperative API, and comparison with alternatives (2025/2026)
metadata:
  type: reference
---

## Recommended library: react-native-keyboard-controller (RNKC)

For Expo SDK 54 + RN 0.81 + new arch, RNKC `KeyboardAwareScrollView` is the correct choice. `KeyboardAvoidingView` (stock RN) is broken with edgeToEdge on Android 15+. The old `react-native-keyboard-aware-scroll-view` (APSL) has no new-arch support and is abandoned.

## All props on KeyboardAwareScrollView

| Prop | Default | What it does |
|------|---------|--------------|
| `bottomOffset` | `0` | Space (px) between keyboard top and focused input's cursor. The primary scroll tuning knob. |
| `extraKeyboardSpace` | `0` | Adjusts perceived keyboard height. **Negative** when KASV doesn't fill full screen (space below it). **Positive** when there are sticky elements above the keyboard you want to account for. |
| `enabled` | `true` | Toggle auto-scroll on/off. |
| `disableScrollOnKeyboardHide` | `false` | Prevents scroll-back-to-original when keyboard closes. Useful in multi-step forms to hold position. |
| `mode` | `"insets"` | `"insets"`: contentInset (iOS) + ClippingScrollView (Android) — no layout reflows, best perf. `"layout"`: appends spacer view — triggers flex re-distribution, needed for pinned-bottom submit buttons. |
| `ScrollViewComponent` | `ScrollView` | Swap in RNGH's ScrollView if you need gesture-handler scroll: `ScrollViewComponent={GHScrollView}` |

## mode="insets" vs mode="layout"

- **mode="insets"** (default): expands scrollable area without touching layout. Correct for most forms where inputs are in a list.
- **mode="layout"**: adds a spacer child, causes flex to re-distribute. Use ONLY when you have `flex: 1` + `justifyContent: "space-between"` and you want a submit button to visually pin to bottom of remaining space as keyboard opens.
- **Absolute-positioned floating footers**: these exist outside the ScrollView layout, so `mode` doesn't matter for the footer itself — the KASV only controls what's inside it.

## bottomOffset: what value to use

- Official Expo example uses `bottomOffset={62}`.
- Community benchmark: `50–80` works for standard forms.
- For screens with a floating footer (absolute, translates up with keyboard): set `bottomOffset` = footer height + desired gap (e.g., `bottomOffset={footerHeight + 20}`). This ensures the scroll stops with the input above both the keyboard AND the footer's visual position.
- **Critical gotcha**: `bottomOffset` measures from the keyboard's top edge to the input's cursor position, NOT the input's bottom edge. For tall inputs (multiline), you may need to add `inputHeight` to bottomOffset to guarantee the full input is visible.

## extraKeyboardSpace: when to use

- If your KASV takes up `flex: 1` to fill screen = you probably need `extraKeyboardSpace={0}` (default is fine).
- If your KASV is inside a container that has bottom padding/tabs/safe-area = use a **negative** value equal to the gap below KASV: `extraKeyboardSpace={-bottomInset}`.
- If you have a `KeyboardStickyView` footer ABOVE the keyboard that adds height = use a **positive** value to tell KASV to scroll further: `extraKeyboardSpace={footerHeight}`.

## Common reasons auto-scroll fails

1. **KeyboardProvider missing or mounted below app root** — KASV's internal worklet can't attach. Symptom: "Can not attach worklet handlers for react-native-keyboard-controller because view tag can not be resolved" in console.
2. **TextInput is not a direct or indirect child of KASV** — KASV only tracks inputs that are descendants of its own scroll container.
3. **mode="insets" + flex-based layout** — If the parent flex layout pushes an input out of scrollable range and you haven't set enough bottomOffset. Fix: increase bottomOffset or switch to mode="layout".
4. **Nested ScrollViews** — inner ScrollView intercepts touch/scroll. Use `scrollEnabled={false}` on the inner one, or restructure.
5. **Reanimated Animated.View entering/exiting animation wrapping the KASV or TextInput** — see Reanimated conflict section below.
6. **contentContainerStyle lacks `flexGrow: 1`** — if content is shorter than screen height on first render, KASV may not know where the input is. Add `contentContainerStyle={{ flexGrow: 1 }}`.
7. **Issue #1394 (v1.21.1, March 2026)**: First-focus scroll is inaccurate, corrects on second focus. Not yet fixed as of June 2026. Workaround: call `assureFocusedInputVisible()` on an `onFocus` handler.
8. **Issue #1411 (Expo SDK 55 / RN 0.83, March 2026)**: Full auto-scroll breakage on Fabric — different from SDK 54. This project (SDK 54 / RN 0.81) is NOT affected by this specific bug.

## Reanimated Animated.View entering/exiting animation conflicts

- **Root problem**: Reanimated layout animations (`entering`, `exiting`, `layout` prop) conflict with `LayoutAnimation.configureNext()`. The **stock RN `KeyboardAvoidingView`** calls `LayoutAnimation.configureNext()` internally, which stomps on Reanimated's layout animation — the animation fires, then KAV overrides it before it finishes ("Overriding previous layout animation with new one before the first began").
- **RNKC's KeyboardAwareScrollView does NOT use LayoutAnimation** — it uses contentInset (mode="insets") or a spacer (mode="layout"), neither of which conflicts with Reanimated entering/exiting.
- **BUT**: If you wrap KASV itself or its parent in a Reanimated `Animated.View` with `entering`/`exiting`, and that animation fires at the same time the keyboard opens, the layout measurement that KASV uses for scroll target can be stale (measured before the animation settled). The auto-scroll fires against the pre-animation layout and lands at the wrong position.
- **Fix**: Don't wrap KASV or TextInputs in entering/exiting Reanimated views. If you must animate the screen container, animate the KASV's children instead (e.g., each form card individually), or add a `useEffect` delay before calling `assureFocusedInputVisible()` after the entering animation completes.

## Imperative API: assureFocusedInputVisible

Available from RNKC v1.20.0+. Call it when layout changes happen after focus (validation errors appear, conditional content shows, entering animation completes):

```typescript
import {
  KeyboardAwareScrollView,
  KeyboardAwareScrollViewRef,
} from "react-native-keyboard-controller";
import { useRef, useEffect } from "react";

function MyForm({ errors }: { errors: Record<string, string> }) {
  const scrollRef = useRef<KeyboardAwareScrollViewRef>(null);

  // Re-scroll whenever validation errors cause layout shifts
  useEffect(() => {
    scrollRef.current?.assureFocusedInputVisible();
  }, [errors]);

  // Also call on manual focus if first-focus accuracy bug (#1394) hits you
  const handleFocus = () => {
    setTimeout(() => {
      scrollRef.current?.assureFocusedInputVisible();
    }, 100); // small delay lets native layout settle
  };

  return (
    <KeyboardAwareScrollView
      ref={scrollRef}
      bottomOffset={50}
      contentContainerStyle={{ flexGrow: 1 }}
    >
      <TextInput onFocus={handleFocus} />
    </KeyboardAwareScrollView>
  );
}
```

## Floating footer pattern (Back/Next buttons, absolute positioned)

The scroll view cannot "know" about elements outside itself. If your footer is absolute-positioned and translates up with the keyboard (via `KeyboardStickyView` or `useReanimatedKeyboardAnimation`), KASV still calculates scroll relative to the full-screen keyboard height — not the keyboard + footer combined height.

**Correct approach — two complementary techniques:**

**Technique 1: Bump `bottomOffset`**
Set `bottomOffset` = footer height + desired padding. This tells KASV to scroll until the input sits that many pixels above the keyboard top — which is exactly where the footer is:

```typescript
const FOOTER_HEIGHT = 80; // your Back/Next bar height
const BOTTOM_PADDING = 16;

<KeyboardAwareScrollView
  bottomOffset={FOOTER_HEIGHT + BOTTOM_PADDING}
  contentContainerStyle={{ flexGrow: 1, paddingBottom: FOOTER_HEIGHT + BOTTOM_PADDING }}
>
```

`paddingBottom` on contentContainerStyle ensures that when the LAST input is focused, there's enough room below it to scroll it into the `bottomOffset` window.

**Technique 2: Use `KeyboardStickyView` for the footer instead of custom translateY**
Replace a manually-translated footer with RNKC's own `KeyboardStickyView`. It moves pixel-perfectly with the keyboard, no JS timing lag:

```typescript
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function FormWizardStep() {
  const { bottom } = useSafeAreaInsets();
  const FOOTER_HEIGHT = 80;

  return (
    <View style={{ flex: 1 }}>
      <KeyboardAwareScrollView
        bottomOffset={FOOTER_HEIGHT + 16}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: FOOTER_HEIGHT + 16 }}
      >
        {/* all your TextInputs here */}
      </KeyboardAwareScrollView>

      {/* Footer sticks to keyboard top — NOT absolute positioned */}
      <KeyboardStickyView
        offset={{ closed: 0, opened: -bottom }} // compensate safe area already in footer
      >
        <View style={{ height: FOOTER_HEIGHT, flexDirection: "row" }}>
          <BackButton />
          <NextButton />
        </View>
      </KeyboardStickyView>
    </View>
  );
}
```

With this pattern: the footer translates up with the keyboard (KeyboardStickyView), and KASV scrolls the input above the footer (bottomOffset = FOOTER_HEIGHT + padding). Together they guarantee the input is always visible.

## What NOT to combine

- Do NOT nest `KeyboardAwareScrollView` inside `KeyboardAvoidingView` — double adjustment.
- Do NOT use `softwareKeyboardLayoutMode: "resize"` (adjustResize) with edgeToEdge AND KASV — KASV assumes it controls its own keyboard avoidance. adjustResize + edgeToEdge = adjustNothing anyway (per prior research).
- Do NOT put KASV inside a Reanimated `Animated.View` that has `entering` prop active at the same time a TextInput gets focus.

## Library comparison: 2025/2026 verdict

| Library | New Arch | Android edgeToEdge | Active maintenance | Verdict |
|---------|----------|--------------------|--------------------|---------|
| Stock RN `KeyboardAvoidingView` | Yes | Broken (adjustResize+edgeToEdge) | N/A (built-in) | Use only as simple last resort |
| `react-native-keyboard-aware-scroll-view` (APSL) | No | No | Abandoned ~2022 | Do not use |
| RNKC `KeyboardAwareScrollView` | Yes | Works correctly | Active (v1.21.x) | USE THIS |
| RNKC `KeyboardAvoidingView` | Yes | Works correctly | Active | OK for non-scroll screens |

## Version notes for this project

Project is on RNKC v1.18.5 (per prior research). `assureFocusedInputVisible` needs v1.20.0+. If still on 1.18.5, upgrade to at least 1.20.0 before using the ref API. Issue #1394 (first-focus inaccuracy) affects v1.21.x — if upgrading past 1.20, be aware. The SDK 55 total-breakage bug (#1411) does NOT affect this project (SDK 54 / RN 0.81).

## Sources
- https://kirillzyusko.github.io/react-native-keyboard-controller/docs/api/components/keyboard-aware-scroll-view
- https://kirillzyusko.github.io/react-native-keyboard-controller/docs/guides/components-overview
- https://kirillzyusko.github.io/react-native-keyboard-controller/docs/api/components/keyboard-sticky-view
- https://kirillzyusko.github.io/react-native-keyboard-controller/docs/troubleshooting
- https://kirillzyusko.github.io/react-native-keyboard-controller/blog/expo-snacks (v1.20 release notes)
- https://kirillzyusko.github.io/react-native-keyboard-controller/blog/chat-scroll-view (v1.21 release notes)
- https://github.com/kirillzyusko/react-native-keyboard-controller/issues/1394 (first-focus scroll inaccuracy, March 2026)
- https://github.com/kirillzyusko/react-native-keyboard-controller/issues/1411 (SDK 55 / RN 0.83 Fabric breakage, March 2026)
- https://github.com/software-mansion/react-native-reanimated/issues/4815 (Reanimated layout anim + KAV conflict)
- https://docs.expo.dev/versions/latest/sdk/keyboard-controller/
