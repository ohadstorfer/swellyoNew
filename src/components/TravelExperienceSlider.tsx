import React, { useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Image,
  Platform,
  PanResponder,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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
}

const BAR_WIDTH = 330;
const BAR_HEIGHT = 4;
const KNOB_SIZE = 28;

const MAX_TRIPS = 20; // Maximum value for the slider (20+)

export const TravelExperienceSlider: React.FC<TravelExperienceSliderProps> = ({
  value,
  onValueChange,
  error,
}) => {
  // Ensure initial value is valid (number of trips, 0-20+)
  const safeInitialValue = isNaN(value) || value < 0 ? 0 : Math.min(value, MAX_TRIPS);
  const initialTrips = Math.max(0, Math.round(safeInitialValue));
  const initialCategory = getCategoryFromTrips(initialTrips);
  
  const [currentTrips, setCurrentTrips] = useState<number>(initialTrips);
  
  const knobPosition = useRef(
    new Animated.Value((initialTrips / MAX_TRIPS) * BAR_WIDTH)
  ).current;

  const imageOpacity = useRef(
    TRAVEL_LEVELS.map((_, index) => 
      new Animated.Value(index === initialCategory ? 1 : 0)
    )
  ).current;

  // Track the initial position when dragging starts
  const dragStartPosition = useRef<number>((initialTrips / MAX_TRIPS) * BAR_WIDTH);
  const barContainerRef = useRef<View>(null);
  // Track the last trips value during drag to ensure we use the correct value on release
  const lastDragTrips = useRef<number>(initialTrips);
  // Track if any actual movement occurred during the pan gesture
  const didPanMove = useRef(false);

  const updateTrips = React.useCallback((newTrips: number, shouldNotify: boolean = true, skipAnimation: boolean = false) => {
    // Validate that newTrips is a valid number
    if (isNaN(newTrips) || newTrips < 0) {
      console.warn('Invalid trips in updateTrips:', newTrips);
      return;
    }
    
    const clampedTrips = Math.max(0, Math.min(MAX_TRIPS, Math.round(newTrips)));
    setCurrentTrips(clampedTrips);
    
    // Track the value we're setting internally
    lastInternalValue.current = clampedTrips;
    
    // Get the category for this number of trips
    const category = getCategoryFromTrips(clampedTrips);
    
    if (shouldNotify) {
      // Pass the actual number of trips to onValueChange
      const validTrips = isNaN(clampedTrips) ? 0 : clampedTrips;
      onValueChange(validTrips);
    }

    const targetPosition = (clampedTrips / MAX_TRIPS) * BAR_WIDTH;

    if (skipAnimation) {
      // For dragging, update position immediately without animation
      knobPosition.setValue(targetPosition);
    } else {
      // Animate knob position
      Animated.spring(knobPosition, {
        toValue: targetPosition,
        useNativeDriver: false,
        tension: 50,
        friction: 7,
      }).start();
    }

    // Animate image transitions based on category
    TRAVEL_LEVELS.forEach((_, index) => {
      Animated.timing(imageOpacity[index], {
        toValue: index === category ? 1 : 0,
        duration: 300,
        useNativeDriver: false,
      }).start();
    });
  }, [knobPosition, imageOpacity, onValueChange]);

  // Track if we're currently dragging to prevent sync conflicts
  // Using both ref (for PanResponder) and state (for UI updates)
  const isDraggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  // Track the last value we set internally to prevent sync conflicts
  const lastInternalValue = useRef<number>(initialTrips);
  // Track if we just finished dragging (to prevent immediate sync and press events)
  // Using both ref (for PanResponder) and state (for TouchableOpacity disabled prop)
  const justFinishedDraggingRef = useRef(false);
  const [justFinishedDragging, setJustFinishedDragging] = useState(false);
  
  // Sync refs with state so PanResponder can access them
  React.useEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);
  
  React.useEffect(() => {
    justFinishedDraggingRef.current = justFinishedDragging;
  }, [justFinishedDragging]);

  // Sync with external value changes (but not while dragging or immediately after)
  React.useEffect(() => {
    if (isDraggingRef.current) {
      return; // Don't sync while user is dragging
    }
    
    // If we just finished dragging, check if the external value matches what we set
    if (justFinishedDragging) {
      const roundedValue = Math.max(0, Math.min(MAX_TRIPS, Math.round(value)));
      // If the external value matches what we just set, ignore it (it's from our own update)
      if (roundedValue === lastInternalValue.current) {
        setJustFinishedDragging(false); // Reset flag
        return;
      }
      // Otherwise, wait a bit before syncing to avoid race conditions
      const timeoutId = setTimeout(() => {
        setJustFinishedDragging(false);
      }, 100);
      return () => clearTimeout(timeoutId);
    }
    
    // Validate value before using it (value is now number of trips, 0-20+)
    if (isNaN(value) || value < 0) {
      console.warn('Invalid value prop in TravelExperienceSlider:', value);
      return;
    }
    
    const newTrips = Math.max(0, Math.min(MAX_TRIPS, Math.round(value)));
    // Only sync if the value is actually different and not from our own update
    if (newTrips !== currentTrips && newTrips !== lastInternalValue.current) {
      updateTrips(newTrips, false);
    }
  }, [value, currentTrips, updateTrips]);

  const handleBarPress = (event: any) => {
    // Prevent bar press from firing immediately after drag release
    // This happens when user releases mouse/pointer while still over the slider
    if (justFinishedDraggingRef.current || isDraggingRef.current) {
      return;
    }
    
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
    
    // Calculate number of trips (0-100) based on position
    const calculatedTrips = Math.round((clampedX / BAR_WIDTH) * MAX_TRIPS);
    
    // Clamp trips to valid range [0, MAX_TRIPS]
    const newTrips = Math.max(0, Math.min(MAX_TRIPS, calculatedTrips));
    
    // Only update if the trips value is valid
    if (!isNaN(newTrips) && newTrips >= 0 && newTrips <= MAX_TRIPS) {
      updateTrips(newTrips);
    }
  };

  // PanResponder for drag functionality
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: (evt) => {
        // Mark that we're dragging
        isDraggingRef.current = true;
        setIsDragging(true);
        // Reset movement tracking
        didPanMove.current = false;
        // Store the current position when drag starts
        knobPosition.stopAnimation((value) => {
          dragStartPosition.current = value;
        });
        // Initialize the tracked trips value to current value
        lastDragTrips.current = currentTrips;
      },
      onPanResponderMove: (evt, gestureState) => {
        // Mark that actual movement occurred
        if (Math.abs(gestureState.dx) > 2 || Math.abs(gestureState.dy) > 2) {
          didPanMove.current = true;
        }
        
        // Calculate new position based on drag
        let newPosition: number;
        
        if (Platform.OS === 'web') {
          // On web, calculate position relative to the bar container
          if (barContainerRef.current) {
            try {
              const node = barContainerRef.current as any;
              if (node && node.getBoundingClientRect) {
                const rect = node.getBoundingClientRect();
                const nativeEvent = evt.nativeEvent as any;
                const clientX = nativeEvent.clientX || nativeEvent.touches?.[0]?.clientX;
                if (clientX !== undefined) {
                  newPosition = clientX - rect.left;
                } else {
                  newPosition = dragStartPosition.current + gestureState.dx;
                }
              } else {
                newPosition = dragStartPosition.current + gestureState.dx;
              }
            } catch (e) {
              newPosition = dragStartPosition.current + gestureState.dx;
            }
          } else {
            newPosition = dragStartPosition.current + gestureState.dx;
          }
        } else {
          // On native, use dx directly
          newPosition = dragStartPosition.current + gestureState.dx;
        }
        
        // Clamp position to valid range [0, BAR_WIDTH]
        const clampedPosition = Math.max(0, Math.min(BAR_WIDTH, newPosition));
        
        // Calculate trips from position
        const calculatedTrips = Math.round((clampedPosition / BAR_WIDTH) * MAX_TRIPS);
        const newTrips = Math.max(0, Math.min(MAX_TRIPS, calculatedTrips));
        
        // Update immediately during drag (skip animation)
        lastDragTrips.current = newTrips; // Track the value during drag
        updateTrips(newTrips, true, true);
      },
      onPanResponderRelease: () => {
        // Use the last tracked trips value from the drag
        // This ensures we use the exact value where the user released
        const finalTrips = lastDragTrips.current;
        
        // Mark that dragging has ended
        isDraggingRef.current = false;
        setIsDragging(false);
        
        // If actual movement occurred, prevent press events
        if (didPanMove.current) {
          justFinishedDraggingRef.current = true;
          setJustFinishedDragging(true);
          // Reset the flag after a delay to allow normal taps again
          setTimeout(() => {
            justFinishedDraggingRef.current = false;
            setJustFinishedDragging(false);
          }, 300); // Longer delay if actual drag occurred
        }
        
        // Update to final position
        updateTrips(finalTrips, true, false); // Animate to final position
      },
    })
  ).current;

  // Get the category based on current number of trips
  const currentCategory = getCategoryFromTrips(currentTrips);
  const currentLevelData = TRAVEL_LEVELS[currentCategory] || TRAVEL_LEVELS[0];

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
                zIndex: index === currentCategory ? 10 : 1,
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
        <Text style={styles.levelSubtitle}>{formatTrips(currentTrips)}</Text>
      </View>

      {/* Level Bar */}
      <View 
        ref={barContainerRef}
        style={styles.barContainer}
      >
        <View style={styles.barTouchable}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            onPress={handleBarPress}
            activeOpacity={1}
            disabled={isDragging || justFinishedDragging}
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
          </TouchableOpacity>

          {/* Knob - Draggable (outside TouchableOpacity, always receives events) */}
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
            {...panResponder.panHandlers}
          >
            <View style={styles.knobInner} />
          </Animated.View>
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
