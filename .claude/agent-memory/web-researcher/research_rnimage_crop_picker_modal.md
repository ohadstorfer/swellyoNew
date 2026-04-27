---
name: react-native-image-crop-picker — openCropper on-demand + stacked modal gotchas
description: openCropper called from button inside RN Modal (preview flow), iOS timing issues, lib health, output sizing, free aspect ratio
type: project
---

## Findings

### openCropper is fully on-demand
`openCropper({ path })` is a plain Promise-returning function. It does not need to be called inside a picker callback. Any button `onPress` works. The only contract is: `path` must be a valid local file path (not a blob URL or expo asset URI).

### Stacked-modal gotchas (iOS — real-world reports)
This is the biggest risk in the new UX:

- **Root cause**: iOS enforces a strict UIViewController presentation hierarchy. If a RN `<Modal>` is still mounted/animating when you call `openCropper`, iOS cannot present the native crop VC on top of the modal host VC — it silently fails or freezes.
- **Issue #659**: opening imagePicker from a modal button freezes — modal closes, picker opens and immediately closes, app is unresponsive.
- **Issue #264**: "Attempt to present <UIAlertController> on <RCTModalHostViewController> whose view is not in the window hierarchy"
- **Issue #2127 + Expo issue #34377**: using expo-image-picker then immediately calling openCropper → "continually loading" on real iOS device (simulator works). A 50ms timeout resolved it ~95% of the time; 100ms+ was less reliable for this specific case. The existing 500ms timeout in our code is safe.
- **Known pattern**: close Modal first, wait for dismiss animation, then call openCropper. The 500ms setTimeout our code already uses is the established community workaround.
- **For the NEW flow** (Modal stays open, Edit button calls openCropper): the Modal must NOT animate-dismiss before calling openCropper. But keeping it mounted while presenting a native VC is also problematic on iOS. **This is the core tension.**
  - Safest approach: set Modal to `transparent` + hide visually (opacity 0 or unmount content) before calling openCropper, then re-show it after the Promise resolves. Do NOT use `visible={false}` (triggers full unmount + animation) — just keep the Modal mounted but blank.
  - Alternative: close the Modal, open cropper (500ms delay), then reopen Modal with the cropped result. Two-modal-open flow but avoids stacking.

### Android backstack
- Android is more tolerant. The native crop Activity is pushed as a new Activity; the RN modal is paused in the backstack. When user finishes/cancels crop, they return to the modal. No extra delay needed on Android.
- Do NOT share the iOS setTimeout delay on Android — it only hurts UX.

### Lib health
- Latest: **v0.51.1** (October 21, 2024). Last release 6 months ago.
- New Architecture support added in v0.50.0 (May 2024) — compatible with RN 0.81.
- Requires a config plugin for Expo (not compatible with pure managed workflow). Our project uses bare workflow / EAS so this is fine.
- Maintenance is slow but present — not abandoned, not deprecated. No popular direct replacement for native crop UI.
- **Combining with expo-image-picker**: confirmed problematic on iOS real devices. The continually-loading bug (issue #2127) affects this exact pattern. Our 500ms delay is the known fix and appears sufficient.
- RocketChat maintains an internal fork (552 commits) but it has 1 star and is not publicly promoted as a replacement.

### Output dimensions
- `width` + `height`: sets the **output resolution** and also locks the crop frame aspect ratio. If omitted, frame is free-style.
- `compressImageMaxWidth` + `compressImageMaxHeight`: caps the output without locking aspect ratio. Use these when you want to limit file size but allow the user to crop freely.
- These two mechanisms are orthogonal: use `width`+`height` to enforce a ratio, use `compressImageMax*` to cap output size independently.
- No newer API — these are the correct current props.

### Free / original aspect ratio
- If you omit `width` and `height`, the default is NOT a fixed square — it opens in free-style mode where the initial frame approximates the image dimensions. (Community reports and README confirm: no width/height = no locked ratio.)
- `freeStyleCropEnabled: true` explicitly allows the user to drag the frame to any shape.
- There is NO prop to say "start with original aspect ratio locked". The only way to get a locked original-ratio frame is to compute the image's actual W/H and pass them as `width` and `height` — but this also locks the ratio so the user cannot freely adjust it.
- Practical answer: omit `width`+`height`, set `freeStyleCropEnabled: true` — this gives "Original" behavior without forcing the user to drag back to it.

## Sources
- https://github.com/ivpusic/react-native-image-crop-picker/issues/659
- https://github.com/ivpusic/react-native-image-crop-picker/issues/264
- https://github.com/ivpusic/react-native-image-crop-picker/issues/2127
- https://github.com/expo/expo/issues/34377
- https://github.com/ivpusic/react-native-image-crop-picker/releases
- https://app.unpkg.com/react-native-image-crop-picker@0.51.1/files/README.md
