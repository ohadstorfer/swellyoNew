import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ImageBackground,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../styles/theme';
import { MatchedUser } from '../types/tripPlanning';
import { getImageUrl } from '../services/media/imageService';
import { SurfLevelIcon } from './SurfLevelIcon';

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

// Map surf level (1-5) to icon name (dipping, cruising, snapping, charging)
function getSurfLevelIconName(surfLevel?: number): 'dipping' | 'cruising' | 'snapping' | 'charging' {
  if (!surfLevel) return 'cruising';
  if (surfLevel <= 1) return 'dipping';
  if (surfLevel === 2) return 'cruising';
  if (surfLevel === 3) return 'snapping';
  return 'charging';
}

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

/**
 * Get country flag emoji or icon
 * For now, we'll use a placeholder - you can enhance this later
 */
function getCountryFlag(countryFrom?: string): string {
  // Simple mapping - can be enhanced
  const flagMap: { [key: string]: string } = {
    'portugal': '🇵🇹',
    'spain': '🇪🇸',
    'france': '🇫🇷',
    'brazil': '🇧🇷',
    'australia': '🇦🇺',
    'usa': '🇺🇸',
    'israel': '🇮🇱',
    'costa rica': '🇨🇷',
    'nicaragua': '🇳🇮',
    'panama': '🇵🇦',
    'el salvador': '🇸🇻',
  };
  
  if (!countryFrom) return '🌍';
  const country = countryFrom.toLowerCase();
  for (const [key, flag] of Object.entries(flagMap)) {
    if (country.includes(key)) {
      return flag;
    }
  }
  return '🌍';
}

export const MatchedUserCard: React.FC<MatchedUserCardProps> = ({
  user,
  destinationCountry,
  onSendMessage,
  onViewProfile,
}) => {
  // Get days in destination (from matching service)
  const daysInDestination = user.days_in_destination || 0;
  
  // Get surf level text
  const surfLevelText = user.surf_level 
    ? SURF_LEVEL_MAP[user.surf_level] || 'Unknown'
    : 'Unknown';
  
  // Get country flag - show destination country, not origin country
  const countryFlag = getCountryFlag(destinationCountry);
  
  // Default cover image (surfboards)
  const coverImageUrl = 'https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=800&q=80';
  
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
            {profileImageUrl ? (
              <Image
                source={{ uri: profileImageUrl }}
                style={styles.avatar}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Text style={styles.avatarPlaceholderText}>
                  {getInitials(user.name)}
                </Text>
              </View>
            )}
          </View>

          {/* Name and Info */}
          <View style={styles.profileDetails}>
            <Text style={styles.fullName} numberOfLines={1}>
              {user.name}
            </Text>
            
            <View style={styles.infoContainer}>
              {/* Days in Destination */}
              <View style={styles.infoItem}>
                <Text style={styles.flagEmoji}>{countryFlag}</Text>
                <Text style={styles.infoText}>
                  <Text style={styles.infoTextBold}>{daysInDestination}/ </Text>
                  <Text style={styles.infoTextLight}>Days</Text>
                </Text>
              </View>

              {/* Surf Level */}
              <View style={styles.infoItem}>
                <View style={styles.surfIconContainer}>
                  <SurfLevelIcon
                    level={getSurfLevelIconName(user.surf_level)}
                    size={16}
                    selected={false}
                  />
                </View>
                <Text style={styles.infoTextLight}>{surfLevelText}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionsContainer}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => onSendMessage(user.user_id)}
            activeOpacity={0.7}
          >
            <Text style={styles.sendMessageText}>Send Message</Text>
          </TouchableOpacity>
          
          <View style={styles.buttonDivider} />
          
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => onViewProfile(user.user_id)}
            activeOpacity={0.7}
          >
            <Text style={styles.viewProfileText}>View Profile</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
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
    height: 53,
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
    paddingBottom: 12,
    paddingHorizontal: 0,
  },
  userDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 0,
    marginTop: -12, // Overlap with cover
    gap: 12,
  },
  avatarContainer: {
    width: 72,
    height: 72,
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
    color: '#7B7B7B',
  },
  profileDetails: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: 8,
    gap: 8,
  },
  fullName: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
    color: colors.black,
  },
  infoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  flagEmoji: {
    fontSize: 18,
  },
  surfIconContainer: {
    width: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoText: {
    fontFamily: 'Inter',
    fontSize: 16,
    lineHeight: 15,
    color: '#A0A0A0',
  },
  infoTextBold: {
    fontFamily: 'Inter-Bold',
    fontWeight: '700',
    color: '#333333',
  },
  infoTextLight: {
    fontFamily: 'Inter',
    fontSize: 16,
    lineHeight: 15,
    color: '#A0A0A0',
  },
  actionsContainer: {
    flexDirection: 'row',
    height: 48,
    borderTopWidth: 0.5,
    borderTopColor: '#CFCFCF',
    marginTop: 8,
  },
  actionButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  buttonDivider: {
    width: 0.5,
    backgroundColor: '#CFCFCF',
  },
  sendMessageText: {
    fontFamily: 'Inter',
    fontSize: 16,
    lineHeight: 15,
    color: '#0788B0',
  },
  viewProfileText: {
    fontFamily: 'Inter',
    fontSize: 16,
    lineHeight: 15,
    color: '#333333',
  },
});

