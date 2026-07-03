# In-App Banners for Bell Notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a native heads-up banner for every bell-notification push while the app is foregrounded, unless the user is looking at the notifications screen — silent in foreground, background behavior untouched.

**Architecture:** Bell pushes already arrive on-device (dispatch-notification-queue, live on prod) with `data.type` set to the real `NotificationType`; today the foreground gate suppresses everything except `message`. We extend the pure gate function to return `{show, sound}`, add a runtime set of bell types, and add a "notifications screen open" module flag set by `NotificationsPanel` on focus/blur (same manual-ref pattern as `currentConversationIdRef`). No server, DB, or navigation changes — tap routing already works.

**Tech Stack:** React Native + Expo 54, expo-notifications, jest-expo.

**Spec:** `docs/superpowers/specs/2026-07-02-bell-notification-banners-design.md`

## Global Constraints

- **Do NOT commit** — Ohad reviews and commits manually. Skip every commit step you'd normally add.
- **No device/simulator testing** — verify with jest + `npx tsc --noEmit` only; Ohad tests on-device himself.
- Background/killed-app push behavior must not change: `setNotificationHandler` only runs while the app is foregrounded, so all changes live inside that handler and its inputs.
- Message-banner behavior must not change (same show/suppress/sound results for `type === 'message'`).
- Unknown or missing `data.type` keeps legacy behavior: suppressed while foregrounded.
- Web untouched (`setupNotificationHandlers` already no-ops on web).

---

### Task 1: Bell-type set + screen-open flag (`notificationsService.ts`)

**Files:**
- Modify: `src/services/notifications/notificationsService.ts` (after the `NotificationType` union, lines 14-31)

**Interfaces:**
- Consumes: existing `NotificationType` union in the same file.
- Produces (used by Tasks 2-4):
  - `export const BELL_NOTIFICATION_TYPES: ReadonlySet<string>`
  - `export function setNotificationsScreenOpen(open: boolean): void`
  - `export function isNotificationsScreenOpen(): boolean`

- [ ] **Step 1: Add the set and the flag**

Insert immediately after the `NotificationType` union (after line 31), before `NotificationRow`:

