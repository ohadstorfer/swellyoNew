import React from 'react';
import { View, StyleSheet } from 'react-native';
import { AvatarSkeleton, TextSkeleton } from './SkeletonPrimitives';

/**
 * Skeleton loader for a single conversation item
 * Matches the layout of ConversationItem
 */
export const ConversationSkeleton: React.FC = () => {
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {/* Avatar */}
        <View style={styles.avatarContainer}>
          <AvatarSkeleton size={52} />
        </View>

        {/* Text content */}
        <View style={styles.textContainer}>
          <TextSkeleton width={180} height={16} style={styles.name} />
          <TextSkeleton width={220} height={14} style={styles.message} />
        </View>

        {/* Time badge */}
        <View style={styles.timeContainer}>
          <TextSkeleton width={40} height={12} />
        </View>
      </View>
    </View>
  );
};

/**
 * Skeleton loader for multiple conversation items
 */
interface ConversationListSkeletonProps {
  count?: number;
}

export const ConversationListSkeleton: React.FC<ConversationListSkeletonProps> = ({
  count = 5,
}) => {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <ConversationSkeleton key={`skeleton-${index}`} />
      ))}
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 16,
  },
  avatarContainer: {
    position: 'relative',
    width: 52,
    height: 52,
  },
  textContainer: {
    flex: 1,
    maxWidth: 246,
    gap: 8,
  },
  name: {
    marginBottom: 0,
  },
  message: {
    marginBottom: 0,
  },
  timeContainer: {
    alignItems: 'flex-end',
    minWidth: 40,
  },
});

