import { createNavigationContainerRef, StackActions } from '@react-navigation/native';
import type { TripDetailFocus } from '../services/notifications/notificationsService';
import type { GroupTrip } from '../services/trips/groupTripsService';

/**
 * Root navigation param list. Grows as the migration converts overlays to
 * cards (see docs/nav-migration/). Phase 2: trips cards + notifications panel.
 */
export type MainTabsParamList = {
  Lineup: undefined;
  Trips: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  HomeTabs: { screen?: keyof MainTabsParamList } | undefined;
  /** Trip detail card — push() so trip→profile→trip chains stack. */
  TripDetail: { tripId: string; focus?: TripDetailFocus | null };
  /** Host edit wizard, card above the trip detail. */
  EditTrip: { trip: GroupTrip };
  /** Full "Updates" list — "View all" target of the Plan-tab admin updates. */
  TripUpdates: { tripId: string };
  /** Full "Packing & Gear" list — "View all" target of the Plan-tab Group Gear. */
  PackingAndGear: { tripId: string };
  /** Full-screen host "Manage Gear" editor — "Manage" target of the Group Gear card. */
  ManageGear: { tripId: string };
  /** Full "Your Gear" checklist — "View all" target of the Plan-tab Your Gear. */
  YourGear: { tripId: string };
  /** Full "Members pack suggestion" editor — host "Manage" target of the Plan-tab
   *  "What should members pack for themselves?" section. */
  ManageSuggestedGear: { tripId: string };
  /** Member "How committed are you?" flow — full-screen options (step 1) + a
   *  note bottom sheet (step 2). Submits a pending commitment to the host. */
  Commitment: {
    tripId: string;
    tripTitle?: string | null;
    initialItems?: string[];
    initialNote?: string | null;
  };
  /** Right-side notifications drawer as a transparent route — lives in back
   *  history, so back from a notification-opened trip returns TO the panel. */
  NotificationsPanel: { userId: string | null };
  /** Chat card (Phase 3). SPIKE: currently only trip group chats route here —
   *  verifying the keyboard system inside a native-stack card before
   *  migrating all three DM paths. */
  ChatCard: {
    conversationId?: string;
    otherUserId: string;
    otherUserName: string;
    otherUserAvatar: string | null;
    isDirect?: boolean;
    tripId?: string;
    surftripId?: string;
    /** Opened from a "Review request" commitment notification — the chat shows a
     *  one-time "Before you approve" heads-up ~1s after it opens. */
    reviewCommitment?: boolean;
  };
  /** Swelly AI chat card. service picks the edge-function variant (dev). */
  SwellyChat: { service?: 'copy' | 'copy-copy' };
  /** Surftrip detail card (was dual-rendered: AppContent overlay + inner stack). */
  SurftripCard: { groupId: string };
  /** OTHER-user profile card (own profile is the Profile tab root). */
  ProfileCard: { userId: string; suppressConnectAnalytics?: boolean };
  /** Settings card — opened from the gear icon on the own-profile root. */
  Settings: undefined;
};

/**
 * Imperative handle for navigation from outside React (push-notification
 * handlers, services). Attached to the single NavigationContainer in App.tsx.
 * Always guard with isReady() — and remember the root stack only mounts once
 * the user is inside the main app, so "container ready" does not imply the
 * HomeTabs route exists yet. For tab switches prefer requestTab() in
 * AppContent, which is mount-safe.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * Push a card on the ROOT stack from anywhere — including inside the
 * `independent` ConversationsStack, whose actions don't bubble to the root
 * (dispatching via useNavigation there dies with "not handled by any
 * navigator"). The ref targets the root container directly.
 */
// App-wide double-push defense. Every card navigation flows through here, so a
// single guard protects the whole app from the two ways a button fires twice:
// an accidental double-tap, and taps that QUEUE during a JS-thread stall and all
// fire at once when it unblocks. Same route+params within the window is never
// intentional, so we drop the repeat. Distinct navigations are unaffected.
const DUP_PUSH_WINDOW_MS = 700;
let lastPush: { key: string; ts: number } = { key: '', ts: 0 };

export function pushRootCard<RouteName extends Exclude<keyof RootStackParamList, 'HomeTabs'>>(
  name: RouteName,
  params: RootStackParamList[RouteName],
) {
  if (!navigationRef.isReady()) return;
  let key = name as string;
  try { key = `${name}:${JSON.stringify(params ?? {})}`; } catch { /* unserializable params — fall back to route name */ }
  const now = Date.now();
  if (key === lastPush.key && now - lastPush.ts < DUP_PUSH_WINDOW_MS) return;
  lastPush = { key, ts: now };
  navigationRef.dispatch(StackActions.push(name, params));
}
