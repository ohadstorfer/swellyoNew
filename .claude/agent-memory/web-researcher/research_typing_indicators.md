---
name: typing-indicators-group-chat
description: Typing indicator transmission model (edge-triggered vs periodic), receiver expiry timeouts, group fan-out behavior (WhatsApp/Telegram/Signal/Stream/Ably/PubNub), cost framing, and best-practice numbers for Supabase Realtime broadcast
metadata:
  type: reference
---

# Typing Indicators — Group Chat Engineering Patterns

## 1. Transmission Model (XEP-0085 and WhatsApp)

**XEP-0085 spec (XMPP standard — what WhatsApp is built on):**
- 5 states: composing, paused, active, inactive, gone
- Edge-triggered: spec explicitly states "a client MUST NOT send a second instance of any given standalone notification... MUST NOT send more than one standalone <composing/> notification in a row"
- Timing for transitions: composing→paused after ~30s of no keystrokes; active→inactive after ~2 min; inactive→gone after ~10 min
- These are suggested triggers, not strict requirements

**WhatsApp actual behavior (reverse-engineered and from community analysis):**
- Emits "typing" once every ~3 seconds during active typing (edge + keepalive combined)
- Emits "stopped typing" 5 seconds after the last keystroke
- Server-side: discards typing events arriving faster than once every 2 seconds per sender-recipient pair
- This is effectively: edge-triggered start + 3-second keepalive re-send + stop 5s after last keystroke

**Telegram:**
- messages.setTyping MTProto method — called when user types
- Community implementations use 3-6 second keepalive loops
- Typing status expires after ~5 seconds without refresh

**Signal:**
- Typing events sent via same sealed-sender Signal Protocol channel
- Opt-in: requires both parties to have "Typing Indicators" enabled in Settings > Privacy
- Group typing: the Signal app confirms typing indicators exist in 1:1; group behavior less documented — privacy-preserving systems tend to suppress group typing

**Stream Chat:**
- typing.start throttled to at most once every 2 seconds
- Swift SDK auto-sends typing.stop 15 seconds after last keystroke
- Clients must defensively prune the typing list (stop signal not guaranteed)

## 2. Receiver Auto-Expiry

| Platform / SDK | Receiver Timeout |
|---|---|
| Telegram | ~5 seconds |
| XEP-0085 (standard) | No fixed timeout specified — implementation-defined |
| WhatsApp (community) | ~5-6 seconds implied by keepalive cadence |
| Discord | ~10 seconds |
| Stream Chat (Swift) | 15 seconds auto typing.stop |
| Ably Chat | heartbeatThrottleMs (default 10,000ms) + 2,000ms grace = 12s total |
| PubNub Chat SDK | 5,000ms default + 1,000ms buffer = ~6s effective |
| Stream Chat (JS) | Not explicitly documented but ~5s implied |

**Consensus**: 5-6 seconds is the industry de facto. Ably's 10+2 and Stream's 15 are outliers for longer-running operations. For a human typing indicator, 5-6s is the standard.

## 3. Group Fan-Out

**WhatsApp groups:**
- Composing event fans out to ALL N members in the group
- Group cap is 512 (up from 256 in 2022)
- 2025 beta feature: when multiple people type simultaneously, shows "X people are typing" aggregated count in the chat header (not individual names beyond the first)
- This is display-layer aggregation — the server still fans out individual events; client aggregates

**Telegram groups:**
- Shows "{Name} is typing" for small groups
- Aggregates to "N people are typing" when multiple people type simultaneously
- This is also client-side aggregation on top of per-person server fan-out
- No confirmed server-side suppression threshold for large groups based on available docs

**Signal:**
- Group typing indicators exist but are privacy-sensitive; minimal public documentation

**PubNub Chat SDK:**
- Typing indicators explicitly **disabled in public chats** (returns an error)
- Only enabled in private group channels
- This is a deliberate cost/abuse-prevention decision

**General principle:**
- At any reasonable group size (<=512), individual event fan-out is the universal approach
- Client-side aggregation ("3 people are typing") is the display pattern — not server-side suppression
- No confirmed hard threshold where WhatsApp/Telegram STOPS sending typing events in large groups

## 4. Cost Framing

**Relative cost: LOW in absolute terms, HIGH if done naively**
- A single typing event is tiny (~100 bytes over WebSocket)
- The danger is frequency: 1 keystroke/second per user with no debounce = O(N) tiny events per second, N = group size
- WhatsApp defense: sender-side 3s throttle + server-side 2s discard = maximum 1 event/2s per sender
- Supabase Realtime: production case study reduced 100 msgs/sec from 1,000,000 events/sec to 5,000 events/sec (200x) by adding proper filters and debouncing; typing indicators without debounce generate 50-100 events per keystroke (from Supabase production blog)
- Ably/PubNub both implement the throttle at the SDK layer to protect customers from themselves

**Supabase-specific:**
- Broadcast channels (not Presence, not postgres_changes) are the correct primitive for typing indicators
- Broadcast = zero DB writes, lower latency, auto-cleanup on disconnect
- Presence CRDT structures are for slow-changing state (online/offline); typing is high-frequency ephemeral

## 5. Best-Practice Numbers (Consensus for Supabase Realtime / Broadcast)

| Parameter | Value | Rationale |
|---|---|---|
| Sender debounce (start) | 300-500ms after first keystroke | Don't fire on first keystroke; wait for "real" typing episode |
| Keepalive re-send interval | 3,000ms (3 seconds) | Below the 5-6s receiver expiry; matches WhatsApp/Telegram cadence |
| Stop event delay | 2,000ms after last keystroke | Stream's pattern; Telegram uses ~3-5s |
| Receiver auto-expiry | 5,000-6,000ms | Universal industry standard; clear without explicit stop event |
| Large group degradation | Display-only: "X people are typing" when >2 active | Client-side aggregation, NOT server suppression |
| Group size threshold for suppression | No firm threshold found | WhatsApp fans out to all 512 members; PubNub disables in "public" channels |

**For Supabase Realtime specifically:**
- Use `channel.send({ type: 'broadcast', event: 'typing', payload: {userId} })`
- On the sender: throttle to max 1 event per 3 seconds using a timer
- On the receiver: `setTimeout(() => clearTyping(userId), 6000)` reset on each incoming event
- Do NOT use Presence for this — Presence CRDT is heavier and not designed for this frequency
- One channel per conversation (already how Swellyo works) — do not create a separate "typing" channel

## Sources

- XEP-0085: https://xmpp.org/extensions/xep-0085.html
- WhatsApp typing indicator deep-dive: https://dev.to/gabrielanhaia/designing-whatsapps-typing-indicator-the-question-that-tests-your-real-time-skills-34k1
- WhatsApp group typing feature (2025): https://www.brandligo.com/whatsapps-new-group-typing-indicator/
- Ably Chat typing docs: https://ably.com/docs/chat/rooms/typing
- PubNub Chat SDK typing: https://www.pubnub.com/docs/chat/chat-sdk/build/features/channels/typing-indicator
- Stream Chat JS typing: https://getstream.io/chat/docs/javascript/typing_indicators/
- Supabase Realtime 73% cost reduction: https://techsynth.tech/blog/reducing-supabase-realtime-costs-by-73-percent/
- Supabase Realtime in production (2026): https://www.agilesoftlabs.com/blog/2026/05/supabase-realtime-in-production-what
- Telegram setTyping MTProto: https://core.telegram.org/method/messages.setTyping
- Signal typing indicators: https://support.signal.org/hc/en-us/articles/360020798451-Typing-Indicators
