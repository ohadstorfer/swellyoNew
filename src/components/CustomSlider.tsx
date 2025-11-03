import React, { useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  TouchableWithoutFeedback,
} from 'react-native';
import { PanGestureHandler, PanGestureHandlerGestureEvent, State } from 'react-native-gesture-handler';
import { colors, spacing } from '../styles/theme';

interface SliderOption {
  value: string;
  label: string;
  description: string;
}

interface CustomSliderProps {
  options: SliderOption[];
  value: string;
  onValueChange: (value: string) => void;
}

export const CustomSlider: React.FC<CustomSliderProps> = ({
  options,
  value,
  onValueChange,
}) => {
  const [sliderWidth, setSliderWidth] = useState(0);
  const currentIndex = options.findIndex(option => option.value === value);
  const progress = (currentIndex / (options.length - 1)) * 100;
  
  const translateX = useRef(new Animated.Value(0)).current;
  const lastTranslateX = useRef(0);
  const currentTranslateX = useRef(0);

  const handleGestureEvent = (event: PanGestureHandlerGestureEvent) => {
    const { translationX, state } = event.nativeEvent;
    
    if (state === State.BEGAN) {
      lastTranslateX.current = currentTranslateX.current;
    }
    
    if (state === State.ACTIVE) {
      // Calculate which level we're hovering over
      const optionWidth = sliderWidth / (options.length - 1);
      const currentPosition = lastTranslateX.current + translationX;
      const hoverIndex = Math.round(currentPosition / optionWidth);
      const clampedIndex = Math.max(0, Math.min(options.length - 1, hoverIndex));
      
      // Update the value immediately as user drags
      if (clampedIndex !== currentIndex) {
        onValueChange(options[clampedIndex].value);
      }
      
      // Move thumb to show current position
      const targetPosition = clampedIndex * optionWidth;
      translateX.setValue(targetPosition);
      currentTranslateX.current = targetPosition;
    }
    
    if (state === State.END) {
      // Ensure we're at the exact position for the selected level
      const optionWidth = sliderWidth / (options.length - 1);
      const targetIndex = Math.round(currentTranslateX.current / optionWidth);
      const clampedIndex = Math.max(0, Math.min(options.length - 1, targetIndex));
      
      // Snap to exact position
      const targetPosition = clampedIndex * optionWidth;
      translateX.setValue(targetPosition);
      currentTranslateX.current = targetPosition;
    }
  };

  const handleLayout = (event: any) => {
    const { width } = event.nativeEvent.layout;
    setSliderWidth(width);
    
    // Set initial position
    const optionWidth = width / (options.length - 1);
    const initialPosition = currentIndex * optionWidth;
    translateX.setValue(initialPosition);
    currentTranslateX.current = initialPosition; // Initialize currentTranslateX
  };

  const handleSliderTap = (event: any) => {
    console.log('Tap detected!', event.nativeEvent); // Debug log
    const { locationX } = event.nativeEvent;
    console.log('Location X:', locationX, 'Slider width:', sliderWidth); // Debug log
    
    if (sliderWidth === 0) return; // Don't process if width not set yet
    
    const optionWidth = sliderWidth / (options.length - 1);
    const targetIndex = Math.round(locationX / optionWidth);
    const clampedIndex = Math.max(0, Math.min(options.length - 1, targetIndex));
    
    console.log('Target index:', targetIndex, 'Clamped index:', clampedIndex); // Debug log
    
    // Update the value
    if (clampedIndex !== currentIndex) {
      console.log('Updating value to:', options[clampedIndex].value); // Debug log
      onValueChange(options[clampedIndex].value);
    }
    
    // Move thumb to the tapped position
    const targetPosition = clampedIndex * optionWidth;
    translateX.setValue(targetPosition);
    currentTranslateX.current = targetPosition;
  };

  return (
    <View style={styles.container}>
      {/* Slider Track */}
      <View style={styles.sliderContainer} onLayout={handleLayout}>
        <TouchableWithoutFeedback onPress={handleSliderTap}>
          <View style={styles.sliderTrack}>
            {/* Filled portion - shows progress */}
            <View
              style={[
                styles.progressFill,
                { width: `${progress}%` }
              ]}
            />
            
            {/* Slider thumb */}
            <Animated.View
              style={[
                styles.sliderThumb,
                {
                  transform: [{ translateX }],
                },
              ]}
            />
          </View>
        </TouchableWithoutFeedback>
        
        {/* Pan gesture handler for sliding */}
        <PanGestureHandler onGestureEvent={handleGestureEvent}>
          <Animated.View style={styles.gestureArea} />
        </PanGestureHandler>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: spacing.lg,
    alignItems: 'center',
    width: '100%',
  },
  sliderContainer: {
    marginBottom: spacing.md,
    width: '100%',
    height: 40,
    position: 'relative',
  },
  sliderTrack: {
    height: 12,
    width: '100%',
    backgroundColor: '#E0E0E0', // More visible gray
    borderRadius: 6,
    position: 'relative',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#FF6B9D', // More visible pink
    borderRadius: 6,
    position: 'absolute',
    left: 0,
    top: 0,
  },
  sliderThumb: {
    position: 'absolute',
    width: 24,
    height: 24,
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: colors.primary,
    top: -6,
    left: -12, // Center the thumb
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  gestureArea: {
    position: 'absolute',
    top: -20,
    left: 0,
    right: 0,
    bottom: -20,
    backgroundColor: 'transparent',
  },
  tapArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
  },
}); 