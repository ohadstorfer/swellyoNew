---
name: mobile-agent-sim-testing
description: LLM/Claude agent autonomous mobile testing — driving iOS Simulator + Android Emulator via MCP; landscape, best practices, Expo-specific setup as of May 2026
metadata:
  type: reference
---

# Mobile Agent Simulator Testing — May 2026

## Top Tool Options

### 1. Expo MCP server (official, Expo-native) — BEST FIT for Swellyo
- SDK 54+ required, free plan available (May 26 2026 changelog)
- Install: `npx expo install expo-mcp --dev`
- Start: `EXPO_UNSTABLE_MCP_SERVER=1 npx expo start`
- Tools: `automation_take_screenshot`, `automation_tap`, `automation_tap_by_testid`, `automation_find_view_by_testid`
- iOS: simulator only (no real device, macOS only)
- Android: emulator mentioned in docs but confirmation ambiguous — official docs say "simulator or emulator" generically
- Works against running dev server (hot-reload-aware), no compiled build needed
- Reconnect required when dev server restarts
- Source: https://docs.expo.dev/eas/ai/mcp/

### 2. ios-simulator-mcp (joshuayoes) — iOS ONLY, lightweight
- npm: `ios-simulator-mcp`, v1.6.0 (April 21, 2026)
- 14 tools: screenshot, tap, swipe, type, ui_describe_all, ui_find_element, record_video, install_app, launch_app
- Uses idb (Facebook) for interaction
- No WebDriverAgent needed (uses simctl + idb)
- ASCII-only text input limitation
- No Android support
- No Expo-specific caveats documented
- Add to Claude Code: `claude mcp add ios-simulator -- node /path/to/ios-simulator-mcp/build/index.js`

