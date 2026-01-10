import React from 'react';
import { View, StyleSheet } from 'react-native';
import { AvatarSkeleton, TextSkeleton } from './SkeletonPrimitives';

/**
 * Skeleton loader for the header (avatar + "Hello {name}")
 * Matches the layout of ConversationsScreen header
 */
export const HeaderSkeleton: React.FC = () => {
  return (
    <View style={styles.leftContainer}>
      <AvatarSkeleton size={40} style={styles.avatar} />
      <TextSkeleton width={140} height={20} style={styles.name} />
    </View>
  );
};

const styles = StyleSheet.create({
  leftContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    marginRight: 0,
  },
  name: {
    marginBottom: 0,
  },
});

