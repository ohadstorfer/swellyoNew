import React, { useState, useEffect, useRef, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Image,
  ImageBackground,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { colors, spacing } from '../styles/theme';
import { getCountryFlag } from '../utils/countryFlags';
import { getDisplayLabelAndFlagKey } from '../utils/destinationDisplay';
import {
  getCountryImageFromStorage,
  getCountryImageFallback,
  getCountryImageFromPexels,
} from '../services/media/imageService';
import { MultiPlaceAutocompleteInput, type MultiPlaceAutocompleteInputRef } from './MultiPlaceAutocompleteInput';
import type { SwipeExcludeZoneRect } from './DestinationInputCard';
import { DestinationDurationInput } from './DestinationDurationInput';
import type { DurationTimeUnit } from '../utils/destinationDuration';
import { computeDurationParts } from '../utils/destinationDuration';

/** Country name (as shown in UI) to CLDR 2-letter region code for Places API bias. */
const COUNTRY_TO_REGION: Record<string, string> = {
  'USA': 'us',
  'United States': 'us',
  'Costa Rica': 'cr',
  'Nicaragua': 'ni',
  'Panama': 'pa',
  'El Salvador': 'sv',
  'Indonesia': 'id',
  'Sri Lanka': 'lk',
  'Philippines': 'ph',
  'Australia': 'au',
  'Mexico': 'mx',
  'Brazil': 'br',
  'Portugal': 'pt',
  'France': 'fr',
  'Spain': 'es',
  'South Africa': 'za',
  'Morocco': 'ma',
  'Israel': 'il',
  'Japan': 'jp',
  'New Zealand': 'nz',
  'Peru': 'pe',
  'Ecuador': 'ec',
  'Chile': 'cl',
};

interface DestinationInputCardCopyProps {
  destination: string;
  onDataChange: (data: {
    areas: string[];
    timeInDays: number;
    timeInText: string;
  }) => void;
  currentIndex?: number;
  totalCount?: number;
  onNext?: () => void;
  onSave?: () => void;
  saveDisabled?: boolean;
  isReadOnly?: boolean;
  initialAreas?: string;
  initialTimeValue?: string;
  initialTimeUnit?: DurationTimeUnit;
  onSwipeExcludeZonesLayout?: (
    index: number,
    zones: { timeUnit: SwipeExcludeZoneRect; areaInput: SwipeExcludeZoneRect }
  ) => void;
  isCurrentCard?: boolean;
  onSetParentScrollEnabled?: (enabled: boolean) => void;
  /** Called when a TextInput inside this card receives focus (native only). */
  onInputFocus?: () => void;
}

export interface DestinationInputCardCopyRef {
  focusAreaInput: () => void;
}

export const DestinationInputCardCopy = forwardRef<
  DestinationInputCardCopyRef,
  DestinationInputCardCopyProps
>(function DestinationInputCardCopy(
  {
    destination,
    onDataChange,
    currentIndex = 0,
    totalCount = 1,
    onNext,
    onSave,
    saveDisabled = false,
    isReadOnly = false,
    initialAreas,
    initialTimeValue,
    initialTimeUnit,
    onSwipeExcludeZonesLayout,
    isCurrentCard,
    onSetParentScrollEnabled,
  },
  ref
) {
  const initialPlaces = initialAreas
    ? initialAreas.split(/[,\n]/).map((a) => a.trim()).filter(Boolean)
    : [];
  const [places, setPlaces] = useState<string[]>(initialPlaces);
  const [timeValue, setTimeValue] = useState(initialTimeValue || '2');
  const [timeUnit, setTimeUnit] = useState<DurationTimeUnit>(initialTimeUnit || 'weeks');
  const placesInputRef = useRef<MultiPlaceAutocompleteInputRef>(null);
  const unitSelectorWrapperRef = useRef<View>(null);
  const areaInputZoneRef = useRef<View>(null);
  const onDataChangeRef = useRef(onDataChange);

  const doMeasureAndReport = useCallback(() => {
    if (!onSwipeExcludeZonesLayout || currentIndex == null) return;
    const idx = currentIndex;
    let timeRect: SwipeExcludeZoneRect | null = null;
    let areaRect: SwipeExcludeZoneRect | null = null;
    const tryReport = () => {
      if (timeRect && areaRect) {
        onSwipeExcludeZonesLayout(idx, { timeUnit: timeRect, areaInput: areaRect });
      }
    };
    unitSelectorWrapperRef.current?.measureInWindow?.((x, y, w, h) => {
      timeRect = { x, y, width: w, height: h };
      tryReport();
    });
    areaInputZoneRef.current?.measureInWindow?.((x, y, w, h) => {
      areaRect = { x, y, width: w, height: h };
      tryReport();
    });
  }, [onSwipeExcludeZonesLayout, currentIndex]);

  const reportExcludeZones = useCallback(() => {
    setTimeout(() => doMeasureAndReport(), 0);
  }, [doMeasureAndReport]);

  useEffect(() => {
    if (isCurrentCard) {
      const id = setTimeout(() => doMeasureAndReport(), 0);
      return () => clearTimeout(id);
    }
  }, [isCurrentCard, doMeasureAndReport]);

  const { displayLabel, flagKey } = useMemo(
    () => getDisplayLabelAndFlagKey(destination),
    [destination]
  );

  const regionCodes = useMemo(() => {
    if (flagKey === 'California' || flagKey === 'Hawaii') {
      return ['us'];
    }
    const code = COUNTRY_TO_REGION[destination];
    return code ? [code] : undefined;
  }, [destination, flagKey]);

  useImperativeHandle(ref, () => ({
    focusAreaInput: () => placesInputRef.current?.focus(),
  }), []);

  useEffect(() => {
    onDataChangeRef.current = onDataChange;
  }, [onDataChange]);

  useEffect(() => {
    const parts = computeDurationParts(timeValue, timeUnit);
    if (!parts || isReadOnly) return;
    onDataChangeRef.current({
      areas: places,
      timeInDays: parts.timeInDays,
      timeInText: parts.timeInText,
    });
  }, [places, timeValue, timeUnit, isReadOnly]);

  const [countryImageFailed, setCountryImageFailed] = useState(false);
  const [pexelsImageUrl, setPexelsImageUrl] = useState<string | null>(null);
  const bucketImageErrorHandledRef = useRef(false);
  const countryImageUrl = getCountryImageFromStorage(flagKey);
  const countryFlagUrl = getCountryFlag(flagKey);
  const handleBucketImageError = async () => {
    if (bucketImageErrorHandledRef.current) return;
    bucketImageErrorHandledRef.current = true;
    setCountryImageFailed(true);
    const url = await getCountryImageFromPexels(flagKey);
    if (url) setPexelsImageUrl(url);
  };
  const backgroundUri =
    (!countryImageFailed && countryImageUrl) || pexelsImageUrl
      ? (countryImageFailed ? pexelsImageUrl! : countryImageUrl!)
      : countryFlagUrl || getCountryImageFallback(flagKey);
  useEffect(() => {
    setCountryImageFailed(false);
    setPexelsImageUrl(null);
    bucketImageErrorHandledRef.current = false;
  }, [destination]);

  const screenWidth = Dimensions.get('window').width;
  const cardWidth = Math.min(328, screenWidth - 62);

  return (
    <View style={[styles.container, { width: cardWidth }]}>
      <View style={[styles.cardOuter, { width: cardWidth }]}>
        <View style={styles.flagCircleWrapper} pointerEvents="none">
          <View style={styles.flagCircle}>
            {countryFlagUrl ? (
              <Image source={{ uri: countryFlagUrl }} style={styles.flagCircleImage} resizeMode="cover" />
            ) : (
              <Text style={styles.flagEmoji}>🌊</Text>
            )}
          </View>
        </View>
        <View style={[styles.cardWrapper, { width: cardWidth }]}>
          <ImageBackground
            source={{ uri: backgroundUri }}
            style={styles.backgroundImage}
            resizeMode="cover"
            onError={handleBucketImageError}
          >
            <View style={styles.frostedOverlay} />
          </ImageBackground>
          <View style={styles.card}>
            <Text style={styles.destinationName}>{displayLabel}</Text>

            <View style={styles.contentWithStack}>
              <View ref={areaInputZoneRef} onLayout={reportExcludeZones} collapsable={false}>
                <MultiPlaceAutocompleteInput
                  ref={placesInputRef}
                  value={places}
                  onChange={setPlaces}
                  placeholder="City/town/surf spots..."
                  disabled={isReadOnly}
                  includedRegionCodes={regionCodes}
                />
              </View>

              <DestinationDurationInput
                timeValue={timeValue}
                timeUnit={timeUnit}
                onTimeValueChange={setTimeValue}
                onTimeUnitChange={setTimeUnit}
                readOnly={isReadOnly}
                onSetParentScrollEnabled={onSetParentScrollEnabled}
                unitSelectorWrapperRef={unitSelectorWrapperRef}
                onUnitSelectorLayout={reportExcludeZones}
              />
            </View>

            {!isReadOnly && (onNext || onSave) && (
              <TouchableOpacity
                style={[
                  onSave ? styles.saveButton : styles.nextButton,
                  onSave && saveDisabled && styles.saveButtonDisabled,
                ]}
                onPress={onSave || onNext}
                activeOpacity={0.85}
                disabled={onSave ? saveDisabled : false}
              >
                <Text style={styles.nextButtonText}>{onSave ? 'Save' : 'Next'}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: { padding: 8, overflow: 'visible' },
  cardOuter: { overflow: 'visible', paddingTop: 56 },
  cardWrapper: {
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    position: 'relative',
  },
  backgroundImage: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 24 },
  frostedOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255, 255, 255, 0.72)', borderRadius: 24 },
  card: {
    borderRadius: 24,
    paddingTop: 32,
    paddingHorizontal: 24,
    paddingBottom: 0,
    minHeight: 320,
  },
  flagCircleWrapper: { position: 'absolute', top: 40, left: 0, right: 0, alignItems: 'center', zIndex: 1 },
  flagCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.white,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: colors.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  flagCircleImage: { width: 50, height: 50, borderRadius: 25 },
  flagEmoji: { fontSize: 28 },
  destinationName: {
    fontSize: 16,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    color: '#333333',
    lineHeight: 22,
    marginBottom: 32,
  },
  content: { gap: 12, overflow: 'visible' },
  contentWithStack: {
    gap: 12,
    overflow: 'visible',
    zIndex: 10000,
    elevation: 24,
  },
  nextButton: {
    backgroundColor: '#2C2C2C',
    borderRadius: 14,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 10,
  },
  nextButtonText: {
    color: colors.white,
    fontSize: 17,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
  saveButton: {
    backgroundColor: '#212121',
    borderRadius: 14,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 10,
  },
  saveButtonDisabled: { opacity: 0.5 },
});
