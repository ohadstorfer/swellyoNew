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
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Rect, Defs, Filter, FeFlood, FeColorMatrix, FeOffset, FeGaussianBlur, FeComposite, FeBlend, Path } from 'react-native-svg';
import { Text } from '../components/Text';
import { Text as RNText } from 'react-native';
import { colors, spacing, typography } from '../styles/theme';
import { supabaseDatabaseService, SupabaseSurfer } from '../services/database/supabaseDatabaseService';
import { supabase } from '../config/supabase';
import { getImageUrl } from '../services/media/imageService';
import { getCountryFlag } from '../utils/countryFlags';
import { uploadProfileImage } from '../services/storage/storageService';
import { ProfileImage } from '../components/ProfileImage';

interface ProfileScreenProps {
  onBack?: () => void;
  userId?: string; // Optional: if provided, view this user's profile instead of current user's
  onMessage?: (userId: string) => void; // Callback when message button is clicked
  onContinueEdit?: () => void; // Callback when "continue edit" button is clicked
  onEdit?: () => void; // Callback when edit button is clicked
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
const TRAVEL_EXPERIENCE_MAP = {
  new_nomad: { trips: 0, progress: 10 },       // 0–3
  rising_voyager: { trips: 4, progress: 30 }, // 4–9
  wave_hunter: { trips: 10, progress: 65 },   // 10–19
  chicken_joe: { trips: 20, progress: 100 },  // 20+
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

// Back Button Icon Component - Matches Figma design (chevron-left)
const BackButtonIcon: React.FC = () => {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Path
        d="M15 18L9 12L15 6"
        stroke="#222B30"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
};

// Edit Button Icon Component - Matches Figma design (edit-02/pencil)
const EditButtonIcon: React.FC = () => {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Path
        d="M11.5312 18.5199L11.2583 17.8213L11.5312 18.5199ZM7.47478 19.2988L7.09978 19.9483L7.09978 19.9483L7.47478 19.2988ZM6.12116 15.3964L5.37971 15.5093L6.12116 15.3964ZM6.61146 12.7941L7.26098 13.1691L6.61146 12.7941ZM6.02731 14.0314L5.29028 13.8925H5.29028L6.02731 14.0314ZM13.5397 16.7941L14.1892 17.1691L13.5397 16.7941ZM12.7602 17.9186L13.249 18.4875H13.249L12.7602 17.9186ZM10.4099 6.21503L9.76038 5.84003L10.4099 6.21503ZM17.3381 10.215L16.6886 9.84003L12.8901 16.4191L13.5397 16.7941L14.1892 17.1691L17.9876 10.59L17.3381 10.215ZM6.61146 12.7941L7.26098 13.1691L11.0594 6.59003L10.4099 6.21503L9.76038 5.84003L5.96194 12.4191L6.61146 12.7941ZM11.5312 18.5199L11.2583 17.8213C10.1618 18.2497 9.41502 18.5394 8.83854 18.6741C8.28167 18.8042 8.02898 18.7527 7.84978 18.6493L7.47478 19.2988L7.09978 19.9483C7.75305 20.3255 8.45392 20.3044 9.17981 20.1348C9.88609 19.9698 10.7513 19.6298 11.8041 19.2184L11.5312 18.5199ZM6.12116 15.3964L5.37971 15.5093C5.5499 16.6267 5.68805 17.546 5.89829 18.2402C6.11436 18.9536 6.44651 19.5712 7.09978 19.9483L7.47478 19.2988L7.84978 18.6493C7.67059 18.5458 7.49965 18.3527 7.33389 17.8054C7.16229 17.2388 7.03986 16.4472 6.86261 15.2835L6.12116 15.3964ZM6.61146 12.7941L5.96194 12.4191C5.64012 12.9765 5.38246 13.4033 5.29028 13.8925L6.02731 14.0314L6.76434 14.1702C6.7983 13.99 6.88802 13.8151 7.26098 13.1691L6.61146 12.7941ZM6.12116 15.3964L6.86261 15.2835C6.7503 14.546 6.73039 14.3505 6.76434 14.1702L6.02731 14.0314L5.29028 13.8925C5.1981 14.3817 5.2828 14.873 5.37971 15.5093L6.12116 15.3964ZM13.5397 16.7941L12.8901 16.4191C12.5172 17.0651 12.4105 17.2303 12.2715 17.3498L12.7602 17.9186L13.249 18.4875C13.6266 18.1631 13.8674 17.7265 14.1892 17.1691L13.5397 16.7941ZM11.5312 18.5199L11.8041 19.2184C12.4036 18.9842 12.8714 18.8119 13.249 18.4875L12.7602 17.9186L12.2715 17.3498C12.1324 17.4693 11.953 17.5498 11.2583 17.8213L11.5312 18.5199ZM15.874 4.75093L15.499 5.40045C16.3339 5.88245 16.8939 6.20761 17.2797 6.50537C17.6483 6.78983 17.7658 6.98144 17.8135 7.15945L18.5379 6.96534L19.2623 6.77123C19.0956 6.14904 18.6976 5.70485 18.1961 5.31785C17.7119 4.94416 17.0471 4.56221 16.249 4.10141L15.874 4.75093ZM17.3381 10.215L17.9876 10.59C18.4484 9.79189 18.8331 9.12875 19.0657 8.56299C19.3065 7.97711 19.4291 7.39341 19.2623 6.77123L18.5379 6.96534L17.8135 7.15945C17.8612 7.33747 17.8553 7.56212 17.6783 7.99278C17.493 8.44357 17.1706 9.00517 16.6886 9.84003L17.3381 10.215ZM15.874 4.75093L16.249 4.10141C15.4509 3.6406 14.7877 3.2559 14.222 3.02337C13.6361 2.78257 13.0524 2.65997 12.4302 2.82668L12.6243 3.55113L12.8184 4.27557C12.9964 4.22787 13.2211 4.23376 13.6518 4.41076C14.1025 4.59604 14.6641 4.91844 15.499 5.40045L15.874 4.75093ZM10.4099 6.21503L11.0594 6.59003C11.5414 5.75517 11.8666 5.19516 12.1643 4.80931C12.4488 4.4407 12.6404 4.32327 12.8184 4.27557L12.6243 3.55113L12.4302 2.82668C11.808 2.99339 11.3638 3.39142 10.9768 3.89291C10.6031 4.37716 10.2212 5.04189 9.76038 5.84003L10.4099 6.21503ZM17.3381 10.215L17.7131 9.56551L10.7849 5.56551L10.4099 6.21503L10.0349 6.86455L16.9631 10.8645L17.3381 10.215Z"
        fill="#222B30"
      />
    </Svg>
  );
};

// Plus Icon SVG Component
const PlusIcon: React.FC<{ size?: number }> = ({ size = 40 }) => {
  const scale = size / 40;
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <Defs>
        <Filter id={`filter0_d_3645_6670_${size}`} x="0" y="0" width="40" height="40" filterUnits="userSpaceOnUse">
          <FeFlood floodOpacity="0" result="BackgroundImageFix"/>
          <FeColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
          <FeOffset/>
          <FeGaussianBlur stdDeviation="2"/>
          <FeComposite in2="hardAlpha" operator="out"/>
          <FeColorMatrix type="matrix" values="0 0 0 0 0.376471 0 0 0 0 0.396078 0 0 0 0 0.435294 0 0 0 0.45 0"/>
          <FeBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_3645_6670"/>
          <FeBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_3645_6670" result="shape"/>
        </Filter>
      </Defs>
      <Circle cx="20" cy="20" r="16" fill="white" filter={`url(#filter0_d_3645_6670_${size})`}/>
      <Circle cx="20" cy="20" r="13" fill="#00A2B6"/>
      <Rect x="19" y="11" width="2" height="18" rx="1" fill="white"/>
      <Rect x="29" y="19" width="2" height="18" rx="1" transform="rotate(90 29 19)" fill="white"/>
    </Svg>
  );
};

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ onBack, userId, onMessage, onContinueEdit, onEdit }) => {
  const [profileData, setProfileData] = useState<SupabaseSurfer | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  
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

  const pickImage = async () => {
    if (!currentUserId) {
      Alert.alert('Error', 'You must be logged in to upload a profile image.');
      return;
    }

    try {
      if (Platform.OS === 'web') {
        // For web, use a file input
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async (e: any) => {
          const file = e.target.files[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = async (event: any) => {
              const imageUri = event.target.result;
              await uploadAndUpdateProfile(imageUri);
            };
            reader.readAsDataURL(file);
          }
        };
        input.click();
      } else {
        // For native, use expo-image-picker
        try {
          const ImagePicker = require('expo-image-picker');
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert(
              'Permission Required',
              'Sorry, we need camera roll permissions to upload your profile picture!'
            );
            return;
          }

          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.8,
          });

          if (!result.canceled && result.assets[0]) {
            const imageUri = result.assets[0].uri;
            await uploadAndUpdateProfile(imageUri);
          }
        } catch (error) {
          console.warn('expo-image-picker not available:', error);
          Alert.alert(
            'Image Picker Not Available',
            'Please install expo-image-picker for native platforms.'
          );
        }
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  };

  const uploadAndUpdateProfile = async (imageUri: string) => {
    if (!currentUserId) return;

    setIsUploadingImage(true);
    try {
      // Upload image to storage
      const result = await uploadProfileImage(imageUri, currentUserId);
      
      if (result.success && result.url) {
        // Update profile with new image URL
        await supabaseDatabaseService.saveSurfer({
          profileImageUrl: result.url,
        });

        // Reload profile data to show new image
        await loadProfileData();
        
        Alert.alert('Success', 'Profile picture updated successfully!');
      } else {
        const errorMessage = result.error || 'Failed to upload image';
        console.error('Upload failed:', errorMessage);
        Alert.alert('Upload Failed', errorMessage);
      }
    } catch (error) {
      console.error('Error uploading profile image:', error);
      Alert.alert('Error', 'Failed to upload profile picture. Please try again.');
    } finally {
      setIsUploadingImage(false);
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
  const travelExpKey = profileData.travel_experience?.toLowerCase() as keyof typeof TRAVEL_EXPERIENCE_MAP;
  const travelExpInfo = profileData.travel_experience && travelExpKey in TRAVEL_EXPERIENCE_MAP
    ? TRAVEL_EXPERIENCE_MAP[travelExpKey]
    : TRAVEL_EXPERIENCE_MAP['new_nomad'];

  // Get destinations array (top 3 by longest stay - sorted by time_in_days descending)
  const topDestinations = profileData.destinations_array 
    ? [...profileData.destinations_array]
        .sort((a, b) => (b.time_in_days || 0) - (a.time_in_days || 0)) // Sort by time_in_days descending
        .slice(0, 3) // Take top 3
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
        {/* Back Button - Always visible, goes to ConversationsScreen (home) */}
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <View style={styles.backButtonContainer}>
            <BackButtonIcon />
          </View>
        </TouchableOpacity>

        {/* Edit Button - Only visible when viewing own profile */}
        {isViewingOwnProfile && onEdit ? (
          <TouchableOpacity style={styles.editButton} onPress={onEdit}>
            <View style={styles.editButtonContainer}>
              <EditButtonIcon />
            </View>
          </TouchableOpacity>
        ) : (
          // Message Button - Visible when viewing other user's profile
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
            <ProfileImage
              imageUrl={profileData.profile_image_url}
              name={profileData.name || 'User'}
              style={styles.profilePicture}
              showLoadingIndicator={false}
            />
          </View>
          {/* Plus Icon Overlay - Only show when viewing own profile */}
          {isViewingOwnProfile && (
            <TouchableOpacity
              style={styles.plusIconContainer}
              onPress={pickImage}
              disabled={isUploadingImage}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              {isUploadingImage ? (
                <View style={styles.uploadingContainer}>
                  <Ionicons name="hourglass-outline" size={20} color="#FFFFFF" />
                </View>
              ) : (
                <PlusIcon size={40} />
              )}
            </TouchableOpacity>
          )}
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
                <Text style={styles.progressLabel}>20+ trips</Text>
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
                          <Text style={styles.destinationDays}>
                            {destination.time_in_text || `${destination.time_in_days} days`}
                          </Text>
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
    left: spacing.md, // 16px gap from left edge
    top: 54,
    zIndex: 10,
  },
  backButtonContainer: {
    width: 44, // 24px icon + 10px padding on each side
    height: 44,
    borderRadius: 48,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    ...(Platform.OS === 'web' && {
      boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.1)',
    }),
  },
  editButton: {
    position: 'absolute',
    right: spacing.md, // 16px gap from right edge
    top: 54,
    zIndex: 10,
  },
  editButtonContainer: {
    width: 44, // 24px icon + 10px padding on each side
    height: 44,
    borderRadius: 48,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    ...(Platform.OS === 'web' && {
      boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.1)',
    }),
  },
  editButtonIcon: {
    width: 24,
    height: 24,
  },
  messageButton: {
    position: 'absolute',
    right: spacing.md, // 16px gap from right edge
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
    ...(Platform.OS === 'web' && {
      objectFit: 'cover' as any,
      display: 'block' as any,
    }),
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
  plusIconContainer: {
    position: 'absolute',
    bottom: -5, // Slightly outside the border for better visibility
    right: -5,  // Slightly outside the border for better visibility
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
    backgroundColor: 'transparent', // Make container transparent
    // Add shadow for better visibility (only on the icon itself, not the container)
    ...(Platform.OS === 'web' && {
      filter: 'drop-shadow(0px 2px 4px rgba(0, 0, 0, 0.2))',
    }),
  },
  uploadingContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 162, 182, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
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
    fontSize: 14,
    fontWeight: '400',
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

