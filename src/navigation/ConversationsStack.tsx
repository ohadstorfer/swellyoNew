import React from 'react';
import { useIsFocused } from '@react-navigation/native';
import ConversationsScreen from '../screens/ConversationsScreen';

/**
 * Thin wrapper since nav migration B1: the old inner blank-stack
 * (DirectMessage / SurftripDetail routes) is GONE — chats and surftrip
 * details are cards on the root stack now, pushed from anywhere via
 * pushRootCard. This wrapper only keeps the AppContent import surface
 * stable and feeds tab focus into the screen (a pushed card blurs the tab,
 * so useIsFocused correctly gates the welcome-guide trigger and refreshes).
 */
export default function ConversationsStack(
  props: React.ComponentProps<typeof ConversationsScreen>
) {
  const isFocused = useIsFocused();
  return <ConversationsScreen {...props} stackScreenFocused={isFocused} />;
}
