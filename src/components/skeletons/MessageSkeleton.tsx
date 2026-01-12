import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SkeletonBase, TextSkeleton } from './SkeletonPrimitives';

/**
 * Skeleton loader for a single message bubble
 * Alternates between left (outbound) and right (received) positions
 */
interface MessageSkeletonProps {
  isOutbound?: boolean; // true for outbound (left), false for received (right)
}

export const MessageSkeleton: React.FC<MessageSkeletonProps> = ({ 
  isOutbound = false 
}) => {
  return (
    <View
      style={[
        styles.messageContainer,
        isOutbound ? styles.outboundContainer : styles.receivedContainer,
      ]}
    >
      <View
        style={[
          styles.messageBubble,
          isOutbound ? styles.outboundBubble : styles.receivedBubble,
        ]}
      >
        {/* Message text skeleton */}
        <View style={styles.textContainer}>
          <TextSkeleton width="80%" height={16} style={styles.textLine1} />
          <TextSkeleton width="60%" height={16} style={styles.textLine2} />
        </View>
        
        {/* Timestamp skeleton */}
        <View style={styles.timestampContainer}>
          <TextSkeleton width={40} height={12} />
        </View>
      </View>
    </View>
  );
};

/**
 * Skeleton loader for multiple messages in a conversation
 * Alternates between outbound and received messages
 */
interface MessageListSkeletonProps {
  count?: number;
}

export const MessageListSkeleton: React.FC<MessageListSkeletonProps> = ({
  count = 5,
}) => {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <MessageSkeleton 
          key={`message-skeleton-${index}`}
          isOutbound={index % 2 === 0} // Alternate between outbound and received
        />
      ))}
    </>
  );
};

const styles = StyleSheet.create({
  messageContainer: {
    marginBottom: 16,
  },
  outboundContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-start', // Outbound messages on LEFT
    alignItems: 'flex-end',
    paddingLeft: 0,
    paddingRight: 60,
  },
  receivedContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-end', // Received messages on RIGHT
    alignItems: 'flex-end',
    paddingLeft: 48,
    paddingRight: 16,
  },
  messageBubble: {
    maxWidth: 268,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexDirection: 'column',
    borderRadius: 16,
  },
  outboundBubble: {
    backgroundColor: '#E4E4E4', // Light gray for skeleton
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 2, // Pointy corner at bottom left
    borderBottomRightRadius: 16,
  },
  receivedBubble: {
    backgroundColor: '#E4E4E4', // Light gray for skeleton
    borderTopLeftRadius: 16,
    borderTopRightRadius: 2, // Pointy corner at top right
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  textContainer: {
    marginBottom: 10,
    width: '100%',
  },
  textLine1: {
    marginBottom: 6,
  },
  textLine2: {
    marginBottom: 0,
  },
  timestampContainer: {
    alignItems: 'flex-start',
    width: '100%',
  },
});

