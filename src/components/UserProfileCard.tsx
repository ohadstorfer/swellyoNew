import React from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ImageBackground,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, G, ClipPath, Defs, Rect } from 'react-native-svg';
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

// Trip Icon Component
const TripIcon: React.FC = () => {
  return (
    <Svg width={14} height={16} viewBox="0 0 14 16" fill="none">
      <G clipPath="url(#clip0_5801_1517)">
        <Path
          d="M4.70549 15.9734C4.80517 15.9668 5.55509 15.7876 4.59803 14.2256C4.59803 14.2256 4.27612 13.7103 4.5075 13.3898C4.73841 13.0688 5.69547 11.9967 5.679 11.372C5.679 11.372 6.81759 11.3467 7.03204 11.4562C7.2465 11.5662 7.27119 11.7346 7.56018 11.6672C7.56018 11.6672 7.94794 12.0556 8.36862 11.7515C8.36862 11.7515 10.1176 12.4015 10.2663 10.7973C10.2663 10.7973 10.6705 10.2652 10.4725 9.62366L10.5882 9.56469V7.61424C10.5882 7.61424 11.4707 8.76261 11.6774 9.07474C11.8836 9.38734 12.5603 10.2231 12.296 10.4763C12.296 10.4763 12.1804 10.7631 12.4364 11.1179C12.4364 11.1179 12.4447 11.4557 12.5603 11.4389C12.676 11.422 12.783 11.4726 12.6427 11.0336C12.6427 11.0336 13.7812 12.2157 13.8059 11.8694C13.8059 11.8694 14.0368 12.0131 13.971 11.8104C13.971 11.8104 14.0867 11.7178 13.8635 11.5825C13.8635 11.5825 14.2348 11.7515 13.1621 10.6452C13.1621 10.6452 12.8653 9.97837 12.601 9.29421C12.3372 8.61053 11.9741 7.7827 11.4542 7.23426C11.4542 7.23426 10.9343 6.15374 10.7528 5.71432C10.7528 5.71432 10.2493 4.6675 9.67182 4.28752C9.0943 3.90753 9.16014 3.87384 9.16014 3.87384C9.16014 3.87384 9.35814 3.45174 9.27537 2.9791L9.30829 2.33753L9.54744 2.27857L9.34945 2.24487L9.51452 2.08436L9.31652 2.16017L9.4816 1.98282L9.21776 2.05862L9.19306 1.68707L9.04445 1.91496C9.04445 1.91496 8.48339 1.17184 7.62557 1.88127C7.62557 1.88127 7.3064 2.13724 7.35075 2.98191C7.35075 2.98191 7.07685 2.93137 7.43398 3.53644C7.43398 3.53644 7.36173 3.63752 7.00689 3.35908C7.00689 3.35908 6.56152 3.1733 5.97577 3.2917C5.97577 3.2917 5.75308 3.35908 5.39001 2.95383C5.39001 2.95383 5.10148 2.8696 4.72195 2.45545C4.34243 2.04178 3.5916 1.96597 3.07215 1.57756C2.55224 1.18916 2.43701 1.13862 2.43701 1.13862C2.43701 1.13862 2.36294 0.649131 1.95826 0.93599C1.95826 0.93599 1.47127 0.623393 1.28197 0.395497C1.28197 0.395497 0.696216 -0.330776 0.853056 0.184447L1.10044 0.47973C1.10044 0.47973 0.0610771 -0.00975573 0.333148 0.34449L0.76206 0.622925C0.76206 0.622925 -0.252604 0.597656 0.0606203 0.808705L0.588758 0.892938C0.588758 0.892938 -0.178527 0.926631 0.151616 1.10399L1.13336 1.1461C1.13336 1.1461 1.34781 1.36558 1.10044 1.33188C1.10044 1.33188 0.531142 1.19664 0.580527 1.4587C0.629911 1.72029 0.927133 1.48397 1.10867 1.59394C1.2902 1.70391 1.65327 1.64448 1.75203 1.63606C1.75203 1.63606 2.01587 1.68894 2.13979 1.77645C2.13979 1.77645 3.44345 2.93605 3.67437 3.07971C3.67437 3.07971 3.94644 3.40073 4.26012 3.40916C4.26012 3.40916 4.5738 3.57809 4.99448 3.87337L5.00271 4.02546C5.00271 4.02546 5.1184 3.97492 5.36578 4.12701C5.61316 4.27909 6.10014 4.57437 6.44675 4.62491C6.44675 4.62491 6.77689 4.777 6.82627 5.23279C6.87566 5.68859 7.32972 7.53796 7.73394 8.28061C8.13816 9.02373 7.89901 9.07427 8.27031 9.14166C8.27031 9.14166 8.48476 9.49637 7.65986 9.04011C6.83496 8.58432 6.01783 8.47435 5.26747 8.44066C4.51664 8.40696 4.14534 8.43223 3.93089 9.0738C3.93089 9.0738 3.6387 9.98773 3.50518 11.3954C3.50381 11.4066 3.50289 11.4183 3.50198 11.4295C3.36983 12.8563 2.25639 12.7974 2.17363 12.7721C2.09086 12.7468 -0.344514 11.5619 0.0615349 12.2653C0.41317 12.8741 0.856714 13.8826 2.03874 15.0043C3.22122 16.126 3.96244 16.0193 4.70641 15.972L4.70549 15.9734Z"
          fill="#212121"
        />
      </G>
      <Defs>
        <ClipPath id="clip0_5801_1517">
          <Rect width={14} height={16} fill="white" transform="matrix(-1 0 0 1 14 0)" />
        </ClipPath>
      </Defs>
    </Svg>
  );
};

