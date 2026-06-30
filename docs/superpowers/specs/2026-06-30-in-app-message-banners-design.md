# In-App Message Banners (Native Foreground Notifications)

**Date:** 2026-06-30
**Branch:** ohad
**Status:** Design approved — ready for implementation plan

## Problem

When a user is actively inside the Swellyo app and receives a message in a
conversation they don't currently have open, nothing visible happens — no
banner, no sound. Today `pushNotificationService` deliberately suppresses all
notifications while the app is in the foreground
(`pushNotificationService.ts:198`: `shouldShow = !isForeground && !isSameConversation`).
Users miss incoming DMs and group-chat messages until they manually return to
the chat list.

We want a top-of-screen banner — the same one the user sees from WhatsApp — for
incoming messages while the app is open, on every screen **except** the
conversation that is currently open.

## Approach: Native foreground notifications (Approach A)

Reuse the existing push pipeline instead of building a custom React Native
overlay. The banner the user wants (their reference screenshot) is the **native
iOS notification** shown while the app is foregrounded. We achieve it by no
longer suppressing notifications in the foreground, letting iOS/Android render
their own heads-up banner.

This was chosen over a custom in-app banner component (Approach B) by the user.
Tradeoffs accepted:
- Banner is driven by the **server push round-trip** (`send-push-notification`
  edge function), so it appears ~1–3s after the message — slightly behind the
  realtime chat-list update.
- **Will not appear in Expo Go.** Requires a dev/preview build on a real device
  with push permission granted. Testing happens there, not Expo Go.
- Banner **look is OS-rendered** — we don't control styling; iOS and Android
  each draw their own. Must be verified on both platforms.

The previously-built custom-banner mockups (`.superpowers/brainstorm/.../banner-*.html`)
are not used by this approach; the native OS banner is the final look.

## Behavior

- **Triggers for:** DMs + group/trip chats, message from another user.
- **Shown on:** every screen — chat list, other conversations, onboarding, etc.
- **Suppressed only when:** the message's conversation is the one currently open
  (`getCurrentConversationId()` match). Background behavior is unchanged (OS
  shows notifications as it already does).
- **Foreground feedback:** banner **+ soft sound + badge bump**.
- **Tap:** opens the conversation (existing deep-link via `onNotificationTap` /
  response listener — no change needed).
- **Dismiss / auto-dismiss / rapid-message coalescing:** handled natively by
  iOS/Android (one notification per conversation, collapsed with a count by the
  OS). No custom logic.

### Banner content (already built server-side, no change needed)
- **DM:** leading image = sender profile photo · title = sender name · body = message
- **Group:** leading image = trip hero image · title = group name · body = `"Sender: message"`

## Changes

### Change 1 — Client handler
**File:** `src/services/notifications/pushNotificationService.ts` (~line 192–208)

In the `setNotificationHandler` callback, change the gate from:
```ts
const shouldShow = !isForeground && !isSameConversation;
```
to:
```ts
const shouldShow = !isSameConversation;
```

Effect: foreground messages for a chat that isn't open now show banner + play
sound + set badge (all five `shouldShow*` flags already follow this one
variable). The currently-open chat stays suppressed. Background unchanged.

Also update the explanatory comment block above (lines ~177–191), which
currently documents the **opposite** intent ("in the foreground, NEVER show a
heads-up banner"). Rewrite it to describe the new rule: suppress only when the
payload's `conversationId` equals the currently-open conversation.

`isForeground` may become unused after this change — remove it if so, or keep it
only if still referenced.

No other client changes: tap routing (`onNotificationTap`), the rich-avatar
notification service extension, block checks, and push-token handling all stay
as-is.

### Change 2 — Edge function message-body labels
**File:** `supabase/functions/send-push-notification/index.ts` (~lines 51–57)

Current logic only special-cases images:
```ts
let body: string;
if (msg.type === 'image') {
  body = 'Sent a photo';
} else {
  body = msg.body || '';
  if (body.length > 100) body = body.substring(0, 97) + '...';
}
```

Extend the type→body map (message `type` values confirmed in the codebase:
`text`, `image`, `audio` = voice, `video`):
```ts
let body: string;
if (msg.type === 'image') {
  body = 'Sent a photo';
} else if (msg.type === 'audio') {
  body = 'Sent a voice message';
} else if (msg.type === 'video') {
  body = 'Sent a video';
} else {
  body = msg.body || '';
  if (body.length > 100) body = body.substring(0, 97) + '...';
}
```

This fixes blank bodies for voice/video in both the foreground banner **and**
real background pushes.

**Deploy procedure (per project workflow — edge functions are copy-pasted into
the Supabase dashboard and the repo file can drift from live):**
1. Download / view the **live** `send-push-notification` source from the
   dashboard.
2. Diff it against the repo file. Reconcile any drift before editing.
3. Apply the body-map change on top of the live version.
4. Copy-paste the result into the Supabase dashboard and deploy.
5. Update the repo file to match what was deployed.

## Files touched

| File | Change |
|------|--------|
| `src/services/notifications/pushNotificationService.ts` | One-line gate change + comment rewrite |
| `supabase/functions/send-push-notification/index.ts` | Body-map for `audio`/`video` + redeploy |

## Acceptance criteria

1. With the app foregrounded, a DM from another user (chat not open) shows a
   native heads-up banner with the sender's photo, name, and message, plus a
   soft sound and badge bump.
2. A group-chat message (chat not open) shows the trip hero image, group name,
   and `"Sender: message"`.
3. Opening the conversation that a message belongs to shows **no** banner for
   that conversation's incoming messages.
4. Background notifications are unchanged.
5. Voice messages show `"Sent a voice message"`; video shows `"Sent a video"` —
   in both the foreground banner and a backgrounded push.
6. Tapping a banner opens the correct conversation.
7. Verified on a dev/preview build on both iOS and Android (not Expo Go).

## Out of scope

- Custom-styled in-app banner component (Approach B).
- Swelly AI chat banners.
- In-app banner while backgrounded (OS already handles this).
- Per-user mute / notification preferences UI.
