// "Mute chat" durations for the trip's group chat, opened from the trip page's
// ⋮ menu. Same three choices as the chat's own mute picker (DirectGroupChat).

import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '../BottomSheetShell';
import { SheetOptionRow } from '../sheets/SheetOptionRow';
import { MUTE_ALWAYS_UNTIL } from '../../services/messaging/messagingService';
import { ff } from '../../theme/fonts';

const HOUR = 60 * 60 * 1000;

interface Props {
  visible: boolean;
  onClose: () => void;
  onMute: (until: Date) => void;
}

export function MuteChatSheet({ visible, onClose, onMute }: Props) {
  const insets = useSafeAreaInsets();
  const pick = (until: () => Date) => () => {
    onClose();
    onMute(until());
  };
  return (
    <BottomSheetShell visible={visible} onClose={onClose}>
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        <Text style={styles.title}>Mute trip chat</Text>
        <SheetOptionRow
          icon="time-outline"
          label="8 hours"
          onPress={pick(() => new Date(Date.now() + 8 * HOUR))}
        />
        <SheetOptionRow
          icon="calendar-outline"
          label="1 week"
          onPress={pick(() => new Date(Date.now() + 7 * 24 * HOUR))}
        />
        <SheetOptionRow
          icon="notifications-off-outline"
          label="Always"
          onPress={pick(() => MUTE_ALWAYS_UNTIL)}
        />
      </View>
    </BottomSheetShell>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
  },
  title: {
    fontFamily: ff('Inter', '700'),
    ...(Platform.OS === 'web' ? { fontWeight: '700' as const } : null),
    fontSize: 16,
    lineHeight: 20,
    color: '#222B30',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
});

export default MuteChatSheet;
