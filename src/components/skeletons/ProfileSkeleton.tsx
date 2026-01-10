import React from 'react';
import { View, StyleSheet } from 'react-native';
import { AvatarSkeleton, TextSkeleton, SkeletonBase } from './SkeletonPrimitives';

/**
 * Skeleton loader for ProfileScreen
 * Matches the layout of the actual profile screen
 */
export const ProfileSkeleton: React.FC = () => {
  return (
    <View style={styles.container}>
      {/* Cover Image Skeleton - Always visible */}
      <View style={styles.coverContainer}>
        <SkeletonBase width="100%" height={180} borderRadius={0} />
      </View>

      {/* Profile Picture Skeleton - Centered, overlapping cover */}
      <View style={styles.profilePictureContainer}>
        <View style={styles.profilePictureWrapper}>
          <AvatarSkeleton size={120} />
        </View>
      </View>

      {/* Profile Info Section */}
      <View style={styles.profileInfoSection}>
        {/* Name and Details Skeleton - Centered */}
        <View style={styles.nameContainer}>
          <View style={styles.fullNameContainer}>
            <TextSkeleton width={180} height={24} style={styles.fullNameSkeleton} />
          </View>
          <View style={styles.profileDetailsContainer}>
            <TextSkeleton width={160} height={16} />
          </View>
        </View>

        {/* Content Container */}
        <View style={styles.contentContainer}>
          {/* Surf Skill Section */}
          <View style={styles.skillSection}>
            <View style={styles.skillTitleRow}>
              <TextSkeleton width={100} height={18} />
              <TextSkeleton width={120} height={18} />
            </View>
            <View style={styles.progressBarContainer}>
              <SkeletonBase width="100%" height={8} borderRadius={4} style={styles.progressBarSkeleton} />
              <View style={styles.progressLabels}>
                <TextSkeleton width={100} height={12} />
                <TextSkeleton width={80} height={12} />
              </View>
            </View>
          </View>

          {/* Travel Experience Section */}
          <View style={styles.skillSection}>
            <View style={styles.skillTitleRow}>
              <TextSkeleton width={140} height={18} />
              <TextSkeleton width={80} height={18} />
            </View>
            <View style={styles.progressBarContainer}>
              <SkeletonBase width="100%" height={8} borderRadius={4} style={styles.progressBarSkeleton} />
              <View style={styles.progressLabels}>
                <TextSkeleton width={60} height={12} />
                <TextSkeleton width={80} height={12} />
              </View>
            </View>
          </View>

          {/* Top Destinations Section - Show 2 skeleton cards */}
          <View style={styles.destinationsSection}>
            <View style={styles.destinationsTitleRow}>
              <TextSkeleton width={140} height={20} />
              <View style={styles.destinationsTitleSpacer} />
            </View>
            {/* Destination Card 1 */}
            <View style={styles.destinationCard}>
              <SkeletonBase width={86} height={74} borderRadius={8} style={styles.destinationImageSkeleton} />
              <View style={styles.destinationContent}>
                <View style={styles.destinationTitleRow}>
                  <TextSkeleton width={140} height={16} />
                  <TextSkeleton width={60} height={16} />
                </View>
                <View style={styles.destinationProgressContainer}>
                  <SkeletonBase width="100%" height={6} borderRadius={3} style={styles.destinationProgressSkeleton} />
                  <View style={styles.destinationProgressLabels}>
                    <TextSkeleton width={70} height={12} />
                    <TextSkeleton width={50} height={12} />
                  </View>
                </View>
              </View>
            </View>
            {/* Destination Card 2 */}
            <View style={styles.destinationCard}>
              <SkeletonBase width={86} height={74} borderRadius={8} style={styles.destinationImageSkeleton} />
              <View style={styles.destinationContent}>
                <View style={styles.destinationTitleRow}>
                  <TextSkeleton width={120} height={16} />
                  <TextSkeleton width={50} height={16} />
                </View>
                <View style={styles.destinationProgressContainer}>
                  <SkeletonBase width="100%" height={6} borderRadius={3} style={styles.destinationProgressSkeleton} />
                  <View style={styles.destinationProgressLabels}>
                    <TextSkeleton width={70} height={12} />
                    <TextSkeleton width={50} height={12} />
                  </View>
                </View>
              </View>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  coverContainer: {
    height: 180,
    width: '100%',
    position: 'relative',
  },
  profilePictureContainer: {
    position: 'absolute',
    top: 145,
    left: '50%',
    marginLeft: -60, // Half of 120px avatar
    zIndex: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profilePictureWrapper: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    overflow: 'hidden',
  },
  profileInfoSection: {
    position: 'absolute',
    top: 275,
    left: '50%',
    transform: [{ translateX: -180.5 }], // Half of 361px
    paddingHorizontal: 0,
    alignItems: 'center',
    width: 361,
    alignSelf: 'center',
  },
  nameContainer: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 8,
    gap: 8,
  },
  fullNameContainer: {
    width: '100%',
    alignItems: 'center',
    flexShrink: 1,
  },
  fullNameSkeleton: {
    marginBottom: 0,
  },
  profileDetailsContainer: {
    width: 194,
    alignItems: 'center',
  },
  contentContainer: {
    marginTop: 16,
    width: '100%',
    gap: 24,
    alignItems: 'center',
  },
  skillSection: {
    width: '100%',
    gap: 12,
  },
  skillTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  progressBarContainer: {
    width: '100%',
    gap: 8,
  },
  progressBarSkeleton: {
    marginBottom: 0,
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  destinationsSection: {
    width: '100%',
    gap: 16,
    marginTop: 8,
  },
  destinationsTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  destinationsTitleSpacer: {
    flex: 1,
  },
  destinationCard: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    alignItems: 'center',
  },
  destinationImageSkeleton: {
    marginBottom: 0,
  },
  destinationContent: {
    flex: 1,
    gap: 8,
  },
  destinationTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  destinationProgressContainer: {
    width: '100%',
    gap: 6,
  },
  destinationProgressSkeleton: {
    marginBottom: 0,
  },
  destinationProgressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
});

