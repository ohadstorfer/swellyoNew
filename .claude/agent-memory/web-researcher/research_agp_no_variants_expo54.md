---
name: AGP "No Variants Exist" — Expo SDK 54 / RN 0.81
description: Root cause and fixes for "No variants exist" AGP 8.11.0 error with react-native-webview and react-native-vector-icons on Expo SDK 54 EAS builds
type: project
---

EAS Build started failing ~Jan 30 2026 with "No variants exist" for modules that have their own buildscript classpath declaring an old AGP version (e.g., react-native-webview declares AGP 7.0.4, react-native-vector-icons also has its own block). The Expo SDK 54 EAS build environment uses AGP 8.11.0; the `AgpVersionAttr` mismatch prevents `com.android.library` from publishing variants.

**Why:** Expo's `expo-root-project` gradle plugin drives the root classpath. Subproject buildscript blocks with stale AGP references confuse Gradle's classloader hierarchy, causing the library not to publish any build variants at all. Pinning the root build.gradle AGP to 8.7.2 does NOT survive Expo's plugin override.

**Confirmed fix strategy (patch-package):** Remove the `buildscript { ... }` block entirely from the offending library's `android/build.gradle`. This works because Gradle's classloader hierarchy means the root project's classpath is inherited; the library's redundant block just introduces an AGP version conflict. No confirmed community report yet saying this 100% works for Expo 54 AGP 8.11 specifically, but the Gradle mechanics confirm it is the right approach.

**Confirmed workaround alternative:** `subprojects` block in root `android/build.gradle` using `configurations.classpath.resolutionStrategy.force` can force the classpath version — but only within the same `buildscript {}` context; cross-project buildscript resolution forcing from root to subproject is NOT reliably supported by Gradle's architecture.

**Status as of April 2026:** expo/expo issue #42370 is open/completed but the Expo team closed it without an official fix; the buildscript removal via patch-package is the community approach. The issue appeared to be tied to an EAS infrastructure bump on Jan 30 2026.

**How to apply:** Use patch-package to remove the `buildscript { repositories {...} dependencies { classpath("com.android.tools.build:gradle:7.0.4") ... } }` block from node_modules/react-native-webview/android/build.gradle and from react-native-vector-icons equivalent file. Run `npx patch-package react-native-webview` and `npx patch-package react-native-vector-icons`.