// Surf Level Icon Component
const SurfLevelIcon: React.FC = () => {
  return (
    <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
      <Path
        d="M11.8298 1.87524C12.473 1.21092 13.5357 1.20233 14.1895 1.85616C14.8254 2.49207 14.8373 3.51939 14.2162 4.16979L12.3637 6.10963C12.2185 6.26168 12.1459 6.33771 12.1012 6.42675C12.0616 6.50557 12.038 6.59147 12.0319 6.67946C12.0249 6.77887 12.0485 6.8813 12.0958 7.08615L13.2477 12.0779C13.2963 12.2881 13.3205 12.3933 13.3127 12.495C13.3058 12.585 13.2806 12.6727 13.2388 12.7527C13.1915 12.8431 13.1152 12.9194 12.9626 13.0719L12.7154 13.3191C12.3113 13.7232 12.1093 13.9253 11.9025 13.9618C11.7219 13.9938 11.5362 13.9499 11.3889 13.8406C11.2203 13.7154 11.13 13.4443 10.9493 12.9022L9.60943 8.88267L7.37921 11.1129C7.24609 11.246 7.17953 11.3126 7.135 11.391C7.09556 11.4604 7.06891 11.5364 7.05633 11.6152C7.04213 11.7043 7.05253 11.7978 7.07332 11.9849L7.19579 13.0872C7.21658 13.2743 7.22698 13.3679 7.21278 13.4569C7.2002 13.5357 7.17355 13.6117 7.13411 13.6812C7.08958 13.7595 7.02302 13.8261 6.8899 13.9592L6.75823 14.0909C6.44285 14.4063 6.28517 14.564 6.10993 14.6096C5.95624 14.6497 5.79329 14.6335 5.65043 14.5641C5.48756 14.485 5.36386 14.2994 5.11646 13.9283L4.07091 12.36C4.02671 12.2937 4.00461 12.2606 3.97895 12.2305C3.95616 12.2038 3.9313 12.1789 3.90459 12.1561C3.87452 12.1305 3.84137 12.1084 3.77507 12.0642L2.20675 11.0186C1.83565 10.7712 1.6501 10.6475 1.57095 10.4846C1.50153 10.3418 1.4854 10.1788 1.52545 10.0251C1.57112 9.84991 1.72881 9.69223 2.04418 9.37685L2.17585 9.24518C2.30898 9.11206 2.37554 9.0455 2.45392 9.00097C2.52337 8.96153 2.59933 8.93488 2.6782 8.9223C2.76722 8.9081 2.86078 8.9185 3.04789 8.93929L4.15015 9.06176C4.33727 9.08255 4.43082 9.09295 4.51985 9.07875C4.59871 9.06617 4.67468 9.03952 4.74412 9.00008C4.82251 8.95555 4.88907 8.88899 5.02219 8.75586L7.25241 6.52565L3.23289 5.18581C2.69074 5.00509 2.41966 4.91473 2.29446 4.74613C2.18514 4.5989 2.14129 4.41315 2.17323 4.23257C2.20981 4.02578 2.41185 3.82373 2.81595 3.41963L3.06313 3.17245C3.21573 3.01986 3.29202 2.94356 3.38242 2.8963C3.46243 2.85447 3.5501 2.82933 3.64011 2.82239C3.74181 2.81456 3.84695 2.83883 4.05723 2.88735L9.02999 4.03491C9.23662 4.08259 9.33994 4.10644 9.43969 4.09934C9.536 4.09249 9.62967 4.06481 9.71423 4.0182C9.80181 3.96992 9.87556 3.89374 10.0231 3.74139L11.8298 1.87524Z"
        stroke="#212121"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
};

// Helper function to format trips display
const formatTrips = (trips: number): string => {
  if (trips === 0) return '0 trips';
  if (trips === 1) return '1 trip';
  if (trips >= 20) return '20+ trips';
  return `${trips} trips`;
};

export const UserProfileCard: React.FC<UserProfileCardProps> = ({ profileData, onPress }) => {
  const travelExperienceTrips = profileData.travel_experience ?? 0;
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
              {/* Travel Experience (Trips Count) */}
              <View style={styles.infoItem}>
              <SurfLevelIcon />
                <Text style={styles.infoText}>
                  {formatTrips(travelExperienceTrips)}
                </Text>
              </View>

              {/* Surf Level */}
              <View style={styles.infoItem}>
               
                <TripIcon />
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
    marginVertical: 0, // Remove vertical margin - handled by container
    marginHorizontal: 0, // Remove horizontal margin - handled by container
    width: '100%', // Take full width of container
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

