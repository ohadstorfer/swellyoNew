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
                <View style={styles.circledNumber}>
                  <Text style={[styles.circledNumberText, { fontSize: 15 }]}>1</Text>
                </View>
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
                <View style={styles.circledNumber}>
                  <Text style={[styles.circledNumberText, { fontSize: 15 }]}>2</Text>
                </View>
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
                <View style={styles.circledNumber}>
                  <Text style={[styles.circledNumberText, { fontSize: 15 }]}>3</Text>
                </View>
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
    width: '85%',
    height: '85%',
    position: 'absolute',
  },
  avatarImageContainer: {
    position: 'absolute',
    width: '105%',
    height: '105%',
    top: '-5%',
    left: '-5%',
    overflow: 'hidden',
    borderRadius: 50,
    zIndex: 1,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 2,
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

