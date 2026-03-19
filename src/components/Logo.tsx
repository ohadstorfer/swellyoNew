import React from 'react';
import { View, StyleSheet, Image, Platform, Text, ViewStyle, Animated } from 'react-native';
import { getImageUrl } from '../services/media/imageService';

// Local logo assets from public/welcome page folder
const LOGO_IMAGE_PATH = '/welcome page/Logo Swellyo.svg';
const VECTOR_IMAGE_PATH = '/welcome page/Vector.svg';

// Native SVG imports (only loaded on native platforms)
let Svg: any, Circle: any, Path: any, Defs: any, LinearGradient: any, Stop: any;
if (Platform.OS !== 'web') {
  const RNSvg = require('react-native-svg');
  Svg = RNSvg.Svg;
  Circle = RNSvg.Circle;
  Path = RNSvg.Path;
  Defs = RNSvg.Defs;
  LinearGradient = RNSvg.LinearGradient;
  Stop = RNSvg.Stop;
}

// Native inline SVG for the Swellyo logo icon
const NativeLogoIcon: React.FC<{ size: number }> = ({ size }) => (
  <Svg width={size} height={size} viewBox="0 0 112 112" fill="none">
    <Defs>
      <LinearGradient id="paint0_linear" x1="56" y1="0" x2="56" y2="112" gradientUnits="userSpaceOnUse">
        <Stop stopColor="#0ABDD3" />
        <Stop offset="1" stopColor="#DBCDBC" />
      </LinearGradient>
    </Defs>
    <Circle cx="56" cy="56" r="56" fill="url(#paint0_linear)" />
    <Path d="M85.8812 81.3183C82.2457 79.689 78.2119 79.5986 73.1889 81.0289C68.3968 82.3939 63.3704 84.9416 58.0495 87.6382C52.4439 90.4786 46.6493 93.4144 40.6119 95.2127C36.7555 96.3603 33.1217 96.934 29.652 96.934C28.1707 96.934 26.7212 96.8287 25.2968 96.6196C33.8331 103.077 44.4667 106.909 55.9974 106.909C71.2925 106.909 85.0108 100.168 94.3439 89.4984C91.9972 85.5321 89.1602 82.787 85.8829 81.3183H85.8812Z" fill="white" />
    <Path d="M20.3725 65.1288C33.4598 68.7521 46.2777 60.8531 58.6755 53.2133C64.7446 49.4729 70.4757 45.9416 76.2084 43.7351C82.9973 41.1222 88.8438 40.8411 94.0811 42.8753C99.2263 44.8743 103.516 49.0647 106.909 55.3813C106.777 44.5949 103.289 34.6183 97.4387 26.4432C96.4077 25.0029 95.1172 23.765 93.6275 22.8082C90.0389 20.5047 86.3515 19.1347 82.6039 18.7198C71.1418 17.4485 61.3217 25.1852 51.8246 32.6678C44.1687 38.6983 36.8677 44.4511 29.3256 44.4511C27.8276 44.4511 26.3211 44.2252 24.7997 43.7284C19.5841 42.0272 15.3947 37.3734 12.3065 29.8691C7.9212 37.1693 5.31678 45.6555 5.09082 54.7322C9.63683 60.0836 14.7737 63.5797 20.3725 65.1304V65.1288Z" fill="white" />
    <Path d="M92.019 48.1781C88.1073 46.6592 83.7337 46.9352 78.2521 49.0446C73.0115 51.0604 67.498 54.4595 61.6615 58.0561C51.1484 64.5349 39.4838 71.7213 27.081 71.723C24.3712 71.723 21.6278 71.3801 18.8527 70.6123C14.1008 69.2974 9.66528 66.8585 5.60133 63.3372C6.83491 71.8953 10.1959 79.7659 15.1369 86.3936C17.5806 88.1752 20.1616 89.475 22.8664 90.2762C33.8365 93.5315 44.8366 87.9577 55.4769 82.5662C61.0489 79.7425 66.3113 77.076 71.6289 75.5605C77.9257 73.7655 83.3504 73.9512 88.2094 76.1292C92.014 77.8338 95.3063 80.7144 98.0463 84.7242C101.595 79.5418 104.209 73.6718 105.647 67.3553C102.46 56.9052 97.8806 50.4565 92.0207 48.1798L92.019 48.1781Z" fill="white" />
  </Svg>
);

