import React from 'react';
import { Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from './Text';
import { AggregatedReaction } from '../services/messaging/messagingService';

interface Props {
  reactions: AggregatedReaction[];
  ownAlignment: 'left' | 'right';
  onPress?: (emoji: string) => void;
}

/**
 * Aggregated reaction chips shown directly under a message bubble
 * (WhatsApp-style overlap). Each pill = one distinct emoji + count.
 */
export const MessageReactionsRow: React.FC<Props> = ({
  reactions,
  ownAlignment,
  onPress,
}) => {
  if (reactions.length === 0) return null;

  return (
    <View
      style={[
        styles.row,
        ownAlignment === 'right' ? styles.alignRight : styles.alignLeft,
      ]}
    >
      {reactions.map(r => {
        const showCount = r.count > 1;
        const Pill = onPress ? TouchableOpacity : View;
        return (
          <Pill
            key={r.emoji}
            style={[styles.pill, r.hasMine && styles.pillMine]}
            {...(onPress
              ? { activeOpacity: 0.7, onPress: () => onPress(r.emoji) }
              : {})}
          >
            <Text style={styles.emoji}>{r.emoji}</Text>
            {showCount ? (
              <Text style={[styles.count, r.hasMine && styles.countMine]}>
                {r.count}
              </Text>
            ) : null}
          </Pill>
        );
      })}
    </View>
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
    backgroundColor: '#D9D9D9',
    borderColor: 'rgba(0, 0, 0, 0.08)',
  },
  emoji: {
    fontSize: 15,
    lineHeight: 18,
  },
  count: {
    fontSize: 11,
    color: '#444',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
  countMine: {
    color: '#222',
    fontWeight: '600',
  },
});
