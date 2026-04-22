---
name: react-native-keyboard-controller Chat Keyboard Sync
description: Official iMessage-style recipe for chat composer + keyboard sync using react-native-keyboard-controller. KeyboardChatScrollView introduced in v1.21, not in v1.18.5 currently installed.
type: reference
---

## Version gap — critical

- Project has v1.18.5. **KeyboardChatScrollView was introduced in v1.21.0 (March 2024).**
- v1.18.5 does NOT have KeyboardChatScrollView or ClippingScrollView.
- To use the official iMessage recipe, upgrade to >= v1.21.6.

## Official iMessage recipe (v1.21+)

The library's own example (`KeyboardChatScrollView/index.tsx`) uses this structure:

```tsx
<SafeAreaView edges={["bottom"]} style={styles.container}>
  <KeyboardGestureArea
    interpolator="ios"
    offset={inputHeight}         // <- composer height
    style={styles.container}
    textInputNativeID="chat-input"
  >
    <FlatList
      inverted
      data={reversedMessages}
      renderScrollComponent={memoList}  // <- passes KeyboardChatScrollView as ScrollView
      renderItem={...}
    />
    <KeyboardStickyView
      offset={stickyViewOffset}  // <- { opened: bottom - MARGIN }
      style={styles.composer}
    >
      <TextInput
        nativeID="chat-input"
        multiline
        onLayout={onInputLayoutChanged}
      />
    </KeyboardStickyView>
  </KeyboardGestureArea>
</SafeAreaView>
```

Where `memoList` is a `VirtualizedListScrollView` wrapping `KeyboardChatScrollView`:

```tsx
const VirtualizedListScrollView = forwardRef((props, ref) => (
  <KeyboardChatScrollView
    ref={ref}
    automaticallyAdjustContentInsets={false}
    contentInsetAdjustmentBehavior="never"
    extraContentPadding={extraContentPadding}
    {...props}
  />
));
```

## Why KeyboardAvoidingView + KeyboardStickyView causes desync

- `KeyboardAvoidingView` adjusts layout (padding/height) via the layout engine — causes frame drops and "double scroll" on interactive dismiss.
- JS-thread `keyboardVisible` state (from `Keyboard.addListener`) fires ~1 frame late, after the UI-thread Reanimated animation has already started. The `paddingBottom` change hits a different frame than the `translateY` from `KeyboardStickyView`, causing a visible gap/jump.
- The library author explicitly says `KeyboardAvoidingView` was "not designed for chat" and lists it as a source of frame drops and double-scroll bugs.

## KeyboardGestureArea positioning

- It MUST wrap BOTH the scroll view AND the KeyboardStickyView composer.
- The `textInputNativeID` prop links the gesture recognizer to the specific TextInput.
- The `offset` prop on KeyboardGestureArea = the composer's height (so drag-to-dismiss calculates the correct drag threshold).
- Wrapping only the list (as in current code) breaks the gesture — the composer doesn't drag with the list.

## Safe area insets for KeyboardStickyView

Use the `offset` prop on `KeyboardStickyView`:
```tsx
const { bottom } = useSafeAreaInsets();
const stickyViewOffset = useMemo(() => ({ opened: bottom - MARGIN }), [bottom]);
// ...
<KeyboardStickyView offset={stickyViewOffset}>
```

This tells the component to translate by `(keyboardHeight - offset.opened)` when open, so the safe area padding doesn't animate separately. Do NOT set paddingBottom dynamically from JS state.

## For v1.18.5 (no KeyboardChatScrollView available)

The pre-v1.21 official chat pattern (still in examples as `ReanimatedChatFlatList`) uses:
```tsx
<KeyboardAvoidingView
  behavior="translate-with-padding"
  keyboardVerticalOffset={headerHeight}
  style={styles.container}
>
  <FlatList inverted ... />
  <TextInput style={styles.textInput} />
</KeyboardAvoidingView>
```
`behavior="translate-with-padding"` is the RNKC-specific behavior (not stock RN) and is described as delivering "the best possible performance." The TextInput lives INSIDE KAV (not in a separate KeyboardStickyView), eliminating the desync entirely.

## iOS bug note (RN 0.81+)

If using `blankSpace` prop on KeyboardChatScrollView, set `applyWorkaroundForContentInsetHitTestBug={true}` — RN 0.81 has a bug where contentInset areas don't respond to touch.

## Sources
- https://kirillzyusko.github.io/react-native-keyboard-controller/docs/next/guides/building-chat-app
- https://kirillzyusko.github.io/react-native-keyboard-controller/docs/api/components/keyboard-chat-scroll-view
- https://kirillzyusko.github.io/react-native-keyboard-controller/blog/chat-scroll-view
- https://github.com/kirillzyusko/react-native-keyboard-controller/blob/main/example/src/screens/Examples/KeyboardChatScrollView/index.tsx
- https://github.com/kirillzyusko/react-native-keyboard-controller/blob/main/example/src/screens/Examples/ReanimatedChatFlatList/index.tsx
