import React from 'react';
import { useIsFocused } from '@react-navigation/native';
import ConversationsScreen from '../screens/ConversationsScreen';

/**
 * Thin wrapper since nav migration B1: the inner blank-stack (DirectMessage /
 * SurftripDetail routes via react-native-screen-transitions) is GONE — chats
 * and surftrip details are cards on the root stack now, pushed from anywhere
 * via pushRootCard. This wrapper only keeps the AppContent import surface
 * stable and feeds tab focus into the screen (a pushed card blurs the tab,
 * so useIsFocused correctly gates the welcome-guide trigger and refreshes).
 *
 * Phase 5: fold into AppContent/RootNavigator and delete this file together
 * with the react-native-screen-transitions dependency.
 */
export default function ConversationsStack({
  onInnerScreenChange: _onInnerScreenChange,
  ...props
}: React.ComponentProps<typeof ConversationsScreen> & {
  /** Legacy (B1): no inner pushes exist anymore. Kept for prop compatibility. */
  onInnerScreenChange?: (open: boolean) => void;
}) {
  const isFocused = useIsFocused();
  return <ConversationsScreen {...props} stackScreenFocused={isFocused} />;
}
