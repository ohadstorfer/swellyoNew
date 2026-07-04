# In-App Banner Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace native foreground notification banners with a custom WhatsApp-style in-app banner (instant, realtime-driven) for bell notifications and chat messages; native pushes remain background-only.

**Architecture:** A module-level event bus feeds a single reanimated overlay host mounted at AppContent's root. Bell events come from a new shared notifications realtime hub (replaces today's 2 subscriptions with 1); message events piggyback on MessagingProvider's existing arrival path (zero new subscriptions). The native foreground gate reverts to suppress-all-while-foregrounded.

**Tech Stack:** React Native, react-native-reanimated 3, react-native-gesture-handler 2 (root RNGH view already wraps the app — the host is NOT a Modal so no local root needed), expo-image, Supabase realtime (postgres_changes), jest-expo.

**Spec:** `docs/superpowers/specs/2026-07-04-in-app-banner-overlay-design.md` — read it for rationale.

## Global Constraints

- **Do NOT commit** — the controller commits at the end. Never run git write commands.
- **No device/simulator testing** — verify with jest + `npx tsc --noEmit` (baseline errors exist only in `supabase/functions/*` and a few legacy service files; require no NEW errors).
- **No new native dependencies** (no expo-haptics — v1 has no haptic; feature must stay OTA-able onto runtime 1.3.0). No server/DB/edge-function changes.
- **No new realtime subscriptions beyond the single hub channel.** Messages must reuse the existing arrival path.
- **Channel stability:** the hub channel is created once per login, never focus-gated (focus-gated churn previously overheated devices), removed only at logout.
- Animation rules (emil-design-eng): transform/opacity only; enter ≈280 ms strong ease-out `Easing.bezier(0.23, 1, 0.32, 1)`; exit faster (≈200 ms); swipe dismiss is velocity-based, not threshold-only; upward-only drag with damped downward resistance; respect reduced motion (fade only).
- Background push behavior (incl. the `channelId: 'default'` Android heads-up fix) must not change.
- Web: all new modules no-op / are never started on web (`Platform.OS === 'web'` guards at the start sites; the host renders nothing on web).

---

### Task 1: `inAppBannerBus` (pure module + tests)

**Files:**
- Create: `src/services/notifications/inAppBannerBus.ts`
- Test: `src/services/notifications/__tests__/inAppBannerBus.test.ts`

**Interfaces (produced):**
```ts
export type InAppBannerPayload = {
  id: string;                 // dedupe key: notification id or message id
  avatarUrl?: string;
  title: string;
  body: string;
  onPress?: () => void;
};
export function showInAppBanner(p: InAppBannerPayload): void;
export function subscribeInAppBanner(l: (p: InAppBannerPayload) => void): () => void;
export function __resetInAppBannerBusForTests(): void;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/services/notifications/__tests__/inAppBannerBus.test.ts
import {
  showInAppBanner,
  subscribeInAppBanner,
  __resetInAppBannerBusForTests,
} from '../inAppBannerBus';

const payload = (id: string) => ({ id, title: 'T', body: 'B' });

describe('inAppBannerBus', () => {
  beforeEach(() => __resetInAppBannerBusForTests());

  it('delivers a shown banner to the subscriber', () => {
    const seen: string[] = [];
    subscribeInAppBanner((p) => seen.push(p.id));
    showInAppBanner(payload('a'));
    expect(seen).toEqual(['a']);
  });

  it('dedupes consecutive same-id shows', () => {
    const seen: string[] = [];
    subscribeInAppBanner((p) => seen.push(p.id));
    showInAppBanner(payload('a'));
    showInAppBanner(payload('a'));
    showInAppBanner(payload('b'));
    showInAppBanner(payload('a')); // non-consecutive: allowed again
    expect(seen).toEqual(['a', 'b', 'a']);
  });

  it('is silent with no subscriber and unsubscribe works', () => {
    expect(() => showInAppBanner(payload('a'))).not.toThrow();
    const seen: string[] = [];
    const unsub = subscribeInAppBanner((p) => seen.push(p.id));
    unsub();
    showInAppBanner(payload('b'));
    expect(seen).toEqual([]);
  });

  it('last subscriber wins (single host)', () => {
    const a: string[] = [];
    const b: string[] = [];
    subscribeInAppBanner((p) => a.push(p.id));
    subscribeInAppBanner((p) => b.push(p.id));
    showInAppBanner(payload('x'));
    expect(a).toEqual([]);
    expect(b).toEqual(['x']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/services/notifications/__tests__/inAppBannerBus.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/services/notifications/inAppBannerBus.ts
/**
 * Tiny module-level bus for the in-app banner overlay. Zero React, zero
 * subscriptions — any module calls showInAppBanner(); the single mounted
 * InAppBannerHost is the subscriber. Last-write-wins (replace policy),
 * consecutive same-id calls are deduped.
 */
export type InAppBannerPayload = {
  /** Dedupe key: notification id or message id. */
  id: string;
  avatarUrl?: string;
  title: string;
  body: string;
  onPress?: () => void;
};

let listener: ((p: InAppBannerPayload) => void) | null = null;
let lastShownId: string | null = null;

export function showInAppBanner(p: InAppBannerPayload): void {
  if (p.id === lastShownId) return;
  lastShownId = p.id;
  listener?.(p);
}

/** Single host: a new subscriber replaces the previous one. */
export function subscribeInAppBanner(l: (p: InAppBannerPayload) => void): () => void {
  listener = l;
  return () => {
    if (listener === l) listener = null;
  };
}

export function __resetInAppBannerBusForTests(): void {
  listener = null;
  lastShownId = null;
}
```

