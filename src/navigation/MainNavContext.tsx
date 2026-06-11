import React, { createContext, useContext } from 'react';
import type { ComponentProps } from 'react';
import type { TripsBottomNavControl, NavKey } from '../components/trips/TripsBottomNav';
import type ConversationsStack from './ConversationsStack';
import type TripsScreen from '../screens/trips/TripsScreen';
import type { ProfileScreen } from '../screens/ProfileScreen';

/**
 * Bridge between AppContent (which still owns auth state, overlay state and
 * all the callbacks) and the tab roots living inside RootNavigator.
 *
 * AppContent used to render ConversationsStack / TripsScreen / ProfileScreen
 * directly and thread ~12 props into each. The roots are now navigator
 * screens, which must be stable module-level components — so the props
 * travel through this context instead. Temporary by design: prop bags shrink
 * as later phases move their contents onto route params.
 */
export interface MainNavContextValue {
  /** The one shared bottom-nav control (collapse/expand SharedValue). */
  navControl: TripsBottomNavControl;
  /** Hide the floating bar (trip detail open, Swelly chat open, overlays…). */
  barSuppressed: boolean;
  /** TripsScreen reports its internal detail/edit overlay state here. */
  setTripsInnerOverlayOpen: (open: boolean) => void;
  /** Mirror of the active tab back into AppContent (legacy reads only). */
  onTabChange: (tab: NavKey) => void;
  /**
   * Programmatic tab switch, mount-safe: AppContent sets it, the tab bar
   * adapter consumes it once the navigator exists. null = nothing requested.
   */
  requestedTab: NavKey | null;
  onRequestedTabConsumed: () => void;

  lineupProps: ComponentProps<typeof ConversationsStack>;
  tripsProps: Omit<
    ComponentProps<typeof TripsScreen>,
    'navControl' | 'onInnerOverlayChange'
  >;
  profileProps: Pick<
    ComponentProps<typeof ProfileScreen>,
    'onBack' | 'onMessage' | 'onEdit' | 'noTransition' | 'swipeBackDisabled'
  >;
}

const MainNavContext = createContext<MainNavContextValue | null>(null);

export const MainNavProvider = MainNavContext.Provider;

export function useMainNav(): MainNavContextValue {
  const ctx = useContext(MainNavContext);
  if (!ctx) {
    throw new Error('useMainNav must be used inside MainNavProvider (RootNavigator is rendered by AppContent)');
  }
  return ctx;
}
