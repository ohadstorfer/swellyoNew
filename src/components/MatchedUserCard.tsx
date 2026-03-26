import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Platform,
} from 'react-native';
import { MatchedUser } from '../types/tripPlanning';
import { getImageUrl } from '../services/media/imageService';
import { analyticsService } from '../services/analytics/analyticsService';

interface MatchedUserCardProps {
  user: MatchedUser;
  onViewProfile: (userId: string) => void;
  isCarousel?: boolean;
}

// Default cover image from public folder
const coverImageUrl = getImageUrl('/COVER IMAGE.jpg');

export const MatchedUserCard: React.FC<MatchedUserCardProps> = ({
  user,
  onViewProfile,
  isCarousel,
}) => {
  const profileImageUri = user.profile_image_url || undefined;

  return (
    <View style={[styles.userCard, isCarousel && styles.userCardCarousel]}>
      <View style={styles.userCardInner}>
        <Image source={{ uri: coverImageUrl }} style={styles.coverImage} />
        <View style={styles.profilePicContainer}>
          {profileImageUri ? (
            <Image source={{ uri: profileImageUri }} style={styles.profilePic} />
          ) : (
            <View style={[styles.profilePic, styles.profilePicPlaceholder]}>
              <Text style={styles.profilePicInitial}>
                {(user.name || 'U').charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.cardName}>{user.name || 'User'}</Text>
          <Text style={styles.cardDetails}>
            {user.age != null ? `${user.age} yo` : ''}
            {user.age != null && user.country_from ? ' | ' : ''}
            {user.country_from || ''}
          </Text>
        </View>
        <View style={styles.viewProfileDivider} />
        <TouchableOpacity
          style={styles.viewProfileButton}
          onPress={() => {
            analyticsService.trackProfileViewClicked('swelly_list');
            onViewProfile(user.user_id);
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.viewProfileLink}>View Profile</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  userCard: {
    width: 274,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 10,
    marginBottom: 16,
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  userCardCarousel: {
    marginBottom: 0,
    marginRight: 10,
    alignSelf: undefined,
  },
  userCardInner: {
    overflow: 'hidden',
    borderRadius: 12,
  },
  coverImage: {
    width: '100%',
    height: 102,
    resizeMode: 'cover',
  },
  profilePicContainer: {
    alignItems: 'center',
    marginTop: -75,
  },
  profilePic: {
    width: 99,
    height: 99,
    borderRadius: 64,
    borderWidth: 3.5,
    borderColor: '#FFFFFF',
  },
  profilePicPlaceholder: {
    backgroundColor: '#A8DDE0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profilePicInitial: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  cardInfo: {
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  cardName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#222',
    marginBottom: 2,
    ...(Platform.OS === 'web' ? { fontFamily: 'Montserrat, sans-serif' } : {}),
  },
  cardDetails: {
    fontSize: 13,
    color: '#888',
    marginBottom: 6,
    ...(Platform.OS === 'web' ? { fontFamily: 'Inter, sans-serif' } : {}),
  },
  viewProfileDivider: {
    height: 1,
    backgroundColor: '#E5E5E5',
    marginHorizontal: 4,
  },
  viewProfileButton: {
    alignItems: 'center',
    paddingTop: 14,
    paddingBottom: 12,
  },
  viewProfileLink: {
    fontSize: 13.5,
    color: '#333',
    ...(Platform.OS === 'web' ? { fontFamily: 'Inter, sans-serif' } : {}),
  },
});
