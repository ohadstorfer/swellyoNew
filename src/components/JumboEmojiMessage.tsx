/**
 * JumboEmojiMessage — WhatsApp-style "jumbo" rendering for an emoji-only message
 * (a single emoji, no other text). Shown with NO bubble background: just the large
 * emoji and a small timestamp + read-receipt row below it, aligned to the
 * message side. Used by DirectMessageScreen and DirectGroupChat in place of the
 * normal text bubble when getEmojiOnlyInfo(body).isJumbo is true. Bodies of 2-3
 * emoji are NOT routed here — they keep the normal bubble and just enlarge the
 * body font via getEmojiFontSize().
 *
 * Bubble chrome: spread `jumboBubbleStyle` onto the MessageBubbleHighlight style
 * array so the surrounding bubble goes transparent/padding-free.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { getEmojiFontSize } from '../utils/emoji';

/** Drop the bubble background/padding/shadow so only the emoji shows. */
export const jumboBubbleStyle = {
  backgroundColor: 'transparent' as const,
  paddingTop: 0,
  paddingBottom: 0,
  paddingLeft: 0,
  paddingRight: 0,
  borderRadius: 0,
  shadowOpacity: 0,
  elevation: 0,
  borderWidth: 0,
};

interface Props {
  body: string;
  count: number;
  isOwn: boolean;
  timeText?: string;
  receipt?: React.ReactNode;
}

export const JumboEmojiMessage: React.FC<Props> = ({
  body,
  count,
  isOwn,
  timeText,
  receipt,
}) => {
  const fontSize = getEmojiFontSize(count) ?? 52;
  return (
    <View style={isOwn ? styles.alignRight : styles.alignLeft}>
      <Text style={[styles.emoji, { fontSize, lineHeight: Math.round(fontSize * 1.2) }]}>
        {body}
      </Text>
      <View style={[styles.metaRow, isOwn ? styles.metaRight : styles.metaLeft]}>
        {!!timeText && <Text style={styles.time}>{timeText}</Text>}
        {receipt}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  alignLeft: { alignItems: 'flex-start' },
  alignRight: { alignItems: 'flex-end' },
  emoji: {
    // A hair of horizontal padding so wide emoji never clip at the edges.
    paddingHorizontal: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  metaLeft: { justifyContent: 'flex-start' },
  metaRight: { justifyContent: 'flex-end' },
  time: {
    fontSize: 11,
    fontWeight: '300',
    color: 'rgba(0,0,0,0.45)',
  },
});

export default JumboEmojiMessage;
