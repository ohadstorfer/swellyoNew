---
name: instagram-liquid-glass-rollback
description: Instagram's Liquid Glass tab bar adoption and apparent rollback (mid-2026), broader app ecosystem opt-out trend, iOS 26 tab bar usability problems, and implications for native vs custom JS tab bar in React Native.
metadata:
  type: reference
---

# Instagram Liquid Glass Tab Bar — Rollback + Broader Ecosystem (June 2026)

## What Happened With Instagram

**Timeline (confirmed from multiple sources):**
- Dec 2025: Instagram began A/B testing a Liquid Glass floating pill nav bar with select users
- Feb 2026: Expanding through TestFlight build 416.0.0; pill-shaped translucent bar replacing flat custom bar
- June 1, 2026: Instagram v432.0.0 shipped WITHOUT Liquid Glass — user on Threads (@theiosguy101) noted it with 91.2K views
- Late June 2026 (approx): X account @OneUiOS reported "Instagram has removed the Liquid Glass UI, switching back to its previous tab bar design"

**Confidence level**: The rollback is reported by social media trackers (OneUiOS, theiosguy101), not by Meta directly. No official Meta statement found. Piunikaweb's Feb 2026 article pre-dated the rollback and described normal staged rollout. This appears to be a server-side A/B test kill, not a permanent removal.

**What replaced it**: Instagram's "previous tab bar design" — their own custom opaque/flat navigation bar.

**Reported reasons for removal:**
- Users complained about accidental taps when the bar auto-shrank on scroll
- Negative user reaction to DM button repositioning (bundled with the LG redesign)
- No official Meta statement — reasons are inferred from user feedback coverage (GB News, ITmatterss)

## The Broader iOS 26 Liquid Glass Ecosystem

**Apps that DID adopt Liquid Glass tab bar (2026):**
- WhatsApp: Wide rollout of LG interface (WABetaInfo confirmed; translucent bottom nav bar)
- Threads: Already shipped with LG (used as comparison point against Instagram)
- Reddit: LG tab bar live for iOS 26, but users report heavy battery drain and interface glitches
- Slack: Full redesign around LG; moved search to tab bar
- Others in Apple's gallery: AllTrails, Carrot Weather, Fantastical, OmniFocus 4, Slack, Lowe's, American Airlines

**Apps NOT in Apple's gallery / not confirmed adopted:**
- Instagram (reverted), Spotify, YouTube — none mentioned in Apple's curated LG gallery

**Apple's own walk-back:**
- iOS 26 Beta 3 (July 2025): Apple toned down LG after developer/user backlash — Control Center transparency reduced, legibility improved
- iOS 27 (announced May 2026, reporting by Mark Gurman via 9to5Mac): Apple reversing the Search tab separation; Music/Podcasts/News/TV/Health will re-integrate Search into the main nav bar. The collapsing tab bar (which required 2 gestures to switch tabs) is being fixed.
- iOS 27 also removing the gyroscopic specular highlight effect from iOS 26

## Why the iOS 26 Tab Bar Is Problematic

From Nielsen Norman Group (authoritative usability analysis):
- "Liquid Glass prioritizes spectacle over usability"
- Translucent controls create contrast/legibility failures over photo content
- Tab bar is "crowded" with search button hovering separately — breaks unified control area
- Violates Apple's own 0.4cm minimum touch target spacing
- Constant animation and unpredictable interface changes

From Ryan Ashcraft (iOS developer):
- Search tab doesn't look like a tab — looks like a button (affordance failure)
- Developers repurposing it for compose/add actions (contradicts HIG)
- Users can't tell what interaction will occur

From Donny Wals (iOS developer):
- `UIDesignRequiresCompatibility=YES` in Info.plist opts the whole app out of LG
- Xcode 27 will likely REMOVE this opt-out option — LG will be mandatory
- Apple frames it as temporary debugging aid, not a permanent escape hatch

## react-native-bottom-tabs — iOS 26 Specific Constraints

If you adopt react-native-bottom-tabs (native UITabBarController) on iOS 26:
- `tabBarStyle.backgroundColor` = SILENTLY IGNORED. OS controls bar appearance. No override.
- `tabBarInactiveTintColor` = applies to labels only, NOT icons (bug #439, PR #527 open as of June 2026)
- `tabBarBlurEffect` = ignored on iOS 26+
- Bar shape = always full-width flat to bottom (no floating pill, no rounded corners, no custom height)
- Tab switch animation = 100% OS-controlled, zero JS involvement
- `tabBarMinimizeBehavior` (iOS 26+ only) = collapse-on-scroll requires react-native-screens 4.25+ + patch for FlashList

The library's own docs: "If the design requires custom background on iOS 26+, floating pill shape, custom animation, or arbitrary React icons — use JS @react-navigation/bottom-tabs with tabBar prop instead."

## Implications for Native vs Custom JS Tab Bar

The native tab bar (react-native-bottom-tabs) gives you:
- Authentic iOS Liquid Glass on iOS 26 (out-of-process, zero JS thread)
- Material 3 on Android
- Zero control over appearance on iOS 26

A custom JS tab bar gives you:
- Full control (brand color, shape, size, animations)
- Consistent across iOS 26+ and older
- Must handle safe area padding, hide-on-scroll, haptics yourself
- Not subject to iOS LG mandatory adoption in Xcode 27

**The Instagram signal**: Meta built the LG bar, A/B tested it, got pushback, and killed it — reverting to their custom opaque bar. WhatsApp (also Meta) kept it. No consensus within the same company.

**For a brand-heavy app with a specific color system (e.g., Swellyo's teal)**: Custom JS bar is the correct choice. The native bar on iOS 26 ignores your brand color entirely.

## Sources

- X/@OneUiOS (late June 2026): https://x.com/oneuios/status/2068162984770421073
- Threads/@theiosguy101 (June 1, 2026): https://www.threads.com/@theiosguy101/post/DZDgxFsE6-I/
- GB News coverage: https://www.gbnews.com/tech/instagram-ios-liquid-glass-update
- PiunikaWeb Instagram LG timeline (Feb 2026): https://piunikaweb.com/2026/02/13/instagram-liquid-glass-navbar-update-whatsapp-delay/
- 9to5Mac iOS 27 tab bar changes: https://9to5mac.com/2026/05/12/ios-27-to-make-key-design-changes-to-streamline-liquid-glass-report/
- TechCrunch iOS 26 Beta 3 dial-back: https://techcrunch.com/2025/07/07/ios-26-beta-3-dials-back-liquid-glass/
- Nielsen Norman Group usability analysis: https://www.nngroup.com/articles/liquid-glass/
- Ryan Ashcraft iOS 26 tab bar critique: https://ryanashcraft.com/ios-26-tab-bar-beef/
- Donny Wals opt-out guide: https://www.donnywals.com/opting-your-app-out-of-the-liquid-glass-redesign-with-xcode-26/
- Apple Concedes on LG — MacObserver: https://www.macobserver.com/news/apple-concedes-on-liquid-glass-design-compromising-for-usability/
- AppleInsider iOS 26 review: https://appleinsider.com/articles/26/05/08/ios-26-review-one-year-later-liquid-glass-complaints-hide-the-real-problem/
- Apple Gadget Hacks gallery analysis: https://apple.gadgethacks.com/news/apple-liquid-glass-developer-gallery-explained-adoption-gaps-and-wins/
