import React from 'react';
import { Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Text } from './Text';

export const QUICK_REACTION_EMOJIS: readonly string[] = [
  '🤙🏼',
  '❤️',
  '😂',
  '😮',
  '😢',
  '🔥',
  '👍🏼',
];

export const REACTIONS_BAR_HEIGHT = 52;
export const REACTIONS_BAR_WIDTH_ESTIMATE = 320;

interface Props {
  // Absolute viewport coords for the top-left of the bar. Caller is
  // responsible for picking a position that keeps the bar on-screen.
  top: number;
  left: number;
  currentReaction?: string;
  onReact: (emoji: string) => void;
}

export const MessageReactionsBar: React.FC<Props> = ({
  top,
  left,
  currentReaction,
  onReact,
}) => {
  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(120)}
      style={[styles.container, { top, left }]}
      pointerEvents="box-none"
    >
      <View style={styles.bar}>
        {QUICK_REACTION_EMOJIS.map(emoji => {
          const isActive = emoji === currentReaction;
          return (
            <TouchableOpacity
              key={emoji}
              style={[styles.item, isActive && styles.itemActive]}
              activeOpacity={0.6}
              onPress={() => onReact(emoji)}
            >
              <Text style={styles.emoji}>{emoji}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingHorizontal: 6,
    paddingVertical: 6,
    gap: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
    ...(Platform.OS === 'web' && {
      boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.18)',
    }),
  },
  item: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemActive: {
    backgroundColor: 'rgba(7, 136, 176, 0.18)',
  },
  emoji: {
    fontSize: 26,
    lineHeight: 30,
  },
});