- [ ] **Step 4: Run tests — PASS.** `npx jest src/services/notifications/__tests__/inAppBannerBus.test.ts`

---

### Task 2: `messagePreviewText` shared helper

**Files:**
- Create: `src/services/messaging/messagePreviewText.ts`
- Modify: `src/screens/ConversationsScreen.tsx` (two duplicated inline preview blocks: direct-chat branch ~lines 740-742 and group-chat branch ~lines 878-895 — locate by content `isLastMessageImage`)
- Test: `src/services/messaging/__tests__/messagePreviewText.test.ts`

**Interfaces (produced):**
```ts
export function messagePreviewText(
  m: { type?: string | null; body?: string | null;
       image_metadata?: unknown; video_metadata?: unknown; audio_metadata?: unknown;
       sender_id?: string | null } | null | undefined,
  opts?: { currentUserId?: string | null }
): string;
```
Returns: `'Image'` | `'Video'` | `'Voice message'` | commitment strings (`'You requested to be Committed'` when `sender_id === currentUserId`, else `'Requested to be Committed'`) | `m.body ?? ''`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/services/messaging/__tests__/messagePreviewText.test.ts
import { messagePreviewText } from '../messagePreviewText';

describe('messagePreviewText', () => {
  it('maps media types to placeholders', () => {
    expect(messagePreviewText({ type: 'image' })).toBe('Image');
    expect(messagePreviewText({ image_metadata: { w: 1 } })).toBe('Image');
    expect(messagePreviewText({ type: 'video' })).toBe('Video');
    expect(messagePreviewText({ video_metadata: {} })).toBe('Video');
    expect(messagePreviewText({ type: 'audio' })).toBe('Voice message');
    expect(messagePreviewText({ audio_metadata: {} })).toBe('Voice message');
  });

  it('maps commitment requests by sender', () => {
    expect(
      messagePreviewText({ type: 'commitment_request', sender_id: 'me' }, { currentUserId: 'me' })
    ).toBe('You requested to be Committed');
    expect(
      messagePreviewText({ type: 'commitment_request', sender_id: 'other' }, { currentUserId: 'me' })
    ).toBe('Requested to be Committed');
  });

  it('falls back to body, then empty string', () => {
    expect(messagePreviewText({ type: 'text', body: 'hola' })).toBe('hola');
    expect(messagePreviewText(null)).toBe('');
    expect(messagePreviewText({})).toBe('');
  });
});
```

- [ ] **Step 2: Run — FAIL (module not found).**

- [ ] **Step 3: Implement**

```ts
// src/services/messaging/messagePreviewText.ts
/**
 * One-line preview for a message — shared by the conversation list and the
 * in-app banner so media/commitment placeholders never drift between the two.
 * Extracted from ConversationsScreen's duplicated inline logic.
 */
type PreviewableMessage = {
  type?: string | null;
  body?: string | null;
  image_metadata?: unknown;
  video_metadata?: unknown;
  audio_metadata?: unknown;
  sender_id?: string | null;
};