// Native inline SVG for the "SWELLYO" vector text
const NativeVectorText: React.FC = () => (
  <Svg width={245} height={37} viewBox="0 0 245 37" fill="none">
    <Path d="M18.1871 8.40314C15.4658 8.40314 14.3364 9.37814 14.3364 10.6245C14.3364 14.7457 30.317 13.821 30.317 24.8275C30.317 32.2556 24.1391 36.3717 15.4133 36.3717C8.38959 36.3717 2.77902 34.0397 0 29.9739L7.0815 23.0332C8.66801 25.7974 11.841 27.9636 15.7495 27.9636C18.5233 27.9636 20.0573 27.1494 20.0573 25.5763C20.0573 20.8068 4.13438 22.214 4.13438 11.3181C4.13438 4.17644 10.3123 0 18.9225 0C25.4945 0 30.7636 2.54808 32.8071 6.34256L25.3841 12.4137C24.1916 10.2476 21.7016 8.40314 18.1871 8.40314Z" fill="white" />
    <Path d="M92.7635 0.814242L75.3697 35.5626H63.5812L62.1103 12.4138L52.7068 35.5626H41.3753L36.0957 0.814242H46.408L49.0137 23.8525L57.9706 0.814242H70.5524L71.913 23.7972L82.3934 0.814242H92.7635Z" fill="white" />
    <Path d="M121.552 0.814242L120.133 8.8907H105.345L104.436 14.1477H116.96L115.542 22.1689H103.018L102.109 27.6973H116.897L115.479 35.5576H91.3398L97.4127 0.814242H121.552Z" fill="white" />
    <Path d="M136.004 0.814242L131.412 27.1595H147.903L146.432 35.5626H120.596L126.653 0.814242H136.004Z" fill="white" />
    <Path d="M165.811 0.814242L161.22 27.1595H177.71L176.239 35.5626H150.403L156.46 0.814242H165.811Z" fill="white" />
    <Path d="M194.437 24.1792L192.456 35.5626H183.105L185.086 24.1792L175.735 0.814242H185.369L191.038 15.4494L201.466 0.814242H211.72L194.437 24.1792Z" fill="white" />
    <Path d="M224.859 37C215.418 37 207.57 31.1198 207.57 20.827C207.57 9.58928 216.569 1.76411 227.711 1.76411C237.152 1.76411 245 7.64429 245 17.9371C245 29.592 236.001 37 224.853 37H224.859ZM226.892 10.4286C221.733 10.4286 217.394 14.1577 217.394 20.2993C217.394 24.5511 220.031 28.3355 225.683 28.3355C230.79 28.3355 235.176 24.6064 235.176 18.4096C235.176 14.1577 232.487 10.4286 226.886 10.4286H226.892Z" fill="white" />
  </Svg>
);

interface LogoProps {
  size?: number;
  iconWrapperStyle?: ViewStyle | ViewStyle[] | any; // any to support Animated styles
}

export const Logo: React.FC<LogoProps> = ({ size = 112, iconWrapperStyle }) => {
  const [logoError, setLogoError] = React.useState(false);
  const [vectorError, setVectorError] = React.useState(false);

  // Get the logo and vector URLs using the image utility for proper platform handling
  const logoUrl = React.useMemo(() => getImageUrl(LOGO_IMAGE_PATH), []);
  const vectorUrl = React.useMemo(() => getImageUrl(VECTOR_IMAGE_PATH), []);

  // Use Animated.View if iconWrapperStyle is provided (it will contain animated transform)
  const IconContainer = iconWrapperStyle ? Animated.View : View;

  const isNative = Platform.OS !== 'web';

  return (
    <View style={styles.container}>
      {/* Logo image - icon only (text is in vector below) */}
      <IconContainer style={[styles.logoContainer, { width: size, height: size }, iconWrapperStyle]}>
        {isNative ? (
          <NativeLogoIcon size={size} />
        ) : !logoError ? (
          <Image
            source={{ uri: logoUrl }}
            style={styles.logoImage}
            resizeMode="contain"
            onError={(error) => {
              console.warn('Failed to load logo image, using fallback:', error);
              setLogoError(true);
            }}
          />
        ) : (
          <View style={[styles.fallbackLogo, { width: size, height: size, borderRadius: size / 2 }]}>
            <Text style={styles.fallbackLogoText}>S</Text>
          </View>
        )}
      </IconContainer>

      {/* Vector image below the logo - "SWELLYO" text */}
      <View style={styles.vectorContainer}>
        {isNative ? (
          <NativeVectorText />
        ) : !vectorError ? (
          <Image
            source={{ uri: vectorUrl }}
            style={styles.vectorImage}
            resizeMode="contain"
            onError={(error) => {
              console.warn('Failed to load vector image:', error);
              setVectorError(true);
            }}
          />
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 0,
  },
  logoImage: {
    width: '100%',
    height: '100%',
    ...(Platform.OS === 'web' && {
      objectFit: 'contain' as any,
      display: 'block' as any,
    }),
  },
  vectorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24, // 24px gap from logo as per Figma
    width: 245,
    height: 37,
  },
  vectorImage: {
    width: 245,
    height: 37,
    tintColor: '#FFFFFF', // White fill as per Figma (--Text-inverse, #FFF)
    ...(Platform.OS === 'web' && {
      objectFit: 'contain' as any,
      display: 'block' as any,
      filter: 'brightness(0) invert(1)' as any, // Ensure white color on web for SVG
    }),
  },
  fallbackLogo: {
    backgroundColor: '#8B5CF6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackLogoText: {
    color: '#FFFFFF',
    fontSize: 48,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : undefined,
  },
  fallbackText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : undefined,
    textAlign: 'center',
  },
}); 