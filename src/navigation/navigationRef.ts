import { createNavigationContainerRef } from '@react-navigation/native';

/**
 * Root navigation param list. Grows as the migration converts overlays to
 * cards (see docs/nav-migration/). Phase 1: only the tabs screen exists.
 */
export type MainTabsParamList = {
  Lineup: undefined;
  Trips: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  HomeTabs: { screen?: keyof MainTabsParamList } | undefined;
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
