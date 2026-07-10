import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from './Text';
import { AggregatedReaction } from '../services/messaging/messagingService';

interface Props {
  reactions: AggregatedReaction[];
  ownAlignment: 'left' | 'right';
  onPress?: (emoji: string) => void;
  // Left offset (px) for left-aligned rows so the badge lines up with the
  // bubble's left edge instead of the avatar lane in group chats.
  leftInset?: number;
  // True while this message is the one lifted by the spotlight overlay (long-
  // press menu or edit mode). The pill hangs OUTSIDE the spotlight's cutout, so
  // leaving it up would strand a blurred, dimmed badge against a perfectly
  // sharp bubble. It fades instead of unmounting: the row contributes height,
  // and dropping it would reflow every message below — in an inverted list
  // that's a visible jump, and it would invalidate the bubbleRect the overlay
  // is actively drawing its hole from.
  hidden?: boolean;
}

/**
 * Aggregated reaction chips shown directly under a message bubble
 * (WhatsApp-style overlap). Each pill = one distinct emoji + count.
 */
export const MessageReactionsRow: React.FC<Props> = ({
  reactions,
  ownAlignment,
  onPress,
  leftInset,
  hidden = false,
}) => {
  // Exit is quicker than entry: the overlay's own fade-in is 150ms, and the
  // pill should already be gone by the time the frost settles.
  const fade = useRef(new Animated.Value(hidden ? 0 : 1)).current;
  useEffect(() => {
    Animated.timing(fade, {
      toValue: hidden ? 0 : 1,
      duration: hidden ? 110 : 150,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [hidden, fade]);

  if (reactions.length === 0) return null;

  // Merge every reaction into ONE WhatsApp-style pill: the distinct emojis
  // shown side by side, with the total count to the right when it's >1.
  const total = reactions.reduce((sum, r) => sum + r.count, 0);
  const anyMine = reactions.some(r => r.hasMine);
  const Pill = onPress ? TouchableOpacity : View;

  return (
    <Animated.View
      pointerEvents={hidden ? 'none' : 'auto'}
      style={[
        styles.row,
        ownAlignment === 'right' ? styles.alignRight : styles.alignLeft,
        ownAlignment === 'left' && leftInset != null && { marginLeft: leftInset },
        { opacity: fade },
      ]}
    >
      <Pill
        style={[styles.pill, anyMine && styles.pillMine]}
        {...(onPress
          ? { activeOpacity: 0.7, onPress: () => onPress(reactions[0].emoji) }
          : {})}
      >
        {reactions.map(r => (
          <Text key={r.emoji} style={styles.emoji}>
            {r.emoji}
          </Text>
        ))}
        {total > 1 ? (
          <Text style={[styles.count, anyMine && styles.countMine]}>{total}</Text>
        ) : null}
      </Pill>
    </Animated.View>
  );
};

const BADGE_SIZE = 30;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    // Pull the row up so the badge slightly overlaps the bottom edge of the
    // bubble (WhatsApp-style "sticker" effect).
    marginTop: -BADGE_SIZE / 2,
    zIndex: 2,
  },
  alignLeft: {
    justifyContent: 'flex-start',
    // 2px right of the bubble's left edge — chat container has paddingLeft: 0
    // for incoming bubbles, so the row starts at the bubble's left.
    marginLeft: 2,
  },
  alignRight: {
    justifyContent: 'flex-end',
    marginRight: 2,
    alignSelf: 'flex-end',
  },
  pill: {
    minWidth: BADGE_SIZE,
    height: BADGE_SIZE,
    paddingHorizontal: 6,
    borderRadius: BADGE_SIZE / 2,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    ...(Platform.OS === 'web' && {
      boxShadow: '0px 1px 2px rgba(0, 0, 0, 0.08)',
    }),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  pillMine: {
    // Always white behind the emoji (own reactions previously used a gray
    // fill). The bold/darker count (countMine) still marks it as yours.
    backgroundColor: '#FFFFFF',
    borderColor: 'rgba(0, 0, 0, 0.08)',
  },
  emoji: {
    fontSize: 15,
    lineHeight: 18,
  },
  count: {
    fontSize: 13,
    color: '#444',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
  countMine: {
    color: '#222',
    fontWeight: '600',
  },
});
