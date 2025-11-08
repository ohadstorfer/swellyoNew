import React, { useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Image,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, spacing, typography } from '../styles/theme';
import { Text } from './Text';

interface TravelExperienceLevel {
  id: number;
  title: string;
  subtitle: string;
  imageUrl: string;
}

const TRAVEL_LEVELS: TravelExperienceLevel[] = [
  {
    id: 0,
    title: 'New Nomad',
    subtitle: '0-3 surf trips',
    imageUrl: '/Travel levels/Travel 111.png',
  },
  {
    id: 1,
    title: 'Rising Voyager',
    subtitle: '4-9 surf trips',
    imageUrl: '/Travel levels/Travel 222.png',
  },
  {
    id: 2,
    title: 'Wave Hunter',
    subtitle: '10-19 surf trips',
    imageUrl: '/Travel levels/Travel 333.png',
  },
  {
    id: 3,
    title: 'Chicken Joe',
    subtitle: '20+ surf trips',
    imageUrl: '/Travel levels/Travel 444.png',
  },
];

interface TravelExperienceSliderProps {
  value: number;
  onValueChange: (value: number) => void;
  error?: string;
}

const BAR_WIDTH = 330;
const BAR_HEIGHT = 4;
const KNOB_SIZE = 28;

export const TravelExperienceSlider: React.FC<TravelExperienceSliderProps> = ({
  value,
  onValueChange,
  error,
}) => {
  // Ensure initial value is valid (not NaN)
  const safeInitialValue = isNaN(value) || value < 0 || value > 3 ? 0 : value;
  const initialLevel = Math.max(0, Math.min(3, Math.round(safeInitialValue)));
  
  const [currentLevel, setCurrentLevel] = useState<number>(initialLevel);
  
  const knobPosition = useRef(
    new Animated.Value((initialLevel / 3) * BAR_WIDTH)
  ).current;

  const imageOpacity = useRef(
    TRAVEL_LEVELS.map((_, index) => 
      new Animated.Value(index === initialLevel ? 1 : 0)
    )
  ).current;

  const updateLevel = React.useCallback((newLevel: number, shouldNotify: boolean = true) => {
    // Validate that newLevel is a valid number
    if (isNaN(newLevel) || newLevel < 0 || newLevel > 3) {
      console.warn('Invalid level in updateLevel:', newLevel);
      return;
    }
    
    const clampedLevel = Math.max(0, Math.min(3, Math.round(newLevel)));
    setCurrentLevel(clampedLevel);
    
    if (shouldNotify) {
      // Ensure we're passing a valid number to onValueChange
      const validLevel = isNaN(clampedLevel) ? 0 : clampedLevel;
      onValueChange(validLevel);
    }

    // Animate knob position
    Animated.spring(knobPosition, {
      toValue: (clampedLevel / 3) * BAR_WIDTH,
      useNativeDriver: false,
      tension: 50,
      friction: 7,
    }).start();

    // Animate image transitions
    // Note: useNativeDriver: false for opacity to avoid warnings in some Expo environments
    // Opacity animations are still performant without native driver
    TRAVEL_LEVELS.forEach((_, index) => {
      Animated.timing(imageOpacity[index], {
        toValue: index === clampedLevel ? 1 : 0,
        duration: 300,
        useNativeDriver: false,
      }).start();
    });
  }, [knobPosition, imageOpacity, onValueChange]);

  // Sync with external value changes
  React.useEffect(() => {
    // Validate value before using it
    if (isNaN(value) || value < 0 || value > 3) {
      console.warn('Invalid value prop in TravelExperienceSlider:', value);
      return;
    }
    
    const newLevel = Math.max(0, Math.min(3, Math.round(value)));
    if (newLevel !== currentLevel) {
      updateLevel(newLevel, false);
    }
  }, [value, currentLevel, updateLevel]);

  const handleBarPress = (event: any) => {
    let locationX: number | undefined;
    const nativeEvent = event.nativeEvent || {};
    
    // Handle different event structures for web vs native
    if (Platform.OS === 'web') {
      // On web, try to get locationX first, then fallback to clientX calculation
      if (typeof nativeEvent.locationX === 'number') {
        locationX = nativeEvent.locationX;
      } else if (nativeEvent.target) {
        // Calculate position relative to the element
        try {
          const rect = (nativeEvent.target as HTMLElement).getBoundingClientRect();
          if (nativeEvent.clientX !== undefined) {
            locationX = nativeEvent.clientX - rect.left;
          }
        } catch (e) {
          // If getBoundingClientRect fails, just return
          return;
        }
      }
    } else {
      // On native, use locationX from nativeEvent
      locationX = nativeEvent.locationX;
    }
    
    // Validate locationX and ensure it's a valid number
    if (locationX === undefined || locationX === null || isNaN(locationX)) {
      // Silently return if we can't determine the position
      return;
    }
    
    // Clamp locationX to valid range [0, BAR_WIDTH]
    const clampedX = Math.max(0, Math.min(BAR_WIDTH, locationX));
    
    // Calculate level (0-3) based on position
    const calculatedLevel = Math.round((clampedX / BAR_WIDTH) * 3);
    
    // Clamp level to valid range [0, 3]
    const newLevel = Math.max(0, Math.min(3, calculatedLevel));
    
    // Only update if the level is valid
    if (!isNaN(newLevel) && newLevel >= 0 && newLevel <= 3) {
      updateLevel(newLevel);
    }
  };

  // Ensure currentLevel is within bounds and get the level data
  const safeCurrentLevel = Math.max(0, Math.min(3, currentLevel));
  const currentLevelData = TRAVEL_LEVELS[safeCurrentLevel] || TRAVEL_LEVELS[0];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>What is your Travel Experience?</Text>

      {/* Images Container */}
      <View style={styles.imagesContainer}>
        {TRAVEL_LEVELS.map((level, index) => (
          <Animated.View
            key={level.id}
            style={[
              styles.imageWrapper,
              {
                opacity: imageOpacity[index],
                zIndex: index === safeCurrentLevel ? 10 : 1,
              },
            ]}
          >
            <Image
              source={{ uri: level.imageUrl }}
              style={styles.image}
              resizeMode="cover"
            />
          </Animated.View>
        ))}
      </View>

      {/* Level Info */}
      <View style={styles.levelInfo}>
        <Text style={styles.levelTitle}>{currentLevelData.title}</Text>
        <Text style={styles.levelSubtitle}>{currentLevelData.subtitle}</Text>
      </View>

      {/* Level Bar */}
      <View style={styles.barContainer}>
        <TouchableOpacity
          style={styles.barTouchable}
          onPress={handleBarPress}
          activeOpacity={1}
        >
          <View style={styles.barBackground}>
            <Animated.View
              style={[
                styles.barFill,
                {
                  width: knobPosition,
                },
              ]}
            >
              <LinearGradient
                colors={['#00A2B6', '#0788B0']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          </View>

          {/* Knob */}
          <Animated.View
            style={[
              styles.knob,
              {
                left: knobPosition.interpolate({
                  inputRange: [0, BAR_WIDTH],
                  outputRange: [-KNOB_SIZE / 2, BAR_WIDTH - KNOB_SIZE / 2],
                }),
              },
            ]}
          >
            <View style={styles.knobInner} />
          </Animated.View>
        </TouchableOpacity>
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
    ...typography.titleLarge,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 28.8,
    color: '#00040A',
    textAlign: 'center',
    marginBottom: spacing.xxxl,
    width: 350,
  },
  imagesContainer: {
    width: 311,
    height: 311,
    marginBottom: spacing.xl,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  imageWrapper: {
    position: 'absolute',
    width: 311,
    height: 311,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderRadius: 16,
    overflow: 'hidden',
  },
  image: {
    width: 311,
    height: 311,
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  levelInfo: {
    alignItems: 'center',
    marginBottom: spacing.lg,
    width: 351,
  },
  levelTitle: {
    ...typography.titleLarge,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 24,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  levelSubtitle: {
    fontFamily: Platform.OS === 'web' ? 'Poppins, sans-serif' : 'Poppins',
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 24,
    color: colors.textSecondary,
    textAlign: 'center',
    height: 25,
  },
  barContainer: {
    width: BAR_WIDTH,
    height: KNOB_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    position: 'relative',
  },
  barTouchable: {
    width: BAR_WIDTH,
    height: KNOB_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  barBackground: {
    width: BAR_WIDTH,
    height: BAR_HEIGHT,
    backgroundColor: '#E1E1E1',
    borderRadius: 8,
    overflow: 'hidden',
    position: 'absolute',
    top: (KNOB_SIZE - BAR_HEIGHT) / 2,
    left: 0,
    alignSelf: 'center',
  },
  barFill: {
    height: BAR_HEIGHT,
    borderRadius: 8,
    overflow: 'hidden',
  },
  knob: {
    position: 'absolute',
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    top: 0,
    left: 0,
  },
  knobInner: {
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  errorText: {
    ...typography.body,
    color: '#FF6B6B',
    fontSize: 14,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
