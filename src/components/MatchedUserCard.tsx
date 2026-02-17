import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ImageBackground,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, G, ClipPath, Defs, Rect } from 'react-native-svg';
import { colors, spacing } from '../styles/theme';
import { MatchedUser } from '../types/tripPlanning';
import { getImageUrl } from '../services/media/imageService';
import { getCountryFlag } from '../utils/countryFlags';
import { ProfileImage } from './ProfileImage';
import { analyticsService } from '../services/analytics/analyticsService';

interface MatchedUserCardProps {
  user: MatchedUser;
  destinationCountry: string;
  onSendMessage: (userId: string) => void;
  onViewProfile: (userId: string) => void;
}

// Surf level mapping (1-5 to display names) - matches ProfileScreen
const SURF_LEVEL_MAP: { [key: number]: string } = {
  1: 'Dipping my toes',
  2: 'Cruising Around',
  3: 'Trimming Lines',
  4: 'Carving Turns',
  5: 'Charging',
};


/**
 * Calculate total days spent in the destination country
 */
function calculateDaysInDestination(
  destinationsArray: Array<{ destination_name: string; time_in_days: number }> | undefined,
  destinationCountry: string
): number {
  if (!destinationsArray) return 0;
  
  return destinationsArray
    .filter(dest => {
      const country = dest.destination_name.split(',')[0]?.trim().toLowerCase();
      return country === destinationCountry.toLowerCase();
    })
    .reduce((sum, dest) => sum + dest.time_in_days, 0);
}


