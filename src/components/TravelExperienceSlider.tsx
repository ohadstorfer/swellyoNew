import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  Image,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Slider from '@react-native-community/slider';
import { colors, spacing, typography } from '../styles/theme';
import { Text } from './Text';
import { getImageUrl } from '../services/media/imageService';

interface TravelExperienceLevel {
  id: number;
  title: string;
  subtitle: string;
  imageUrl: string;
}

// Helper to get travel level image URL with proper platform handling
const getTravelLevelImageUrl = (path: string): string => {
  return getImageUrl(path);
};

const TRAVEL_LEVELS: TravelExperienceLevel[] = [
  {
    id: 0,
    title: 'New Nomad',
    subtitle: '0-3 surf trips',
    imageUrl: getTravelLevelImageUrl('/Travel levels/Travel 111.png'),
  },
  {
    id: 1,
    title: 'Rising Voyager',
    subtitle: '4-9 surf trips',
    imageUrl: getTravelLevelImageUrl('/Travel levels/Travel 222.png'),
  },
  {
    id: 2,
    title: 'Wave Hunter',
    subtitle: '10-19 surf trips',
    imageUrl: getTravelLevelImageUrl('/Travel levels/Travel 333.png'),
  },
  {
    id: 3,
    title: 'Chicken Joe',
    subtitle: '20+ surf trips',
    imageUrl: getTravelLevelImageUrl('/Travel levels/Travel 444.png'),
  },
];

// Helper function to map number of trips to category level (0-3)
const getCategoryFromTrips = (trips: number): number => {
  if (trips <= 3) return 0; // New Nomad
  if (trips <= 9) return 1; // Rising Voyager
  if (trips <= 19) return 2; // Wave Hunter
  return 3; // Chicken Joe (20+)
};

// Helper function to format trips display
const formatTrips = (trips: number): string => {
  if (trips === 0) return '0 trips';
  if (trips === 1) return '1 trip';
  if (trips >= 20) return '20+ trips';
  return `${trips} trips`;
};

interface TravelExperienceSliderProps {
  value: number;
  onValueChange: (value: number) => void;
  error?: string;
  availableHeight?: number; // Available space for content to dynamically size
}

const BAR_WIDTH = 330;
const BAR_HEIGHT = 4;
const KNOB_SIZE = 28;

const MAX_TRIPS = 20; // Maximum value for the slider (20+)

