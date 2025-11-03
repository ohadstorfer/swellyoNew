import React from 'react';
import { View, StyleSheet, Image } from 'react-native';

// Figma logo asset URLs - updated with latest asset URLs
const LOGO_IMAGE_URL = 'https://www.figma.com/api/mcp/asset/c1e731af-c573-4cf4-9cb9-f7cde4affd1e';
const SWELLYO_TEXT_URL = 'https://www.figma.com/api/mcp/asset/dceda2ab-08ae-4224-9c9f-1e96cfc80256';

interface LogoProps {
  size?: number;
}

export const Logo: React.FC<LogoProps> = ({ size = 112 }) => {
  return (
    <View style={styles.container}>
      {/* Main logo image - no ellipse background */}
      <View style={[styles.logoContainer, { width: size, height: size }]}>
        <Image
          source={{ uri: LOGO_IMAGE_URL }}
          style={styles.logoImage}
          resizeMode="contain"
        />
      </View>
      
      {/* SWELLYO text */}
      <View style={styles.textContainer}>
        <Image
          source={{ uri: SWELLYO_TEXT_URL }}
          style={styles.swellyoText}
          resizeMode="contain"
        />
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
    marginBottom: 24,
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  textContainer: {
    height: 37,
    width: 245,
  },
  swellyoText: {
    width: '100%',
    height: '100%',
  },
}); 