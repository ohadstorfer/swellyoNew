---
name: sfsymbol-symbolset-raw-format
description: Exact raw file format for a custom SF Symbol .symbolset (Contents.json, SVG layer structure, viewBox, strokes rule, .fill naming) for programmatic generation without opening SF Symbols.app.
metadata:
  type: reference
---

# Custom SF Symbol `.symbolset` Raw File Format (July 2026)

Full brief written to scratchpad for the requesting task; key facts below for reuse.

## Contents.json — verified verbatim from a real shipped repo (Meshtastic-Apple)
```json
{
  "info" : { "author" : "xcode", "version" : 1 },
  "symbols" : [ { "filename" : "X.svg", "idiom" : "universal" } ]
}
```
No `properties` key required (some tools add `"properties":{"symbol-rendering-intent":"template"}` — optional).

## Folder structure
`Name.symbolset/{Contents.json, name.svg}` inside `Assets.xcassets/`.

## SVG structure
- Official template canvas: `width="3300" height="2200"`, top-level groups `<g id="Notes">`, `<g id="Guides">`, `<g id="Symbols">`.
- `Symbols` holds per-weight/scale `<g id="Regular-M">` etc. **Only `Regular-M` is mandatory** — rest optional, system falls back to scaling.
- Guides = `Baseline-M`/`Capline-M`/margin lines — used for optical alignment + SF Symbols.app compatibility, **not enforced by Xcode compile**.
- **Not strictly required for a basic compile**: a plain flat SVG (any viewBox, e.g. 24×24, no Notes/Guides) works as a Symbol Image Set — confirmed by `jaywcjlove/create-custom-symbols`'s own "no template injection" fast path. Trade-off: won't open/validate in SF Symbols.app GUI, no weight interpolation, less certain morph-interpolation quality.

## Strokes: NOT allowed
Must be filled, closed paths. createwithswift.com explicit: "It doesn't include open paths, strokes, gradients, or effects... turn strokes into paths" before export.

## `.fill` naming convention: CONFIRMED via Apple's own docs
Apple's "Creating custom symbol images for your app" doc states custom symbols follow the **same naming pattern as system symbols** — `name` + `name.fill` as two separate Symbol Image Sets resolves automatically via `.symbolVariants(.fill)` / nil `selectedImage`, no extra linking metadata needed.
**Caveat** (cross-ref [[research_ios26_tabbar_sfsymbol_fill_morph]]): naming-convention resolution is guaranteed/documented, but the *smooth* Magic-Replace morph (vs a plain cross-fade) additionally wants path-compatible source shapes between the two SVGs — not a formally documented rule for the fill case specifically (only documented for weight-interpolation sources), so treat as best-effort inference, not settled fact.

## Sources
- Apple docs: https://developer.apple.com/documentation/uikit/creating-custom-symbol-images-for-your-app
- Meshtastic-Apple real .symbolset (raw fetched): https://github.com/meshtastic/Meshtastic-Apple/tree/main/Meshtastic%20Watch%20App/Assets.xcassets/custom.foxhunt.symbolset
- Cookpad eng blog (raw XML skeleton, Regular-M-mandatory claim): https://techlife.cookpad.com/entry/2021/01/05/custom-symbols-en
- createwithswift.com strokes rule: https://www.createwithswift.com/creating-custom-sf-symbols/
- jaywcjlove/create-custom-symbols (minimal no-template-injection path): https://github.com/jaywcjlove/create-custom-symbols
