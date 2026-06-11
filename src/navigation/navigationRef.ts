import { createNavigationContainerRef } from '@react-navigation/native';
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