export function messagePreviewText(
  m: PreviewableMessage | null | undefined,
  opts?: { currentUserId?: string | null }
): string {
  if (!m) return '';
  if (m.type === 'image' || m.image_metadata) return 'Image';
  if (m.type === 'video' || m.video_metadata) return 'Video';
  if (m.type === 'audio' || m.audio_metadata) return 'Voice message';
  if (m.type === 'commitment_request') {
    return m.sender_id && m.sender_id === opts?.currentUserId
      ? 'You requested to be Committed'
      : 'Requested to be Committed';
  }
  return m.body ?? '';
}
```

- [ ] **Step 4: Run tests — PASS.**

- [ ] **Step 5: Switch ConversationsScreen to the helper**

In `src/screens/ConversationsScreen.tsx`, find BOTH inline preview blocks (search `isLastMessageImage`). Replace the boolean flags + string selection with a call to `messagePreviewText(conv.last_message, { currentUserId })` (the current user id variable already in scope there — verify its name in the file). Preserve any JSX around it (icons etc.) — only the text-string derivation moves to the helper. If a branch renders icon + text based on those booleans, keep deriving the booleans locally for the icon but take the STRING from the helper (no behavior change).

- [ ] **Step 6: Verify** — `npx tsc --noEmit` (no new errors) and `npx jest src/services/messaging/__tests__/messagePreviewText.test.ts` PASS.

---

### Task 3: `notificationsRealtimeHub` + NotificationCenter switch + logout

**Files:**
- Create: `src/services/notifications/notificationsRealtimeHub.ts`
- Modify: `src/components/notifications/NotificationCenter.tsx` (badge effect ~lines 119-126; panel focus effect ~lines 197-216 — locate by `notificationsService.subscribe`)
- Modify: `src/utils/registerLogoutHandlers.ts` (add one register line)

**Interfaces (produced):**
```ts
export function startNotificationsHub(userId: string): void;  // idempotent per user
export function stopNotificationsHub(): void;
export function onNotification(l: {
  onInsert?: (row: NotificationRow) => void;
  onUpdate?: (row: NotificationRow) => void;
}): () => void;
```

**Consumes:** `NotificationRow` from `./notificationsService`; `supabase` from `../../config/supabase`. Mirror the channel config of `notificationsService.subscribe` (`notificationsService.ts:331-375`): postgres_changes INSERT + UPDATE on `public.notifications`, `filter: recipient_id=eq.${userId}`.

- [ ] **Step 1: Implement the hub**

```ts
// src/services/notifications/notificationsRealtimeHub.ts
/**
 * ONE shared realtime channel for the current user's `notifications` rows.
 * Badge, panel, and the in-app banner attach as in-memory listeners —
 * replacing the 2 postgres_changes subscriptions that existed before
 * (badge + focus-gated panel) with a single stable one.
 *
 * Lifecycle: started once post-auth (AppContent), stopped only at logout
 * (registerLogoutHandlers). NEVER focus-gate this channel — channel churn
 * previously overheated devices (see NotificationCenter badge comment).
 * Resilience intentionally matches the old badge subscription (no rejoin).
 */
import { supabase } from '../../config/supabase';
import type { NotificationRow } from './notificationsService';

type HubListener = {
  onInsert?: (row: NotificationRow) => void;
  onUpdate?: (row: NotificationRow) => void;
};

let channel: ReturnType<typeof supabase.channel> | null = null;
let currentUserId: string | null = null;
const listeners = new Set<HubListener>();

