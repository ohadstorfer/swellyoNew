---
name: sdk55-upgrade-effort-risk
description: Go/no-go assessment of Expo SDK 54→55 upgrade for Swellyo (bare workflow, RN 0.81→0.83, minimizeBehavior chain)
metadata:
  type: project
---

Researched June 2026.

## SDK 55 Status
- RELEASED and STABLE (February 2026). Ships React Native 0.83 (NOT 0.82).
- SDK 56 is in beta (June 2026), ships RN 0.85.

## Swellyo-specific advantage
- `newArchEnabled: true` already in app.json — the biggest SDK 55 breaking change (mandatory New Arch) is already met. This removes ~40% of typical migration pain.

## Headline breaking changes 54→55 for Swellyo
1. **Reanimated v3 → v4** (project on ^3.15.1): New Arch only; `react-native-worklets` added as separate dep; runOnJS renamed to scheduleOnRN; most animation logic still works but needs testing. Heavy usage in Swellyo = real effort.
2. **Android Gradle autolinking completely rewritten**: old `autolinking.gradle` removed, replaced with Gradle plugin system. Bare workflow = manual native diff to apply.
3. **Swift 6 imports**: `bindReactNativeFactory` removed from AppDelegate; `import Expo` → `internal import Expo` type change.
4. **Kotlin/KSP version alignment**: mismatches cause build failure.
5. **patch-package patches will break**: all 3 patches (vector-icons, webview, video-trim) are version-specific and need to be recreated.
6. **@bacons/apple-targets**: unknown compatibility with new native project structure — custom notification extension target is a risk.
7. expo-av removed from Expo Go (project uses it; still works as package, but deprecated).
8. `eas update` now requires `--environment` flag.

## Effort estimate (Swellyo, bare workflow)
- **3–5 days** if New Arch was already enabled (it is). Typical production app without New Arch: 5–10 days.
- Day 1: JS deps bump, expo-doctor scan, fix npm conflicts
- Day 1–2: Reanimated v3→v4 — babel config, rename runOnJS, test all gesture/animation screens
- Day 2–3: Native project diff (Gradle plugin overhaul, Swift 6 AppDelegate, Kotlin/KSP)
- Day 3: Recreate 3 patch-package patches for new versions
- Day 4–5: @bacons/apple-targets + notification extension compatibility + full device regression

## The minimizeBehavior chain (critical finding)
- `tabBarMinimizeBehavior` requires **react-native-bottom-tabs** (project has ^1.3.1 — OK) + **react-native-screens 4.25+**
- screens 4.25 requires RN 0.82+ (drops legacy arch)
- SDK 55 ships RN 0.83, which satisfies the 0.82 requirement
- BUT: SDK 55 defaults screens to 4.23 — you must manually override to 4.25 after upgrading
- Current project: screens ~4.16 on RN 0.81 — can NOT upgrade screens independently (native module compiled for different RN version)

## SHOW-STOPPER: minimizeBehavior open bug
- GitHub issue #4145 (opened Dec 2025, still OPEN June 2026): `tabBarMinimizeBehavior` never engages when tabs contain nested stack navigators AND/OR virtualized lists.
- Root cause: UIKit cannot detect a UIScrollView nested inside a React Native screen tree.
- Swellyo's architecture: every tab has a native-stack inside — this EXACTLY matches the broken case.
- A PR with a fix was proposed but not merged as of research date.
- **Conclusion: upgrading SDK to unlock minimizeBehavior is currently pointless for Swellyo's nav structure.**

## Recommendation
- Do NOT upgrade SDK 54→55 just to get minimizeBehavior. The feature won't work in Swellyo's nested-stack tab architecture until the bug is fixed.
- The upgrade has value for other reasons (security, ecosystem, Reanimated 4 performance) — but schedule it as its own effort, not driven by minimizeBehavior.
- Watch react-native-screens #4145 for a fix; re-evaluate then.
- If minimizeBehavior is urgent, wait for screens 4.26+ with the fix AND SDK 56 stable (which will bundle newer screens).

**Why:** solo developer, production app, bare workflow, custom extension target. The minimizeBehavior bug means the effort doesn't deliver the feature that motivated it.
**How to apply:** Block any SDK upgrade tickets that list minimizeBehavior as the motivation until #4145 is fixed.