```ts
/**
 * Every bell type, as a runtime set for the foreground push gate.
 * Record<NotificationType, true> forces exhaustiveness: adding a new
 * NotificationType without listing it here is a compile error.
 */
const BELL_TYPE_FLAGS: Record<NotificationType, true> = {
  member_joined: true,
  member_committed: true,
  gear_claimed: true,
  admin_update_posted: true,
  group_gear_updated: true,
  personal_gear_updated: true,
  gear_request_decided: true,
  commitment_decided: true,
  join_request_decided: true,
  join_request_received: true,
  gear_request_received: true,
  commitment_request_received: true,
  member_left: true,
  trip_cancelled: true,
  member_removed: true,
  trip_reminder: true,
  trip_ended: true,
};
export const BELL_NOTIFICATION_TYPES: ReadonlySet<string> = new Set(
  Object.keys(BELL_TYPE_FLAGS)
);

/**
 * "Is the notifications screen (bell panel) currently focused?" — module-level
 * flag, same manual pattern as MessagingProvider's currentConversationIdRef.
 * NotificationsPanel sets it on focus/blur; the push foreground gate reads it
 * to suppress banners for the screen the user is already looking at.
 */
let notificationsScreenOpen = false;
export function setNotificationsScreenOpen(open: boolean): void {
  notificationsScreenOpen = open;
}
export function isNotificationsScreenOpen(): boolean {
  return notificationsScreenOpen;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no NEW errors (compare against a pre-change run if the baseline isn't clean).

---

### Task 2: Extend the pure foreground gate (TDD)

**Files:**
- Modify: `src/services/notifications/__tests__/pushNotificationGate.test.ts` (full rewrite shown below)
- Modify: `src/services/notifications/pushNotificationService.ts:18-44` (pure function + its doc comment)

**Interfaces:**
- Consumes: `BELL_NOTIFICATION_TYPES` from `./notificationsService` (Task 1).
- Produces (used by Task 3):

```ts
export function shouldShowForegroundNotification(args: {
  notificationType: string | undefined;
  conversationId: string | null | undefined;
  currentConversationId: string | null;
  isNotificationsScreenOpen: boolean;
  isForeground: boolean;
}): { show: boolean; sound: boolean }
```

- [ ] **Step 1: Rewrite the test file with the new contract**

Replace the whole body of `src/services/notifications/__tests__/pushNotificationGate.test.ts` with:

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

/** Baseline args; individual tests override what they exercise. */
const base = {
  notificationType: undefined as string | undefined,
  conversationId: null as string | null | undefined,
  currentConversationId: null as string | null,
  isNotificationsScreenOpen: false,
  isForeground: true,
};

describe('shouldShowForegroundNotification', () => {
  describe('message notifications (behavior unchanged, sound follows show)', () => {
    it('shows with sound when foreground and a DIFFERENT conversation is open', () => {
      expect(
        shouldShowForegroundNotification({
          ...base,
          notificationType: 'message',
          conversationId: 'conv-A',
          currentConversationId: 'conv-B',
        })
      ).toEqual({ show: true, sound: true });
    });

    it('suppresses when foreground and the SAME conversation is open', () => {
      expect(
        shouldShowForegroundNotification({
          ...base,
          notificationType: 'message',
          conversationId: 'conv-A',
          currentConversationId: 'conv-A',
        })
      ).toEqual({ show: false, sound: false });
    });

    it('shows when foreground and NO conversation is open', () => {
      expect(
        shouldShowForegroundNotification({
          ...base,
          notificationType: 'message',
          conversationId: 'conv-A',
        })
      ).toEqual({ show: true, sound: true });
    });

    it('shows when backgrounded (different conversation)', () => {
      expect(
        shouldShowForegroundNotification({
          ...base,
          notificationType: 'message',
          conversationId: 'conv-A',
          currentConversationId: 'conv-B',
          isForeground: false,
        })
      ).toEqual({ show: true, sound: true });
    });

    it('ignores the notifications-screen flag for messages', () => {
      expect(
        shouldShowForegroundNotification({
          ...base,
          notificationType: 'message',
          conversationId: 'conv-A',
          isNotificationsScreenOpen: true,
        })
      ).toEqual({ show: true, sound: true });
    });
  });

  describe('bell notifications (new: in-app banners, silent in foreground)', () => {
    const BELL_SAMPLE = [
      'join_request_received',
      'commitment_decided',
      'gear_request_received',
      'member_joined',
      'trip_reminder',
    ];

    it.each(BELL_SAMPLE)(
      '%s shows SILENTLY in foreground when notifications screen is closed',
      (type) => {
        expect(
          shouldShowForegroundNotification({ ...base, notificationType: type })
        ).toEqual({ show: true, sound: false });
      }
    );

    it.each(BELL_SAMPLE)(
      '%s is suppressed in foreground when notifications screen is OPEN',
      (type) => {
        expect(
          shouldShowForegroundNotification({
            ...base,
            notificationType: type,
            isNotificationsScreenOpen: true,
          })
        ).toEqual({ show: false, sound: false });
      }
    );

    it('shows with sound when backgrounded', () => {
      expect(
        shouldShowForegroundNotification({
          ...base,
          notificationType: 'join_request_received',
          isForeground: false,
        })
      ).toEqual({ show: true, sound: true });
    });

    it('shows when backgrounded even if the screen flag is stale-open', () => {
      expect(
        shouldShowForegroundNotification({
          ...base,
          notificationType: 'join_request_received',
          isNotificationsScreenOpen: true,
          isForeground: false,
        })
      ).toEqual({ show: true, sound: true });
    });
  });

  describe('unknown / missing types (legacy: suppressed in foreground)', () => {
    it('suppresses an unknown type in the foreground', () => {
      expect(
        shouldShowForegroundNotification({
          ...base,
          notificationType: 'some_future_type',
        })
      ).toEqual({ show: false, sound: false });
    });

    it('suppresses a missing type in the foreground', () => {
      expect(shouldShowForegroundNotification({ ...base })).toEqual({
        show: false,
        sound: false,
      });
    });

    it('shows an unknown type when backgrounded', () => {
      expect(
        shouldShowForegroundNotification({
          ...base,
          notificationType: 'some_future_type',
          isForeground: false,
        })
      ).toEqual({ show: true, sound: true });
    });
  });
});
```

