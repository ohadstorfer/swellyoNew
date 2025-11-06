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
    imageUrl: '/Travel levels/Travel 1.png',
  },
  {
    id: 1,
    title: 'Rising Voyager',
    subtitle: '4-9 surf trips',
    imageUrl: '/Travel levels/Travel 2.png',
  },
  {
    id: 2,
    title: 'Wave Hunter',
    subtitle: '10-19 surf trips',
    imageUrl: '/Travel levels/Travel 3.png',
  },
  {
    id: 3,
    title: 'Chicken Joe',
    subtitle: '20+ surf trips',
    imageUrl: '/Travel levels/Travel 4.png',
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
  const [currentLevel, setCurrentLevel] = useState<number>(
    Math.max(0, Math.min(3, Math.round(value)))
  );
  
  const knobPosition = useRef(
    new Animated.Value((Math.max(0, Math.min(3, Math.round(value))) / 3) * BAR_WIDTH)
  ).current;

  const imageOpacity = useRef(
    TRAVEL_LEVELS.map((_, index) => 
      new Animated.Value(index === Math.max(0, Math.min(3, Math.round(value))) ? 1 : 0)
    )
  ).current;

  const updateLevel = React.useCallback((newLevel: number, shouldNotify: boolean = true) => {
    if (newLevel < 0 || newLevel > 3) return;
    
    const clampedLevel = Math.max(0, Math.min(3, newLevel));
    setCurrentLevel(clampedLevel);
    
    if (shouldNotify) {
      onValueChange(clampedLevel);
    }

    // Animate knob position
    Animated.spring(knobPosition, {
      toValue: (clampedLevel / 3) * BAR_WIDTH,
      useNativeDriver: false,
      tension: 50,
      friction: 7,
    }).start();

    // Animate image transitions
    TRAVEL_LEVELS.forEach((_, index) => {
      Animated.timing(imageOpacity[index], {
        toValue: index === clampedLevel ? 1 : 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    });
  }, [knobPosition, imageOpacity, onValueChange]);

  // Sync with external value changes
  React.useEffect(() => {
    const newLevel = Math.max(0, Math.min(3, Math.round(value)));
    if (newLevel !== currentLevel) {
      updateLevel(newLevel, false);
    }
  }, [value, currentLevel, updateLevel]);

  const handleBarPress = (event: any) => {
    const { locationX } = event.nativeEvent;
    const newLevel = Math.round((locationX / BAR_WIDTH) * 3);
    updateLevel(newLevel);
  };

  const currentLevelData = TRAVEL_LEVELS[currentLevel];

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
                zIndex: index === currentLevel ? 10 : 1,
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
    position: 'relative',
  },
  barBackground: {
    width: BAR_WIDTH,
    height: BAR_HEIGHT,
    backgroundColor: '#E1E1E1',
    borderRadius: 8,
    overflow: 'hidden',
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
    top: (KNOB_SIZE - BAR_HEIGHT) / 2,
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
