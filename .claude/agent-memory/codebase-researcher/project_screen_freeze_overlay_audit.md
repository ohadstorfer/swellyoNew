---
name: project_screen_freeze_overlay_audit
description: Full-screen overlay/backdrop audit for the intermittent touch-freeze bug (screen unresponsive, native @bottom-tabs bar still works) — 2026-07-17
metadata:
  type: project
---

Investigated 2026-07-17: intermittent freeze where the whole screen stops responding to touches but the tab bar keeps working.

**Why the tab bar still works while the screen freezes**: `src/navigation/RootNavigator.tsx` uses `createNativeBottomTabNavigator` from `@bottom-tabs/react-navigation` — a REAL native tab bar component (UITabBar/BottomNavigationView), not an RN-rendered view. It lives outside the RN JS view hierarchy that an invisible overlay would sit in, so it stays tappable even when a JS-rendered full-screen View is silently swallowing touches over the screen content. This confirms the bug is an invisible-but-mounted **touch-capturing RN view**, not a frozen JS thread (a real JS hang would also kill tab-bar taps).

**Top suspect (HIGH plausibility): `src/components/MessageActionsMenu.tsx` `requestClose()` (lines 185-197)**
```js
const requestClose = (after?: () => void) => {
  if (closingRef.current) return;
  closingRef.current = true;
  Animated.parallel([...]).start(({ finished }) => {
    if (finished) { after?.(); onClose(); }   // <-- gated on `finished`
  });
};
```
- Component itself does `if (!visible) return null` (line 244) — correct unmount pattern in isolation.
- BUT `onClose()` (which is the ONLY thing that sets the parent's `menuVisible` state back to `false`) only fires `if (finished)`. If the exit animation's `.start()` callback ever resolves with `finished: false` (RN semantics: happens when the animation is stopped/superseded before completing), `onClose()` never fires and `visible` stays `true` forever.
- Same is true for Delete/Reply/Copy/Report: `handleDelete` etc. call `requestClose(after)`, and `after()` (which fires `onDelete`/`handleDeleteMessage` in the parent) is ALSO inside the `if (finished)` gate — so on `finished:false` the action is silently dropped too.
- While stuck, the component renders `<Animated.View pointerEvents="box-none" style={{opacity: fade}}>` (root) containing an inner `pointerEvents="box-none"` layer wrapping a `<TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => requestClose()} />` (lines 373-387) — a genuine full-screen tap-catcher. `box-none` doesn't help here since the TouchableOpacity itself is a capturing child.
- Rendered **in-tree, not inside a Modal** (explicit code comment: "so presenting it does not resign the composer's first responder"), so nothing else tears it down for you.
- Used by BOTH `src/screens/DirectMessageScreen.tsx` (line 6293) and `src/screens/DirectGroupChat.tsx` (line 6200) — i.e. every 1:1 and group chat screen in the app, which is high-frequency, high-interaction surface (matches "intermittent, no known trigger").
- No timeout/safety-net fallback anywhere that force-closes the menu if the callback never fires.
- Companion component `src/components/chat/BubbleSpotlightDim.tsx` is properly gated by parent state (`{editDimRect && (menuVisible || editingMessageId) && <BubbleSpotlightDim/>}` in both chat screens) — so if `menuVisible` gets stuck true via the bug above, BOTH the menu's own full-screen catcher AND BubbleSpotlightDim's full-screen `Pressable` (also in-tree, not Modal) stay mounted and capturing.
- Exact trigger not 100% pinned (single-owner Animated.Value with a `closingRef` guard makes a same-component race hard to construct from normal taps), but `finished:false` is a realistic RN outcome from app backgrounding mid-animation, JS-thread hiccups, or any other code path that ever calls `.start()` again on the same `fade`/`scale` values. This is a real code gap worth hardening (unconditional `onClose()` call, or a timeout fallback) regardless of exact repro.

**Second suspect (LOW-MEDIUM): `src/components/ReportAISheet.tsx`**
- Also in-tree (not Modal), `if (!visible) return null` (line 159).
- Safer than MessageActionsMenu: its animation callbacks (`handleClose` line 123-128, `handleConfirmationClose` line 148-157) call `onClose()`/state resets UNCONDITIONALLY (no `finished` check) — so animation interruption self-heals.
- Weaker spot: `handleClose` is not re-entry guarded (no `closingRef` equivalent) and `slideAnim` is driven from 5 different places (mount effect, handleReport, handleClose, panResponder move/release) — a rapid double-tap on the backdrop could double-invoke `Animated.parallel(...).start()`, but since both target the same value harmlessly, this is unlikely to actually strand the component captured (not the same severity as MessageActionsMenu).

**Everything else checked and found SAFE (real native `Modal` fully unmounts on close, so nothing leaks touches to screens beneath):**
- `src/components/BottomSheetShell.tsx` + `src/hooks/useSheetTransition.ts` — the shared bottom-sheet wrapper for basically every sheet in the app. Backdrop `Animated.View` is always `pointerEvents="none"` (line 113-115); the whole thing sits inside a real `<Modal visible={mounted}>`. Worst case if the close-animation callback never fires (`finished` false) is `mounted` stays `true` and the Modal stays open — visibly (not invisible), so it doesn't match this bug's "invisible" symptom, and users would see + report a stuck sheet, not a silent freeze.
- `src/components/TutorialOverlay/TutorialOverlay.tsx` — real `Modal`, `modalMounted` state, self-contained.
- `src/components/SwellyTopicOverlay/SwellyTopicOverlay.tsx` — real `Modal`.
- `src/components/trips/joinRequest/JoinDecisionOverlay.tsx`, `JoinDeclinedOverlay.tsx` — real `Modal`.
- `src/components/AlbumMediaViewer.tsx`, `src/components/MediaReviewModal.tsx` — real `Modal`.
- `src/components/ProfileEditPanel/ProfileEditPanel.tsx` — real `Modal` (line 862); its 6 sub-screens (ProfileEditSurfStyleScreen etc.) use `pointerEvents={visible ? 'auto' : 'none'}` at their root to cross-fade WITHIN the same modal — that pattern is intentional and safe since it's contained inside the outer Modal (unmounts entirely when the panel closes).
- `src/components/notifications/InAppBannerHost.tsx` — outer wrap is `pointerEvents="box-none"` (absoluteFillObject but non-capturing); the actual banner unmounts via `if (!payload) return null`, and even if `hide()`'s fade-out callback is skipped, the banner only occupies a small top strip, not the full screen — doesn't match "whole screen" freeze.
- `src/components/AttachPanel.tsx` — bounded to keyboard-height rect (not full screen) and conditionally rendered by the parent (`{panelOpen && <AttachPanel/>}`); `dismissing` only toggles its own pointerEvents right before removal.
- `src/components/ImagePreviewContent.tsx` / `VideoPreviewContent.tsx` processing overlays are explicitly `pointerEvents="none"` — decorative only, never capture.
- `src/components/ChatTextInput.tsx` recording-lock UI (`isRecording`/`isLocked`) replaces only the composer row, never full-screen.

**Recommended fix for the top suspect**: in `MessageActionsMenu.requestClose`, call `after?.(); onClose();` unconditionally (like ReportAISheet does) instead of gating on `finished`, and/or add a `setTimeout` safety net that force-calls `onClose()` if the animation callback hasn't fired within ~2x the animation duration.