export const MatchedUserCard: React.FC<MatchedUserCardProps> = ({
  user,
  destinationCountry,
  onSendMessage,
  onViewProfile,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<'message' | 'profile' | null>(null);
  
  // Get days in destination (from matching service)
  const daysInDestination = user.days_in_destination || 0;
  
  // Get surf level text
  const surfLevelText = user.surf_level 
    ? SURF_LEVEL_MAP[user.surf_level] || 'Unknown'
    : 'Unknown';
  
  // Get country flag - show destination country, not origin country
  const countryFlagUrl = getCountryFlag(destinationCountry);
  
  // Default cover image from public folder
  const coverImageUrl = getImageUrl('/COVER IMAGE.jpg');
  
  // Profile image or placeholder
  const profileImageUrl = user.profile_image_url || null;
  
  // Get initials for placeholder
  const getInitials = (name: string): string => {
    if (!name) return 'U';
    const parts = name.split(' ').filter(Boolean);
    if (parts.length > 1) {
      return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
    }
    return parts[0].charAt(0).toUpperCase();
  };

  return (
    <View style={styles.card}>
      {/* Cover Image */}
      <View style={styles.coverContainer}>
        <ImageBackground
          source={{ uri: coverImageUrl }}
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

      {/* Profile Info Section */}
      <View style={styles.profileInfo}>
        <View style={styles.userDetails}>
          {/* Profile Picture */}
          <View style={styles.avatarContainer}>
            <ProfileImage
              imageUrl={profileImageUrl}
              name={user.name}
              style={styles.avatar}
              showLoadingIndicator={false}
            />
          </View>

          {/* Name and Info */}
          <View style={styles.profileDetails}>
            <Text style={styles.fullName} numberOfLines={1}>
              {user.name}
            </Text>
            
            <View style={styles.infoContainer}>
              {/* Days in Destination */}
              <View style={styles.infoItem}>
                {countryFlagUrl ? (
                  <Image 
                    source={{ uri: countryFlagUrl }} 
                    style={styles.flagImage}
                    resizeMode="contain"
                  />
                ) : (
                  <Text style={styles.flagEmoji}>🌍</Text>
                )}
                <Text style={styles.infoText}>
                  <Text style={styles.infoTextBold}>{daysInDestination}</Text>
                  <Text style={styles.infoTextLight}> Days</Text>
                </Text>
              </View>

              {/* Surf Level */}
              <View style={styles.infoItem}>
                <View style={styles.surfIconContainer}>
                  <Svg width={14} height={16} viewBox="0 0 14 16" fill="none">
                    <Defs>
                      <ClipPath id="clip0_surfer">
                        <Rect width={14} height={16} fill="white" transform="matrix(-1 0 0 1 14 0)"/>
                      </ClipPath>
                    </Defs>
                    <G clipPath="url(#clip0_surfer)">
                      <Path 
                        d="M4.70549 15.9734C4.80517 15.9668 5.55509 15.7876 4.59803 14.2256C4.59803 14.2256 4.27612 13.7103 4.5075 13.3898C4.73841 13.0688 5.69547 11.9967 5.679 11.372C5.679 11.372 6.81759 11.3467 7.03204 11.4562C7.2465 11.5662 7.27119 11.7346 7.56018 11.6672C7.56018 11.6672 7.94794 12.0556 8.36862 11.7515C8.36862 11.7515 10.1176 12.4015 10.2663 10.7973C10.2663 10.7973 10.6705 10.2652 10.4725 9.62366L10.5882 9.56469V7.61424C10.5882 7.61424 11.4707 8.76261 11.6774 9.07474C11.8836 9.38734 12.5603 10.2231 12.296 10.4763C12.296 10.4763 12.1804 10.7631 12.4364 11.1179C12.4364 11.1179 12.4447 11.4557 12.5603 11.4389C12.676 11.422 12.783 11.4726 12.6427 11.0336C12.6427 11.0336 13.7812 12.2157 13.8059 11.8694C13.8059 11.8694 14.0368 12.0131 13.971 11.8104C13.971 11.8104 14.0867 11.7178 13.8635 11.5825C13.8635 11.5825 14.2348 11.7515 13.1621 10.6452C13.1621 10.6452 12.8653 9.97837 12.601 9.29421C12.3372 8.61053 11.9741 7.7827 11.4542 7.23426C11.4542 7.23426 10.9343 6.15374 10.7528 5.71432C10.7528 5.71432 10.2493 4.6675 9.67182 4.28752C9.0943 3.90753 9.16014 3.87384 9.16014 3.87384C9.16014 3.87384 9.35814 3.45174 9.27537 2.9791L9.30829 2.33753L9.54744 2.27857L9.34945 2.24487L9.51452 2.08436L9.31652 2.16017L9.4816 1.98282L9.21776 2.05862L9.19306 1.68707L9.04445 1.91496C9.04445 1.91496 8.48339 1.17184 7.62557 1.88127C7.62557 1.88127 7.3064 2.13724 7.35075 2.98191C7.35075 2.98191 7.07685 2.93137 7.43398 3.53644C7.43398 3.53644 7.36173 3.63752 7.00689 3.35908C7.00689 3.35908 6.56152 3.1733 5.97577 3.2917C5.97577 3.2917 5.75308 3.35908 5.39001 2.95383C5.39001 2.95383 5.10148 2.8696 4.72195 2.45545C4.34243 2.04178 3.5916 1.96597 3.07215 1.57756C2.55224 1.18916 2.43701 1.13862 2.43701 1.13862C2.43701 1.13862 2.36294 0.649131 1.95826 0.93599C1.95826 0.93599 1.47127 0.623393 1.28197 0.395497C1.28197 0.395497 0.696216 -0.330776 0.853056 0.184447L1.10044 0.47973C1.10044 0.47973 0.0610771 -0.00975573 0.333148 0.34449L0.76206 0.622925C0.76206 0.622925 -0.252604 0.597656 0.0606203 0.808705L0.588758 0.892938C0.588758 0.892938 -0.178527 0.926631 0.151616 1.10399L1.13336 1.1461C1.13336 1.1461 1.34781 1.36558 1.10044 1.33188C1.10044 1.33188 0.531142 1.19664 0.580527 1.4587C0.629911 1.72029 0.927133 1.48397 1.10867 1.59394C1.2902 1.70391 1.65327 1.64448 1.75203 1.63606C1.75203 1.63606 2.01587 1.68894 2.13979 1.77645C2.13979 1.77645 3.44345 2.93605 3.67437 3.07971C3.67437 3.07971 3.94644 3.40073 4.26012 3.40916C4.26012 3.40916 4.5738 3.57809 4.99448 3.87337L5.00271 4.02546C5.00271 4.02546 5.1184 3.97492 5.36578 4.12701C5.61316 4.27909 6.10014 4.57437 6.44675 4.62491C6.44675 4.62491 6.77689 4.777 6.82627 5.23279C6.87566 5.68859 7.32972 7.53796 7.73394 8.28061C8.13816 9.02373 7.89901 9.07427 8.27031 9.14166C8.27031 9.14166 8.48476 9.49637 7.65986 9.04011C6.83496 8.58432 6.01783 8.47435 5.26747 8.44066C4.51664 8.40696 4.14534 8.43223 3.93089 9.0738C3.93089 9.0738 3.6387 9.98773 3.50518 11.3954C3.50381 11.4066 3.50289 11.4183 3.50198 11.4295C3.36983 12.8563 2.25639 12.7974 2.17363 12.7721C2.09086 12.7468 -0.344514 11.5619 0.0615349 12.2653C0.41317 12.8741 0.856714 13.8826 2.03874 15.0043C3.22122 16.126 3.96244 16.0193 4.70641 15.972L4.70549 15.9734Z" 
                        fill="#212121"
                      />
                    </G>
                  </Svg>
                </View>
                <Text style={styles.infoTextLight}>{surfLevelText}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionsContainer}>
          <TouchableOpacity
            style={[
              styles.actionButton, 
              styles.actionButtonWithBorder,
              isLoading && styles.actionButtonDisabled
            ]}
            onPress={() => {
              if (isLoading) {
                console.log('[MatchedUserCard] Send Message button clicked but already loading');
                return;
              }
              
              console.log('[MatchedUserCard] Send Message button clicked for userId:', user.user_id);
              setIsLoading(true);
              setLoadingAction('message');
              
              // Track connect clicked
              analyticsService.trackConnectClicked();
              console.log('[MatchedUserCard] Calling onSendMessage with userId:', user.user_id);
              onSendMessage(user.user_id);
            }}
            activeOpacity={isLoading ? 1 : 0.7}
            disabled={isLoading}
          >
            {isLoading && loadingAction === 'message' ? (
              <ActivityIndicator size="small" color="#0788B0" />
            ) : (
            <Text style={styles.sendMessageText}>Send Message</Text>
            )}
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[
              styles.actionButton,
              isLoading && styles.actionButtonDisabled
            ]}
            onPress={() => {
              if (isLoading) return;
              
              setIsLoading(true);
              setLoadingAction('profile');
              
              // Track profile_view_clicked from swelly_list
              analyticsService.trackProfileViewClicked('swelly_list');
              onViewProfile(user.user_id);
            }}
            activeOpacity={isLoading ? 1 : 0.7}
            disabled={isLoading}
          >
            {isLoading && loadingAction === 'profile' ? (
              <ActivityIndicator size="small" color="#333" />
            ) : (
            <Text style={styles.viewProfileText}>View Profile</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    width: 340,
    alignSelf: 'center',
    backgroundColor: colors.white,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 5,
  },
  coverContainer: {
    height: 60,
    width: '100%',
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
  profileInfo: {
    paddingTop: 0,
    paddingBottom: 0,
    paddingHorizontal: 0,
  },
  userDetails: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingTop: 0,
    paddingBottom: spacing.md,
    marginTop: -20, // Overlap with cover image
    gap: spacing.sm,
  },
  avatarContainer: {
    width: 72,
    height: 72,
    marginBottom: 0,
    backgroundColor: 'gray',
    borderRadius: 36,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: colors.white,
  },
  avatarPlaceholder: {
    backgroundColor: '#E4E4E4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarPlaceholderText: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  profileDetails: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: 4,
    gap: 8,
  },
  fullName: {
    color: '#000',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    fontSize: 14,
    fontStyle: 'normal',
    fontWeight: '600',
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 0,
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
    gap: spacing.xs,
  },
  flagEmoji: {
    fontSize: 18,
    lineHeight: 18,
  },
  flagImage: {
    width: 18,
    height: 18,
  },
  surfIconContainer: {
    width: 14,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    fontSize: 16,
    lineHeight: 15,
    color: colors.textSecondary,
  },
  infoTextBold: {
    color: '#333',
    textAlign: 'center',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    fontSize: 14,
    fontStyle: 'normal',
    fontWeight: '700',
    lineHeight: 18,
  },
  infoTextLight: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    fontSize: 14,
    lineHeight: 18,
    color: '#A0A0A0',
    textAlign: 'center',
  },
  actionsContainer: {
    flexDirection: 'row',
    height: 48,
    borderTopWidth: 1,
    borderTopColor: colors.dotInactive,
    marginTop: 0,
  },
  actionButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingLeft: 4,
  },
  actionButtonWithBorder: {
    borderRightWidth: 0.5,
    borderRightColor: '#CFCFCF',
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  sendMessageText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    fontSize: 14,
    fontStyle: 'normal',
    fontWeight: '400',
    lineHeight: 15,
    color: '#0788B0',
  },
  viewProfileText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    fontSize: 14,
    fontStyle: 'normal',
    fontWeight: '400',
    lineHeight: 15,
    color: '#333',
  },
});

