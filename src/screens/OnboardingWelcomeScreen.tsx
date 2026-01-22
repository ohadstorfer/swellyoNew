import React from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Image,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { Text } from '../components/Text';
import { getImageUrl } from '../services/media/imageService';
import { useScreenDimensions } from '../utils/responsive';

interface OnboardingWelcomeScreenProps {
  onNext: () => void;
  onBack?: () => void;
}

export const OnboardingWelcomeScreen: React.FC<OnboardingWelcomeScreenProps> = ({ onNext, onBack }) => {
  const { height: screenHeight, width: screenWidth } = useScreenDimensions();
  
  // Calculate responsive spacing based on screen height
  const isSmallScreen = screenHeight < 700;
  const contentGap = isSmallScreen ? 16 : 23;
  const pointGap = isSmallScreen ? 12 : 16;
  const avatarSize = isSmallScreen ? 90 : 107;
  const titleFontSize = isSmallScreen ? 20 : 24;
  const subtitleFontSize = isSmallScreen ? 14 : 18;
  const pointTitleFontSize = isSmallScreen ? 16 : 18;
  const pointTextFontSize = isSmallScreen ? 12 : 14;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header with Back Button - Positioned absolutely */}
      {onBack && (
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#222B30" />
          </TouchableOpacity>
        </View>
      )}
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { minHeight: screenHeight },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header with Swelly Avatar and Title */}
        <View style={[styles.headerContainer, { gap: contentGap }]}>
          {/* Swelly Avatar */}
          <View style={[styles.avatarContainer, { width: avatarSize, height: avatarSize }]}>
            <View style={styles.avatarRing}>
              <Image
                source={{ uri: getImageUrl('/Ellipse 11.svg') }}
                style={styles.ellipseBackground}
                resizeMode="contain"
              />
              <View style={styles.avatarImageContainer}>
                <Image
                  source={{ uri: getImageUrl('/Swelly avatar onboarding.png') }}
                  style={styles.avatarImage}
                  resizeMode="cover"
                />
              </View>
            </View>
          </View>

          {/* Title */}
          <View style={styles.titleContainer}>
            <Text style={[styles.title, { fontSize: titleFontSize }]}>
              Yo! I'm Swelly!
            </Text>
          </View>

          {/* Subtitle */}
          <View style={styles.subtitleContainer}>
            <Text style={[styles.subtitleBold, { fontSize: subtitleFontSize }]}>
              Welcome to Swellyo.
            </Text>
            <View style={{ height: isSmallScreen ? 4 : 8 }} />
            <Text style={[styles.subtitleRegular, { fontSize: pointTextFontSize }]}>
              Your early....and thats rad!
            </Text>
            <Text style={[styles.subtitleRegular, { fontSize: pointTextFontSize }]}>
              We are building a better way to
            </Text>
            <Text style={[styles.subtitleRegular, { fontSize: pointTextFontSize }]}>
              surf, travel & connect.
            </Text>
          </View>
        </View>

        {/* Three Points */}
        <View style={[styles.pointsContainer, { gap: pointGap }]}>
          {/* Point 1 */}
          <View style={styles.pointContainer}>
            <View style={styles.pointContent}>
              <View style={styles.pointTitleContainer}>
               
                  <Svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <Path d="M7.5 12H7.51M12 12H12.01M16.5 12H16.51M12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3C7.02944 3 3 7.02944 3 12C3 13.1971 3.23374 14.3397 3.65806 15.3845C3.73927 15.5845 3.77988 15.6845 3.798 15.7653C3.81572 15.8443 3.8222 15.9028 3.82221 15.9839C3.82222 16.0667 3.80718 16.1569 3.77711 16.3374L3.18413 19.8952C3.12203 20.2678 3.09098 20.4541 3.14876 20.5888C3.19933 20.7067 3.29328 20.8007 3.41118 20.8512C3.54589 20.909 3.73218 20.878 4.10476 20.8159L7.66265 20.2229C7.84309 20.1928 7.9333 20.1778 8.01613 20.1778C8.09715 20.1778 8.15566 20.1843 8.23472 20.202C8.31554 20.2201 8.41552 20.2607 8.61549 20.3419C9.6603 20.7663 10.8029 21 12 21ZM8 12C8 12.2761 7.77614 12.5 7.5 12.5C7.22386 12.5 7 12.2761 7 12C7 11.7239 7.22386 11.5 7.5 11.5C7.77614 11.5 8 11.7239 8 12ZM12.5 12C12.5 12.2761 12.2761 12.5 12 12.5C11.7239 12.5 11.5 12.2761 11.5 12C11.5 11.7239 11.7239 11.5 12 11.5C12.2761 11.5 12.5 11.7239 12.5 12ZM17 12C17 12.2761 16.7761 12.5 16.5 12.5C16.2239 12.5 16 12.2761 16 12C16 11.7239 16.2239 11.5 16.5 11.5C16.7761 11.5 17 11.7239 17 12Z" stroke="#222B30" strokeLinecap="round" strokeLinejoin="round"/>
                  </Svg>
                <Text style={[styles.pointTitle, { fontSize: pointTitleFontSize }]}>
                  Tell us who you are
                </Text>
              </View>
              <Text style={[styles.pointDescription, { fontSize: pointTextFontSize }]}>
                Just a few questions to understand
              </Text>
              <Text style={[styles.pointDescription, { fontSize: pointTextFontSize }]}>
                your surf style & interests.
              </Text>
            </View>
          </View>

          {/* Point 2 */}
          <View style={styles.pointContainer}>
            <View style={styles.pointContent}>
              <View style={styles.pointTitleContainer}>
                
                  <Svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <Path d="M10 11.5347C11.2335 10.8218 12.7663 10.8218 13.9999 11.5347M8.82843 9.17157C10.3905 10.7337 10.3905 13.2663 8.82843 14.8284C7.26634 16.3905 4.73367 16.3905 3.17157 14.8284C1.60948 13.2663 1.60948 10.7337 3.17157 9.17157C4.73366 7.60948 7.26633 7.60948 8.82843 9.17157ZM20.8284 9.17157C22.3905 10.7337 22.3905 13.2663 20.8284 14.8284C19.2663 16.3905 16.7337 16.3905 15.1716 14.8284C13.6095 13.2663 13.6095 10.7337 15.1716 9.17157C16.7337 7.60948 19.2663 7.60948 20.8284 9.17157Z" stroke="#222B30" strokeLinecap="round" strokeLinejoin="round"/>
                  </Svg>
                <Text style={[styles.pointTitle, { fontSize: pointTitleFontSize }]}>
                  Find your people
                </Text>
              </View>
              <Text style={[styles.pointDescription, { fontSize: pointTextFontSize }]}>
                We'll connect you with travelers
              </Text>
              <Text style={[styles.pointDescription, { fontSize: pointTextFontSize }]}>
                who match your vibe.
              </Text>
            </View>
          </View>

          {/* Point 3 */}
          <View style={styles.pointContainer}>
            <View style={styles.pointContent}>
              <View style={styles.pointTitleContainer}>
                
                  <Svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <Path d="M20.7914 12.6075C21.0355 12.3982 21.1575 12.2936 21.2023 12.1691C21.2415 12.0598 21.2415 11.9403 21.2023 11.831C21.1575 11.7065 21.0355 11.6019 20.7914 11.3926L12.3206 4.13202C11.9004 3.77182 11.6903 3.59172 11.5124 3.58731C11.3578 3.58348 11.2101 3.6514 11.1124 3.77128C11 3.90921 11 4.18595 11 4.73942V9.03468C8.86532 9.40813 6.91159 10.4898 5.45971 12.1139C3.87682 13.8846 3.00123 16.176 3 18.551V19.163C4.04934 17.8989 5.35951 16.8766 6.84076 16.166C8.1467 15.5395 9.55842 15.1684 11 15.0706V19.2607C11 19.8141 11 20.0909 11.1124 20.2288C11.2101 20.3487 11.3578 20.4166 11.5124 20.4128C11.6903 20.4084 11.9004 20.2283 12.3206 19.8681L20.7914 12.6075Z" stroke="#222B30" strokeLinecap="round" strokeLinejoin="round"/>
                  </Svg>
                <Text style={[styles.pointTitle, { fontSize: pointTitleFontSize }]}>
                  Share & explore
                </Text>
              </View>
              <Text style={[styles.pointDescription, { fontSize: pointTextFontSize }]}>
                Chat, ask, offer tips — your insights
              </Text>
              <Text style={[styles.pointDescription, { fontSize: pointTextFontSize }]}>
                help build the future of surf travel.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Next Button */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={styles.button}
          onPress={onNext}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={['#00A2B6', '#0788B0']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.gradientButton}
          >
            <Text style={styles.buttonText}>Next</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  header: {
    position: 'absolute',
    top: 16,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  backButton: {
    width: 60,
    alignItems: 'flex-start',
  },
  scrollContent: {
    flexGrow: 1,
    paddingTop: 52,
    paddingBottom: 100,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  headerContainer: {
    alignItems: 'center',
    width: '100%',
    maxWidth: 393,
  },
  avatarContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarRing: {
    width: '100%',
    height: '100%',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ellipseBackground: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  avatarImageContainer: {
    position: 'absolute',
    width: '105%',
    height: '113%',
    top: '-13.8%',
    left: '-5%',
    overflow: 'hidden',
    borderRadius: 50,
    zIndex: 1,
    aspectRatio: 5/13,
  },
  avatarImage: {
    width: '105%',
    height: '105%',
    ...(Platform.OS === 'web' && {
      objectFit: 'cover' as any,
    }),
  },
  titleContainer: {
    alignItems: 'center',
    width: '100%',
  },
  title: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Headings, Montserrat), sans-serif' : 'Montserrat',
    fontWeight: '700',
    color: '#0788B0',
    textAlign: 'center',
    lineHeight: 28.8, // 1.2 * 24
  },
  subtitleContainer: {
    alignItems: 'center',
    width: '100%',
    maxWidth: 357,
  },
  subtitleBold: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Headings, Montserrat), sans-serif' : 'Montserrat',
    fontWeight: '700',
    color: '#000000',
    textAlign: 'center',
    lineHeight: 24,
  },
  subtitleRegular: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Body, Inter), sans-serif' : 'Inter',
    fontWeight: '400',
    color: '#000000',
    textAlign: 'center',
    lineHeight: 22,
  },
  pointsContainer: {
    width: '100%',
    maxWidth: 393,
    marginTop: 20,
    paddingHorizontal: 16,
    alignSelf: 'center',
    alignItems: 'center',
  },
  pointContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  pointContent: {
    flex: 1,
    gap: 2,
    alignItems: 'center',
  },
  pointTitleContainer: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'stretch',
  },
  circledNumber: {
    width: 20,
    height: 20,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  circledNumberText: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Headings, Montserrat), sans-serif' : 'Montserrat',
    fontWeight: '700',
    color: '#000000',
    lineHeight: 16,
    textAlign: 'center',
  },
  pointTitle: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Headings, Montserrat), sans-serif' : 'Montserrat',
    fontWeight: '700',
    color: '#000000',
    lineHeight: 24,
    textAlign: 'center',
  },
  pointDescription: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Body, Inter), sans-serif' : 'Inter',
    fontWeight: '400',
    color: '#000000',
    lineHeight: 22,
    textAlign: 'center',
  },
  buttonContainer: {
    position: 'absolute',
    bottom: 24,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  button: {
    width: '100%',
    maxWidth: 330,
    minWidth: 150,
  },
  gradientButton: {
    height: 56,
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  buttonText: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Headings, Montserrat), sans-serif' : 'Montserrat',
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 32,
  },
});

