import React from 'react';
import { View, StyleSheet, Image, Platform, Text } from 'react-native';
import { getImageUrl } from '../services/media/imageService';

// Local logo assets from public/welcome page folder
const LOGO_IMAGE_PATH = '/welcome page/Logo Swellyo.svg';
const VECTOR_IMAGE_PATH = '/welcome page/Vector.svg';

interface LogoProps {
  size?: number;
}

export const Logo: React.FC<LogoProps> = ({ size = 112 }) => {
  const [logoError, setLogoError] = React.useState(false);
  const [vectorError, setVectorError] = React.useState(false);

  // Get the logo and vector URLs using the image utility for proper platform handling
  const logoUrl = React.useMemo(() => getImageUrl(LOGO_IMAGE_PATH), []);
  const vectorUrl = React.useMemo(() => getImageUrl(VECTOR_IMAGE_PATH), []);

  return (
    <View style={styles.container}>
      {/* Logo image - contains both logo and text */}
      <View style={[styles.logoContainer, { width: size, height: size }]}>
        {!logoError ? (
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
      </View>
      
      {/* Vector image below the logo */}
      <View style={styles.vectorContainer}>
        {!vectorError ? (
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