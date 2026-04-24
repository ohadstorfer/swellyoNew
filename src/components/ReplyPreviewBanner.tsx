import React from 'react';
import { View, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Text } from './Text';
import { Ionicons } from '@expo/vector-icons';
import type { Message } from '../services/messaging/messagingService';

const REPLY_PURPLE = '#A58DED';

interface ReplyPreviewBannerProps {
  message: Message;
  currentUserId: string | null;
  otherUserName?: string;
  onCancel: () => void;
}

export const ReplyPreviewBanner: React.FC<ReplyPreviewBannerProps> = ({
  message,
  currentUserId,
  otherUserName,
  onCancel,
}) => {
  const isOwn = !!currentUserId && message.sender_id === currentUserId;
  const displayName = isOwn ? 'You' : (message.sender_name || otherUserName || 'User');

  let preview: string;
  if (message.type === 'image') {
    preview = 'Photo';
  } else if (message.type === 'video') {
    preview = 'Video';
  } else {
    preview = (message.body || '').trim();
  }

  const mediaIcon =
    message.type === 'image' ? 'image-outline' :
    message.type === 'video' ? 'videocam-outline' :
    null;

  return (
    <View style={styles.container}>
      <View style={styles.bar} />
      <View style={styles.content}>
        <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
        <View style={styles.previewRow}>
          {mediaIcon && (
            <Ionicons
              name={mediaIcon as any}
              size={14}
              color="rgba(255,255,255,0.7)"
              style={styles.previewIcon}
            />
          )}
          <Text style={styles.preview} numberOfLines={1}>{preview}</Text>
        </View>
      </View>
      <TouchableOpacity
        onPress={onCancel}
        style={styles.closeBtn}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="close" size={22} color="rgba(255,255,255,0.85)" />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#2A2A2A',
    paddingVertical: 8,
    paddingRight: 8,
    paddingLeft: 0,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  bar: {
    width: 3,
    backgroundColor: REPLY_PURPLE,
    borderRadius: 2,
    marginLeft: 10,
    marginRight: 10,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
  },
  name: {
    color: REPLY_PURPLE,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  previewIcon: {
    marginRight: 4,
  },
  preview: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    flexShrink: 1,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
  closeBtn: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
