---
name: whatsapp-failed-pending-message-ux
description: WhatsApp pending/sending/failed text message UX — full tick-state spec, retry timing, ordering, RN offline-queue implementation patterns
metadata:
  type: reference
---

# WhatsApp Pending/Failed Message UX — Full Spec

Companion to [[whatsapp-photo-send-failure-ux]] (media-specific) and [[whatsapp-send-animation]] (entering animation). This file covers text messages and the general status-state machine.

## 1. Pending/sending state
- Bubble appears in the thread **immediately** on tap-send (optimistic), at the bottom of the list, regardless of connectivity. Never blocks the UI waiting for a server round-trip.
- Icon: a small clock/circle-with-hands icon, bottom-right of the bubble, in the exact spot the tick marks occupy once sent. No spinner, no "sending..." text.
- Input clears synchronously the moment send is tapped, before any network activity.
- Stays pending indefinitely (no visible timeout countdown) until either it reaches the server (converts to single grey tick) or WhatsApp gives up and shows the failed state.

## 2. Status indicator states (bottom-right of bubble, sender-side only)
| State | Icon | Meaning |
|---|---|---|
| Pending/sending | Clock | Not yet left the device / not yet reached WhatsApp servers |
| Sent | Single grey check | Left the device, arrived at WhatsApp's server |
| Delivered | Double grey check | Arrived at recipient's device (not necessarily opened) |
| Read | Double blue check | Recipient opened the chat and viewed it. Requires read receipts on both sides — if recipient disabled read receipts, stays grey double-check even after reading. If sender is blocked, caps at single grey forever. |
| Failed | Red circled exclamation mark | Same position, replaces the clock |

Group chats: double-blue only shows once **every** participant has read it — one unread recipient holds the whole group message at grey, even if most already saw it.

## 3. Failed state interaction
- After enough failed delivery attempts (exact timeout undocumented publicly — commonly observed as tens of seconds to a couple minutes of no connectivity, or an explicit server rejection), clock is replaced by red "!" in a circle.
- Tap the red icon (or long-press the bubble) → context menu with **"Resend message"** (sometimes shown with "Delete" alongside). No re-typing needed — original content/attachment reference is retained locally.
- Signal's equivalent is more verbose: red exclamation → "Not delivered" / "Tap for details" → "Failed to send" with a "Resend" action. Telegram is the outlier — its failures are frequently silent/opaque, a widely-criticized gap vs. WhatsApp and Signal (community consensus this is one of Telegram's weaker UX points).

## 4. Auto-retry behavior
- **No-connectivity-at-send-time**: fully automatic. Message queues locally, clock icon shown, and WhatsApp auto-retries in the background the moment connectivity returns — zero user action required, no manual retry needed for this case.
- **True failure** (partial upload/send that errors out, server rejection, blocked recipient, etc.): does NOT auto-retry. Shows the red "!" and requires an explicit manual tap to resend.
- Multiple queued messages send in original order once connectivity returns (see Ordering below).
- Signal users have explicitly requested WhatsApp/iMessage-style "auto-retry until delivered" (GitHub signalapp/Signal-Android #7888, #4115) — implying WhatsApp's auto-retry-on-reconnect is the community-recognized gold standard other apps get asked to copy.

## 5. Ordering & timestamps
- Pending/failed messages stay fixed at the bottom, in original send order — they never reorder past each other or jump around while pending.
- When a queued message finally sends, its **displayed timestamp does not change** — it keeps the time it was composed/tapped-send, not the time it actually left the device. (This matches general chat-app convention: timestamp = user intent time, not network time.)
- If message 2 of 3 queued fails while 1 and 3 succeed, each bubble tracks independent state — no blocking of siblings (confirmed in the photo-send research too, see [[whatsapp-photo-send-failure-ux]]).

## 6. Cross-app comparison + RN implementation patterns

**iMessage**: red "!" bubble variant, "Not Delivered" label with a "Try Again" / "Send as Text Message" (SMS fallback) option — the SMS-fallback is iMessage-specific (dual-protocol), not applicable to a single-protocol app.

**Signal**: most explicit/verbose failure UX (multi-step disclosure: icon → "tap for details" → explanation → resend). Prioritizes making failure legible over minimizing UI. Community has repeatedly asked for WhatsApp-style silent auto-retry (Signal-Android #7888).

**Telegram**: weakest UX in this space — failures are commonly logged but not surfaced, users perceive the app as "hung." Explicitly called out as a negative example — do not replicate this.

**General RN implementation pattern** (per GetStream Chat RN SDK docs + community offline-first writeups, 2025-2026):
- Generate a client-side **temp/local ID** (e.g. `temp_${uuid()}`) at tap-send time; insert into local state immediately with `status: 'pending'`.
- Message row carries a `status` field: `'pending' | 'sent' | 'delivered' | 'read' | 'failed'` — drives which icon renders, no separate boolean flags.
- Use `NetInfo.addEventListener` to detect reconnect and trigger `processQueue()` — flush all `pending` messages in original order. Also flush on `AppState` foreground, not just network change, since apps can be backgrounded through a reconnect.
- Persist the queue (AsyncStorage/MMKV) so pending/failed messages **survive app kill** — GetStream's docs explicitly call this out as a hard requirement ("queued actions persist across app restarts and OS kills").
- Exponential backoff on auto-retry to avoid hammering the server on flaky connections; give up after N attempts (or M seconds) and flip to `'failed'` — do not retry forever silently (this is what makes Telegram's UX bad).
- Reconcile temp ID → server ID: on ack, swap the local temp id for the DB-assigned id in place (do not remove-and-reinsert — that causes list flicker/reorder).
- Manual retry from `'failed'` re-uses the same temp id and original payload; don't ask the user to re-enter/re-pick anything.

## Sources
- https://www.pandasecurity.com/en/mediacenter/whatsapp-check-marks/
- https://techwhack.com/apps/whatsapp-ticks-meaning/
- https://faq.whatsapp.com/5155925751185676
- https://www.techgamingreport.com/whatsapp-shows-a-red-exclamation-mark-this-must-be-done-now/
- https://github.com/signalapp/Signal-Android/issues/7888
- https://github.com/signalapp/Signal-Android/issues/4115
- https://getstream.io/chat/docs/sdk/react-native/basics/offline-support/
- https://github.com/rgommezz/react-native-offline
- https://medium.com/@didemsahin1789/optimistic-updates-offline-thinking-in-react-native-274b702f0652
