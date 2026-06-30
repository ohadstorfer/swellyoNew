# In-App Message Banners Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a native top-of-screen notification banner (+ soft sound + badge) for incoming DM and group-chat messages while the app is foregrounded, on every screen except the conversation that is currently open.

**Architecture:** Reuse the existing Expo push pipeline. Stop suppressing notifications in the foreground for **message** notifications only, letting iOS/Android render their native heads-up banner. Non-message notification types (trip reminders, requests, gear) keep their current foreground-suppressed behavior. Separately, fix the server-built push body so voice/video messages show readable labels instead of a blank line.

**Tech Stack:** React Native 0.81 / Expo 54, `expo-notifications` (`setNotificationHandler`), Supabase Edge Function (Deno) for push body, Jest (`jest-expo`) for the client unit test.

---

## Background (read before starting)

The foreground-suppression rule lives in `src/services/notifications/pushNotificationService.ts` inside `setNotificationHandler`. Today:

```ts
const shouldShow = !isForeground && !isSameConversation;
```

This forces every notification off while the app is active. We want **message** notifications to show in the foreground unless they belong to the currently-open chat. We must NOT change behavior for other notification types.

Message pushes are discriminated by `data.type === 'message'` and carry `data.conversationId` (confirmed in `supabase/functions/send-push-notification/index.ts:186-195`). The currently-open conversation id is available via `this.getCurrentConversationId()`.

Existing test convention (`src/services/notifications/__tests__/notificationsService.test.ts`): test **pure exported functions**, mock `../../../config/supabase` so no network/DB is touched. We follow that — extract the gate decision into a pure exported function and unit-test it.

Message `type` values in this codebase: `text`, `image`, `audio` (= voice), `video`.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/services/notifications/pushNotificationService.ts` | Foreground notification gate | Add pure exported `shouldShowForegroundNotification(...)`; use it in the handler for all five `shouldShow*` flags; rewrite the now-inverted comment |
| `src/services/notifications/__tests__/pushNotificationGate.test.ts` | Unit test for the gate | Create |
| `supabase/functions/send-push-notification/index.ts` | Server-built push title/body | Add `audio`/`video` labels to the body map; redeploy |

---

## Task 1: Foreground gate for message notifications (client, TDD)

**Files:**
- Create: `src/services/notifications/__tests__/pushNotificationGate.test.ts`
- Modify: `src/services/notifications/pushNotificationService.ts` (add exported helper near top of module; use it in the handler at ~line 192-208; rewrite comment at ~line 177-191)

- [ ] **Step 1: Write the failing test**

Create `src/services/notifications/__tests__/pushNotificationGate.test.ts`:

```ts
/**
 * Unit tests for the pure foreground-notification gate.
 *
 * SAFETY: zero network, zero DB. We import only the pure helper; the supabase
 * client is mocked so importing the service never opens a connection.
 */
jest.mock('../../../config/supabase', () => ({
  supabase: {},
  isSupabaseConfigured: () => false,
}));

import { shouldShowForegroundNotification } from '../pushNotificationService';

