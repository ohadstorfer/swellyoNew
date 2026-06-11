import React, { useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import ConversationsStack from './ConversationsStack';
import TripsScreen from '../screens/trips/TripsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import TripsBottomNav, { NavKey } from '../components/trips/TripsBottomNav';
import { useMainNav } from './MainNavContext';
import type { MainTabsParamList, RootStackParamList } from './navigationRef';

/**
 * The real navigation tree (nav migration Phase 1+):
 *
 *   RootStack (native-stack — cards push here in Phase 2+, covering the bar)
 *     └─ HomeTabs (bottom tabs: Lineup / Trips / Profile)
 *          tab bar = the floating TripsBottomNav, one persistent instance
 *
 * Tab screens stay mounted after first visit (lazy + no detach) — that's
 * what preserves each root's scroll/pager state across switches, and keeps
 * the Trips/conversations realtime subscriptions alive.
 */
const Tab = createBottomTabNavigator<MainTabsParamList>();
const RootStack = createNativeStackNavigator<RootStackParamList>();

// Screen wrappers are module-level (a navigator remounts inline components on
// every render). They pull their props from MainNavContext.
function LineupTabScreen() {
  const { lineupProps } = useMainNav();
  return <ConversationsStack {...lineupProps} />;
}

function TripsTabScreen() {
  const { tripsProps, navControl, setTripsInnerOverlayOpen } = useMainNav();
  return (
    <TripsScreen
      {...tripsProps}
      navControl={navControl}
      onInnerOverlayChange={setTripsInnerOverlayOpen}
    />
  );
}

function ProfileTabScreen() {
  const { profileProps } = useMainNav();
  return <ProfileScreen {...profileProps} />;
}

const ROUTE_FOR_KEY: Record<NavKey, keyof MainTabsParamList> = {
  lineup: 'Lineup',
  trips: 'Trips',
  profile: 'Profile',
};
const KEY_FOR_ROUTE: Record<string, NavKey> = {
  Lineup: 'lineup',
  Trips: 'trips',
  Profile: 'profile',
};

/**
 * Adapter between react-navigation's tabBar contract and TripsBottomNav.
 * Emits tabPress (cancelable) per the custom-tab-bar contract; never calls
 * popToTop manually (react-navigation issue #9424 — wrong-stack bug).
 */
function FloatingTabBar({ state, navigation }: BottomTabBarProps) {
  const { navControl, barSuppressed, onTabChange, requestedTab, onRequestedTabConsumed } = useMainNav();
  const active = KEY_FOR_ROUTE[state.routes[state.index].name] ?? 'lineup';

  // Mirror the active tab into AppContent for the legacy reads that still
  // branch on "which page is showing" (deleted in Phase 5).
  useEffect(() => {
    onTabChange(active);
  }, [active, onTabChange]);

  // Programmatic switches (deep links, join-decision overlay, group-chat
  // exits) arrive as a requested tab; consuming them here is mount-safe by
  // construction — the bar only renders when the navigator exists.
  useEffect(() => {
    if (!requestedTab) return;
    if (requestedTab !== active) {
      navigation.navigate(ROUTE_FOR_KEY[requestedTab]);
    }
    onRequestedTabConsumed();
  }, [requestedTab, active, navigation, onRequestedTabConsumed]);

  const pressTab = (key: NavKey) => {
    const index = state.routes.findIndex(r => r.name === ROUTE_FOR_KEY[key]);
    if (index < 0) return;
    const route = state.routes[index];
    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });
    if (state.index !== index && !event.defaultPrevented) {
      navigation.navigate(route.name);
    }
  };

  if (barSuppressed) return null;

  return (
    <TripsBottomNav
      control={navControl}
      active={active}
      onLineupPress={() => pressTab('lineup')}
      onTripsPress={() => pressTab('trips')}
      onProfilePress={() => pressTab('profile')}
    />
  );
}

const renderTabBar = (props: BottomTabBarProps) => <FloatingTabBar {...props} />;

function HomeTabs() {
  return (
    <Tab.Navigator
      initialRouteName="Lineup"
      // Hardware back must not jump between tabs (platform convention —
      // Instagram/WhatsApp behavior). Each root handles its own back.
      backBehavior="none"
      // Keep visited tabs mounted: scroll positions, the trips pager, and
      // realtime subscriptions (useTripsListRealtime, conversations) survive
      // tab switches. lazy keeps first launch cheap.
      detachInactiveScreens={false}
      tabBar={renderTabBar}
      screenOptions={{
        headerShown: false,
        lazy: true,
        // Bug guard: freezeOnBlur on tab navigators has a known FPS/memory
        // issue (react-native-screens #2971) — keep it off.
        freezeOnBlur: false,
      }}
    >
      <Tab.Screen name="Lineup" component={LineupTabScreen} />
      <Tab.Screen name="Trips" component={TripsTabScreen} />
      <Tab.Screen name="Profile" component={ProfileTabScreen} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  return (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      <RootStack.Screen name="HomeTabs" component={HomeTabs} />
    </RootStack.Navigator>
  );
}
