import React from 'react';
import { View, StyleSheet, Image, Platform, Text, ViewStyle, Animated } from 'react-native';
import { getImageUrl } from '../services/media/imageService';

// Local logo assets from public folder
const LOGO_IMAGE_PATH = '/LogoBlack.svg';
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

// Native inline SVG for the Swellyo logo icon (black circle with gradient border)
const NativeLogoIcon: React.FC<{ size: number }> = ({ size }) => (
  <Svg width={size} height={size} viewBox="0 0 118 118" fill="none">
    <Defs>
      <LinearGradient id="paint0_linear" x1="3" y1="59" x2="115" y2="59" gradientUnits="userSpaceOnUse">
        <Stop stopColor="#05BCD3" />
        <Stop offset="0.7" stopColor="#DBCDBC" />
      </LinearGradient>
    </Defs>
    <Circle cx="59" cy="59" r="57.5" fill="black" stroke="url(#paint0_linear)" strokeWidth="3" />
    <Path d="M88.8802 84.3185C85.2448 82.6892 81.2109 82.5989 76.1879 84.0291C71.3958 85.3942 66.3694 87.9419 61.0485 90.6385C55.443 93.4789 49.6483 96.4147 43.611 98.213C39.7546 99.3605 36.1208 99.9343 32.651 99.9343C31.1697 99.9343 29.7202 99.8289 28.2958 99.6198C36.8321 106.077 47.4657 109.909 58.9964 109.909C74.2915 109.909 88.0098 103.168 97.3429 92.4986C94.9962 88.5324 92.1592 85.7873 88.8819 84.3185H88.8802Z" fill="white" />
    <Path d="M23.3715 68.129C36.4589 71.7523 49.2767 63.8533 61.6745 56.2135C67.7436 52.4731 73.4747 48.9418 79.2074 46.7354C85.9963 44.1224 91.8428 43.8414 97.0801 45.8755C102.225 47.8745 106.515 52.065 109.908 58.3815C109.776 47.5952 106.288 37.6185 100.438 29.4434C99.4067 28.0031 98.1162 26.7653 96.6265 25.8084C93.0379 23.5049 89.3506 22.1349 85.6029 21.72C74.1408 20.4487 64.3207 28.1855 54.8237 35.668C47.1678 41.6985 39.8667 47.4513 32.3246 47.4513C30.8266 47.4513 29.3202 47.2255 27.7987 46.7287C22.5832 45.0274 18.3937 40.3736 15.3055 32.8694C10.9202 40.1695 8.31581 48.6558 8.08984 57.7325C12.6359 63.0838 17.7727 66.58 23.3715 68.1307V68.129Z" fill="white" />
    <Path d="M95.018 51.1784C91.1064 49.6594 86.7327 49.9355 81.2511 52.0449C76.0105 54.0606 70.497 57.4598 64.6605 61.0563C54.1475 67.5352 42.4828 74.7216 30.0801 74.7233C27.3702 74.7233 24.6269 74.3803 21.8517 73.6125C17.0998 72.2977 12.6643 69.8587 8.60035 66.3374C9.83393 74.8956 13.1949 82.7662 18.1359 89.3939C20.5796 91.1754 23.1606 92.4752 25.8655 93.2765C36.8355 96.5318 47.8356 90.958 58.4759 85.5665C64.0479 82.7427 69.3103 80.0763 74.6279 78.5607C80.9247 76.7658 86.3495 76.9515 91.2085 79.1295C95.013 80.8341 98.3053 83.7147 101.045 87.7244C104.594 82.542 107.208 76.6721 108.646 70.3555C105.459 59.9054 100.88 53.4567 95.0197 51.18L95.018 51.1784Z" fill="white" />
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