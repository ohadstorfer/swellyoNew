import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StackActions } from '@react-navigation/native';
import { createNativeStackNavigator, NativeStackScreenProps } from '@react-navigation/native-stack';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import ConversationsStack from './ConversationsStack';
import TripsScreen from '../screens/trips/TripsScreen';
import TripDetailScreen from '../screens/trips/TripDetailScreen';
import CreateTripWizard from '../screens/trips/CreateTripWizard';
import { NotificationsPanel } from '../components/notifications/NotificationCenter';
import { ProfileScreen } from '../screens/ProfileScreen';
import TripsBottomNav, { NavKey } from '../components/trips/TripsBottomNav';
import { useMainNav } from './MainNavContext';
import { useOnboarding } from '../context/OnboardingContext';
import { queryClient } from '../lib/queryClient';
import { tripsKeys } from '../hooks/trips/useTripQueries';
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

// --- Cards (Phase 2) --------------------------------------------------------

function TripDetailCardScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'TripDetail'>) {
  const { tripCard } = useMainNav();
  const { tripId, focus } = route.params;
  return (
    <TripDetailScreen
      tripId={tripId}
      initialFocus={focus ?? null}
      onBack={() => navigation.goBack()}
      onOpenGroupChat={tripCard.onOpenGroupChat}
      onEditTrip={trip => navigation.dispatch(StackActions.push('EditTrip', { trip }))}
      onViewUserProfile={userId => tripCard.onViewUserProfile(userId, tripId)}
    />
  );
}

function EditTripCardScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'EditTrip'>) {
  const { user } = useOnboarding();
  const currentUserId = user?.id?.toString() ?? null;
  const trip = route.params.trip;
  return (
    <SafeAreaView style={editStyles.root} edges={['top']}>
      <View style={editStyles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={editStyles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={28} color="#222B30" />
        </TouchableOpacity>
        <Text style={editStyles.headerTitle}>Edit trip</Text>
        <View style={{ width: 28 }} />
      </View>
      <CreateTripWizard
        hostId={currentUserId}
        hostingStyle={trip.hosting_style}
        initialTrip={trip}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });
          queryClient.invalidateQueries({ queryKey: tripsKeys.detail(trip.id) });
          // Back to the detail card so the host sees the updated trip immediately.
          navigation.goBack();
        }}
        onCancel={() => navigation.goBack()}
      />
    </SafeAreaView>
  );
}

function NotificationsPanelScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'NotificationsPanel'>) {
  return (
    <NotificationsPanel
      userId={route.params.userId}
      onClose={() => navigation.goBack()}
      // The panel STAYS in the stack under the trip card — backing out of the
      // trip lands on the open panel (the bug this migration started from).
      onOpenTrip={(tripId, focus) =>
        navigation.dispatch(StackActions.push('TripDetail', { tripId, focus: focus ?? null }))
      }
    />
  );
}

const editStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat-Bold',
    fontSize: 18,
    fontWeight: '700',
    color: '#222B30',
  },
});

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
  const {
    navControl, barSuppressed, onTabChange,
    requestedTab, onRequestedTabConsumed,
    requestedTripCard, onRequestedTripCardConsumed,
  } = useMainNav();
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

  // Programmatic trip-card opens (deep links). Pushed on the PARENT root
  // stack — the card covers the tabs and the bar.
  useEffect(() => {
    if (!requestedTripCard) return;
    navigation
      .getParent()
      ?.dispatch(StackActions.push('TripDetail', {
        tripId: requestedTripCard.tripId,
        focus: requestedTripCard.focus ?? null,
      }));
    onRequestedTripCardConsumed();
  }, [requestedTripCard, navigation, onRequestedTripCardConsumed]);

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

  // ⚠ Keep ALL hooks above this line — this early return runs every render
  // while an overlay covers the roots (Rules of Hooks).
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
      <RootStack.Screen name="TripDetail" component={TripDetailCardScreen} />
      <RootStack.Screen name="EditTrip" component={EditTripCardScreen} />
      <RootStack.Screen
        name="NotificationsPanel"
        component={NotificationsPanelScreen}
        options={{
          // Transparent route: the screen underneath stays visible; the panel
          // animates ITSELF (slide drawer + backdrop fade), so no nav animation.
          presentation: 'transparentModal',
          animation: 'none',
        }}
      />
    </RootStack.Navigator>
  );
}