### 3. mobile-mcp (mobile-next) — CROSS-PLATFORM but requires WebDriverAgent for iOS
- npm: `@mobilenext/mobile-mcp`, v0.0.57 (May 28, 2026), 5.1k stars
- iOS: requires WebDriverAgent running (xcodebuild XCUITest target)
- Android: ADB-based, simpler setup
- CRITICAL BUG: WebDriverAgent fails on Xcode 26.2 / iOS 26.2 simulators (issue #303, open as of May 2026). Fix needs WDA v11.4.1+ bundled. Not yet resolved in repo.
- Add: `claude mcp add mobile-mcp -- npx -y @mobilenext/mobile-mcp@latest`
- Best for projects that also need Android-only testing today

### 4. Maestro MCP — SELECTOR-BASED, YAML, cross-platform
- Launched Feb 2026, blog post April 14 2026
- Install Maestro CLI: `curl -Ls "https://get.maestro.mobile.dev" | bash`
- Add: `claude mcp add maestro -- maestro mcp`
- Tools: generate YAML flows from NL, execute flows, inspect view hierarchy CSV, debug
- Expo Go: use `openLink: exp://127.0.0.1:19000` instead of `launchApp`
- Dev client: requires compiled APK/IPA (EAS local build)
- Expo Go + Expo dev client both supported — zero app instrumentation
- 70-80% first-gen accuracy reported; human validation still needed
- No token cost for screenshots (YAML selector-based, not vision-driven)
- Requires `maestro login` / MAESTRO_CLOUD_API_KEY for some tools
- Source: https://docs.maestro.dev/get-started/maestro-mcp

### 5. Claude Code computer-use (built-in, Anthropic)
- Available in Claude Code v2.1.85+ on macOS, Pro or Max plan only
- Enable via `/mcp` > enable `computer-use`
- Full screen control: sees simulator window visually, clicks/types like a human
- No MCP server to install — built into Claude Code
- Slowest approach (3-5s per action), but requires zero setup beyond macOS permissions
- Works with any app (Expo Go, dev client, production, anything visible on screen)
- Screenshot-driven: uses vision model to interpret screen state
- Good for one-off verification; too slow/expensive for regression suites
- Source: https://code.claude.com/docs/en/computer-use

### 6. Appium MCP — Heavy-weight, enterprise
- Official Appium MCP: `appium/appium-mcp` on GitHub
- Requires Appium server, XCUITest driver, WebDriverAgent
- Full cross-platform but significant setup overhead
- April 2026 meetup demo: zero-to-test without manual scripting via Claude
- Source: https://github.com/appium/appium-mcp

## Screenshot-Driven vs Selector-Driven Consensus (May 2026)

Community consensus: **hybrid is best**. Default to selector/accessibility tree; fall back to screenshot only for visual validation.

- Screenshot-only: expensive (50k-100k tokens for complex flows), 3-5s per step, coordinate flakiness
- Selector-based (Maestro/Appium): stable, cheap, YAML is human-readable and Claude-writable
- Expo MCP hybrid: testID-first (selector) + screenshot for visual confirmation
- Full-frame screenshots are noisy; scope to specific views when possible
- For RN/Expo: accessibility tree is often sparse (custom components), so hybrid is especially important

## The Recommended Stack for Swellyo (Expo SDK 54, RN 0.81)

**Tier 1 — Start here (zero extra build step):**
expo-mcp local capabilities + ios-simulator-mcp

- expo-mcp: testID-based taps, screenshots, element inspection while dev server runs
- ios-simulator-mcp: fine-grained control (video recording, app install/launch, accessibility tree dump)
- Both work against the running dev server via `npx expo start` (no compiled build needed)
- iOS: both work on simulator today
- Android: expo-mcp claims emulator support; ios-simulator-mcp is iOS only

**Tier 2 — Add Maestro for regression flows:**
- Write `.maestro/` YAML flows for key journeys (onboarding, match, DM flow)
- For Expo Go testing: `openLink: exp://127.0.0.1:19000`
- For dev client: requires local EAS build (eas build --local --profile development-simulator)
- Claude can generate/edit YAML flows via Maestro MCP

**Tier 3 — Claude computer-use as escape hatch:**
- When the MCP tools fail or a flow is hard to express as selectors
- Requires Pro/Max plan, interactive session only
- Good for one-off verification of a specific visual bug

## Key Watch-outs

1. mobile-mcp Xcode 26 bug: WebDriverAgent fails on iOS 26.2 simulators (open issue #303). Avoid mobile-mcp for iOS if on Xcode 26.2.
2. expo-mcp Android: official docs say "simulator or emulator" but don't explicitly confirm all automation_* tools work on Android. Verify at setup time.
3. ios-simulator-mcp ASCII-only: cannot type non-ASCII characters (no emoji, no Spanish accented chars in test input).
4. Maestro + Expo Go: can't use `launchApp`, must use `openLink: exp://127.0.0.1:19000`; this URL breaks if Metro port changes.
5. expo-mcp reconnect: must reconnect MCP whenever dev server restarts (Claude loses the local capabilities connection).
6. Maestro accuracy: self-reported 70-80% first-gen accuracy. Generated flows need human review before being treated as ground truth.
7. Token cost of screenshots: a complex flow using screenshots at every step can burn 50k-100k tokens. Use testID-based taps where possible.
8. Claude computer-use: Pro/Max plan required; macOS only; interactive session only (not available with `-p` flag or in headless/overnight runs).
9. Maestro requires `maestro login` for cloud tools; CLI local runs work without auth.

## Expo-Specific Notes

- SDK 54 is specifically required for expo-mcp local capabilities
- Expo Go vs dev client vs production build changes which Maestro command to use
- testID props in components make expo-mcp much more reliable than coordinate-based taps
- Fast Refresh (hot reload) means the dev server stays alive between Claude's code edit and screenshot — no rebuild needed for JS-only changes
- Native module changes (any change that would require `expo run:ios`) need a rebuild before any MCP tool can verify them