export const TravelExperienceSlider: React.FC<TravelExperienceSliderProps> = ({
  value,
  onValueChange,
  error,
  availableHeight,
}) => {
  // Ensure initial value is valid (number of trips, 0-20+)
  const safeInitialValue = isNaN(value) || value < 0 ? 0 : Math.min(value, MAX_TRIPS);
  const initialTrips = Math.max(0, Math.round(safeInitialValue));
  const initialCategory = getCategoryFromTrips(initialTrips);
  
  const [currentTrips, setCurrentTrips] = useState<number>(initialTrips);

  const imageOpacity = useRef(
    TRAVEL_LEVELS.map((_, index) => 
      new Animated.Value(index === initialCategory ? 1 : 0)
    )
  ).current;

  // Update trips and animate images
  const updateTrips = React.useCallback((newTrips: number) => {
    // Validate that newTrips is a valid number
    if (isNaN(newTrips) || newTrips < 0) {
      console.warn('Invalid trips in updateTrips:', newTrips);
      return;
    }
    
    const clampedTrips = Math.max(0, Math.min(MAX_TRIPS, Math.round(newTrips)));
    setCurrentTrips(clampedTrips);
    
    // Get the category for this number of trips
    const category = getCategoryFromTrips(clampedTrips);
    
    // Pass the actual number of trips to onValueChange
    const validTrips = isNaN(clampedTrips) ? 0 : clampedTrips;
    onValueChange(validTrips);

    // Animate image transitions based on category
    TRAVEL_LEVELS.forEach((_, index) => {
      Animated.timing(imageOpacity[index], {
        toValue: index === category ? 1 : 0,
        duration: 300,
        useNativeDriver: false,
      }).start();
    });
  }, [imageOpacity, onValueChange]);

  // Sync with external value changes
  useEffect(() => {
    // Validate value before using it (value is now number of trips, 0-20+)
    if (isNaN(value) || value < 0) {
      console.warn('Invalid value prop in TravelExperienceSlider:', value);
      return;
    }
    
    const newTrips = Math.max(0, Math.min(MAX_TRIPS, Math.round(value)));
    // Only sync if the value is actually different
    if (newTrips !== currentTrips) {
      setCurrentTrips(newTrips);
      
      // Update image opacity without triggering onValueChange
      const category = getCategoryFromTrips(newTrips);
      TRAVEL_LEVELS.forEach((_, index) => {
        Animated.timing(imageOpacity[index], {
          toValue: index === category ? 1 : 0,
          duration: 300,
          useNativeDriver: false,
        }).start();
      });
    }
  }, [value, currentTrips, imageOpacity]);

  const handleSliderChange = (newValue: number) => {
    updateTrips(newValue);
  };

  // Get the category based on current number of trips
  const currentCategory = getCategoryFromTrips(currentTrips);
  const currentLevelData = TRAVEL_LEVELS[currentCategory] || TRAVEL_LEVELS[0];

  // Calculate dynamic sizes based on available height
  const calculateDynamicSizes = () => {
    if (!availableHeight || availableHeight <= 0) {
      // Default sizes if no available height provided
      return {
        titleFontSize: 24,
        titleMarginBottom: spacing.xxxl,
        imageSize: 311,
        imageMarginBottom: spacing.xl,
        levelInfoMarginBottom: spacing.lg,
        levelTitleFontSize: 16,
        levelSubtitleFontSize: 16,
      };
    }

    // Reserve space for bar (KNOB_SIZE + margin)
    const barHeight = 28 + spacing.md;
    
    // Calculate available space for title, images, and level info
    const availableForContent = availableHeight - barHeight - spacing.md; // spacing.md for error text if shown
    
    // Allocate space proportionally:
    // Title: ~10% of available space
    // Images: ~70% of available space (main visual element - made bigger)
    // Level Info: ~20% of available space
    
    const titleSpace = availableForContent * 0.10;
    const imagesSpace = availableForContent * 0.70;
    const levelInfoSpace = availableForContent * 0.20;
    
    // Calculate font sizes and dimensions
    const titleFontSize = Math.max(18, Math.min(24, titleSpace * 0.8));
    const titleMarginBottom = Math.max(spacing.md, Math.min(spacing.xxxl, titleSpace * 0.3));
    
    // Image size should fit in imagesSpace, maintaining aspect ratio
    // Use more of the allocated space for the image itself (increased from 0.9 to 0.95)
    const imageSize = Math.max(200, Math.min(311, imagesSpace * 0.95));
    const imageMarginBottom = Math.max(spacing.sm, Math.min(spacing.xl, imagesSpace * 0.05));
    
    // Level info sizing
    const levelInfoMarginBottom = Math.max(spacing.sm, Math.min(spacing.lg, levelInfoSpace * 0.2));
    const levelTitleFontSize = Math.max(14, Math.min(16, levelInfoSpace * 0.3));
    const levelSubtitleFontSize = Math.max(14, Math.min(16, levelInfoSpace * 0.3));
    
    return {
      titleFontSize,
      titleMarginBottom,
      imageSize,
      imageMarginBottom,
      levelInfoMarginBottom,
      levelTitleFontSize,
      levelSubtitleFontSize,
    };
  };

  const dynamicSizes = calculateDynamicSizes();

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { 
        fontSize: dynamicSizes.titleFontSize, 
        lineHeight: dynamicSizes.titleFontSize * 1.2,
        marginBottom: dynamicSizes.titleMarginBottom 
      }]}>What is your Travel Experience?</Text>

      {/* Images Container */}
      <View style={[styles.imagesContainer, {
        width: dynamicSizes.imageSize,
        height: dynamicSizes.imageSize,
        marginBottom: dynamicSizes.imageMarginBottom,
      }]}>
        {TRAVEL_LEVELS.map((level, index) => (
          <Animated.View
            key={level.id}
            style={[
              styles.imageWrapper,
              {
                width: dynamicSizes.imageSize,
                height: dynamicSizes.imageSize,
                opacity: imageOpacity[index],
                zIndex: index === currentCategory ? 10 : 1,
              },
            ]}
          >
            <Image
              source={{ uri: level.imageUrl }}
              style={[styles.image, {
                width: dynamicSizes.imageSize,
                height: dynamicSizes.imageSize,
              }]}
              resizeMode="cover"
            />
          </Animated.View>
        ))}
      </View>

      {/* Level Info */}
      <View style={[styles.levelInfo, { marginBottom: dynamicSizes.levelInfoMarginBottom }]}>
        <Text style={[styles.levelTitle, { fontSize: dynamicSizes.levelTitleFontSize }]}>
          {currentLevelData.title}
        </Text>
        <Text style={[styles.levelSubtitle, { fontSize: dynamicSizes.levelSubtitleFontSize }]}>
          {formatTrips(currentTrips)}
        </Text>
      </View>

      {/* Level Bar - Using @react-native-community/slider */}
      <View style={styles.barContainer}>
        <View style={styles.sliderWrapper}>
          {/* Custom track background */}
          <View style={styles.trackBackground} />
          
          {/* Gradient fill overlay */}
          <View style={styles.trackFillContainer}>
            <View 
              style={[
                styles.trackFill,
                {
                  width: `${(currentTrips / MAX_TRIPS) * 100}%`,
                },
              ]}
            >
              <LinearGradient
                colors={['#00A2B6', '#0788B0']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
            </View>
          </View>
          
          {/* Slider component */}
          <Slider
            value={currentTrips}
            onValueChange={handleSliderChange}
            minimumValue={0}
            maximumValue={MAX_TRIPS}
            step={1}
            style={styles.slider}
            minimumTrackTintColor="transparent"
            maximumTrackTintColor="transparent"
            thumbTintColor="#FFFFFF"
          />
        </View>
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: spacing.lg,
  },
  title: {
    // fontSize, lineHeight, and marginBottom are set dynamically via inline style
    ...typography.titleLarge,
    fontWeight: '700',
    color: '#00040A',
    textAlign: 'center',
    maxWidth: 350,
    width: '100%',
  },
  imagesContainer: {
    // width, height, and marginBottom are set dynamically via inline style
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  imageWrapper: {
    // width and height are set dynamically via inline style
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderRadius: 16,
    overflow: 'hidden',
  },
  image: {
    // width and height are set dynamically via inline style
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  levelInfo: {
    alignItems: 'center',
    // marginBottom is set dynamically via inline style
    maxWidth: 351,
    width: '100%',
  },
  levelTitle: {
    // fontSize is set dynamically via inline style
    ...typography.titleLarge,
    fontWeight: '700',
    lineHeight: 24,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  levelSubtitle: {
    // fontSize is set dynamically via inline style
    fontFamily: Platform.OS === 'web' ? 'Poppins, sans-serif' : 'Poppins',
    fontWeight: '400',
    lineHeight: 24,
    color: colors.textSecondary,
    textAlign: 'center',
    minHeight: 24,
  },
  barContainer: {
    width: BAR_WIDTH,
    height: KNOB_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    position: 'relative',
  },
  sliderWrapper: {
    width: BAR_WIDTH,
    height: KNOB_SIZE,
    position: 'relative',
    justifyContent: 'center',
  },
  trackBackground: {
    position: 'absolute',
    width: BAR_WIDTH,
    height: BAR_HEIGHT,
    backgroundColor: '#E1E1E1',
    borderRadius: 8,
    top: (KNOB_SIZE - BAR_HEIGHT) / 2,
    left: 0,
    zIndex: 0,
  },
  trackFillContainer: {
    position: 'absolute',
    width: BAR_WIDTH,
    height: BAR_HEIGHT,
    top: (KNOB_SIZE - BAR_HEIGHT) / 2,
    left: 0,
    overflow: 'hidden',
    borderRadius: 8,
    zIndex: 1,
  },
  trackFill: {
    height: BAR_HEIGHT,
    borderRadius: 8,
    overflow: 'hidden',
  },
  slider: {
    width: BAR_WIDTH,
    height: KNOB_SIZE,
    zIndex: 2,
  },
  errorText: {
    ...typography.body,
    color: '#FF6B6B',
    fontSize: 14,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
