import React, { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import { createBlankStackNavigator } from 'react-native-screen-transitions/blank-stack';
import Transition from 'react-native-screen-transitions';
import { useNavigation, useRoute } from '@react-navigation/native';
import { interpolate } from 'react-native-reanimated';
import ConversationsScreen from '../screens/ConversationsScreen';
import { DirectMessageScreen } from '../screens/DirectMessageScreen';
import { useMessaging } from '../context/MessagingProvider';

export type DMNavParams = {
  conversationId?: string;
  otherUserId: string;
  otherUserName: string;
  otherUserAvatar: string | null;
  isDirect?: boolean;
};

type ConversationsStackContextValue = {
  navigateToDM: (params: DMNavParams) => void;
  closeDM: () => void;
};

const ConversationsStackContext = createContext<ConversationsStackContextValue | null>(null);
export const useConversationsStack = () => useContext(ConversationsStackContext);

const Stack = createBlankStackNavigator();

type ConversationsScreenProps = React.ComponentProps<typeof ConversationsScreen>;

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
        options={{
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          gestureActivationArea: { left: 'edge' },
          transitionSpec: {
            open: Transition.Specs.DefaultSpec,
            close: Transition.Specs.DefaultSpec,
          },
          screenStyleInterpolator: ({ progress, current: { layouts: { screen } } }) => {
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
        }}
      >
        {() => <DirectMessageRoute onViewUserProfile={props.onViewUserProfile} />}
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

  const ctx = useMemo(() => ({ navigateToDM, closeDM }), [navigateToDM, closeDM]);

  return (
    <ConversationsStackContext.Provider value={ctx}>
      <ConversationsScreen {...props} />
    </ConversationsStackContext.Provider>
  );
}

function DirectMessageRoute({
  onViewUserProfile,
}: {
  onViewUserProfile?: (userId: string) => void;
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

  return (
    <DirectMessageScreen
      conversationId={params.conversationId}
      otherUserId={params.otherUserId}
      otherUserName={params.otherUserName}
      otherUserAvatar={params.otherUserAvatar}
      isDirect={params.isDirect ?? true}
      onBack={handleBack}
      onViewProfile={onViewUserProfile}
      onConversationCreated={(conversationId) => {
        if (conversationId) setCurrentConversationId(conversationId);
        navigation.setParams({ conversationId });
      }}
    />
  );
}