export function startNotificationsHub(userId: string): void {
  if (channel && currentUserId === userId) return; // idempotent
  stopNotificationsHub();
  currentUserId = userId;
  channel = supabase
    .channel(`notifications-hub:${userId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
      (payload) => {
        const row = payload.new as NotificationRow;
        listeners.forEach((l) => l.onInsert?.(row));
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
      (payload) => {
        const row = payload.new as NotificationRow;
        listeners.forEach((l) => l.onUpdate?.(row));
      }
    )
    .subscribe((status) => {
      if (__DEV__ && status !== 'SUBSCRIBED') {
        console.log('[notificationsRealtimeHub] status:', status);
      }
    });
}

export function stopNotificationsHub(): void {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  currentUserId = null;
}

/** Attach an in-memory listener; returns unsubscribe. Cheap — no channel churn. */
export function onNotification(l: HubListener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
```

- [ ] **Step 2: Switch the badge (NotificationCenter.tsx ~119-126)**

Replace `notificationsService.subscribe(userId, {...})` with:
```ts
import { onNotification } from '../../services/notifications/notificationsRealtimeHub';
// ...
useEffect(() => {
  if (!userId) return;
  const unsubscribe = onNotification({ onInsert: () => setUnread((u) => u + 1) });
  return unsubscribe;
}, [userId]);
```
Keep the existing explanatory comment about channel stability, updating it to say the CHANNEL now lives in notificationsRealtimeHub and this is only an in-memory listener.

- [ ] **Step 3: Switch the panel (NotificationCenter.tsx ~197-216)**

Same substitution inside the `useFocusEffect`: `onNotification({ onInsert: (row) => {...existing body...}, onUpdate: (row) => {...existing body...} })` — handler bodies IDENTICAL to today; only the subscription mechanism changes (focus-gating an in-memory listener is free).

- [ ] **Step 4: Logout** — in `src/utils/registerLogoutHandlers.ts`, next to `pushNotificationService.clearToken()`:
```ts
import { stopNotificationsHub } from '../services/notifications/notificationsRealtimeHub';
// inside the registration block:
logoutRegistry.register(() => stopNotificationsHub());
```

- [ ] **Step 5: Verify** — `npx tsc --noEmit` no new errors. (Hub start is wired in Task 5; until then badge/panel listeners receive nothing at runtime — acceptable intermediate state, do not wire AppContent here.)

---

### Task 4: `InAppBannerHost` component + mount

**Files:**
- Create: `src/components/notifications/InAppBannerHost.tsx`
- Modify: `src/components/AppContent.tsx` (~line 1903-1919 — mount AFTER the `activeOverlay` absoluteFill view so the banner renders on top; locate by `{activeOverlay && <View style={StyleSheet.absoluteFill}>`)

**Interfaces:** consumes `subscribeInAppBanner` / `InAppBannerPayload` (Task 1). Renders nothing on web.

- [ ] **Step 1: Implement the host**

```tsx
// src/components/notifications/InAppBannerHost.tsx
/**
 * WhatsApp-style in-app banner. Mounted ONCE at AppContent root, above the
 * navigator and activeOverlay. Fed exclusively by inAppBannerBus — the app
 * tree never re-renders for a banner, only this host does.
 *
 * Motion (emil-design-eng): transform/opacity only; enter 280ms strong
 * ease-out; exit 200ms; velocity-based swipe-up dismiss with damped
 * downward drag; reduced-motion → fade only.
 *
 * Known v1 limitation: RN Modal sheets render in their own window and cover
 * this banner. Accepted (spec).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Image as ExpoImage } from 'expo-image';
import { subscribeInAppBanner, InAppBannerPayload } from '../../services/notifications/inAppBannerBus';
import { ff, fs } from '../../theme/fonts';

const ENTER_MS = 280;
const EXIT_MS = 200;
const AUTO_DISMISS_MS = 5000;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const HIDDEN_Y = -160; // safely above any banner height + inset

export const InAppBannerHost: React.FC = () => {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [payload, setPayload] = useState<InAppBannerPayload | null>(null);
  const translateY = useSharedValue(HIDDEN_Y);
  const opacity = useSharedValue(0);
  const dragY = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const payloadRef = useRef<InAppBannerPayload | null>(null);
  payloadRef.current = payload;

  const clearTimer = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  };

  const hide = useCallback(() => {
    clearTimer();
    // withTiming retargets smoothly if we're mid-enter (interruptible).
    translateY.value = withTiming(HIDDEN_Y, { duration: EXIT_MS, easing: EASE_OUT });
    opacity.value = withTiming(0, { duration: EXIT_MS }, (finished) => {
      if (finished) runOnJS(setPayload)(null);
    });
  }, [opacity, translateY]);

  const armTimer = useCallback(() => {
    clearTimer();
    timer.current = setTimeout(hide, AUTO_DISMISS_MS);
  }, [hide]);

  useEffect(() => {
    const unsub = subscribeInAppBanner((p) => {
      setPayload(p);
      dragY.value = 0;
      if (reducedMotion) {
        translateY.value = 0;
        opacity.value = 0;
        opacity.value = withTiming(1, { duration: ENTER_MS });
      } else {
        // Replace policy: retarget from wherever we are — no restart-from-zero.
        translateY.value = withTiming(0, { duration: ENTER_MS, easing: EASE_OUT });
        opacity.value = withTiming(1, { duration: ENTER_MS, easing: EASE_OUT });
      }
      armTimer();
    });
    return () => { unsub(); clearTimer(); };
  }, [armTimer, dragY, opacity, reducedMotion, translateY]);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      // Upward free, downward damped (friction, not a wall).
      dragY.value = e.translationY < 0 ? e.translationY : e.translationY / 8;
    })
    .onEnd((e) => {
      const flungUp = e.velocityY < -500 || e.translationY < -40;
      if (flungUp) {
        runOnJS(hide)();
      } else {
        dragY.value = withTiming(0, { duration: EXIT_MS, easing: EASE_OUT });
        runOnJS(armTimer)();
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value + dragY.value }],
    opacity: opacity.value,
  }));

  if (Platform.OS === 'web' || !payload) return null;

  const onPress = () => {
    const p = payloadRef.current;
    hide();
    p?.onPress?.();
  };

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingTop: insets.top + 6 }]}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.banner, animatedStyle]}>
          <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            {payload.avatarUrl ? (
              <ExpoImage source={{ uri: payload.avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial}>{payload.title.charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <View style={styles.texts}>
              <Text style={styles.title} numberOfLines={1}>{payload.title}</Text>
              <Text style={styles.body} numberOfLines={2}>{payload.body}</Text>
            </View>
          </Pressable>
          <View style={styles.grabber} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  banner: {
    width: '100%',
    maxWidth: 560,
    borderRadius: 22,
    backgroundColor: 'rgba(28,28,30,0.96)',
    paddingTop: 12,
    paddingBottom: 8,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  pressed: { opacity: 0.85 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: { backgroundColor: '#05BCD3', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#FFFFFF', fontSize: fs(16), ...ff('Inter', 700) },
  texts: { flex: 1, marginLeft: 12 },
  title: { color: '#FFFFFF', fontSize: fs(14), ...ff('Inter', 700), includeFontPadding: false },
  body: { color: 'rgba(255,255,255,0.85)', fontSize: fs(13), ...ff('Inter', 400), includeFontPadding: false, marginTop: 1 },
  grabber: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.28)',
    marginTop: 8,
  },
});
```

**IMPORTANT — verify `ff`/`fs` call shape against `src/theme/fonts.ts` before using** (project rule: never bare fontFamily+fontWeight; `ff(family, weight)` returns a style object — adjust spread if the real signature differs).

- [ ] **Step 2: Mount in AppContent**

In `AppContent.tsx` (~1903-1919), AFTER the `{activeOverlay && ...}` line and adjacent to `ProfileEditPanel`:
```tsx
import { InAppBannerHost } from './notifications/InAppBannerHost';
// ...
{activeOverlay && <View style={StyleSheet.absoluteFill}>{activeOverlay}</View>}
<InAppBannerHost />
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit` no new errors.

---

### Task 5: `bellBannerSource` + start hub/source in AppContent

**Files:**
- Create: `src/services/notifications/bellBannerSource.ts`
- Test: `src/services/notifications/__tests__/bellBannerSource.test.ts`
- Modify: `src/components/AppContent.tsx` (post-auth effect near `setupNotificationHandlers`, ~lines 385-412)

**Interfaces (produced):**
```ts
export function startBellBannerSource(
  userId: string,
  openTrip: (tripId: string, focus: TripDetailFocus | null) => void
): () => void;  // returns stop
// exported for tests:
export function handleBellInsert(
  row: NotificationRow,
  ctx: { userId: string; openTrip: (tripId: string, focus: TripDetailFocus | null) => void }
): void;
```
**Consumes:** `onNotification` (Task 3), `showInAppBanner` (Task 1), and from `notificationsService`: `renderNotification`, `tripFocusForNotification`, `isNotificationsScreenOpen`, `NotificationRow`, `TripDetailFocus`; `getStorageThumbUrl` from `../media/imageService`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/services/notifications/__tests__/bellBannerSource.test.ts
jest.mock('../../../config/supabase', () => ({ supabase: {}, isSupabaseConfigured: () => false }));
jest.mock('../inAppBannerBus', () => ({ showInAppBanner: jest.fn() }));
jest.mock('../notificationsService', () => {
  const actual = jest.requireActual('../notificationsService');
  return { ...actual, isNotificationsScreenOpen: jest.fn(() => false) };
});

import { handleBellInsert } from '../bellBannerSource';
import { showInAppBanner } from '../inAppBannerBus';
import { isNotificationsScreenOpen } from '../notificationsService';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'n1', recipient_id: 'me', trip_id: 't1', type: 'member_joined',
  audience: 'user', actor_id: 'actor', entity_type: null, entity_id: null,
  data: { actor_name: 'Ana', trip_title: 'El Salvador 26' },
  read_at: null, handled_at: null, created_at: 'now',
} as any);
const ctx = { userId: 'me', openTrip: jest.fn() };

