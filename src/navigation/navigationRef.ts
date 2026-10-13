import { CommonActions, createNavigationContainerRef, StackActions } from '@react-navigation/native';
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

/** What a trip's Chat tab can be opened with. */
export type TripChatParams = {
  /** Opened from message search — scroll to this message + flash it on load. */
  targetMessageId?: string;
  /** OS-share media handoff — prefills the composer's media preview. */
  sharedMedia?: { uri: string; mimeType: string; kind: 'image' | 'video' };
  /** Opened from a "Review request" commitment notification. */
  reviewCommitment?: boolean;
};

export type RootStackParamList = {
  HomeTabs: { screen?: keyof MainTabsParamList } | undefined;
  /** Trip detail card — push() so trip→profile→trip chains stack. */
  TripDetail: {
    tripId: string;
    focus?: TripDetailFocus | null;
    /** With focus 'chat': handed straight to the embedded group chat. */
    chat?: TripChatParams;
    /** Bumped when an already-open trip card is asked to show its chat again,
     *  so the screen re-applies the focus. See openTripChat(). */
    focusNonce?: number;
  };
  /** Host edit wizard, card above the trip detail. */
  EditTrip: { trip: GroupTrip };
  /** Operator-only flat edit screen for a hosting_style='C' trip. Distinct from
   *  EditTrip, which reopens the create wizard and is peer-trip only. */
  OperatorEditTrip: { tripId: string };
  /** Full-screen place picker pushed from the Edit trip screen's "Where" row. */
  OperatorEditDestination: { tripId: string };
  /**
   * Traveler onboarding on an operator trip — the flow between "approved" and
   * "actually in the trip".
   *
   * A CARD, never `presentation: 'modal'`. Three of its steps open OS pickers,
   * and a picker fired while a Modal is tearing down hangs the main thread and
   * the OS kills the app. See the header of TravelerOnboardingScreen.
   */
  TravelerOnboarding: {
    tripId: string;
    tripTitle?: string | null;
    /** Launched from the dev menu — shows the Reset button. Never set on the
     *  real path; a traveler's onboarding cannot undo itself. */
    devMode?: boolean;
  };
  /**
   * A crew member's own paperwork on an operator trip — what the operator
   * asked them for, and where they answer it.
   *
   * A CARD, never `presentation: 'modal'`, for the same reason
   * TravelerOnboarding is one: its upload and medical rows open OS pickers.
   */
  StaffPaperwork: {
    tripId: string;
    tripTitle?: string | null;
    /** Launched from the dev menu — lists every crew requirement on the trip
     *  instead of the ones assigned to you, and adds a Reset. Never set on the
     *  real path: an operator cannot be crew on their own trip, so there is no
     *  other way to walk this screen without a second account. */
    devMode?: boolean;
  };
  /**
   * Every payment on one operator trip — the ledger behind the Dashboard's
   * "Payments collected" tile. Product Specs §"Trip operator view".
   *
   * A card, not a modal: it opens a share sheet for the CSV export, and an OS
   * sheet fired from a Modal that is tearing down is the same hazard
   * TravelerOnboarding's header warns about.
   */
  TripPayments: { tripId: string; tripTitle?: string | null };
  /** Where each traveler stands on paying — opened from the "Total Guests
   *  Payments" tile on TripPayments. A card for the same reason: CSV export. */
  TripGuestPayments: { tripId: string; tripTitle?: string | null };
  /** Every pending join request on one trip — the Dashboard's "Join Request"
   *  action card. Approve / Contact on the row; Decline is in the profile. */
  TripJoinRequests: { tripId: string };
  /** One traveler on an operator trip, as the operator sees them. */
  TripTraveler: { tripId: string; userId: string };
  /** Full "Updates" list — "View all" target of the Plan-tab admin updates. */
  TripUpdates: { tripId: string };
  /** Full "Members" list — "View all" target of the Overview Participants row and
   *  the Plan-tab Members section. Permission layers resolved inside the screen. */
  TripMembers: { tripId: string };
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
    /** OS-share media handoff — prefills the composer's media preview on mount. */
    sharedMedia?: { uri: string; mimeType: string; kind: 'image' | 'video' };
    /** Opened from message search — scroll to this message + flash it on load. */
    targetMessageId?: string;
  };
  /** OS-share conversation picker ("Share to Swellyo"). The payload itself
   *  lives in shareIntake's module store, not in nav params. */
  ShareToChat: undefined;
  /** Swelly AI chat card. service picks the edge-function variant (dev). */
  SwellyChat: { service?: 'copy' | 'copy-copy' };
  /** Surftrip detail card (was dual-rendered: AppContent overlay + inner stack). */
  SurftripCard: { groupId: string };
  /** OTHER-user profile card (own profile is the Profile tab root). */
  ProfileCard: {
    userId: string;
    suppressConnectAnalytics?: boolean;
    /** When opened to review a pending join request — the profile shows an
     *  Approve / Decline footer that actions this request, then pops back. */
    joinRequest?: { tripId: string; requestId: string };
  };
  /** Settings card — opened from the gear icon on the own-profile root. */
  Settings: undefined;
  /**
   * Operator onboarding — the four things settled once before selling a trip.
   *
   * A CARD, not a modal: the waiver step opens the OS document picker, and a
   * picker fired while a Modal is tearing down hangs the main thread. Same
   * reason as TravelerOnboarding above.
   */
  OperatorSetup: undefined;
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

/**
 * Open a trip on its Chat tab — the one way into a trip's group chat
 * (docs/specs/trip-chat-tab.md, req 19-20).
 *
 * If that same trip is already the top card, switch its tab instead of pushing
 * a duplicate: `focusNonce` makes the screen re-apply the focus even when it
 * was already 'chat'. Lower in the stack, or not open at all: push a new card,
 * so back behaves as usual.
 */
export function openTripChat(tripId: string, chat?: TripChatParams) {
  if (!navigationRef.isReady()) return;
  const top = navigationRef.getCurrentRoute();
  if (top?.name === 'TripDetail' && (top.params as { tripId?: string } | undefined)?.tripId === tripId) {
    navigationRef.dispatch({
      ...CommonActions.setParams({ focus: 'chat', chat, focusNonce: Date.now() }),
      source: top.key,
    });
    return;
  }
  pushRootCard('TripDetail', { tripId, focus: 'chat', chat });
}

/**
 * Open a chat card — unless it is a trip's group chat, which has no card any
 * more: it lives on the trip page's Chat tab, so open that instead. Surftrip
 * chats and DMs are unchanged. Use this wherever a ChatCard used to be pushed.
 */
export function pushChatCard(params: RootStackParamList['ChatCard']) {
  if (params.isDirect === false && params.tripId && !params.surftripId) {
    openTripChat(params.tripId, {
      targetMessageId: params.targetMessageId,
      sharedMedia: params.sharedMedia,
      reviewCommitment: params.reviewCommitment,
    });
    return;
  }
  pushRootCard('ChatCard', params);
}
