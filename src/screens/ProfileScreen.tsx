import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Image,
  ImageBackground,
  TouchableOpacity,
  Platform,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { Text as RNText } from 'react-native';
import { colors, spacing, typography } from '../styles/theme';
import { supabaseDatabaseService, SupabaseSurfer } from '../services/database/supabaseDatabaseService';
import { supabase } from '../config/supabase';
import { getImageUrl } from '../services/media/imageService';
import { getCountryFlag } from '../utils/countryFlags';

interface ProfileScreenProps {
  onBack?: () => void;
  userId?: string; // Optional: if provided, view this user's profile instead of current user's
  onMessage?: (userId: string) => void; // Callback when message button is clicked
}

// Board type mapping
const BOARD_TYPE_MAP: { [key: string]: { name: string; imageUrl: string } } = {
  'shortboard': { name: 'Short Board', imageUrl: 'https://api.builder.io/api/v1/image/assets/TEMP/9761796f6e2272f3cacf14c4fc9342525bb54ff8?width=371' },
  'midlength': { name: 'Mid-length', imageUrl: 'https://api.builder.io/api/v1/image/assets/TEMP/377f67727b21485479e873ed3d93c57611722f74?width=371' },
  'longboard': { name: 'Long Board', imageUrl: 'https://api.builder.io/api/v1/image/assets/TEMP/4692a28e8ac444a82eec1f691f5f008c8a9bbc8e?width=371' },
  'softtop': { name: 'Soft Top', imageUrl: 'https://api.builder.io/api/v1/image/assets/TEMP/1d104557a7a5ea05c3b36931c1ee56fd01a6d426?width=371' },
};

// Surf level mapping (1-5 to display names)
const SURF_LEVEL_MAP: { [key: number]: { name: string; progress: number } } = {
  1: { name: 'Dipping my toes', progress: 20 }, // 20% of bar
  2: { name: 'Cruising Around', progress: 40 }, // 40% of bar
  3: { name: 'Trimming Lines', progress: 60 }, // 60% of bar (or Snapping for shortboard)
  4: { name: 'Carving Turns', progress: 80 }, // 80% of bar (or Charging for shortboard)
  5: { name: 'Charging', progress: 100 }, // 100% of bar
};

// Travel experience mapping (enum to number of trips)
const TRAVEL_EXPERIENCE_MAP: { [key: string]: { trips: number; progress: number } } = {
  'new_nomad': { trips: 3, progress: 10 }, // ~10% of bar (3 trips out of 30+)
  'rising_voyager': { trips: 7, progress: 23 }, // ~23% of bar
  'wave_hunter': { trips: 15, progress: 50 }, // ~50% of bar
  'chicken_joe': { trips: 30, progress: 100 }, // 100% of bar
};

