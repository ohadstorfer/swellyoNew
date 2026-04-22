---
name: Google Play Icon Requirements — Full Spec
description: Play Console hi-res icon, adaptive icon safe zone, monochrome, roundIcon, store-listing match policy, Expo behavior, common rejection reasons
type: reference
---

## Play Console Hi-Res Icon
- 512×512 px, 32-bit PNG, sRGB, max 1024 KB
- No transparency (renders on white/black background)
- No pre-rounded corners (Google applies 30% radius dynamically as of March 31 2026)
- No drop shadows (Google applies dynamically)
- Source: https://developer.android.com/distribute/google-play/resources/icon-design-specifications

## Adaptive Launcher Icon
- Total canvas: 108×108 dp (both foreground + background layers)
- Safe zone: center 66×66 dp circle — guaranteed never clipped
- Outer 18 dp on all 4 sides: may be clipped by device launcher mask — decorative/background only
- Foreground MUST be transparent PNG (logo on transparent canvas)
- Background MUST be fully opaque (color or drawable)
- Recommended source for raster foreground: 1024×1024 px (Expo scales to density buckets)
- At xxxhdpi, Expo generates 432×432 px (108dp × 4)
- Logo should fill ~60% of safe zone (roughly 40×40 dp equivalent)
- Source: https://developer.android.com/develop/ui/views/launch/icon_design_adaptive

## Monochrome Icon (Android 13+)
- Optional for Play Store approval — NOT required
- Strongly recommended: Android 16 QPR2 will auto-generate themed icon if absent (may look bad)
- Same drawable as foreground is acceptable
- Add via `android.adaptiveIcon.monochromeImage` in app.json
- Configured in ic_launcher.xml as `<monochrome>` layer

## Round Icon (android:roundIcon)
- Deprecated — do not use
- Having roundIcon in manifest BREAKS themed adaptive icons on Android 13+
- Remove it unless you specifically need a different circular asset (rare)

## Store Listing Match Policy
- Policy: on-device installed icon must visually match the store listing hi-res icon
- "Matches" = brand-consistent, same logo/brand identity — not pixel-identical
- Common cause: Expo placeholder adaptive-icon.png on device vs real brand icon uploaded to Play Console
- Google rejection message: "App does not match the store listing — when it's installed, your app's icon or name is different to the store listing"
- No official "exact text" policy page found; Google handles this via review rejection

## Common Rejection Reasons (2025/2026)
- Pre-rounded corners in submitted 512×512 asset (Google applies its own 30% radius — double-rounding looks bad)
- iOS-style squircle mask baked into the PNG
- Expo placeholder adaptive-icon.png used as launcher icon (white square with shape) while real brand icon is in Play Console
- Transparency in the 512×512 hi-res icon (renders as black/white background artifact)
- Drop shadow baked into 512×512 PNG

## Expo Behavior
- `android.adaptiveIcon.foregroundImage`: used as-is — NO automatic safe-zone padding by Expo
  - You must pre-compose your logo centered on a 1024×1024 transparent canvas with the logo filling ~60% of center
  - Outer 16-17% on each side = the 18 dp "bleed zone" that may be clipped
- `android.adaptiveIcon.backgroundColor`: solid hex color applied as background layer
- `android.adaptiveIcon.backgroundImage`: optional image background (overrides backgroundColor)
- `android.adaptiveIcon.monochromeImage`: you supply this; Expo does NOT auto-generate it
- Expo generates density buckets: mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi from the source image
- The top-level `icon` key is used as fallback for pre-API26 Android devices

## What to Deliver
1. `assets/adaptive-icon.png` — 1024×1024 transparent PNG, logo centered filling ~60% of center 600px (safe zone), outer 200px bleed zone
2. `assets/icon.png` — 1024×1024 opaque PNG, full square, no rounding, no shadow (for iOS + Android pre-API26 fallback)
3. Play Console hi-res icon — 512×512 opaque PNG, sRGB, no rounding, no shadow, max 1024 KB
4. Optional but recommended: `assets/monochrome-icon.png` — single-color version for Android 13+ theming
