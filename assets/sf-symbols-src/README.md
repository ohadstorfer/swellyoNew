# Custom SF Symbols — tab bar icons (Phase 2)

Goal: the WhatsApp-style outline→fill **morph** on the native iOS 26 tab bar.
That morph only fires for **SF Symbols** (system or custom), never raster PNGs.
So each of the 3 tabs needs a **custom symbol pair**: an outline + a `.fill`.

## ✅ AUTO-GENERATED (no SF Symbols app needed)

The 6 `.symbolset` folders are now generated **programmatically** from the source
vectors below — no manual SF Symbols-app authoring. They live in
`generated/` here and are copied into `ios/Swellyo/Images.xcassets/`.

- Generator: `generated/gen_symbols2.py` (+ `generated/masters.py` for the paths,
  `generated/foxhunt.svg` = a real Apple export template used as the skeleton).
- Needs `pip install shapely svgpathtools`. Run `python3 gen_symbols2.py`.
- What it does: expands the outline **strokes** into filled closed paths (round
  cap/join buffer — SF Symbols disallow strokes), keeps the solid paths for the
  `.fill` twin, then **injects the artwork into Apple's real weight/scale template**
  (Notes + Guides + Ultralight/Regular/Black-S groups), mapping the 24×24 design box
  onto the template cell (baseline origin, centered, ~cap-height tall). Writes each
  `Name.symbolset/{Contents.json, name.svg}`.
- ⚠️ **`actool` rejects a flat 24×24 SVG** ("must have a glyph for Regular weight
  Medium size") — the weight-group template structure is required. Verified: the
  generated set compiles clean via `xcrun actool` (Assets.car produced, no errors).
- **Size knob:** `S` in `gen_symbols2.py` (default 70 ≈ cap-height). Bump/drop it if
  the icon looks too big/small on device, then regenerate + recopy into the catalog.

`TAB_ICON_MODE` is set to `'sfsymbol'` and points at `TAB_CUSTOM_SYMBOLS` in
`src/navigation/RootNavigator.tsx`. **Still needs a native rebuild + device test.**
If the render looks off on device, the SF Symbols-app recipe below is the fallback.

---

## Source vectors (from Figma)

Pulled from Figma `Swellyo Data Entry App` → node `14113-29295` (Nav Bar 4):

| Tab      | File                | Figma component | Variant fetched |
|----------|---------------------|-----------------|-----------------|
| Lineup   | `lineup-send.svg`   | `send-01`       | outline (stroke) |
| Trips    | `trips-map.svg`     | `map-01`        | **solid (fill)** |
| Profile  | `profile-user.svg`  | `user-03`       | outline (stroke) |

All are 24×24, normalized to solid black, backgrounds stripped. `send` and
`user` are the outline masters; `map` is the fill master.

## Naming — MUST match exactly

The tab bar resolves the `.fill` variant by naming convention, so author two
symbols per tab with these exact names:

| Tab      | Outline symbol        | Fill symbol                |
|----------|-----------------------|----------------------------|
| Lineup   | `co.swellyo.lineup`   | `co.swellyo.lineup.fill`   |
| Trips    | `co.swellyo.trips`    | `co.swellyo.trips.fill`    |
| Profile  | `co.swellyo.profile`  | `co.swellyo.profile.fill`  |

(These are already wired in `src/navigation/RootNavigator.tsx` →
`TAB_CUSTOM_SYMBOLS`.)

## Recipe (SF Symbols app, macOS — ~15 min per icon)

1. Open the **SF Symbols** app → New Symbol from a system template (⌘E on a
   close system symbol gives a correct 3-weight template: Ultralight-S /
   Regular-S / Black-S + Guides + Notes).
2. Replace the template artwork with the matching SVG here. Keep it inside the
   cap-height / baseline guides; don't edit the Guides/Notes layers.
3. Author the **outline** symbol → name `co.swellyo.<tab>`.
4. Author the **fill** symbol → name `co.swellyo.<tab>.fill`. **Derive the fill
   from the same paths as the outline** so the two are path-compatible — same
   subpath count, same winding direction, geometry that "grows" outline→fill.
   If they aren't compatible you get a hard cross-fade, not the morph.
5. Check the variant grid in the app for kinks/overlaps at interpolated weights.
6. Export each as a **Symbol Image Set** and drag both into
   `ios/Swellyo/Images.xcassets` in Xcode. Commit the `.symbolset` folders.

## Then, in the app

- `src/navigation/RootNavigator.tsx`: swap `TAB_SF_SYMBOLS` → `TAB_CUSTOM_SYMBOLS`
  and set `TAB_ICON_MODE = 'sfsymbol'`.
- The library patch (`patches/react-native-bottom-tabs+1.3.1.patch`) already
  loads custom symbols via `Image(name)` (systemName can't) and re-enables the
  fill morph (dropped `.noneSymbolVariant()`).
- **Native rebuild required** (not OTA, dead in Expo Go). Test on device iOS 26.
- Android has no SF Symbols → falls back to the raster `swap` path automatically.
