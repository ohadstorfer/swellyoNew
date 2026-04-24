import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Text } from './Text';
import { Ionicons } from '@expo/vector-icons';
import type { ReplyToSnapshot } from '../services/messaging/messagingService';

const REPLY_PURPLE = '#A58DED';

interface QuotedMessagePreviewProps {
  snapshot: ReplyToSnapshot;
  isOwnBubble: boolean;
}

export const QuotedMessagePreview: React.FC<QuotedMessagePreviewProps> = ({
  snapshot,
  isOwnBubble,
}) => {
  let preview: string;
  if (snapshot.type === 'image') {
    preview = 'Photo';
  } else if (snapshot.type === 'video') {
    preview = 'Video';
  } else {
    preview = (snapshot.body || '').trim();
  }

  const mediaIcon =
    snapshot.type === 'image' ? 'image-outline' :
    snapshot.type === 'video' ? 'videocam-outline' :
    null;

  // Swelly bubbles (own and other) are all light-background (white, beige, teal,
  // etc.), so always use dark body text — white-on-white was invisible on own
  // bubbles. The sender name stays purple which reads fine on all bubble colors.
  const bodyColor = 'rgba(0,0,0,0.7)';

  return (
    <View style={styles.container}>
      <View style={styles.bar} />
      <View style={styles.content}>
        <Text style={styles.name} numberOfLines={1}>{snapshot.sender_name || 'User'}</Text>
        <View style={styles.previewRow}>
          {mediaIcon && (
            <Ionicons
              name={mediaIcon as any}
              size={13}
              color={bodyColor}
              style={styles.previewIcon}
            />
          )}
          <Text style={[styles.preview, { color: bodyColor }]} numberOfLines={1}>
            {preview}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'stretch',
    alignSelf: 'stretch', // Override parent bubble's alignItems:'flex-end' so the
                          // quote fills the bubble width instead of shrink-wrapping.
    minWidth: 180,         // Forces the bubble to grow wide enough to show quote
                          // content — matches WhatsApp's quoted-reply width.
    backgroundColor: 'rgba(0,0,0,0.15)',
    borderRadius: 6,
    marginBottom: 4,
    overflow: 'hidden',
    paddingVertical: 5,
    paddingRight: 8,
  },
  bar: {
    width: 3,
    backgroundColor: REPLY_PURPLE,
    borderRadius: 2,
    marginLeft: 6,
    marginRight: 8,
  },
  content: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  name: {
    color: REPLY_PURPLE,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 1,
  },
  previewIcon: {
    marginRight: 3,
  },
  preview: {
    fontSize: 13,
    flexShrink: 1,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
});
