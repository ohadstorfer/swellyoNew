import React, { createContext, useContext } from 'react';
import type { ComponentProps } from 'react';
import type { TripsBottomNavControl, NavKey } from '../components/trips/TripsBottomNav';
import type { TripDetailFocus } from '../services/notifications/notificationsService';
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
  /**
   * Programmatic trip-card open (push notifications, invite links, join
   * decisions, chat-header taps). Same mount-safe consumption pattern as
   * requestedTab; pushed as a TripDetail card on the root stack.
   */
  requestedTripCard: { tripId: string; focus?: TripDetailFocus | null } | null;
  onRequestedTripCardConsumed: () => void;
  /** Callbacks the TripDetail card needs from AppContent (legacy overlays). */
  tripCard: {
    onOpenGroupChat: (params: {
      conversationId: string;
      title: string;
      heroImageUrl?: string | null;
      tripId?: string;
    }) => void;
    onViewUserProfile: (userId: string, fromTripId: string) => void;
  };

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