- [ ] **Step 2: Run the tests — expect failure**

Run: `npx jest src/services/notifications/__tests__/pushNotificationGate.test.ts`
Expected: FAIL — TS/shape errors (function still returns `boolean`, doesn't accept `isNotificationsScreenOpen`).

- [ ] **Step 3: Implement the new gate**

In `src/services/notifications/pushNotificationService.ts`, add to the imports (line 5 area):

```ts
import { BELL_NOTIFICATION_TYPES } from './notificationsService';
```

Replace the doc comment + function at lines 18-44 with:

```ts
/**
 * Pure decision for whether a received notification should surface a banner /
 * sound / badge. Runs only while the app is foregrounded (expo-notifications
 * handler); background pushes are rendered by the OS and never reach this.
 *
 * Rules:
 *  • message notifications → show (with sound) UNLESS they belong to the
 *    currently-open conversation.
 *  • bell notification types (see BELL_NOTIFICATION_TYPES) → show UNLESS the
 *    user is looking at the notifications screen. SILENT while foregrounded —
 *    the user is already in the app; sound is for pulling them in from outside.
 *  • unknown / missing types → legacy rule: suppress while foregrounded.
 *
 * Exported (not on the class) so it can be unit-tested without a real client.
 */
export function shouldShowForegroundNotification(args: {
  notificationType: string | undefined;
  conversationId: string | null | undefined;
  currentConversationId: string | null;
  isNotificationsScreenOpen: boolean;
  isForeground: boolean;
}): { show: boolean; sound: boolean } {
  const isSameConversation =
    !!args.conversationId && args.conversationId === args.currentConversationId;

  if (args.notificationType === 'message') {
    const show = !isSameConversation;
    return { show, sound: show };
  }

  if (!!args.notificationType && BELL_NOTIFICATION_TYPES.has(args.notificationType)) {
    const show = !(args.isForeground && args.isNotificationsScreenOpen);
    return { show, sound: show && !args.isForeground };
  }

  const show = !args.isForeground && !isSameConversation;
  return { show, sound: show };
}
```

- [ ] **Step 4: Run the tests — expect pass**

Run: `npx jest src/services/notifications/__tests__/pushNotificationGate.test.ts`
Expected: PASS (all tests). Note: `npx tsc --noEmit` will FAIL until Task 3 updates the caller in `setupNotificationHandlers` — that's expected at this point.

---

### Task 3: Wire the gate into the handler (`pushNotificationService.ts`)

**Files:**
- Modify: `src/services/notifications/pushNotificationService.ts:46-55` (class fields), `:192-244` (setup + handler)

**Interfaces:**
- Consumes: `shouldShowForegroundNotification` (Task 2 shape).
- Produces (used by Task 4):

```ts
setupNotificationHandlers(
  getCurrentConversationId: () => string | null,
  onNotificationTap: (payload: NotificationTapPayload) => void,
  getIsNotificationsScreenOpen?: () => boolean  // defaults to () => false
): void
```

- [ ] **Step 1: Add the class field**

Next to the existing `getCurrentConversationId` field (line 53):

```ts
  private getIsNotificationsScreenOpen: (() => boolean) | null = null;
```

- [ ] **Step 2: Extend the setup signature and store the getter**

Change the `setupNotificationHandlers` signature (lines 196-203) to:

```ts
  setupNotificationHandlers(
    getCurrentConversationId: () => string | null,
    onNotificationTap: (payload: NotificationTapPayload) => void,
    getIsNotificationsScreenOpen: () => boolean = () => false
  ): void {
    if (Platform.OS === 'web') return;

    this.getCurrentConversationId = getCurrentConversationId;
    this.onNotificationTap = onNotificationTap;
    this.getIsNotificationsScreenOpen = getIsNotificationsScreenOpen;
```

- [ ] **Step 3: Update the handler body and its comment**

Update the explanatory comment above `setNotificationHandler` (lines 205-217): replace the paragraph starting "Non-message notifications (trip reminders, requests, gear) keep the legacy rule" with:

```ts
    // Bell notification types (requests, commitments, gear, member events,
    // reminders) also show in the foreground — silently — unless the user is
    // looking at the notifications screen. Unknown types keep the legacy rule:
    // suppressed while foregrounded, shown when backgrounded.
```

Replace the `handleNotification` body (lines 219-242) with:

```ts
      handleNotification: async (notification) => {
        const data = notification.request.content.data as
          | { type?: string; conversationId?: string }
          | undefined;
        const conversationId = data?.conversationId;
        const notificationType = data?.type;
        const currentId = this.getCurrentConversationId?.() ?? null;
        const isForeground = AppState.currentState === 'active';

        const { show, sound } = shouldShowForegroundNotification({
          notificationType,
          conversationId,
          currentConversationId: currentId,
          isNotificationsScreenOpen: this.getIsNotificationsScreenOpen?.() ?? false,
          isForeground,
        });
        return {
          // Legacy key (pre-SDK 54) — kept for backwards compat
          shouldShowAlert: show,
          // SDK 54+ replacement keys
          shouldShowBanner: show,
          shouldShowList: show,
          shouldPlaySound: sound,
          shouldSetBadge: show,
        };
      },
```

- [ ] **Step 4: Verify**

Run: `npx jest src/services/notifications/__tests__/pushNotificationGate.test.ts && npx tsc --noEmit`
Expected: tests PASS; tsc has no NEW errors (the Task 2 caller mismatch is now resolved; `AppContent` still passes 2 args — fine, the third is optional).

---

### Task 4: Screen awareness + wiring (`NotificationCenter.tsx`, `AppContent.tsx`)

**Files:**
- Modify: `src/components/notifications/NotificationCenter.tsx` (import block ending line 31; `NotificationsPanel` focus effects near line 186)
- Modify: `src/components/AppContent.tsx:63-67` (imports), `:384-410` (handler setup)

**Interfaces:**
- Consumes: `setNotificationsScreenOpen` / `isNotificationsScreenOpen` (Task 1), optional third param of `setupNotificationHandlers` (Task 3).
- Produces: user-visible behavior; nothing downstream.

- [ ] **Step 1: Flag the panel open/closed on focus/blur**

In `NotificationCenter.tsx`, add `setNotificationsScreenOpen` to the existing import from `'../../services/notifications/notificationsService'` (the import ends at line 31).

Inside `NotificationsPanel`, directly ABOVE the existing realtime `useFocusEffect` (line 186), add:

```ts
  // Tell the push foreground gate the bell screen is visible: banners for bell
  // notifications are suppressed while the user is already looking at the list
  // (the focused realtime subscription below inserts the row live instead).
  useFocusEffect(
    useCallback(() => {
      setNotificationsScreenOpen(true);
      return () => setNotificationsScreenOpen(false);
    }, [])
  );
```

(`useFocusEffect` and `useCallback` are already imported in this file — verify, they're used at lines 186-187.)

- [ ] **Step 2: Pass the getter from AppContent**

In `AppContent.tsx`, add `isNotificationsScreenOpen` to the existing import from `'../services/notifications/notificationsService'` (ends at line 67).

In the `setupNotificationHandlers` call (lines 386-407), add the third argument after the tap callback:

```ts
    pushNotificationService.setupNotificationHandlers(
      getCurrentConversationId,
      (payload) => {
        // ... existing tap callback UNCHANGED ...
      },
      isNotificationsScreenOpen
    );
```

Do not modify the tap callback body or the effect's dependency array.

- [ ] **Step 3: Full verify**

Run: `npx jest src/services/notifications/__tests__/pushNotificationGate.test.ts && npx tsc --noEmit`
Expected: tests PASS, no new tsc errors.

- [ ] **Step 4: Manual device test plan (Ohad, later — not part of this session)**

1. App foregrounded, NOT on the bell screen → trigger a bell event from a second account (e.g. join request on a dev-only trip) → after ≤ ~1 min (queue cron) a SILENT banner appears; tapping it opens the trip at the right section.
2. Bell screen open → repeat → NO banner; the row appears live in the list.
3. App backgrounded → repeat → normal push with sound (unchanged).
4. Message banners → unchanged (banner+sound for other chats, suppressed for the open one).

⚠️ Per prior incident rules: only trigger events on trips where ALL members are dev accounts — real users receive pushes for real trips.