describe('shouldShowForegroundNotification', () => {
  describe('message notifications', () => {
    it('shows when foreground and a DIFFERENT conversation is open', () => {
      expect(
        shouldShowForegroundNotification({
          notificationType: 'message',
          conversationId: 'conv-A',
          currentConversationId: 'conv-B',
          isForeground: true,
        })
      ).toBe(true);
    });

    it('suppresses when foreground and the SAME conversation is open', () => {
      expect(
        shouldShowForegroundNotification({
          notificationType: 'message',
          conversationId: 'conv-A',
          currentConversationId: 'conv-A',
          isForeground: true,
        })
      ).toBe(false);
    });

    it('shows when foreground and NO conversation is open', () => {
      expect(
        shouldShowForegroundNotification({
          notificationType: 'message',
          conversationId: 'conv-A',
          currentConversationId: null,
          isForeground: true,
        })
      ).toBe(true);
    });

    it('shows when backgrounded (different conversation)', () => {
      expect(
        shouldShowForegroundNotification({
          notificationType: 'message',
          conversationId: 'conv-A',
          currentConversationId: 'conv-B',
          isForeground: false,
        })
      ).toBe(true);
    });
  });

  describe('non-message notifications (unchanged behavior)', () => {
    it('suppresses in the foreground', () => {
      expect(
        shouldShowForegroundNotification({
          notificationType: 'trip_reminder',
          conversationId: null,
          currentConversationId: null,
          isForeground: true,
        })
      ).toBe(false);
    });

    it('shows when backgrounded', () => {
      expect(
        shouldShowForegroundNotification({
          notificationType: 'trip_reminder',
          conversationId: null,
          currentConversationId: null,
          isForeground: false,
        })
      ).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- pushNotificationGate`
Expected: FAIL — `shouldShowForegroundNotification is not a function` / not exported.

- [ ] **Step 3: Add the pure exported helper**

In `src/services/notifications/pushNotificationService.ts`, add this module-level export **above** the `class PushNotificationService` declaration (after the imports / `NotificationTapPayload` interface):

```ts
/**
 * Pure decision for whether a received notification should surface a banner /
 * sound / badge.
 *
 * Rule:
 *  • message notifications  → show UNLESS they belong to the currently-open
 *    conversation (so you get a banner for every other chat, foreground or not).
 *  • all other types        → keep the legacy behavior: suppress while the app
 *    is in the foreground, show when backgrounded.
 *
 * Exported (not on the class) so it can be unit-tested without a real client.
 */
export function shouldShowForegroundNotification(args: {
  notificationType: string | undefined;
  conversationId: string | null | undefined;
  currentConversationId: string | null;
  isForeground: boolean;
}): boolean {
  const isMessage = args.notificationType === 'message';
  const isSameConversation =
    !!args.conversationId && args.conversationId === args.currentConversationId;

  if (isMessage) {
    return !isSameConversation;
  }
  return !args.isForeground && !isSameConversation;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- pushNotificationGate`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Wire the helper into the handler**

In the same file, replace the `setNotificationHandler` block (currently ~lines 177-208). Replace the comment block AND the `shouldShow` computation. New version:

```ts
    // Decide whether a received notification surfaces a banner / sound / badge.
    //
    // Message notifications now show in the FOREGROUND too — a native heads-up
    // banner for any chat that isn't the one currently open (in-app message
    // banners). The currently-open conversation stays suppressed so you don't
    // get a banner for the chat you're already reading.
    //
    // Non-message notifications (trip reminders, requests, gear) keep the
    // legacy rule: suppressed while foregrounded, shown when backgrounded.
    //
    // Note: expo-notifications SDK 54 deprecated `shouldShowAlert` in favor of
    // `shouldShowBanner` + `shouldShowList`. We set all three for safety so
    // this keeps working across upgrades.
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const data = notification.request.content.data as
          | { type?: string; conversationId?: string }
          | undefined;
        const conversationId = data?.conversationId;
        const notificationType = data?.type;
        const currentId = this.getCurrentConversationId?.() ?? null;
        const isForeground = AppState.currentState === 'active';

        const shouldShow = shouldShowForegroundNotification({
          notificationType,
          conversationId,
          currentConversationId: currentId,
          isForeground,
        });

        return {
          // Legacy key (pre-SDK 54) — kept for backwards compat
          shouldShowAlert: shouldShow,
          // SDK 54+ replacement keys
          shouldShowBanner: shouldShow,
          shouldShowList: shouldShow,
          shouldPlaySound: shouldShow,
          shouldSetBadge: shouldShow,
        };
      },
    });
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors from `pushNotificationService.ts`. (If `isForeground` or other locals are reported unused, the block above already removed the old ones — confirm no stray references remain.)

- [ ] **Step 7: Run the full notifications test folder**

Run: `npm test -- src/services/notifications`
Expected: PASS — new gate tests plus existing `notificationsService` tests stay green.

- [ ] **Step 8: Commit**

```bash
git add src/services/notifications/pushNotificationService.ts \
        src/services/notifications/__tests__/pushNotificationGate.test.ts
git commit -m "feat(notifications): show foreground banner for messages outside the open chat"
```

---

## Task 2: Voice/video push body labels (edge function)

This is a Deno edge function deployed by copy-paste into the Supabase dashboard; the repo file can drift from the live version. It cannot be exercised by the Jest suite, so it is verified manually (Step 4) on a device build.

**Files:**
- Modify: `supabase/functions/send-push-notification/index.ts` (body map, ~lines 51-57)

- [ ] **Step 1: Reconcile live vs repo BEFORE editing**

Open the Supabase dashboard → Edge Functions → `send-push-notification` → view the deployed source. Diff it against the repo file `supabase/functions/send-push-notification/index.ts`. If they differ, update the repo file to match live first (and note the drift), so the change below is applied on top of what is actually running.

- [ ] **Step 2: Edit the body map**

In `supabase/functions/send-push-notification/index.ts`, replace this block (~lines 51-57):

```ts
  let body: string;
  if (msg.type === 'image') {
    body = 'Sent a photo';
  } else {
    body = msg.body || '';
    if (body.length > 100) body = body.substring(0, 97) + '...';
  }
```

with:

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

- [ ] **Step 3: Deploy**

Copy the full, reconciled file contents into the Supabase dashboard `send-push-notification` editor and Deploy. Confirm the deploy succeeds (dashboard shows the new version / no build error).

- [ ] **Step 4: Manual verification matrix (device build, not Expo Go)**

On a dev/preview build, recipient device, with the app **backgrounded** (so the push body is plainly visible), have another account send each type and confirm the notification body:

| Message type | Expected DM body | Expected group body |
|--------------|------------------|---------------------|
| text         | the text (truncated > 100) | `Sender: the text` |
| image        | `Sent a photo`   | `Sender: Sent a photo` |
| audio (voice)| `Sent a voice message` | `Sender: Sent a voice message` |
| video        | `Sent a video`   | `Sender: Sent a video` |

Expected: no blank-body notifications for voice or video.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/send-push-notification/index.ts
git commit -m "feat(push): label voice and video messages in push body"
```

---

## Task 3: End-to-end device verification (Approach A acceptance)

No code — this is the on-device acceptance pass for the whole feature. Requires a dev/preview build on a real device with push permission granted, on **both iOS and Android**, with a second test account. (In-app banners do NOT appear in Expo Go.)

- [ ] **Step 1: Foreground DM, different chat**

Open the app on a screen that is NOT the test DM (e.g. the chat list). Send a DM from the other account.
Expected: native heads-up banner with sender photo + name + message text, a soft sound, and the app badge increments.

- [ ] **Step 2: Foreground, inside that chat → suppressed**

Open the test DM conversation. Send another DM from the other account.
Expected: NO banner and NO sound for that conversation; the message just appears in the thread.

- [ ] **Step 3: Foreground group chat**

On any screen except the group chat, send a group message from the other account.
Expected: banner shows the trip hero image, the group name as title, and `Sender: message` as the body.

- [ ] **Step 4: Tap routing**

Tap a banner from Step 1 or 3.
Expected: the app opens the correct conversation.

- [ ] **Step 5: Non-message notifications unchanged**

Trigger a non-message notification (e.g. a trip request/reminder) while foregrounded.
Expected: still suppressed in the foreground (no behavior change vs before this feature).

- [ ] **Step 6: Both platforms**

Repeat Steps 1-4 on the other platform (iOS and Android).
Expected: banner appears on both; styling is each OS's native look.

---

## Self-Review (completed by plan author)

- **Spec coverage:** Foreground message banner (Task 1) ✓; suppress open chat (Task 1 + T3 S2) ✓; sound + badge (Task 1 flags, T3 S1) ✓; tap opens conversation (existing, verified T3 S4) ✓; voice/video labels (Task 2) ✓; both platforms (T3 S6) ✓; Expo-Go caveat called out ✓.
- **Refinement vs spec:** The spec wrote the gate as `shouldShow = !isSameConversation`. That would also unsuppress *non-message* notifications in the foreground (trip reminders, requests). This plan narrows it to message notifications only (`data.type === 'message'`) to keep the blast radius to exactly the requested feature; non-message behavior is unchanged and explicitly tested (Task 1 + T3 S5).
- **Placeholder scan:** none — all steps contain concrete code/commands.
- **Type consistency:** `shouldShowForegroundNotification` signature is identical in the test (Task 1 Step 1) and the implementation (Task 1 Step 3) and the call site (Task 1 Step 5).