// Lifestyle keyword to icon mapping (simplified - using Ionicons for now)
const LIFESTYLE_ICON_MAP: { [key: string]: string } = {
  'yoga': 'fitness-outline',
  'hiking': 'walk-outline',
  'cycling': 'bicycle-outline',
  'gaming': 'game-controller-outline',
  'music': 'musical-notes-outline',
  'volleyball': 'football-outline',
  'climbing': 'trail-sign-outline',
  'diving': 'water-outline',
  'fishing': 'fish-outline',
  'remote-work': 'laptop-outline',
  'party': 'wine-outline',
  'nightlife': 'moon-outline',
  'culture': 'library-outline',
  'local culture': 'people-outline',
  'nature': 'leaf-outline',
  'sustainability': 'reload-outline',
  'art': 'color-palette-outline',
  'food': 'restaurant-outline',
  'exploring': 'map-outline',
  'adventure': 'compass-outline',
  'mobility': 'barbell-outline',
};

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ onBack, userId, onMessage }) => {
  const [profileData, setProfileData] = useState<SupabaseSurfer | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  
  // Determine if we're viewing our own profile or another user's
  const isViewingOwnProfile = !userId;

  useEffect(() => {
    loadProfileData();
  }, [userId]);

  const loadProfileData = async () => {
    try {
      let targetUserId: string;
      
      if (userId) {
        // View specific user's profile
        targetUserId = userId;
      } else {
        // Get current authenticated user
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        
        if (authError || !user) {
          console.error('Error getting user:', authError);
          setLoading(false);
          return;
        }
        
        targetUserId = user.id;
        setCurrentUserId(user.id);
      }

      // Fetch surfer data
      const surferData = await supabaseDatabaseService.getSurferByUserId(targetUserId);
      setProfileData(surferData);
    } catch (error) {
      console.error('Error loading profile data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text>Loading profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!profileData) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text>No profile data found</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Get board type display info
  const boardTypeInfo = profileData.surfboard_type 
    ? BOARD_TYPE_MAP[profileData.surfboard_type.toLowerCase()] || BOARD_TYPE_MAP['shortboard']
    : BOARD_TYPE_MAP['shortboard'];

  // Get surf level display info
  const surfLevelInfo = profileData.surf_level 
    ? SURF_LEVEL_MAP[profileData.surf_level] || SURF_LEVEL_MAP[1]
    : SURF_LEVEL_MAP[1];

  // Get travel experience display info
  const travelExpInfo = profileData.travel_experience
    ? TRAVEL_EXPERIENCE_MAP[profileData.travel_experience.toLowerCase()] || TRAVEL_EXPERIENCE_MAP['new_nomad']
    : TRAVEL_EXPERIENCE_MAP['new_nomad'];

  // Get destinations array (top 3)
  const topDestinations = profileData.destinations_array 
    ? profileData.destinations_array.slice(0, 3)
    : [];

  // Get lifestyle keywords
  const lifestyleKeywords = profileData.lifestyle_keywords || [];

  // Get user initials for placeholder
  const getInitials = (name: string): string => {
    if (!name || name.trim() === '') return 'U';
    const nameParts = name.trim().split(/\s+/);
    if (nameParts.length === 1) {
      return nameParts[0].charAt(0).toUpperCase();
    }
    return (nameParts[0].charAt(0) + nameParts[nameParts.length - 1].charAt(0)).toUpperCase();
  };

  // Calculate destination progress (days out of max 365)
  // Based on Figma: Short visit = 0, Local = 365 days
  const getDestinationProgress = (days: number): number => {
    const maxDays = 365;
    const containerWidth = 361; // Profile info section width
    const progressPercentage = Math.min(100, (days / maxDays) * 100);
    return progressPercentage;
  };

  // Calculate progress bar width in pixels based on Figma exact values
  // Container width is 361px (profileInfoSection width)
  const getSurfSkillProgressWidth = (): number => {
    // Figma shows 71px for "Dipping my toes" level
    // Calculate based on surf level
    const containerWidth = 361;
    return (surfLevelInfo.progress / 100) * containerWidth;
  };

  const getTravelExpProgressWidth = (): number => {
    // Figma shows 109px for 3 trips
    const containerWidth = 361;
    return (travelExpInfo.progress / 100) * containerWidth;
  };

  const getDestinationProgressWidth = (days: number): number => {
    // Destination progress bar is 243px wide (not 361px)
    const progressBarWidth = 243;
    const maxDays = 365;
    const progressPercentage = Math.min(100, (days / maxDays) * 100);
    return (progressPercentage / 100) * progressBarWidth;
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Cover Image */}
        <View style={styles.coverContainer}>
          <ImageBackground
            source={{ 
              uri: getImageUrl('/COVER IMAGE.jpg') // Default cover image from public folder
            }}
            style={styles.coverImage}
            resizeMode="cover"
          >
            <LinearGradient
              colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.4)']}
              locations={[0.29059, 0.99702]}
              style={styles.coverGradient}
            />
            <View style={styles.coverOverlay} />
          </ImageBackground>
        </View>

        {/* Header Buttons */}
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <View style={styles.backButtonContainer}>
            <Ionicons name="chevron-back" size={18} color="#222B30" />
            <Text style={styles.backButtonText}>Continue edit</Text>
          </View>
        </TouchableOpacity>

        {isViewingOwnProfile ? (
          <TouchableOpacity style={styles.saveButton}>
            <View style={styles.saveButtonContainer}>
              <Ionicons name="cloud-upload-outline" size={18} color="#222B30" />
              <Text style={styles.saveButtonText}>Save</Text>
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity 
            style={styles.messageButton}
            onPress={() => {
              if (userId && onMessage) {
                onMessage(userId);
              }
            }}
          >
            <View style={styles.messageButtonContainer}>
              <Ionicons name="chatbubble-outline" size={18} color="#222B30" />
              <Text style={styles.messageButtonText}>Message</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Profile Picture - Centered */}
        <View style={styles.profilePictureContainer}>
          <View style={styles.profilePictureWrapper}>
            {profileData.profile_image_url ? (
              <Image
                source={{ uri: profileData.profile_image_url }}
                style={styles.profilePicture}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.profilePicturePlaceholder}>
                <Text style={styles.profilePictureInitials}>
                  {getInitials(profileData.name || 'User')}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Profile Info Section - Board and Name Row */}
        <View style={styles.profileInfoSection}>
          <View style={styles.profileInfoRow}>
            {/* Board Image - Left side */}
            <View style={styles.boardImageContainer}>
              <Image
                source={{ uri: boardTypeInfo.imageUrl }}
                style={styles.boardImage}
                resizeMode="contain"
              />
            </View>

            {/* Name and Details - Centered below profile image, vertically aligned with board */}
            <View style={styles.nameContainer}>
              <View style={styles.fullNameContainer}>
                <RNText 
                  style={styles.fullName}
                  numberOfLines={1}
                  adjustsFontSizeToFit={true}
                  minimumFontScale={0.4}
                >
                  {profileData.name || 'User'}
                </RNText>
              </View>
              <View style={styles.profileDetailsContainer}>
                <Text style={styles.profileDetails}>
                  {profileData.age ? `${profileData.age} yo` : ''}
                  {profileData.age && profileData.country_from ? ' | ' : ''}
                  {profileData.country_from || ''}
                  {profileData.country_from && boardTypeInfo.name ? ' | ' : ''}
                  {boardTypeInfo.name}
                </Text>
              </View>
            </View>
          </View>

          {/* Content Container - Surf Skill, Travel Experience, Destinations */}
          <View style={styles.contentContainer}>
          {/* Surf Skill Section */}
          <View style={styles.skillSection}>
            <View style={styles.skillTitleRow}>
              <Text style={styles.skillTitle}>Surf Skill:</Text>
              <Text style={styles.skillValue}>{surfLevelInfo.name}</Text>
            </View>
            <View style={styles.progressBarContainer}>
              <View style={styles.progressBar}>
                <LinearGradient
                  colors={['#05BCD3', '#00A2B6']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.progressFill, { width: getSurfSkillProgressWidth() }]}
                />
                <View style={[styles.progressEmpty, { flex: 1 }]} />
              </View>
              <View style={styles.progressLabels}>
                <Text style={styles.progressLabel}>Deeping my toes</Text>
                <Text style={styles.progressLabel}>Charging</Text>
              </View>
            </View>
          </View>

          {/* Travel Experience Section */}
          <View style={styles.skillSection}>
            <View style={styles.skillTitleRow}>
              <Text style={styles.skillTitle}>Travel Experience:</Text>
              <Text style={styles.skillValue}>{travelExpInfo.trips} trips</Text>
            </View>
            <View style={styles.progressBarContainer}>
              <View style={styles.progressBar}>
                <LinearGradient
                  colors={['#05BCD3', '#00A2B6']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.progressFill, { width: getTravelExpProgressWidth() }]}
                />
                <View style={[styles.progressEmpty, { flex: 1 }]} />
              </View>
              <View style={styles.progressLabels}>
                <Text style={styles.progressLabel}>0 trips</Text>
                <Text style={styles.progressLabel}>30+ trips</Text>
              </View>
            </View>
          </View>

          {/* Top Destinations Section */}
          {topDestinations.length > 0 && (
            <View style={styles.destinationsSection}>
              <View style={styles.destinationsTitleRow}>
                <Text style={styles.sectionTitle}>Top Destinations</Text>
                <View style={styles.destinationsTitleSpacer} />
              </View>
              {topDestinations.map((destination, index) => {
                const progressWidth = getDestinationProgressWidth(destination.time_in_days);
                // Extract country name from destination (format: "Area, Country" or just "Country")
                const destinationParts = destination.destination_name.split(',').map(part => part.trim());
                const countryName = destinationParts.length > 1 ? destinationParts[destinationParts.length - 1] : destinationParts[0];
                const countryFlagUrl = getCountryFlag(countryName);
                
                return (
                  <View key={index} style={styles.destinationCard}>
                    {countryFlagUrl ? (
                      <Image
                        source={{ uri: countryFlagUrl }}
                        style={styles.destinationImage}
                        resizeMode="cover"
                      />
                    ) : (
                      <Image
                        source={{ 
                          uri: `https://source.unsplash.com/86x74/?${encodeURIComponent(destination.destination_name.split(',')[0])},beach,surf`
                        }}
                        style={styles.destinationImage}
                        resizeMode="cover"
                      />
                    )}
                    <View style={styles.destinationContent}>
                      <View style={styles.destinationTitleRow}>
                        <Text style={styles.destinationName}>{destination.destination_name}:</Text>
                        <View style={styles.destinationDaysContainer}>
                          <Text style={styles.destinationDays}>{destination.time_in_days}</Text>
                          <Text style={styles.destinationDaysLabel}>/Days</Text>
                        </View>
                      </View>
                      <View style={styles.destinationProgressContainer}>
                        <View style={styles.destinationProgressBar}>
                          <LinearGradient
                            colors={['#05BCD3', '#00A2B6']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                            style={[styles.destinationProgressFill, { width: progressWidth }]}
                          />
                          <View style={[styles.destinationProgressEmpty, { flex: 1 }]} />
                        </View>
                        <View style={styles.destinationProgressLabels}>
                          <Text style={styles.destinationProgressLabel}>Short visit</Text>
                          <Text style={styles.destinationProgressLabel}>Local</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Lifestyle Section - Inside profileInfoSection, after destinations */}
          {lifestyleKeywords.length > 0 && (
            <View style={styles.lifestyleSectionWrapper}>
              <View style={styles.lifestyleTitleContainer}>
                <Text style={styles.lifestyleTitle}>Lifestyle</Text>
              </View>
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false}
                style={styles.lifestyleScrollView}
                contentContainerStyle={styles.lifestyleContainer}
              >
                {lifestyleKeywords.slice(0, 6).map((keyword, index) => {
                  const iconName = LIFESTYLE_ICON_MAP[keyword.toLowerCase()] || 'ellipse-outline';
                  return (
                    <View key={index} style={styles.lifestyleItem}>
                      <View style={styles.lifestyleIconContainer}>
                        <Ionicons name={iconName as any} size={24} color="#222B30" />
                      </View>
                      <Text style={styles.lifestyleLabel}>{keyword}</Text>
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundGray,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  coverContainer: {
    height: 180,
    width: '100%',
    position: 'relative',
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
  coverOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  backButton: {
    position: 'absolute',
    left: 16,
    top: 54,
    zIndex: 10,
  },
  backButtonContainer: {
    height: 40,
    minWidth: 70,
    borderRadius: 48,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 8,
    paddingRight: 12,
    paddingVertical: 10,
  },
  backButtonText: {
    fontSize: 12,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 15,
    color: colors.textPrimary,
  },
  saveButton: {
    position: 'absolute',
    left: 307,
    top: 54,
    zIndex: 10,
  },
  saveButtonContainer: {
    height: 40,
    minWidth: 70,
    borderRadius: 48,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 8,
    paddingRight: 12,
    paddingVertical: 10,
  },
  saveButtonText: {
    fontSize: 12,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 15,
    color: colors.textPrimary,
  },
  messageButton: {
    position: 'absolute',
    left: 307,
    top: 54,
    zIndex: 10,
  },
  messageButtonContainer: {
    height: 40,
    minWidth: 70,
    borderRadius: 48,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 8,
    paddingRight: 12,
    paddingVertical: 10,
  },
  messageButtonText: {
    fontSize: 12,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 15,
    color: colors.textPrimary,
  },
  profilePictureContainer: {
    position: 'absolute',
    top: 78,
    left: '50%',
    transform: [{ translateX: -60 }], // Half of 120px (profile picture width)
    zIndex: 10,
    alignItems: 'center',
    justifyContent: 'center',
    width: 120,
    height: 120,
  },
  profilePictureWrapper: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 6,
    borderColor: colors.white,
    overflow: 'hidden',
    backgroundColor: colors.white,
  },
  profilePicture: {
    width: '100%',
    height: '100%',
  },
  profilePicturePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#E4E4E4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profilePictureInitials: {
    fontSize: 48,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    color: '#7B7B7B',
    textAlign: 'center',
  },
  profileInfoSection: {
    position: 'absolute',
    top: 145,
    left: '50%',
    transform: [{ translateX: -180.5 }], // Half of 361px
    paddingHorizontal: 0,
    alignItems: 'center',
    width: 361,
    alignSelf: 'center',
  },
  contentContainer: {
    marginTop: 16,
    width: '100%',
    gap: 24,
    alignItems: 'center',
  },
  profileInfoRow: {
    flexDirection: 'row',
    width: '100%',
    alignItems: 'flex-end',
    position: 'relative',
  },
  boardImageContainer: {
    width: 75,
    height: 130,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  boardImage: {
    width: 85, // Increased from 79 (slightly bigger)
    height: 140, // Increased from 130 (slightly bigger)
    ...(Platform.OS === 'web' && {
      objectFit: 'contain' as any,
    }),
  },
  nameContainer: {
    position: 'absolute',
    left: '50%',
    marginLeft: -100, // Center it (half of typical width ~200px)
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 8,
    gap: 8,
    width: 200,
  },
  fullNameContainer: {
    width: '100%',
    alignItems: 'center',
    flexShrink: 1,
  },
  profileDetailsContainer: {
    width: 194,
    alignItems: 'center',
  },
  fullName: {
    fontSize: 24,
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : undefined,
    lineHeight: 28.8, // 1.2 * 24
    color: colors.textPrimary,
    textAlign: 'center',
    width: '100%',
  },
  profileDetails: {
    fontSize: 14,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 18,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  skillSection: {
    width: '100%',
    gap: 8,
  },
  skillTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  skillTitle: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 22,
    color: colors.black,
  },
  skillValue: {
    fontSize: 14,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 18,
    color: colors.black,
  },
  progressBarContainer: {
    gap: 4,
    width: '100%',
  },
  progressBar: {
    height: 6,
    width: '100%',
    backgroundColor: colors.white,
    borderRadius: 2,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    minWidth: 0,
  },
  progressEmpty: {
    backgroundColor: '#E4E4E4',
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 15,
    color: colors.black,
  },
  progressLabelSmall: {
    fontSize: 10,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 20,
    color: colors.black,
  },
  destinationsSection: {
    width: '100%',
    gap: 8,
    marginTop: 0,
    marginBottom: 0,
  },
  destinationsTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 22,
    color: colors.black,
  },
  destinationsTitleSpacer: {
    width: 18,
    height: 22,
  },
  destinationCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    overflow: 'hidden',
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
    paddingRight: 16,
  },
  destinationImage: {
    width: 86,
    height: 74,
    borderRadius: 0,
  },
  destinationContent: {
    flex: 1,
    paddingRight: 0,
    paddingVertical: 0,
    gap: 8,
    justifyContent: 'center',
    minHeight: 74,
  },
  destinationTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
  },
  destinationName: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 22,
    color: '#000',
  },
  destinationDaysContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    marginLeft: 4,
  },
  destinationDays: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 22,
    color: '#000',
  },
  destinationDaysLabel: {
    fontSize: 10,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 20,
    color: colors.textSecondary, // #7b7b7b
  },
  destinationProgressContainer: {
    width: '100%',
    gap: 4,
  },
  destinationProgressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginTop: 0,
  },
  destinationProgressLabel: {
    fontSize: 10,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 20,
    color: colors.textSecondary, // #7b7b7b
  },
  destinationProgressBar: {
    height: 6,
    width: 243,
    backgroundColor: colors.white,
    borderRadius: 2,
    flexDirection: 'row',
    overflow: 'hidden',
    marginTop: 0,
  },
  destinationProgressFill: {
    height: '100%',
    borderRadius: 2,
    minWidth: 0,
  },
  destinationProgressEmpty: {
    backgroundColor: '#E4E4E4',
  },
  lifestyleSectionWrapper: {
    marginTop: 0,
    marginLeft: 0,
    width: '100%',
    gap: 7.5,
    paddingLeft: 0,
  },
  lifestyleScrollView: {
    marginTop: 6,
  },
  lifestyleTitleContainer: {
    marginBottom: 6,
  },
  lifestyleTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 16.5,
    color: colors.black,
  },
  lifestyleContainer: {
    flexDirection: 'row',
    gap: 12.613,
    width: 350,
    paddingRight: 16,
  },
  lifestyleItem: {
    width: 59.91,
    alignItems: 'center',
    gap: 0,
    marginBottom: 0,
  },
  lifestyleIconContainer: {
    width: 55.856,
    height: 55.856,
    borderRadius: 27.928,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.black,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lifestyleLabel: {
    fontSize: 12.61,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 18.018,
    color: '#333333',
    textAlign: 'center',
  },
});

