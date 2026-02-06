import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Platform,
  Dimensions,
  Image,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from './Text';
import { colors, spacing, typography, borderRadius } from '../styles/theme';
import { getCountryFlag } from '../utils/countryFlags';

interface DestinationInputCardProps {
  destination: string;
  onDataChange: (data: {
    areas: string[];
    timeInDays: number;
    timeInText: string;
  }) => void;
  currentIndex?: number;
  totalCount?: number;
  onPrevious?: () => void;
  onNext?: () => void;
  isReadOnly?: boolean;
  initialAreas?: string;
  initialTimeValue?: string;
  initialTimeUnit?: TimeUnit;
}

type TimeUnit = 'days' | 'weeks' | 'months' | 'years';

export const DestinationInputCard: React.FC<DestinationInputCardProps> = ({
  destination,
  onDataChange,
  currentIndex = 0,
  totalCount = 1,
  onPrevious,
  onNext,
  isReadOnly = false,
  initialAreas,
  initialTimeValue,
  initialTimeUnit,
}) => {
  const [areas, setAreas] = useState(initialAreas || '');
  const [timeValue, setTimeValue] = useState(initialTimeValue || '2');
  const [timeUnit, setTimeUnit] = useState<TimeUnit>(initialTimeUnit || 'weeks');
  const [isUnitPickerVisible, setIsUnitPickerVisible] = useState(false);
  const [unitButtonLayout, setUnitButtonLayout] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const unitButtonRef = useRef<View>(null);
  const onDataChangeRef = useRef(onDataChange);

  // Update ref when onDataChange changes
  useEffect(() => {
    onDataChangeRef.current = onDataChange;
  }, [onDataChange]);

  // Calculate time data whenever values change
  useEffect(() => {
    const numericValue = parseFloat(timeValue);
    if (isNaN(numericValue) || numericValue <= 0) {
      return;
    }

    let timeInDays = 0;
    let timeInText = '';

    switch (timeUnit) {
      case 'days':
        timeInDays = Math.round(numericValue);
        timeInText = numericValue === 1 ? '1 day' : `${numericValue} days`;
        break;
      case 'weeks':
        timeInDays = Math.round(numericValue * 7);
        timeInText = numericValue === 1 ? '1 week' : `${numericValue} weeks`;
        break;
      case 'months':
        timeInDays = Math.round(numericValue * 30);
        if (numericValue % 1 === 0.5) {
          timeInText = `${Math.floor(numericValue)}.5 months`;
        } else {
          timeInText = numericValue === 1 ? '1 month' : `${numericValue} months`;
        }
        break;
      case 'years':
        timeInDays = Math.round(numericValue * 365);
        if (numericValue % 1 === 0.5) {
          timeInText = `${Math.floor(numericValue)}.5 years`;
        } else {
          timeInText = numericValue === 1 ? '1 year' : `${numericValue} years`;
        }
        break;
    }

    // Parse areas
    const areasArray = areas
      .split(/[,\n]/)
      .map(area => area.trim())
      .filter(area => area.length > 0);

    // Don't call onDataChange in read-only mode
    if (!isReadOnly) {
      onDataChangeRef.current({
        areas: areasArray,
        timeInDays,
        timeInText,
      });
    }
  }, [areas, timeValue, timeUnit, isReadOnly]);

  const handleTimeValueChange = (text: string) => {
    // Allow only numbers and a single decimal point
    let cleanedText = text.replace(/[^0-9.]/g, '');
    const parts = cleanedText.split('.');
    
    if (parts.length > 2) {
      // More than one decimal point, keep only the first part and first decimal
      cleanedText = `${parts[0]}.${parts[1]}`;
    }
    
    // If there's a decimal point with digits after it, only allow ".5"
    if (cleanedText.includes('.')) {
      const [integerPart, decimalPart] = cleanedText.split('.');
      if (decimalPart && decimalPart.length > 0) {
        // If user types anything after decimal, replace with "5"
        // Examples: "2.8" -> "2.5", "2.832" -> "2.5", "2.55" -> "2.5"
        cleanedText = `${integerPart}.5`;
      }
      // If decimalPart is empty (user just typed "."), allow it temporarily
    }
    
    setTimeValue(cleanedText);
  };

  const handleUnitSelect = (unit: TimeUnit) => {
    setTimeUnit(unit);
    setIsUnitPickerVisible(false);
  };

  const handleUnitButtonPress = () => {
    if (unitButtonRef.current) {
      unitButtonRef.current.measure((x, y, width, height, pageX, pageY) => {
        setUnitButtonLayout({ x: pageX, y: pageY, width, height });
        setIsUnitPickerVisible(!isUnitPickerVisible);
      });
    } else {
      setIsUnitPickerVisible(!isUnitPickerVisible);
    }
  };

  // Close unit picker when clicking outside
  useEffect(() => {
    if (!isUnitPickerVisible) {
      return;
    }

    const handlePressOutside = () => {
      setIsUnitPickerVisible(false);
    };

    // Add a small delay to avoid immediate close
    const timer = setTimeout(() => {
      // This will be handled by the overlay
    }, 100);

    return () => clearTimeout(timer);
  }, [isUnitPickerVisible]);

  const flagUrl = getCountryFlag(destination);
  const screenWidth = Dimensions.get('window').width;
  const cardWidth = Math.min(328, screenWidth - 62); // 328px from Figma, with padding

  return (
    <View style={[styles.container, { width: cardWidth }]}>
      <LinearGradient
        colors={[
          'rgba(5, 188, 211, 0.5)',
          'rgba(219, 205, 188, 0.5)',
          'rgba(232, 223, 209, 0.5)',
          'rgba(246, 243, 237, 0.5)',
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradientWrapper}
      >
        <View style={styles.card}>
          {/* Header with flag and destination name */}
          <View style={styles.header}>
            {flagUrl ? (
              <Image 
                source={{ uri: flagUrl }} 
                style={styles.flagImage}
                resizeMode="contain"
              />
            ) : (
              <Text style={styles.flagEmoji}>🌊</Text>
            )}
            <Text style={styles.destinationName}>{destination}</Text>
          </View>

          {/* Input Fields */}
          <View style={styles.content}>
            {/* Areas Input */}
            <TouchableOpacity style={styles.inputContainer} activeOpacity={1} disabled={isReadOnly}>
              <TextInput
                style={[styles.textInput, isReadOnly && styles.inputReadOnly]}
                value={areas}
                onChangeText={setAreas}
                placeholder="🎯 City/town/surf spots..."
                placeholderTextColor="#A0A0A0"
                multiline={false}
                editable={!isReadOnly}
                {...(Platform.OS === 'web' && {
                  // @ts-ignore
                  style: [
                    styles.textInput,
                    isReadOnly && styles.inputReadOnly,
                    {
                      outline: 'none',
                      outlineWidth: 0,
                      outlineStyle: 'none',
                      outlineColor: 'transparent',
                      borderWidth: 0,
                      borderColor: 'transparent',
                    },
                  ],
                })}
              />
            </TouchableOpacity>

            {/* Time Input */}
            <View style={styles.timeInputContainer}>
              <View style={styles.timeInputRow}>
                <View style={styles.timeInputBox}>
                  <TextInput
                    style={[styles.timeInput, isReadOnly && styles.inputReadOnly]}
                    value={timeValue}
                    onChangeText={handleTimeValueChange}
                    placeholder="🕝 Time spent"
                    placeholderTextColor="#A0A0A0"
                    keyboardType="numeric"
                    editable={!isReadOnly}
                    {...(Platform.OS === 'web' && {
                      // @ts-ignore
                      style: [
                        styles.timeInput,
                        isReadOnly && styles.inputReadOnly,
                        {
                          outline: 'none',
                          outlineWidth: 0,
                          outlineStyle: 'none',
                          outlineColor: 'transparent',
                          borderWidth: 0,
                          borderColor: 'transparent',
                        },
                      ],
                    })}
                  />
                </View>
                <View style={styles.unitSelectorContainer}>
                  <TouchableOpacity
                    ref={unitButtonRef}
                    style={[styles.unitButton, isReadOnly && styles.unitButtonReadOnly]}
                    onPress={handleUnitButtonPress}
                    activeOpacity={0.7}
                    disabled={isReadOnly}
                  >
                    <Text style={[styles.unitText, isReadOnly && styles.unitTextReadOnly]}>
                      {timeUnit.charAt(0).toUpperCase() + timeUnit.slice(1)}
                    </Text>
                    {!isReadOnly && <Ionicons name="chevron-down" size={16} color={colors.textPrimary} />}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>

          {/* Navigation Controls */}
          <View style={styles.navigationContainer}>
            {currentIndex > 0 && onPrevious ? (
              <TouchableOpacity
                style={[styles.navArrow, isReadOnly && styles.navArrowReadOnly]}
                onPress={onPrevious}
                activeOpacity={0.7}
              >
                <Ionicons name="chevron-back" size={24} color={isReadOnly ? '#CCCCCC' : colors.textPrimary} />
              </TouchableOpacity>
            ) : (
              <View style={styles.navArrowPlaceholder} />
            )}

            <View style={styles.dotsContainer}>
              {Array.from({ length: totalCount }).map((_, index) => (
                <View
                  key={index}
                  style={[
                    styles.dot,
                    index === currentIndex ? styles.dotActive : styles.dotInactive,
                  ]}
                />
              ))}
            </View>

            {currentIndex < totalCount - 1 && onNext ? (
              <TouchableOpacity
                style={[styles.navArrow, isReadOnly && styles.navArrowReadOnly]}
                onPress={onNext}
                activeOpacity={0.7}
              >
                <Ionicons name="chevron-forward" size={24} color={isReadOnly ? '#CCCCCC' : colors.textPrimary} />
              </TouchableOpacity>
            ) : (
              <View style={styles.navArrowPlaceholder} />
            )}
          </View>
        </View>
      </LinearGradient>

      {/* Unit Picker Modal - Rendered outside card hierarchy */}
      <Modal
        visible={isUnitPickerVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsUnitPickerVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setIsUnitPickerVisible(false)}
        >
          <View
            style={[
              styles.unitOptionsContainerPortal,
              unitButtonLayout && {
                position: 'absolute',
                top: unitButtonLayout.y + unitButtonLayout.height + 8,
                left: unitButtonLayout.x,
                width: unitButtonLayout.width,
              },
            ]}
            onStartShouldSetResponder={() => true}
          >
            <TouchableOpacity
              activeOpacity={1}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.unitOptionsGrid}>
                <TouchableOpacity
                  style={[
                    styles.unitOptionGrid,
                    timeUnit === 'days' && styles.unitOptionGridSelected,
                  ]}
                  onPress={() => handleUnitSelect('days')}
                >
                  <Text
                    style={[
                      styles.unitOptionGridText,
                      timeUnit === 'days' && styles.unitOptionGridTextSelected,
                    ]}
                  >
                    Days
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.unitOptionGrid,
                    timeUnit === 'weeks' && styles.unitOptionGridSelected,
                  ]}
                  onPress={() => handleUnitSelect('weeks')}
                >
                  <Text
                    style={[
                      styles.unitOptionGridText,
                      timeUnit === 'weeks' && styles.unitOptionGridTextSelected,
                    ]}
                  >
                    Weeks
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.unitOptionGrid,
                    timeUnit === 'months' && styles.unitOptionGridSelected,
                  ]}
                  onPress={() => handleUnitSelect('months')}
                >
                  <Text
                    style={[
                      styles.unitOptionGridText,
                      timeUnit === 'months' && styles.unitOptionGridTextSelected,
                    ]}
                  >
                    Months
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.unitOptionGrid,
                    timeUnit === 'years' && styles.unitOptionGridSelected,
                  ]}
                  onPress={() => handleUnitSelect('years')}
                >
                  <Text
                    style={[
                      styles.unitOptionGridText,
                      timeUnit === 'years' && styles.unitOptionGridTextSelected,
                    ]}
                  >
                    Years
                  </Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 8,
    overflow: 'visible',
  },
  gradientWrapper: {
    borderRadius: 24,
    padding: 8,
    overflow: 'visible',
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    paddingBottom: 24,
    shadowColor: '#596E7C',
    shadowOffset: { width: 1, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 7,
    elevation: 5,
    overflow: 'visible',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
  },
  flagEmoji: {
    fontSize: 24,
    lineHeight: 22,
  },
  flagImage: {
    width: 24,
    height: 24,
  },
  destinationName: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    color: '#333333',
    lineHeight: 24,
  },
  content: {
    gap: 16,
    paddingHorizontal: 16,
    overflow: 'visible',
  },
  inputContainer: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#CFCFCF',
    borderRadius: 12,
    height: 56,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    ...(Platform.OS === 'web' && {
      outline: 'none',
      outlineWidth: 0,
      outlineStyle: 'none',
      outlineColor: 'transparent',
      // @ts-ignore
      '&:focus': {
        outline: 'none',
        borderColor: '#CFCFCF',
      },
      '&:focus-within': {
        outline: 'none',
        borderColor: '#CFCFCF',
      },
    } as any),
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    fontWeight: '400',
    color: colors.textPrimary,
    lineHeight: 22,
    ...(Platform.OS === 'web' && {
      outline: 'none',
      outlineWidth: 0,
      outlineStyle: 'none',
      outlineColor: 'transparent',
      borderWidth: 0,
      borderColor: 'transparent',
      // @ts-ignore
      '&:focus': {
        outline: 'none',
        borderWidth: 0,
        borderColor: 'transparent',
      },
    } as any),
  },
  timeInputContainer: {
    width: '100%',
    overflow: 'visible',
  },
  timeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  timeInputBox: {
    flex: 1,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#CFCFCF',
    borderRadius: 12,
    height: 56,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    ...(Platform.OS === 'web' && {
      outline: 'none',
      outlineWidth: 0,
      outlineStyle: 'none',
      outlineColor: 'transparent',
      // @ts-ignore
      '&:focus': {
        outline: 'none',
        borderColor: '#CFCFCF',
      },
      '&:focus-within': {
        outline: 'none',
        borderColor: '#CFCFCF',
      },
    } as any),
  },
  timeInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    fontWeight: '400',
    color: colors.textPrimary,
    lineHeight: 22,
    ...(Platform.OS === 'web' && {
      outline: 'none',
      outlineWidth: 0,
      outlineStyle: 'none',
      outlineColor: 'transparent',
      borderWidth: 0,
      borderColor: 'transparent',
      // @ts-ignore
      '&:focus': {
        outline: 'none',
        borderWidth: 0,
        borderColor: 'transparent',
      },
    } as any),
  },
  unitSelectorContainer: {
    flex: 1,
    position: 'relative',
  },
  unitButton: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#CFCFCF',
    borderRadius: 12,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    ...(Platform.OS === 'web' && {
      outline: 'none',
      outlineWidth: 0,
      outlineStyle: 'none',
      outlineColor: 'transparent',
      // @ts-ignore
      '&:focus': {
        outline: 'none',
        borderColor: '#CFCFCF',
      },
    } as any),
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0)',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
  },
  unitOptionsContainerPortal: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#CFCFCF',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    zIndex: 9001,
    padding: 8,
  },
  unitOptionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  unitOptionGrid: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitOptionGridSelected: {
    backgroundColor: '#0788B0',
    borderColor: '#0788B0',
  },
  unitOptionGridText: {
    fontSize: 14,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  unitOptionGridTextSelected: {
    color: colors.white,
    fontWeight: '600',
  },
  unitText: {
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    fontWeight: '400',
    color: colors.textPrimary,
    lineHeight: 22,
  },
  navigationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 48,
  },
  navArrow: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navArrowPlaceholder: {
    width: 24,
    height: 24,
  },
  dotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flex: 1,
  },
  dot: {
    borderRadius: 4,
  },
  dotActive: {
    width: 24,
    height: 8,
    backgroundColor: '#0788B0',
  },
  dotInactive: {
    width: 8,
    height: 8,
    backgroundColor: '#CFCFCF',
  },
  inputReadOnly: {
    opacity: 0.6,
    backgroundColor: '#F5F5F5',
  },
  unitButtonReadOnly: {
    opacity: 0.6,
    backgroundColor: '#F5F5F5',
  },
  unitTextReadOnly: {
    color: '#999999',
  },
  navArrowReadOnly: {
    opacity: 0.5,
  },
});
