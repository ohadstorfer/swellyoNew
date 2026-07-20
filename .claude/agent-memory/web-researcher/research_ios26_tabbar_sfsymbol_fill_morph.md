---
name: ios26-tabbar-sfsymbol-fill-morph
description: How iOS 26 Liquid Glass tab bar morphs SF Symbol icons from outline to filled on selection (Magic Replace mechanism), whether it works with raster/custom icons, and react-native-bottom-tabs' behavior (it explicitly disables the auto-morph).
metadata:
  type: reference
---

# iOS Tab Bar SF Symbol Outline→Fill Morph — Mechanism (July 2026)

## The core mechanism (NOT new to iOS 26)

Since **iOS 15** (not iOS 26), `UITabBarController`/SwiftUI `TabView` automatically renders SF Symbol tab icons as **outline when unselected, `.fill` variant when selected** — with zero developer code. Source: next-planet.com blog + widely corroborated by Donny Wals/Sarunw SF Symbols pieces.

- Pass only a base symbol name (e.g. `house`) as `image`, leave `selectedImage` **nil**. The tab bar auto-swaps to the symbol's `.fill` counterpart on selection.
- To opt OUT (keep outline always) in SwiftUI: `.environment(\.symbolVariants, .none)` on the Label.
- **iOS 26 changed the animation quality, not the underlying selection logic.** Liquid Glass adds: a floating glass capsule/indicator that slides between icons, tab bar floats above content, minimize-on-scroll. The outline→fill swap itself rides on **"Magic Replace"** (SF Symbols 6 / iOS 18+, refined in 26) — a `symbolEffect(.replace)` content-transition that interpolates shared paths between two *related* symbols (e.g. `house` ↔ `house.fill`) so the fill appears to "grow into" the glyph rather than a hard cut.

## Q1 — selectedImage explicit vs nil

- Leaving `selectedImage` nil (SF Symbol `image` only) is the documented way to get automatic fill-on-select.
- Explicitly setting `selectedImage` does **not necessarily kill the morph** — if you set it to the symbol's own recognized `.fill` counterpart, behavior/animation is effectively identical (you've just made explicit what the OS does automatically). The morph animation (Magic Replace) itself requires the two symbols to be **path-related** (same glyph family, regular↔fill of the same symbol). If `selectedImage` is unrelated (a different symbol, or a raster image), you get a **plain cut/cross-fade swap**, no morph.

## Q2 — SF Symbols only, or raster too?

**Raster/PNG/template images do NOT get the progressive Magic-Replace morph.** There's no shared-path data for the system to interpolate — at best you get a cross-fade between two bitmaps. The morph-with-continuity effect is exclusive to vector SF Symbols (including custom ones authored the SF-Symbols way — see Q3).

## Q3 — Custom brand icons: can they get the same morph?

**Yes, but only if authored as a single custom SF Symbol with both weight/fill sources baked into ONE symbol asset — not as two separately-named symbols.**

Workflow (WWDC21 "Create custom symbols" session 10250; createwithswift.com; blakecrosley.com):
1. Design outline artwork in a vector tool.
2. In SF Symbols app: **File → Export Template (⌘E)**, choose the **Variable** template — gives you 3 editable design sources: Ultralight-Small, Regular-Small, Black-Small (system interpolates the other 24 weight/scale combos).
3. Edit the SVG in Figma/Illustrator/Sketch/Affinity. **Critical constraint**: every path across variants must have the **same anchor-point count, start point, and winding direction**, or the SF Symbols app throws an interpolation error and won't import.
4. To add a `.fill` appearance for the SAME symbol (not a second symbol), the SF Symbols app's layer/annotation tooling lets you mark the filled rendering as part of the one symbol's variant set.
5. Drag the finished SVG into the **Custom Symbols** folder in the SF Symbols app → it generates all 27 variant combinations.
6. Add the resulting symbol to your asset catalog; reference it by name with `UIImage(systemName: "your.custom.symbol")` exactly like a built-in symbol.
7. With `selectedImage` left nil, the tab bar's automatic outline→fill switching (and the Magic Replace morph) applies to your custom symbol identically to system symbols — **because it's the same symbol's fill layer, not a different image.**

**Two independently-named custom symbols (an "outline-brand-icon" and a separate "filled-brand-icon" treated as if they were regular/selected pair) will NOT get the smooth morph** — Magic Replace needs recognized path continuity within one symbol definition, not two arbitrary assets. This is the key distinction to tell the user: one symbol, two baked-in appearances = morph works; two separate icon images = plain swap only.

## Q4 — Is the fill tracked continuously by a drag gesture, or only on discrete tap?

