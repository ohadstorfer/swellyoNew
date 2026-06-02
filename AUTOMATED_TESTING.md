# Automated UI verification (Claude agents)

Stack for Claude / Claude Code agents to verify Swellyo changes end-to-end on iOS Simulator + Android Emulator, instead of stopping at `tsc` and asking the human to click around.

Two layers, used together:

- **Maestro** (`maestro mcp` + `~/.maestro/bin/maestro` CLI) — selector- and YAML-driven flows that run on both iOS sim and Android emu. The default verification tool.
- **Expo MCP** (`expo-mcp` stdio) — testID-aware tools (`automation_take_screenshot`, `automation_tap_by_testid`, `automation_find_view_by_testid`) that ride on the running Metro dev server. Use when an agent needs to inspect a specific React view without writing YAML.

Both wired into `.mcp.json`. Both auto-enabled via `.claude/settings.local.json` (`enabledMcpjsonServers`).

## One-time host setup (already done on Ohad's machine)

- Maestro 2.6.0 installed to `~/.maestro/`. PATH added to `~/.zprofile` (`export PATH="$PATH:$HOME/.maestro/bin"`).
- `expo-mcp` is a devDependency. Re-installed by anyone who runs `npm install`.

To sanity-check:

```bash
~/.maestro/bin/maestro --version    # 2.6.0
xcrun simctl list devices booted    # at least one booted iOS sim
~/Library/Android/sdk/platform-tools/adb devices  # at least one emulator
```

## Per-session: starting Metro with the MCP flag

For Expo MCP tools (the testID-based ones) to work, Metro has to be started with the unstable MCP flag:

```bash
EXPO_UNSTABLE_MCP_SERVER=1 npx expo start
```

Maestro does **not** need Metro running — it talks to the already-installed dev/prod build via the platform's accessibility layer.

## How an agent verifies a change

1. **Edit code** → if JS-only, Fast Refresh updates the sim immediately. **Native module / app.json / config plugin changes need a rebuild** (`npm run ios` / `npm run android`) before any screenshot will reflect the change. If you're an agent and you can't tell, ask.
2. **Pick the right tool**:
   - Need to walk through a flow on both platforms? → write/extend a Maestro YAML, run `maestro test .maestro/<flow>.yaml`.
   - Need to verify one specific component rendered correctly? → use Expo MCP `automation_take_screenshot` scoped to a `testID`.
   - Need to verify something selector-less (animation, gradient, custom canvas)? → use `computer-use` MCP (Pro/Max plan only; interactive sessions only).
3. **Inspect the result** — screenshots go to `.maestro/screenshots/` for our flows, and `~/.maestro/tests/<timestamp>/` for ad-hoc runs.

## Running the starter flows

```bash
maestro test .maestro/smoke.yaml             # boot + welcome screen
maestro test .maestro/visual-baseline.yaml   # capture baseline screenshots
maestro test .maestro/                       # everything in config.yaml
```

Add `--platform ios` or `--platform android` to pin a single platform. Otherwise Maestro uses whichever sim/emu is booted (errors if both are booted and you don't pick).

## testID conventions

We're adding testIDs incrementally on the screens an agent is most likely to drive. Naming pattern: `<screen-or-area>-<element>-button` / `-input` / `-row`. So far:

| Screen                | testIDs                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WelcomeScreen         | `welcome-apple-button`, `welcome-google-button`, `welcome-terms-checkbox`, `welcome-demo-button`, `welcome-skip-demo-button`                             |
| OnboardingChrome (all onboarding steps) | `onboarding-next-button`, `onboarding-back-button` — persistent footer/header, present on every onboarding step                                          |
| ConversationsScreen   | `conversations-profile-button`, `conversations-menu-button`, `conversations-swelly-button`, `conversation-row-<id>`                                      |
| ChatScreen (Swelly)   | `swelly-chat-back-button`, `swelly-chat-attach-button`, `swelly-chat-input`, `swelly-chat-input-send`, `swelly-chat-input-camera`, `swelly-chat-input-mic` |
| DirectMessageScreen   | `dm-chat-input`, `dm-chat-input-send`, `dm-chat-input-camera`, `dm-chat-input-mic`                                                                       |
| DirectGroupChat       | `group-chat-input`, `group-chat-input-send`, `group-chat-input-camera`, `group-chat-input-mic`                                                           |
| TripsScreen           | `trips-back-button`, `trips-empty-create-button`                                                                                                         |
| CreateTripFlowA       | `create-trip-a-back-button`, `create-trip-a-next-button`, `create-trip-a-submit-button`                                                                  |
| CreateTripFlowBC      | `create-trip-bc-back-button`, `create-trip-bc-next-button`, `create-trip-bc-submit-button`                                                               |
| CreateTripFlowC       | `create-trip-c-back-button`, `create-trip-c-next-button`, `create-trip-c-submit-button`                                                                  |

When you touch a new screen for an agent flow, add testIDs in the same pattern and extend this table.

## Watch-outs

- **Xcode 26.x compatibility.** Our setup avoids `mobile-mcp` because its bundled WebDriverAgent doesn't start on Xcode 26.2+ (GitHub issue #303). Maestro + Expo MCP don't share that bug — both work fine on Xcode 26.3.
- **Token cost.** Full-frame screenshots are expensive (50–100k tokens for a 20-step flow). Prefer accessibility-tree inspection (`maestro hierarchy`, Expo MCP `automation_find_view_by_testid`) over screenshots, and scope screenshots to a single view when you need pixels.
- **Native vs JS changes.** Fast Refresh covers JS. Anything in `app.json`, a config plugin, or a native module requires `npm run ios` / `npm run android` first. Agents that screenshot without rebuilding will report false passes.
- **Spanish/i18n input.** Maestro's `inputText` is fine. The standalone `ios-simulator-mcp` (not installed by default) only types ASCII — don't use it for Spanish strings.
- **Sim must be booted before the flow.** Maestro will error if no sim/emu is available. Boot via `open -a Simulator` or `~/Library/Android/sdk/emulator/emulator @<avd>`.
- **Expo MCP needs the unstable flag.** Without `EXPO_UNSTABLE_MCP_SERVER=1`, Metro doesn't expose the local automation tools and the MCP proxy will silently have nothing to call.

## Extending the flows

- Add a new YAML in `.maestro/`. Reference testIDs with `id:` (preferred) or visible text with `text:`. See [Maestro docs](https://docs.maestro.dev/) — the agent has access to those docs via the Maestro MCP `getDocumentation` tool.
- Register the new flow in `.maestro/config.yaml` so `maestro test .maestro/` picks it up.
- Run locally before relying on it in agent loops. First-pass YAML accuracy is ~70–80% per the community; review what the agent generates.
