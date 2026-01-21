import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { AvatarSkeleton, TextSkeleton, SkeletonBase } from './SkeletonPrimitives';
import { useScreenDimensions } from '../../utils/responsive';

/**
 * Skeleton loader for ProfileScreen
 * Matches the layout of the actual profile screen
 */
export const ProfileSkeleton: React.FC = () => {
  // Get screen dimensions for responsive design
  const { width: screenWidth } = useScreenDimensions();
  
  // Calculate content width: always use full width minus 16px padding on each side
  const contentWidth = screenWidth - 32; // 16px padding each side
  
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
        <View style={[styles.contentContainer, { width: contentWidth }]}>
          {/* Cards Row - Surf Style and Travel Experience */}
          <View style={styles.cardsRow}>
            {/* Surf Style Card */}
            <View style={styles.card}>
              <TextSkeleton width={80} height={15} style={styles.cardTitle} />
              <View style={styles.cardContent}>
                <TextSkeleton width={100} height={22} style={styles.cardValue} />
                <TextSkeleton width={50} height={14} style={styles.cardLabel} />
              </View>
              {/* Board illustration skeleton */}
              {/* <View style={styles.cardIllustration}>
                <SkeletonBase width={75} height={115} borderRadius={8} />
              </View> */}
            </View>

            {/* Travel Experience Card */}
            <View style={styles.card}>
              <TextSkeleton width={120} height={15} style={styles.cardTitle} />
              <View style={styles.cardContent}>
                <TextSkeleton width={30} height={22} style={styles.cardValue} />
                <TextSkeleton width={40} height={14} style={styles.cardLabel} />
              </View>
              {/* Travel illustration skeleton */}
              {/* <View style={styles.travelIllustration}>
                <SkeletonBase width={96} height={96} borderRadius={8} />
              </View> */}
            </View>
          </View>

          {/* Surf Skill Card */}
          <View style={styles.surfSkillCard}>
            <View style={styles.surfSkillVideoContainer}>
              <SkeletonBase width="100%" height={229} borderRadius={12} />
              {/* Title overlay skeleton */}
              <View style={styles.surfSkillTitleOverlay}>
                <TextSkeleton width={80} height={22} />
              </View>
              {/* Expand icon skeleton */}
              <View style={styles.surfSkillExpandIcon}>
                <SkeletonBase width={24} height={24} borderRadius={4} />
              </View>
              {/* Content overlay skeleton */}
              <View style={styles.surfSkillContentOverlay}>
                <TextSkeleton width={140} height={22} style={styles.surfSkillNameSkeleton} />
                <TextSkeleton width={100} height={20} />
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
    alignSelf: 'center',
  },
  cardsRow: {
    flexDirection: 'row',
    gap: 16,
    width: '100%',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    flex: 1,
    height: 140,
    position: 'relative',
    justifyContent: 'space-between',
    shadowColor: '#596E7C',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 4,
  },
  cardTitle: {
    marginBottom: 0,
  },
  cardContent: {
    gap: 4,
    marginTop: 'auto',
  },
  cardValue: {
    marginBottom: 4,
  },
  cardLabel: {
    marginBottom: 0,
  },
  cardIllustration: {
    position: 'absolute',
    left: 99,
    top: 13,
    width: 75,
    height: 115,
  },
  travelIllustration: {
    position: 'absolute',
    left: 71,
    top: 34,
    width: 96,
    height: 96,
  },
  surfSkillCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 0,
    width: '100%',
    marginBottom: 16,
    shadowColor: '#596E7C',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 4,
  },
  surfSkillVideoContainer: {
    width: '100%',
    height: 229,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
    position: 'relative',
  },
  surfSkillTitleOverlay: {
    position: 'absolute',
    top: 16,
    left: 16,
    zIndex: 20,
  },
  surfSkillExpandIcon: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 20,
    width: 24,
    height: 24,
  },
  surfSkillContentOverlay: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    zIndex: 20,
    gap: 4,
  },
  surfSkillNameSkeleton: {
    marginBottom: 4,
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

