import React from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ImageBackground,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { colors, spacing } from '../styles/theme';
import { ProfileImage } from './ProfileImage';
import { getImageUrl } from '../services/media/imageService';
import { SupabaseSurfer } from '../services/database/supabaseDatabaseService';

interface UserProfileCardProps {
  profileData: SupabaseSurfer;
  onPress?: () => void;
}

// Surf level mapping (1-5 to display names) - matches ProfileScreen
const SURF_LEVEL_MAP: { [key: number]: string } = {
  1: 'Dipping my toes',
  2: 'Cruising Around',
  3: 'Trimming Lines',
  4: 'Carving Turns',
  5: 'Charging',
};

export const UserProfileCard: React.FC<UserProfileCardProps> = ({ profileData, onPress }) => {
  const destinationsCount = profileData.destinations_array?.length || 0;
  const surfLevel = profileData.surf_level || 1;
  const surfLevelName = SURF_LEVEL_MAP[surfLevel] || SURF_LEVEL_MAP[1];

  return (
    <TouchableOpacity 
      style={styles.card} 
      onPress={onPress}
      activeOpacity={0.9}
    >
      {/* Cover Image */}
      <View style={styles.coverContainer}>
        <ImageBackground
          source={{ uri: getImageUrl('/COVER IMAGE.jpg') }}
          style={styles.coverImage}
          resizeMode="cover"
        >
          <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.4)']}
            locations={[0.29059, 0.99702]}
            style={styles.coverGradient}
          />
        </ImageBackground>
      </View>

      {/* Profile Info */}
      <View style={styles.profileInfoContainer}>
        <View style={styles.userDetailsContainer}>
          {/* Profile Picture - positioned to overlap cover image */}
          <View style={styles.profileImageContainer}>
            <ProfileImage
              imageUrl={profileData.profile_image_url}
              name={profileData.name || 'User'}
              style={styles.profileImage}
            />
          </View>

          {/* User Info */}
          <View style={styles.userInfoContainer}>
            <View style={styles.nameContainer}>
              <Text style={styles.nameText}>{profileData.name || 'User'}</Text>
            </View>

            {/* Info Items */}
            <View style={styles.infoContainer}>
              {/* Trips Count */}
              <View style={styles.infoItem}>
                <Ionicons name="airplane-outline" size={16} color="#A0A0A0" />
                <Text style={styles.infoText}>
                  {destinationsCount} {destinationsCount === 1 ? 'Trip' : 'Trips'}
                </Text>
              </View>

              {/* Surf Level */}
              <View style={styles.infoItem}>
                <Ionicons name="water-outline" size={16} color="#A0A0A0" />
                <Text style={styles.infoText}>{surfLevelName}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* View Profile Button */}
        <View style={styles.viewProfileContainer}>
          <Text style={styles.viewProfileText}>View Profile</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    overflow: 'hidden',
    marginVertical: spacing.sm,
    marginHorizontal: 0, // Remove horizontal margin - will be handled by container
    width: '100%', // Dynamic width
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 4,
    ...(Platform.OS === 'web' && {
      cursor: 'pointer',
    }),
  },
  coverContainer: {
    height: 53,
    width: '100%',
    marginBottom: 0,
    position: 'relative',
    zIndex: 1,
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  coverGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  profileInfoContainer: {
    flexDirection: 'column',
    gap: 0,
    paddingBottom: 0,
    position: 'relative',
    zIndex: 2,
  },
  userDetailsContainer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    alignItems: 'flex-start',
    paddingTop: 0, 
    paddingBottom: 6,
  },
  profileImageContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    overflow: 'hidden',
    borderWidth: 4,
    borderColor: colors.white,
    position: 'absolute',
    top: -20, // Move up by half its height to overlap cover image
    left: 16,
    zIndex: 3,
  },
  profileImage: {
    width: '100%',
    height: '100%',
  },
  userInfoContainer: {
    flex: 1,
    flexDirection: 'column',
    gap: 8,
    paddingBottom: 0,
    justifyContent: 'flex-end',
    marginLeft: 88, // Account for profile image width (72) + gap (12) + border (4)
    paddingTop: 4, // Small padding to align with profile image
  },
  nameContainer: {
    width: '100%',
  },
  nameText: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  infoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  infoText: {
    fontSize: 12,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 15,
    color: '#A0A0A0',
  },
  viewProfileContainer: {
    borderTopWidth: 0.5,
    borderTopColor: '#CFCFCF',
    paddingTop: 12,
    paddingBottom: 12, // Less gap below View Profile text
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  viewProfileText: {
    fontSize: 14,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 22,
    color: colors.textPrimary,
  },
});

