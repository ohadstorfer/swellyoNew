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
  };
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
export function pushRootCard<RouteName extends Exclude<keyof RootStackParamList, 'HomeTabs'>>(
  name: RouteName,
  params: RootStackParamList[RouteName],
) {
  if (!navigationRef.isReady()) return;
  navigationRef.dispatch(StackActions.push(name, params));
}