describe('handleBellInsert', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows a banner with rendered title/body and trip tap', () => {
    handleBellInsert(row(), ctx);
    expect(showInAppBanner).toHaveBeenCalledTimes(1);
    const p = (showInAppBanner as jest.Mock).mock.calls[0][0];
    expect(p.id).toBe('n1');
    expect(typeof p.title).toBe('string');
    expect(p.title.length).toBeGreaterThan(0);
    p.onPress();
    expect(ctx.openTrip).toHaveBeenCalledWith('t1', expect.anything());
  });

  it('skips own-actor rows', () => {
    handleBellInsert(row({ actor_id: 'me' }), ctx);
    expect(showInAppBanner).not.toHaveBeenCalled();
  });

  it('skips while the notifications screen is open', () => {
    (isNotificationsScreenOpen as jest.Mock).mockReturnValueOnce(true);
    handleBellInsert(row(), ctx);
    expect(showInAppBanner).not.toHaveBeenCalled();
  });

  it('still shows rows without trip_id (no-op press)', () => {
    handleBellInsert(row({ trip_id: null }), ctx);
    expect(showInAppBanner).toHaveBeenCalledTimes(1);
    expect(() => (showInAppBanner as jest.Mock).mock.calls[0][0].onPress?.()).not.toThrow();
    expect(ctx.openTrip).not.toHaveBeenCalled();
  });

  it('swallows malformed rows without throwing', () => {
    expect(() => handleBellInsert({ id: 'x' } as any, ctx)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run — FAIL (module not found).**

- [ ] **Step 3: Implement**

```ts
// src/services/notifications/bellBannerSource.ts
/**
 * Bridges the notifications realtime hub to the in-app banner: instant bell
 * banners (<1s) instead of waiting for the push queue cron (~1min). The
 * native push still fires later; the foreground gate suppresses it.
 */
import {
  NotificationRow,
  TripDetailFocus,
  isNotificationsScreenOpen,
  renderNotification,
  tripFocusForNotification,
} from './notificationsService';
import { getStorageThumbUrl } from '../media/imageService';
import { showInAppBanner } from './inAppBannerBus';
import { onNotification } from './notificationsRealtimeHub';

const AVATAR_PX = 80;

type Ctx = { userId: string; openTrip: (tripId: string, focus: TripDetailFocus | null) => void };

export function handleBellInsert(row: NotificationRow, ctx: Ctx): void {
  try {
    if (!row?.id || !row.type) return;
    if (row.actor_id && row.actor_id === ctx.userId) return;   // own action
    if (isNotificationsScreenOpen()) return;                    // watching the list live
    const r = renderNotification(row);
    const avatar = row.data?.actor_avatar_url
      ? getStorageThumbUrl(row.data.actor_avatar_url, AVATAR_PX)
      : undefined;
    const tripId = row.trip_id;
    showInAppBanner({
      id: row.id,
      avatarUrl: avatar ?? undefined,
      title: r.title,
      body: r.body,
      onPress: tripId
        ? () => ctx.openTrip(tripId, tripFocusForNotification(row.type, row.data ?? undefined))
        : undefined,
    });
  } catch (e) {
    if (__DEV__) console.warn('[bellBannerSource] skipped malformed row:', e);
  }
}

export function startBellBannerSource(userId: string, openTrip: Ctx['openTrip']): () => void {
  return onNotification({ onInsert: (row) => handleBellInsert(row, { userId, openTrip }) });
}
```
**Check `tripFocusForNotification`'s real signature** in notificationsService.ts (it takes `(type, {stage, decision})`-ish args — adapt the call to pass exactly what it expects from `row.data`; AppContent.tsx:395-398 shows the canonical call shape).

- [ ] **Step 4: Run tests — PASS.**

- [ ] **Step 5: Start hub + source in AppContent**

In `AppContent.tsx`, add a new effect near the `setupNotificationHandlers` one (~412). Gate on native + logged-in user; restart on user change:
```tsx
import { startNotificationsHub } from '../services/notifications/notificationsRealtimeHub';
import { startBellBannerSource } from '../services/notifications/bellBannerSource';
// ...
useEffect(() => {
  if (Platform.OS === 'web' || !user?.id) return;
  startNotificationsHub(user.id);
  const stopSource = startBellBannerSource(user.id, openTripCard);
  return stopSource;
  // openTripCard is a stable useCallback([]) — safe to omit (matches the
  // existing TDZ-note pattern of the setupNotificationHandlers effect).
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [user?.id]);
```
(Hub stop happens ONLY via logout registry — do not stop the hub in the effect cleanup; the source listener detach is enough.)

- [ ] **Step 6: Verify** — `npx tsc --noEmit` no new errors; bellBannerSource + inAppBannerBus jest suites PASS.

---

### Task 6: Message banners from MessagingProvider

**Files:**
- Modify: `src/context/MessagingProvider.tsx` — `handleInboxChange` (~lines 761-775, locate by `SYNC_FROM_SERVER`; `conversationsRef` kept in sync at ~778-780; `currentUserIdRef` maintained at ~435/456/985; `currentConversationIdRef` per existing pattern)

**Consumes:** `showInAppBanner` (Task 1), `messagePreviewText` (Task 2), `pushRootCard` from `../navigation/navigationRef` (`navigationRef.ts:101-112` — params: `conversationId, otherUserId, otherUserName, otherUserAvatar, isDirect, tripId?, surftripId?`; mirror the existing bell→chat call at `NotificationCenter.tsx:379-389`), `getStorageThumbUrl` from `../services/media/imageService`.

- [ ] **Step 1: Capture the previous snapshot and add the banner pass**

Inside `handleInboxChange`, BEFORE the dispatch, capture `const prevById = new Map(conversationsRef.current.map((c) => [c.id, c]));`. AFTER `dispatch({ type: 'SYNC_FROM_SERVER', ... })`, add:

```ts
// In-app banner for genuinely-new messages in conversations that are not
// open. Runs on the enriched result we already fetched — zero extra realtime
// or network cost. Skips unknown conversations (initial sync/reconnect) to
// avoid a banner storm on login.
try {
  for (const conv of updated) {
    const lm: any = (conv as any).last_message;
    if (!lm?.id) continue;
    const prev = prevById.get(conv.id);
    if (!prev) continue;
    if ((prev as any).last_message?.id === lm.id) continue;
    const myId = currentUserIdRef.current;
    if (!lm.sender_id || lm.sender_id === myId) continue;
    if (conv.id === currentConversationIdRef.current) continue;

    const isDirect = !!(conv as any).other_user; // verify against Conversation type
    const sender = isDirect
      ? (conv as any).other_user
      : ((conv as any).members ?? []).find((m: any) => m.user_id === lm.sender_id);
    const senderName = isDirect ? sender?.name : sender?.name;
    const senderAvatar = sender?.profile_image_url ?? sender?.avatar;
    const groupName = !isDirect ? (conv as any).name : undefined;

    showInAppBanner({
      id: lm.id,
      avatarUrl: senderAvatar ? getStorageThumbUrl(senderAvatar, 80) ?? undefined : undefined,
      title: groupName ? `${senderName ?? 'Someone'} — ${groupName}` : senderName ?? 'New message',
      body: messagePreviewText(lm, { currentUserId: myId }),
      onPress: () =>
        pushRootCard('ChatCard', {
          conversationId: conv.id,
          otherUserId: isDirect ? sender?.user_id ?? sender?.id ?? '' : '',
          otherUserName: senderName ?? '',
          otherUserAvatar: senderAvatar ?? undefined,
          isDirect,
        }),
    });
  }
} catch (e) {
  if (__DEV__) console.warn('[MessagingProvider] banner pass failed:', e);
}
```
**Verify every field name against the actual `Conversation` type and the existing usages** (`ConversationsScreen.tsx` DM branch ~740, group branch ~878-895, and the `pushRootCard('ChatCard', ...)` calls at `ConversationsScreen.tsx:208-216` and `NotificationCenter.tsx:379-389`) — replace the `(conv as any)` casts with proper typing where the fields exist on the type; keep behavior identical to how those screens resolve name/avatar/params. The banner pass must remain fully wrapped in try/catch — it must never break message sync.

- [ ] **Step 2: Verify** — `npx tsc --noEmit` no new errors.

---

### Task 7: Revert native foreground gate + full verify

**Files:**
- Modify: `src/services/notifications/pushNotificationService.ts` — `shouldShowForegroundNotification` (~lines 34-56) + its doc comment
- Modify: `src/services/notifications/__tests__/pushNotificationGate.test.ts` (full rewrite below)

- [ ] **Step 1: Rewrite the gate tests**

```ts
// src/services/notifications/__tests__/pushNotificationGate.test.ts
/**
 * The custom in-app banner (InAppBannerHost, realtime-driven) now owns ALL
 * foreground notifications, so the native gate is back to the legacy rule:
 * suppress everything while foregrounded, show when backgrounded.
 */
jest.mock('../../../config/supabase', () => ({
  supabase: {},
  isSupabaseConfigured: () => false,
}));

import { shouldShowForegroundNotification } from '../pushNotificationService';

const base = {
  notificationType: undefined as string | undefined,
  conversationId: null as string | null | undefined,
  currentConversationId: null as string | null,
  isNotificationsScreenOpen: false,
  isForeground: true,
};

describe('shouldShowForegroundNotification (custom-banner era)', () => {
  it.each(['message', 'join_request_received', 'commitment_decided', 'unknown_type', undefined])(
    'suppresses %s while foregrounded',
    (type) => {
      expect(shouldShowForegroundNotification({ ...base, notificationType: type as any }))
        .toEqual({ show: false, sound: false });
    }
  );

  it.each(['message', 'join_request_received', 'trip_reminder', 'unknown_type'])(
    'shows %s with sound when backgrounded',
    (type) => {
      expect(
        shouldShowForegroundNotification({ ...base, notificationType: type as any, isForeground: false })
      ).toEqual({ show: true, sound: true });
    }
  );

  it('suppresses a background message for the conversation that is somehow still marked open', () => {
    expect(
      shouldShowForegroundNotification({
        ...base,
        notificationType: 'message',
        conversationId: 'c1',
        currentConversationId: 'c1',
        isForeground: false,
      })
    ).toEqual({ show: false, sound: false });
  });

  it('flags (screen open / same conversation) never force-show in foreground', () => {
    expect(
      shouldShowForegroundNotification({
        ...base,
        notificationType: 'message',
        conversationId: 'c1',
        currentConversationId: 'c2',
        isNotificationsScreenOpen: true,
      })
    ).toEqual({ show: false, sound: false });
  });
});
```

- [ ] **Step 2: Run — FAIL** (current gate shows messages/bell types in foreground).

- [ ] **Step 3: Revert the implementation**

Replace the function body (keep the signature and `{show, sound}` return shape — the handler call site stays untouched):
```ts
/**
 * Native-notification gate. Since 2026-07-04 the custom in-app banner
 * (InAppBannerHost, realtime-driven) owns ALL foreground notifications, so
 * this is back to the legacy rule: suppress everything while the app is
 * foregrounded; show (with sound) when backgrounded — except messages for a
 * conversation still marked open. The unused-looking params are kept so the
 * handler call site and any future re-split stay stable.
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
  const show = !args.isForeground && !isSameConversation;
  return { show, sound: show };
}
```
Remove the now-unused `BELL_NOTIFICATION_TYPES` import from this file (the export itself stays in notificationsService — the bell list still uses the type union, and removing the set is out of scope). Also update the comment above `setNotificationHandler` (~lines 227-230) to say foreground presentation is now fully suppressed in favor of the in-app banner.

- [ ] **Step 4: Run gate tests — PASS.**

- [ ] **Step 5: Full verify**

Run: `npx tsc --noEmit` (no new errors) and `npx jest src/services/notifications src/services/messaging` (all suites pass).

---

### Task 8 (controller, not a subagent): manual device test plan for Ohad

1. Dev client + Metro with this code. Second (dev/demo) account triggers a bell event on an all-dev trip → banner slides in < 1 s, silent; tap lands on the right trip section.
2. On the notifications screen → no banner; the row appears in the list live.
3. DM from another chat → banner with sender avatar/preview; tap opens that chat. DM in the OPEN chat → no banner.
4. Group message → banner titled "Sender — Group"; tap opens the group chat.
5. Background the app → native push arrives with sound (unchanged, incl. Android heads-up).
6. Logout → login with another account → banners work for the new account (hub restarted).
⚠️ Only trigger events on trips where ALL members are dev accounts.
