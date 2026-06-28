import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StackActions, useNavigationState } from '@react-navigation/native';
import { createNativeStackNavigator, NativeStackScreenProps } from '@react-navigation/native-stack';
import { createNativeBottomTabNavigator } from '@bottom-tabs/react-navigation';
import ConversationsStack from './ConversationsStack';
import { DirectMessageScreen } from '../screens/DirectMessageScreen';
import { DirectGroupChat } from '../screens/DirectGroupChat';
import { TripPlanningChatScreen } from '../screens/TripPlanningChatScreen';
import SurftripDetailScreen from '../screens/surftrips/SurftripDetailScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { swellyServiceCopy, swellyServiceCopyCopy } from '../services/swelly/swellyServiceCopy';
import { useMessaging } from '../context/MessagingProvider';
import TripsScreen from '../screens/trips/TripsScreen';
import TripDetailScreen from '../screens/trips/TripDetailScreen';
import TripUpdatesScreen from '../screens/trips/TripUpdatesScreen';
import TripMembersScreen from '../screens/trips/TripMembersScreen';
import PackingAndGearScreen from '../screens/trips/PackingAndGearScreen';
import YourGearScreen from '../screens/trips/YourGearScreen';
import ManageSuggestedGearScreen from '../screens/trips/ManageSuggestedGearScreen';
import ManageGearScreen from '../screens/trips/ManageGearScreen';
import CommitmentScreen from '../screens/trips/CommitmentScreen';
import CreateTripWizard from '../screens/trips/CreateTripWizard';
import { NotificationsPanel } from '../components/notifications/NotificationCenter';
import { ProfileScreen } from '../screens/ProfileScreen';
import type { NavKey } from '../components/trips/TripsBottomNav';
import { Images } from '../assets/images';
import { useMainNav } from './MainNavContext';
import { useOnboarding } from '../context/OnboardingContext';
import { queryClient } from '../lib/queryClient';
import { tripsKeys } from '../hooks/trips/useTripQueries';
import { approveJoinRequest, declineJoinRequest } from '../services/trips/groupTripsService';
import type { MainTabsParamList, RootStackParamList } from './navigationRef';
import { navigationRef, pushRootCard } from './navigationRef';

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
const Tab = createNativeBottomTabNavigator<MainTabsParamList>();
const RootStack = createNativeStackNavigator<RootStackParamList>();

// ⏱ TEMP perf instrumentation (dev only). Profiler.onRender fires on every
// commit with phase = 'mount' | 'update' and actualDuration = render+commit ms
// for that subtree. This tells us, on a tab switch, whether a screen REMOUNTS
// (phase 'mount' = the expensive case) or just re-renders, and how long its JS
// work takes. Remove once the tab-switch lag is diagnosed.
const onTabRender = (
  id: string,
  phase: 'mount' | 'update' | 'nested-update',
  actualDuration: number,
) => {
  if (__DEV__ && actualDuration > 30) {
    console.log(`[TAB-PERF] ${id} ${phase} ${Math.round(actualDuration)}ms`);
  }
};

// Screen wrappers are module-level (a navigator remounts inline components on
// every render). They pull their props from MainNavContext.
function LineupTabScreen() {
  const { lineupProps } = useMainNav();
  return (
    <React.Profiler id="Lineup" onRender={onTabRender}>
      <ConversationsStack {...lineupProps} />
    </React.Profiler>
  );
}

function TripsTabScreen() {
  const { tripsProps, navControl } = useMainNav();
  return (
    <React.Profiler id="Trips" onRender={onTabRender}>
      <TripsScreen {...tripsProps} navControl={navControl} />
    </React.Profiler>
  );
}

function ProfileTabScreen() {
  const { profileProps } = useMainNav();
  return (
    <React.Profiler id="Profile" onRender={onTabRender}>
      <ProfileScreen {...profileProps} />
    </React.Profiler>
  );
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
      onViewAllUpdates={() => navigation.dispatch(StackActions.push('TripUpdates', { tripId }))}
      onViewAllMembers={() => navigation.dispatch(StackActions.push('TripMembers', { tripId }))}
      onViewAllGroupGear={() => navigation.dispatch(StackActions.push('PackingAndGear', { tripId }))}
      onViewAllYourGear={() => navigation.dispatch(StackActions.push('YourGear', { tripId }))}
      onManageSuggestedGear={() => navigation.dispatch(StackActions.push('ManageSuggestedGear', { tripId }))}
      onManageGroupGear={() => navigation.dispatch(StackActions.push('ManageGear', { tripId }))}
      onOpenCommitment={args =>
        navigation.dispatch(StackActions.push('Commitment', {
          tripId,
          tripTitle: args.tripTitle,
          initialItems: args.initialItems,
          initialNote: args.initialNote,
        }))
      }
    />
  );
}

function PackingAndGearCardScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'PackingAndGear'>) {
  const { tripId } = route.params;
  return (
    <PackingAndGearScreen
      tripId={tripId}
      onBack={() => navigation.goBack()}
      onEdit={() => navigation.dispatch(StackActions.push('ManageGear', { tripId }))}
    />
  );
}

function YourGearCardScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'YourGear'>) {
  const { tripId } = route.params;
  return <YourGearScreen tripId={tripId} onBack={() => navigation.goBack()} />;
}

function ManageSuggestedGearCardScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'ManageSuggestedGear'>) {
  const { tripId } = route.params;
  return <ManageSuggestedGearScreen tripId={tripId} onBack={() => navigation.goBack()} />;
}

function ManageGearCardScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'ManageGear'>) {
  const { tripId } = route.params;
  return <ManageGearScreen tripId={tripId} onBack={() => navigation.goBack()} />;
}

function CommitmentCardScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'Commitment'>) {
  const { user } = useOnboarding();
  const currentUserId = user?.id ? String(user.id) : null;
  const { tripId, tripTitle, initialItems, initialNote } = route.params;
  return (
    <CommitmentScreen
      tripId={tripId}
      currentUserId={currentUserId}
      tripTitle={tripTitle ?? null}
      initialItems={initialItems}
      initialNote={initialNote ?? null}
      onClose={() => navigation.goBack()}
    />
  );
}

function TripUpdatesCardScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'TripUpdates'>) {
  const { tripId } = route.params;
  return <TripUpdatesScreen tripId={tripId} onBack={() => navigation.goBack()} />;
}

function TripMembersCardScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'TripMembers'>) {
  const { tripCard } = useMainNav();
  const { tripId } = route.params;
  return (
    <TripMembersScreen
      tripId={tripId}
      onBack={() => navigation.goBack()}
      onViewUserProfile={userId => tripCard.onViewUserProfile(userId, tripId)}
      onReviewRequest={(userId, requestId) =>
        navigation.dispatch(
          StackActions.push('ProfileCard', { userId, joinRequest: { tripId, requestId } })
        )
      }
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

function ChatCardScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'ChatCard'>) {
  const { chatCard } = useMainNav();
  const { setCurrentConversationId } = useMessaging();
  const params = route.params;

  // Suppress unread increments while this conversation is on screen (same
  // two-phase pattern as the ConversationsStack DM route).
  useEffect(() => {
    if (params.conversationId) setCurrentConversationId(params.conversationId);
    return () => setCurrentConversationId(null);
  }, [params.conversationId, setCurrentConversationId]);

  const Chat = params.isDirect === false ? DirectGroupChat : DirectMessageScreen;
  return (
    <Chat
      conversationId={params.conversationId}
      otherUserId={params.otherUserId}
      otherUserName={params.otherUserName}
      otherUserAvatar={params.otherUserAvatar}
      isDirect={params.isDirect ?? true}
      tripId={params.tripId}
      surftripId={params.surftripId}
      reviewCommitment={params.reviewCommitment}
      onBack={() => navigation.goBack()}
      onViewProfile={chatCard.onViewProfile}
      onOpenTripDetail={chatCard.onOpenTripDetail}
      onOpenSurftripDetail={chatCard.onOpenSurftripDetail}
      onConversationCreated={(conversationId: string) => {
        if (conversationId) setCurrentConversationId(conversationId);
        navigation.setParams({ conversationId });
      }}
    />
  );
}

function SurftripCardScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'SurftripCard'>) {
  const { chatCard } = useMainNav();
  const { user } = useOnboarding();
  return (
    <SurftripDetailScreen
      groupId={route.params.groupId}
      currentUserId={user?.id ? String(user.id) : null}
      onBack={() => navigation.goBack()}
      onOpenChat={(conversationId: string, title: string) =>
        navigation.dispatch(StackActions.push('ChatCard', {
          conversationId,
          otherUserId: '',
          otherUserName: title,
          otherUserAvatar: null,
          isDirect: false,
          surftripId: route.params.groupId,
        }))
      }
      onViewProfile={chatCard.onViewProfile}
    />
  );
}

function SwellyChatCardScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'SwellyChat'>) {
  const { swellyChat } = useMainNav();
  return (
    <TripPlanningChatScreen
      onChatComplete={() => {
        navigation.goBack();
      }}
      onViewUserProfile={swellyChat.onViewUserProfile}
      onStartConversation={swellyChat.onStartConversation}
      persistedChatId={swellyChat.persistedChatId}
      persistedMatchedUsers={swellyChat.persistedMatchedUsers}
      persistedDestination={swellyChat.persistedDestination}
      onChatStateChange={swellyChat.onChatStateChange}
      service={route.params?.service === 'copy-copy' ? swellyServiceCopyCopy : swellyServiceCopy}
      visible={true}
      // The navigator animates the card — skip the screen's own entry slide.
      noTransition={true}
    />
  );
}

function ProfileCardScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'ProfileCard'>) {
  const { profileCard } = useMainNav();
  const { userId, suppressConnectAnalytics, joinRequest } = route.params;
  // Opened to review a pending join request → Approve / Decline footer that
  // actions the request, refreshes the trip caches, then pops back.
  const reviewRequest = joinRequest
    ? {
        onApprove: async () => {
          try {
            await approveJoinRequest(joinRequest.requestId);
            queryClient.invalidateQueries({ queryKey: tripsKeys.detail(joinRequest.tripId) });
            queryClient.invalidateQueries({ queryKey: tripsKeys.detailRequests(joinRequest.tripId) });
            queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });
            navigation.goBack();
          } catch (e: any) {
            Alert.alert('Could not approve', e?.message || 'Please try again.');
          }
        },
        onDecline: async () => {
          try {
            await declineJoinRequest(joinRequest.requestId);
            queryClient.invalidateQueries({ queryKey: tripsKeys.detailRequests(joinRequest.tripId) });
            navigation.goBack();
          } catch (e: any) {
            Alert.alert('Could not decline', e?.message || 'Please try again.');
          }
        },
      }
    : undefined;
  return (
    <ProfileScreen
      userId={userId}
      onBack={() => {
        navigation.goBack();
      }}
      onMessage={profileCard.onMessage}
      suppressConnectAnalytics={suppressConnectAnalytics}
      reviewRequest={reviewRequest}
      // Card: the navigator owns slide-in and swipe-back.
      noTransition={true}
      swipeBackDisabled={true}
    />
  );
}

function SettingsCardScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Settings'>) {
  const { settings } = useMainNav();
  return (
    <SettingsScreen
      onBack={() => navigation.goBack()}
      userName={settings.userName}
      userAvatar={settings.userAvatar}
      userEmail={settings.userEmail}
    />
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
 * Extras rendered alongside the NATIVE tab navigator (which has no custom
 * tabBar slot). Lives inside HomeTabs → inside both NavigationContainer and
 * MainNavProvider, so it can read context and drive navigation:
 *   • mirrors the active tab back into AppContent (Profile back button)
 *   • consumes programmatic tab switches + trip-card opens
 *   • renders the Swelly floating avatar (Lineup tab only)
 */
function HomeTabsExtras() {
  const {
    barSuppressed, onTabChange,
    requestedTab, onRequestedTabConsumed,
    requestedTripCard, onRequestedTripCardConsumed,
    lineupProps,
  } = useMainNav();

  // Active tab name read from the nested HomeTabs state on the root stack.
  const activeRoute = useNavigationState(state => {
    const home = state.routes.find(r => r.name === 'HomeTabs');
    const tabState = home?.state as { index?: number; routes: { name: string }[] } | undefined;
    if (!tabState || tabState.index == null) return 'Trips';
    return tabState.routes[tabState.index]?.name ?? 'Trips';
  });
  const active = (KEY_FOR_ROUTE[activeRoute] ?? 'trips') as NavKey;

  // Mirror the active tab into AppContent (legacy reads + Profile back button).
  useEffect(() => {
    onTabChange(active);
  }, [active, onTabChange]);

  // Programmatic switches (deep links, join-decision overlay, group-chat
  // exits). Target the nested tab via the container ref — mount-safe.
  useEffect(() => {
    if (!requestedTab) return;
    if (requestedTab !== active && navigationRef.isReady()) {
      navigationRef.navigate('HomeTabs', { screen: ROUTE_FOR_KEY[requestedTab] });
    }
    onRequestedTabConsumed();
  }, [requestedTab, active, onRequestedTabConsumed]);

  // Programmatic trip-card opens (deep links) — pushed on the root stack so the
  // card covers the tabs and the native bar.
  useEffect(() => {
    if (!requestedTripCard) return;
    pushRootCard('TripDetail', {
      tripId: requestedTripCard.tripId,
      focus: requestedTripCard.focus ?? null,
    });
    onRequestedTripCardConsumed();
  }, [requestedTripCard, onRequestedTripCardConsumed]);

  // Swelly floating avatar — Lineup tab only, hidden while an overlay is up.
  if (active !== 'lineup' || barSuppressed || !lineupProps.onSwellyPress) return null;
  return (
    <TouchableOpacity
      testID="conversations-swelly-button"
      onPress={() => lineupProps.onSwellyPress?.()}
      activeOpacity={0.85}
      style={swellyFloatingStyles.button}
    >
      <Image
        source={Images.swellyPopout}
        style={swellyFloatingStyles.image}
        resizeMode="contain"
      />
    </TouchableOpacity>
  );
}

const swellyFloatingStyles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: 12,
    // Sits just above the native tab bar (~49pt bar + bottom safe area).
    // Tuned visually on device — adjust if it overlaps the bar.
    bottom: 96,
    width: 80,
    height: 85,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 30,
  },
  image: {
    width: 80,
    height: 85,
  },
});