**No evidence found of a native continuous drag/scrub API on `UITabBarController`.** Tab selection in stock UIKit/SwiftUI is a **discrete tap event** — there is no Apple-documented interactive-drag-to-preview-then-commit gesture for the tab bar itself (unlike, say, interactive pop/swipe-back on a navigation stack). Third-party libraries (`SwipeableTabBarController`, `swipe-tab-bar` on GitHub) exist specifically because Apple doesn't ship this — confirming it's not native.

What likely reads as "the lens tracks your finger": the **Liquid Glass indicator capsule + Magic Replace fill both animate via a fast, fluid spring animation triggered by the tap**, running out-of-process (compositor-level, not JS/main-thread), so the transition *feels* attached to the touch even though it's a discrete state change under the hood, not a live scrub. Recommend telling the user this is very likely a misperception of a well-tuned spring animation, not literal drag-tracking — no Apple source (WWDC25 "Meet Liquid Glass" #219, "Build a UIKit app with the new design" #284) describes or demonstrates scrub-to-preview tab selection.

## Q5 — react-native-bottom-tabs (Callstack) and `sfSymbol`

**Important, concrete finding**: the library's own native iOS code explicitly calls `.noneSymbolVariant()` → `.environment(\.symbolVariants, .none)` on its SwiftUI tab items. This **deliberately disables** the automatic outline→fill morph that stock `TabView`/`UITabBarController` would otherwise apply.

Practical implication: passing `{ sfSymbol: 'house.fill' }` per tab does NOT give you the native automatic morph for free. You must either:
- Provide a single static symbol name per tab (no morph, same icon both states), or
- Use the library's focused/unfocused icon map (`tabBarIcon: ({focused}) => ({ sfSymbol: focused ? 'house.fill' : 'house' })`) to hard-swap symbol names yourself on selection — this gives an instant cut, not the Magic-Replace interpolated morph, because you're now supplying two independently-resolved images rather than letting the OS apply its own variant switch to one symbol.
- Raster/PNG/SVG icons work on both platforms but never get any morph — plain tint/swap only (per [[research_rnbt_native_bottom_tabs]]).

**Bottom line for Swellyo**: getting the authentic WhatsApp-style continuous-looking fill morph via `react-native-bottom-tabs` is not currently possible — the library intentionally opts out of it. If pixel-perfect Liquid Glass icon morphing matters more than brand-color control, that's a real trade-off to flag (ties into [[research_instagram_liquid_glass_rollback]]'s broader finding that the native iOS 26 tab bar gives you almost zero control anyway — Instagram itself reverted to a custom bar).

## Sources
- next-planet.com "Outlined TabItem icons in iOS": https://blog.next-planet.com/outlined-tabitem-icons-in-ios
- Donny Wals, "How to use SF Symbols in your apps": https://www.donnywals.com/how-to-use-sf-symbols-in-your-apps/
- Sarunw, "What is a variant in SF Symbols": https://sarunw.com/posts/what-is-variant-in-sf-symbols/
- Apple UITabBarItem.selectedImage docs: https://developer.apple.com/documentation/uikit/uitabbaritem/1617072-selectedimage
- Apple SymbolVariants (SwiftUI) docs: https://developer.apple.com/documentation/swiftui/symbolvariants
- WWDC25 "Meet Liquid Glass" (session 219): https://developer.apple.com/videos/play/wwdc2025/219/
- WWDC25 "Build a UIKit app with the new design" (session 284): https://developer.apple.com/videos/play/wwdc2025/284/
- WWDC21 "Create custom symbols" (session 10250): https://developer.apple.com/videos/play/wwdc2021/10250/
- createwithswift.com, "Creating Custom SF Symbols": https://www.createwithswift.com/creating-custom-sf-symbols/
- Blake Crosley, "Custom SF Symbols: The Variable Template...": https://blakecrosley.com/blog/custom-sf-symbols-creation
- nilcoalescing.com, "Enhanced replace transition for SF Symbols in iOS 18" (Magic Replace): https://nilcoalescing.com/blog/EnhancedReplaceTransitionForSFSymbolsInIOS18/
- createwithswift.com, "Animating SF Symbols with the symbol effect modifier": https://www.createwithswift.com/animating-sf-symbols-with-the-symbol-effect-modifier/
- Apple HIG Tab bars: https://developer.apple.com/design/human-interface-guidelines/tab-bars
- react-native-bottom-tabs GitHub / DeepWiki SwiftUI Tab Views page: https://deepwiki.com/callstack/react-native-bottom-tabs/5.2-swiftui-tab-views
- GitHub SwipeableTabBarController (evidence no native drag-scrub exists): https://github.com/marcosgriselli/SwipeableTabBarController
