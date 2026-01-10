import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Platform } from 'react-native';

/**
 * Shimmer animation component for skeleton loaders
 * Works on iOS, Android, and Web (Expo Web)
 * Respects reduced motion preferences
 */
export const Shimmer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const shimmerAnim = useRef(new Animated.Value(0)).current;
  const [reducedMotion, setReducedMotion] = React.useState(false);

  useEffect(() => {
    // Check for reduced motion preference on web
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      setReducedMotion(mediaQuery.matches);
      
      const handleChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
    
    // On native, we'll assume reduced motion is off unless explicitly set
    // (React Native doesn't have a built-in way to check this)
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      // For reduced motion, use a subtle pulse instead of shimmer
      Animated.loop(
        Animated.sequence([
          Animated.timing(shimmerAnim, {
            toValue: 0.3,
            duration: 1500,
            useNativeDriver: true,
          }),
          Animated.timing(shimmerAnim, {
            toValue: 0.1,
            duration: 1500,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      // Normal shimmer animation - moves from left to right
      Animated.loop(
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        })
      ).start();
    }
  }, [reducedMotion, shimmerAnim]);

  // For reduced motion, use opacity pulse
  const opacity = reducedMotion
    ? shimmerAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0.1, 0.3],
      })
    : undefined;

  // For normal motion, create a moving shimmer effect
  const translateX = reducedMotion
    ? undefined
    : shimmerAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [-200, 200],
      });

  return (
    <View style={styles.container}>
      {children}
      <Animated.View
        style={[
          styles.shimmer,
          opacity && { opacity },
          translateX && { transform: [{ translateX }] },
        ]}
        accessibilityRole="none"
        accessibilityLabel=""
        importantForAccessibility="no"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
  },
  shimmer: {
    position: 'absolute',
    top: 0,
    left: '-50%',
    width: '50%',
    height: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
    ...(Platform.OS === 'web' && {
      background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.5), transparent)',
    }),
  },
});