function HomeTabs() {
  // barSuppressed hides the entire native bar while a full-screen JS overlay
  // (match-loading, Swelly shaper, own-profile, profile editor) is up — those
  // overlays are NOT nav cards, so they don't cover the OS-level bar on their
  // own.
  const { barSuppressed } = useMainNav();
  return (
    <>
      <Tab.Navigator
        initialRouteName="Trips"
        backBehavior="none"
        // Brand teal active, muted inactive. On iOS 26 the bar itself is
        // Liquid Glass (background OS-controlled); the tint + icons are ours.
        tabBarActiveTintColor="#05BCD3"
        tabBarInactiveTintColor="#8A9BA3"
        // iOS 26: collapse to a pill on scroll-down (the behavior Eyal chose).
        minimizeBehavior="onScrollDown"
        labeled
        hapticFeedbackEnabled
        tabBarHidden={barSuppressed}
      >
        <Tab.Screen
          name="Lineup"
          component={LineupTabScreen}
          options={{ title: 'The Lineup', tabBarIcon: () => Images.nav.theLineup }}
        />
        <Tab.Screen
          name="Trips"
          component={TripsTabScreen}
          options={{ title: 'Trips', tabBarIcon: () => Images.nav.trips }}
        />
        <Tab.Screen
          name="Profile"
          component={ProfileTabScreen}
          options={{ title: 'Profile', tabBarIcon: () => Images.nav.profile }}
        />
      </Tab.Navigator>
      <HomeTabsExtras />
    </>
  );
}

export default function RootNavigator() {
  return (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      <RootStack.Screen name="HomeTabs" component={HomeTabs} />
      <RootStack.Screen name="TripDetail" component={TripDetailCardScreen} options={{ presentation: 'card' }} />
      <RootStack.Screen name="EditTrip" component={EditTripCardScreen} options={{ presentation: 'card' }} />
      <RootStack.Screen name="TripUpdates" component={TripUpdatesCardScreen} options={{ presentation: 'card' }} />
      <RootStack.Screen name="TripMembers" component={TripMembersCardScreen} options={{ presentation: 'card' }} />
      <RootStack.Screen name="PackingAndGear" component={PackingAndGearCardScreen} options={{ presentation: 'card' }} />
      <RootStack.Screen name="YourGear" component={YourGearCardScreen} options={{ presentation: 'card' }} />
      <RootStack.Screen name="ManageSuggestedGear" component={ManageSuggestedGearCardScreen} options={{ presentation: 'card' }} />
      <RootStack.Screen name="ManageGear" component={ManageGearCardScreen} options={{ presentation: 'card' }} />
      <RootStack.Screen name="Commitment" component={CommitmentCardScreen} options={{ presentation: 'card' }} />
      <RootStack.Screen name="ChatCard" component={ChatCardScreen} options={{ presentation: 'card' }} />
      <RootStack.Screen name="SwellyChat" component={SwellyChatCardScreen} options={{ presentation: 'card' }} />
      <RootStack.Screen name="SurftripCard" component={SurftripCardScreen} options={{ presentation: 'card' }} />
      <RootStack.Screen name="ProfileCard" component={ProfileCardScreen} options={{ presentation: 'card' }} />
      <RootStack.Screen name="Settings" component={SettingsCardScreen} options={{ presentation: 'card' }} />
      {/* Plain card. The panel is full-screen and opaque, so transparency
          bought nothing and modal presentations broke z-order/gestures
          (two strikes: native modal context → sheets+crashes; contained →
          cards rendering underneath). Native slide + edge-swipe back. */}
      <RootStack.Screen
        name="NotificationsPanel"
        component={NotificationsPanelScreen}
        options={{ presentation: 'card' }}
      />
    </RootStack.Navigator>
  );
}
