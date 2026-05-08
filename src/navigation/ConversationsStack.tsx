import React, { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import { createBlankStackNavigator } from 'react-native-screen-transitions/blank-stack';
import Transition from 'react-native-screen-transitions';
import { useNavigation, useRoute } from '@react-navigation/native';
import { interpolate } from 'react-native-reanimated';
import ConversationsScreen from '../screens/ConversationsScreen';
import { DirectMessageScreen } from '../screens/DirectMessageScreen';
import { DirectGroupChat } from '../screens/DirectGroupChat';
import SurftripDetailScreen from '../screens/surftrips/SurftripDetailScreen';
import { useMessaging } from '../context/MessagingProvider';
import { useUserProfile } from '../context/UserProfileContext';

export type DMNavParams = {
  conversationId?: string;
  otherUserId: string;
  otherUserName: string;
  otherUserAvatar: string | null;
  isDirect?: boolean;
  tripId?: string;
  surftripId?: string;
};

type ConversationsStackContextValue = {
  navigateToDM: (params: DMNavParams) => void;
  closeDM: () => void;
  navigateToSurftripDetail: (groupId: string) => void;
  closeSurftripDetail: () => void;
};

const ConversationsStackContext = createContext<ConversationsStackContextValue | null>(null);
export const useConversationsStack = () => useContext(ConversationsStackContext);

const Stack = createBlankStackNavigator();

type ConversationsScreenProps = React.ComponentProps<typeof ConversationsScreen>;

const slideFromRightOptions = {
  gestureEnabled: true,
  gestureDirection: 'horizontal' as const,
  // Restrict the screen-pop swipe to the left edge of the screen so per-message
  // swipe-to-reply can claim touches that land on incoming bubbles in the body.
  gestureActivationArea: 'edge' as const,
  transitionSpec: {
    open: Transition.Specs.DefaultSpec,
    close: Transition.Specs.DefaultSpec,
  },
  screenStyleInterpolator: ({ progress, current: { layouts: { screen } } }: any) => {
    'worklet';
    if (progress === 1) {
      return {};
    }
    return {
      content: {
        style: {
          transform: [
            {
              translateX: interpolate(
                progress,
                [0, 1, 2],
                [screen.width, 0, 0],
              ),
            },
          ],
        },
      },
    };
  },
};

export default function ConversationsStack(props: ConversationsScreenProps) {
  if (Platform.OS === 'web') {
    return <ConversationsScreen {...props} />;
  }
  return (
    <Stack.Navigator
      initialRouteName="ConversationsList"
      enableNativeScreens={false}
      independent
    >
      <Stack.Screen name="ConversationsList">
        {() => <ConversationsListRoute {...props} />}
      </Stack.Screen>
      <Stack.Screen
        name="DirectMessage"
        options={slideFromRightOptions}
      >
        {() => (
          <DirectMessageRoute
            onViewUserProfile={props.onViewUserProfile}
            onOpenTripDetail={props.onOpenTripDetail}
          />
        )}
      </Stack.Screen>
      <Stack.Screen
        name="SurftripDetail"
        options={slideFromRightOptions}
      >
        {() => <SurftripDetailRoute onViewUserProfile={props.onViewUserProfile} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

function ConversationsListRoute(props: ConversationsScreenProps) {
  const navigation = useNavigation<any>();
  const { setCurrentConversationId } = useMessaging();

  const navigateToDM = useCallback(
    (params: DMNavParams) => {
      if (params.conversationId) {
        setCurrentConversationId(params.conversationId);
      }
      navigation.navigate('DirectMessage', params);
    },
    [navigation, setCurrentConversationId],
  );

  const closeDM = useCallback(() => {
    setCurrentConversationId(null);
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation, setCurrentConversationId]);

  const navigateToSurftripDetail = useCallback(
    (groupId: string) => {
      navigation.navigate('SurftripDetail', { groupId });
    },
    [navigation],
  );

  const closeSurftripDetail = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  const ctx = useMemo(
    () => ({ navigateToDM, closeDM, navigateToSurftripDetail, closeSurftripDetail }),
    [navigateToDM, closeDM, navigateToSurftripDetail, closeSurftripDetail],
  );

  return (
    <ConversationsStackContext.Provider value={ctx}>
      <ConversationsScreen {...props} />
    </ConversationsStackContext.Provider>
  );
}

function DirectMessageRoute({
  onViewUserProfile,
  onOpenTripDetail,
}: {
  onViewUserProfile?: (userId: string) => void;
  onOpenTripDetail?: (tripId: string) => void;
}) {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const params = (route.params ?? {}) as DMNavParams;
  const { setCurrentConversationId } = useMessaging();

  useEffect(() => {
    if (params.conversationId) {
      setCurrentConversationId(params.conversationId);
    }
    return () => {
      setCurrentConversationId(null);
    };
  }, [params.conversationId, setCurrentConversationId]);

  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  const handleOpenSurftripDetail = useCallback(
    (surftripId: string) => {
      navigation.navigate('SurftripDetail', { groupId: surftripId });
    },
    [navigation],
  );

  const ChatScreen = params.isDirect === false ? DirectGroupChat : DirectMessageScreen;
  return (
    <ChatScreen
      conversationId={params.conversationId}
      otherUserId={params.otherUserId}
      otherUserName={params.otherUserName}
      otherUserAvatar={params.otherUserAvatar}
      isDirect={params.isDirect ?? true}
      tripId={params.tripId}
      surftripId={params.surftripId}
      onBack={handleBack}
      onViewProfile={onViewUserProfile}
      onOpenTripDetail={onOpenTripDetail}
      onOpenSurftripDetail={handleOpenSurftripDetail}
      onConversationCreated={(conversationId) => {
        if (conversationId) setCurrentConversationId(conversationId);
        navigation.setParams({ conversationId });
      }}
    />
  );
}

function SurftripDetailRoute({
  onViewUserProfile,
}: {
  onViewUserProfile?: (userId: string) => void;
}) {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const params = (route.params ?? {}) as { groupId: string };
  const { profile } = useUserProfile();
  const currentUserId = profile?.user_id ?? null;

  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  const handleOpenChat = useCallback(
    (conversationId: string, title: string) => {
      navigation.navigate('DirectMessage', {
        conversationId,
        otherUserId: '',
        otherUserName: title,
        otherUserAvatar: null,
        isDirect: false,
        surftripId: params.groupId,
      } satisfies DMNavParams);
    },
    [navigation, params.groupId],
  );

  return (
    <SurftripDetailScreen
      groupId={params.groupId}
      currentUserId={currentUserId}
      onBack={handleBack}
      onOpenChat={handleOpenChat}
      onViewProfile={onViewUserProfile}
    />
  );
}
