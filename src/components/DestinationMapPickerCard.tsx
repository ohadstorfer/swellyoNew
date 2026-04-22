import React, { useState, useEffect, useRef, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Dimensions,
  Image,
  ImageBackground,
  ScrollView,
  FlatList,
  PanResponder,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from './Text';
import { colors, spacing } from '../styles/theme';
import { getCountryFlag } from '../utils/countryFlags';
import { getDisplayLabelAndFlagKey } from '../utils/destinationDisplay';
import {
  getCountryImageFromStorage,
  getCountryImageFallback,
  getCountryImageFromPexels,
} from '../services/media/imageService';
import { PlaceChip } from './PlaceChip';
import { MapPopover, type MapPickerPlace } from './MapPickerModal';
import { getMapPickerInlineHtml, COUNTRY_CENTERS } from '../utils/mapPickerHtml';
import type { SwipeExcludeZoneRect } from './DestinationInputCard';
import { normalizeMapPickerPlace } from '../utils/googlePlaceNormalizer';

const DEBUG_MAP_PICKER =
  process.env.EXPO_PUBLIC_MAP_PICKER_DEBUG === 'true' ||
  process.env.EXPO_PUBLIC_LOCAL_MODE === 'true';

function logMapPicker(...args: any[]) {
  if (__DEV__ || DEBUG_MAP_PICKER) {
    // eslint-disable-next-line no-console
    console.log('[DestinationMapPickerCard]', ...args);
  }
}

const PLACES_AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const PLACES_DETAILS_URL = 'https://places.googleapis.com/v1/places';
const SUGGESTION_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;
const MAX_SUGGESTIONS = 5;

interface PlaceSuggestion {
  placeId: string;
  text: string;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

async function fetchPlaceDetails(placeId: string, apiKey: string): Promise<MapPickerPlace | null> {
  try {
    const res = await fetch(`${PLACES_DETAILS_URL}/${encodeURIComponent(placeId)}`, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'displayName,formattedAddress,location',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const lat = data?.location?.latitude;
    const lng = data?.location?.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    return {
      name: data?.displayName?.text ?? data?.formattedAddress ?? '',
      placeId,
      lat,
      lng,
      formatted_address: data?.formattedAddress ?? '',
    };
  } catch {
    return null;
  }
}

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

interface DestinationMapPickerCardProps {
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
  initialTimeUnit?: TimeUnit;
  onSwipeExcludeZonesLayout?: (
    index: number,
    zones: { timeUnit: SwipeExcludeZoneRect; areaInput: SwipeExcludeZoneRect }
  ) => void;
  isCurrentCard?: boolean;
  onSetParentScrollEnabled?: (enabled: boolean) => void;
  /** Called when a TextInput inside this card receives focus (native only). */
  onInputFocus?: () => void;
}

export interface DestinationMapPickerCardRef {
  focusAreaInput: () => void;
}

type TimeUnit = 'days' | 'weeks' | 'months' | 'years';

const TIME_UNITS: TimeUnit[] = ['days', 'weeks', 'months', 'years'];
const UNIT_LABELS: Record<TimeUnit, string> = { days: 'Days', weeks: 'Weeks', months: 'Months', years: 'Years' };
const UNIT_ITEM_WIDTH = 58;
const UNIT_CAROUSEL_CONTAINER_WIDTH = 179;
/** Minimum horizontal drag (px) to advance/retreat one time unit. */
const SWIPE_THRESHOLD = 12;

/** Saved place: identified by placeId, shown by displayLabel (e.g. formatted_address or name). */
interface SavedPlace {
  placeId: string;
  displayLabel: string;
  /** All area parts from the normalized address — kept for the data layer. */
  areaParts?: string[];
}

function parseInitialPlaces(initialAreas: string | undefined): SavedPlace[] {
  if (!initialAreas || !initialAreas.trim()) return [];
  const delimiter = initialAreas.includes('\n') ? '\n' : /[,\n]/;
  return initialAreas
    .split(delimiter)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((displayLabel) => ({ placeId: '', displayLabel }));
}

export const DestinationMapPickerCard = forwardRef<
  DestinationMapPickerCardRef,
  DestinationMapPickerCardProps
>(function DestinationMapPickerCard(
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
    onInputFocus,
  },
  ref
) {
  const [places, setPlaces] = useState<SavedPlace[]>(() => parseInitialPlaces(initialAreas));
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [inputRowHeight, setInputRowHeight] = useState(0);
  const [timeValue, setTimeValue] = useState(initialTimeValue || '2');
  const [timeUnit, setTimeUnit] = useState<TimeUnit>(initialTimeUnit || 'weeks');
  const unitScrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const inputRowRef = useRef<View>(null);
  const unitSelectorWrapperRef = useRef<View>(null);
  const onDataChangeRef = useRef(onDataChange);
  // Race-guard: discards stale autocomplete responses when the user types fast.
  const autocompleteSeqRef = useRef(0);
  const isMountedRef = useRef(true);

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
    inputRowRef.current?.measureInWindow?.((x, y, w, h) => {
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

  const timeUnitIndex = TIME_UNITS.indexOf(timeUnit);
  const scrollToUnitIndex = useCallback((index: number, animated = true) => {
    const x = index * UNIT_ITEM_WIDTH;
    unitScrollRef.current?.scrollTo({ x, animated });
  }, []);

  /** Move selection at most one step in the given direction (-1 or 1). */
  const stepTimeUnit = useCallback(
    (direction: number) => {
      if (direction === 0) return;
      const currentIndex = TIME_UNITS.indexOf(timeUnit);
      const nextIndex = Math.max(0, Math.min(TIME_UNITS.length - 1, currentIndex + direction));
      if (nextIndex === currentIndex) return;
      const newUnit = TIME_UNITS[nextIndex];
      setTimeUnit(newUnit);
      scrollToUnitIndex(nextIndex);
    },
    [timeUnit, scrollToUnitIndex]
  );

  const { displayLabel, flagKey } = useMemo(
    () => getDisplayLabelAndFlagKey(destination),
    [destination]
  );
  const regionCode = useMemo(() => {
    if (flagKey === 'California' || flagKey === 'Hawaii') return 'us';
    return COUNTRY_TO_REGION[destination];
  }, [destination, flagKey]);
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;
  const countryCenter = useMemo(() => (regionCode ? COUNTRY_CENTERS[regionCode] : undefined), [regionCode]);
  const inlineMapHtml = useMemo(
    () => (apiKey ? getMapPickerInlineHtml(apiKey, regionCode, { countryCenter, zoom: 5 }) : ''),
    [apiKey, regionCode, countryCenter]
  );

  useImperativeHandle(ref, () => ({
    focusAreaInput: () => inputRef.current?.focus(),
  }), []);

  useEffect(() => {
    logMapPicker('mount', { destination, hasApiKey: !!apiKey, regionCode });
    return () => {
      logMapPicker('unmount', { destination });
    };
  }, [destination, apiKey, regionCode]);

  useEffect(() => {
    onDataChangeRef.current = onDataChange;
  }, [onDataChange]);

  useEffect(() => {
    const numericValue = parseFloat(timeValue);
    if (isNaN(numericValue) || numericValue <= 0) return;

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
        timeInText = numericValue % 1 === 0.5 ? `${Math.floor(numericValue)}.5 months` : (numericValue === 1 ? '1 month' : `${numericValue} months`);
        break;
      case 'years':
        timeInDays = Math.round(numericValue * 365);
        timeInText = numericValue % 1 === 0.5 ? `${Math.floor(numericValue)}.5 years` : (numericValue === 1 ? '1 year' : `${numericValue} years`);
        break;
    }

    if (!isReadOnly) {
      onDataChangeRef.current({
        areas: places.flatMap((p) => p.areaParts && p.areaParts.length > 0 ? p.areaParts : [p.displayLabel]),
        timeInDays,
        timeInText,
      });
    }
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

  const onSetParentScrollEnabledRef = useRef(onSetParentScrollEnabled);
  onSetParentScrollEnabledRef.current = onSetParentScrollEnabled;

  const unitPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => Platform.OS !== 'web' && !isReadOnly,
        onMoveShouldSetPanResponderCapture: (_, gestureState) => {
          if (isReadOnly) return false;
          const { dx, dy } = gestureState;
          return Math.abs(dx) > Math.abs(dy) * 0.5 && Math.abs(dx) > 4;
        },
        onPanResponderGrant: () => {
          onSetParentScrollEnabledRef.current?.(false);
        },
        onPanResponderMove: () => {},
        onPanResponderRelease: (_, gestureState) => {
          const { dx } = gestureState;
          const direction = dx > SWIPE_THRESHOLD ? -1 : dx < -SWIPE_THRESHOLD ? 1 : 0;
          stepTimeUnit(direction);
          onSetParentScrollEnabledRef.current?.(true);
        },
        onPanResponderTerminate: () => {
          onSetParentScrollEnabledRef.current?.(true);
        },
      }),
    [isReadOnly, stepTimeUnit]
  );

  useEffect(() => {
    scrollToUnitIndex(timeUnitIndex, false);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const addPlace = useCallback((place: MapPickerPlace) => {
    const normalized = normalizeMapPickerPlace(place);
    logMapPicker('addPlace', {
      name: place.name,
      placeId: place.placeId,
      lat: place.lat,
      lng: place.lng,
      normalized,
    });

    setPlaces((prev) => {
      const existingPlaceIds = new Set(prev.filter((p) => p.placeId).map((p) => p.placeId));
      if (place.placeId && existingPlaceIds.has(place.placeId)) return prev;

      const mainName = (place.name || normalized.area[0] || '').trim();
      if (!mainName) return prev;

      const existingLabels = new Set(prev.map((p) => p.displayLabel.toLowerCase()));
      if (existingLabels.has(mainName.toLowerCase())) return prev;

      return [
        ...prev,
        {
          placeId: place.placeId || '',
          displayLabel: mainName,
          areaParts: normalized.area,
        },
      ];
    });
  }, []);

  const handleMapError = useCallback((payload: { type: string; error?: string; message?: string }) => {
    if (payload.type === 'MAP_ERROR') {
      logMapPicker('MAP_ERROR received', { error: payload.error, message: payload.message });
    }
  }, []);

  const debouncedQuery = useDebounce(query, SUGGESTION_DEBOUNCE_MS);

  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (!apiKey || isReadOnly || trimmed.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setSuggestionsLoading(false);
      return;
    }

    const seq = ++autocompleteSeqRef.current;
    setSuggestionsLoading(true);

    const body: Record<string, unknown> = {
      input: trimmed,
      includeQueryPredictions: false,
    };
    if (regionCode && regionCode.length === 2) {
      body.includedRegionCodes = [regionCode];
    }

    fetch(PLACES_AUTOCOMPLETE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text',
      },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        if (!isMountedRef.current || seq < autocompleteSeqRef.current) return;
        if (!res.ok) {
          logMapPicker('autocomplete http error', { status: res.status });
          setSuggestions([]);
          return;
        }
        const data = await res.json();
        if (!isMountedRef.current || seq < autocompleteSeqRef.current) return;
        const list: PlaceSuggestion[] = [];
        for (const s of data?.suggestions ?? []) {
          const pred = s?.placePrediction;
          if (pred?.text?.text && pred?.placeId) {
            list.push({ placeId: pred.placeId, text: pred.text.text });
          }
          if (list.length >= MAX_SUGGESTIONS) break;
        }
        setSuggestions(list);
      })
      .catch((err) => {
        if (!isMountedRef.current || seq < autocompleteSeqRef.current) return;
        logMapPicker('autocomplete network error', err);
        setSuggestions([]);
      })
      .finally(() => {
        if (!isMountedRef.current || seq !== autocompleteSeqRef.current) return;
        setSuggestionsLoading(false);
      });
  }, [debouncedQuery, apiKey, regionCode, isReadOnly]);

  const handleSuggestionSelect = useCallback(
    async (suggestion: PlaceSuggestion) => {
      if (!apiKey) return;
      // Invalidate any in-flight autocomplete request so a late response
      // doesn't re-open the dropdown after we close it.
      autocompleteSeqRef.current++;
      setSuggestions([]);
      setSuggestionsLoading(false);
      // Clear BOTH the controlled value AND the native input buffer. Setting
      // state alone can race with the iOS/Android autocorrect commit that
      // fires on the suggestion tap — ref.clear() wipes the native buffer
      // so any late onChangeText from autocorrect sees an already-empty field.
      setQuery('');
      inputRef.current?.clear?.();
      const place = await fetchPlaceDetails(suggestion.placeId, apiKey);
      if (!isMountedRef.current) return;
      if (place) {
        addPlace(place);
      } else {
        // Fallback: use the suggestion text as display label so the user's tap
        // isn't silently dropped even when the Details call fails.
        addPlace({
          name: suggestion.text,
          placeId: suggestion.placeId,
          lat: 0,
          lng: 0,
          formatted_address: suggestion.text,
        });
      }
    },
    [apiKey, addPlace]
  );

  const dropdownVisible = !isReadOnly && query.trim().length >= MIN_QUERY_LENGTH && (suggestions.length > 0 || suggestionsLoading);
  const showInlineMap = query.trim().length >= MIN_QUERY_LENGTH && !!apiKey && !isReadOnly;

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
              <View style={styles.inputRowAndMapWrapper}>
                <View
                  ref={inputRowRef}
                  onLayout={(e) => {
                    setInputRowHeight(e.nativeEvent.layout.height);
                    reportExcludeZones();
                  }}
                  style={[
                    styles.inputRowWrapper,
                    isReadOnly && styles.inputRowWrapperDisabled,
                    // Keep input above the map overlay permanently — toggling
                    // elevation on state change caused Android to recompose the
                    // view layer, which can blur the focused native TextInput.
                    styles.inputRowWrapperAboveOverlay,
                  ]}
                >
                  <Ionicons name="location-outline" size={20} color="#A0A0A0" style={styles.inputRowIcon} />
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.inputRowChipsScroll}
                    contentContainerStyle={styles.inputRowChipsContent}
                    keyboardShouldPersistTaps="always"
                  >
                    {places.map((p, index) => (
                      <View key={p.placeId || `${p.displayLabel}-${index}`} style={styles.chipWrap}>
                        <PlaceChip
                          label={p.displayLabel}
                          onRemove={() => setPlaces((prev) => prev.filter((_, j) => j !== index))}
                          disabled={isReadOnly}
                        />
                      </View>
                    ))}
                    <TextInput
                      ref={inputRef}
                      keyboardType="web-search"
                      underlineColorAndroid="transparent"
                      // Place-search input must treat user input literally.
                      // iOS/Android autocorrect holds a pending correction in
                      // a buffer; when the user taps a suggestion, the touch
                      // commit flushes that buffer and fires onChangeText
                      // AFTER our setQuery('') → the dropdown re-opens with
                      // the autocorrect ghost text. Disabling all correction
                      // on this field prevents that race.
                      autoCorrect={false}
                      autoCapitalize="none"
                      autoComplete="off"
                      spellCheck={false}
                      textContentType="none"
                      importantForAutofill="no"
                      style={[
                        styles.inputRowTextInput,
                        isReadOnly && styles.inputRowTextInputDisabled,
                      ]}
                      value={query}
                      onChangeText={(text) => {
                        logMapPicker('onChangeText', {
                          prevQuery: query,
                          nextQuery: text,
                        });
                        setQuery(text);
                      }}
                      onFocus={() => {
                        if (Platform.OS !== 'web' && onInputFocus) {
                          setTimeout(() => onInputFocus(), 300);
                        }
                      }}
                      placeholder={places.length === 0 ? 'City/town/surf spots...' : 'Add another...'}
                      placeholderTextColor="#A0A0A0"
                      editable={!isReadOnly && !!apiKey}
                    />
                  </ScrollView>
                </View>
                {showInlineMap && inputRowHeight > 0 && (
                  <MapPopover
                    visible
                    inputRowHeight={inputRowHeight}
                    htmlContent={inlineMapHtml}
                    onMessage={handleMapError}
                    onClose={() => setQuery('')}
                  />
                )}
                {dropdownVisible && inputRowHeight > 0 && (
                  <View
                    style={[styles.suggestionsDropdown, { top: inputRowHeight + 8 }]}
                    // Claim the touch responder at the RN layer so the gesture
                    // never falls through to the WebView below (which would
                    // become first responder and dismiss the IME). Same pattern
                    // used successfully in MultiPlaceAutocompleteInput.
                    onStartShouldSetResponder={() => true}
                  >
                    {suggestions.length > 0 ? (
                      <FlatList
                        data={suggestions}
                        keyExtractor={(item) => item.placeId}
                        keyboardShouldPersistTaps="always"
                        keyboardDismissMode="none"
                        style={styles.suggestionsList}
                        renderItem={({ item }) => (
                          <TouchableOpacity
                            style={styles.suggestionItem}
                            onPress={() => handleSuggestionSelect(item)}
                            activeOpacity={0.7}
                          >
                            <Ionicons name="location-outline" size={18} color="#808080" style={styles.suggestionItemIcon} />
                            <Text style={styles.suggestionItemText} numberOfLines={2}>
                              {item.text}
                            </Text>
                          </TouchableOpacity>
                        )}
                      />
                    ) : suggestionsLoading ? (
                      <View style={styles.suggestionsLoadingRow}>
                        <ActivityIndicator size="small" color="#808080" />
                        <Text style={styles.suggestionsLoadingText}>Searching…</Text>
                      </View>
                    ) : null}
                  </View>
                )}

                <View
                  style={styles.timeInputContainer}
                  {...(Platform.OS === 'web' && { dataSet: { swipeExclude: 'true' } } as any)}
                >
                <View style={styles.timeInputRow}>
                  <View style={styles.timeInputBox}>
                    <TextInput
                      underlineColorAndroid="transparent"
                      style={[styles.timeInput, isReadOnly && styles.inputReadOnly]}
                      value={timeValue}
                      onChangeText={handleTimeValueChange}
                      onFocus={() => {
                        if (Platform.OS !== 'web' && onInputFocus) {
                          setTimeout(() => onInputFocus(), 300);
                        }
                      }}
                      placeholder="🕝 Time spent"
                      placeholderTextColor="#A0A0A0"
                      keyboardType="decimal-pad"
                      editable={!isReadOnly}
                    />
                  </View>
                  <View
                    ref={unitSelectorWrapperRef}
                    onLayout={reportExcludeZones}
                    style={[styles.unitCarouselContainer, isReadOnly && styles.unitCarouselReadOnly]}
                    {...unitPanResponder.panHandlers}
                  >
                    <ScrollView
                      ref={unitScrollRef}
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={[
                        styles.unitCarouselContent,
                        { paddingHorizontal: (UNIT_CAROUSEL_CONTAINER_WIDTH - UNIT_ITEM_WIDTH) / 2 },
                      ]}
                      scrollEnabled={false}
                    >
                      {TIME_UNITS.map((unit, i) => {
                        const isSelected = i === timeUnitIndex;
                        return (
                          <View key={unit} style={[styles.unitCarouselItem, { width: UNIT_ITEM_WIDTH }]}>
                            <Text
                              style={[
                                styles.unitCarouselItemText,
                                isSelected ? styles.unitCarouselItemTextSelected : styles.unitCarouselItemTextFaded,
                                isReadOnly && styles.unitCarouselItemTextReadOnly,
                              ]}
                            >
                              {UNIT_LABELS[unit]}
                            </Text>
                          </View>
                        );
                      })}
                    </ScrollView>
                    <View style={styles.unitCarouselGradientOverlay} pointerEvents="none">
                      <LinearGradient
                        colors={['#FFFFFF', 'rgba(255, 255, 255, 0)', '#FFFFFF']}
                        locations={[0, 0.5, 1]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={StyleSheet.absoluteFill}
                      />
                    </View>
                  </View>
                </View>
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
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: { padding: 8, overflow: 'visible', flex: 1 },
  cardOuter: { flex: 1, overflow: 'visible', paddingTop: 56 },
  cardWrapper: {
    flex: 1,
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
    flex: 1,
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
  contentWithStack: {
    flex: 1,
    gap: 8,
    overflow: 'visible',
    zIndex: 10000,
    elevation: 24,
  },
  inputRowAndMapWrapper: {
    flex: 1,
    position: 'relative',
    gap: 12,
  },
  inputRowWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 12,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  inputRowWrapperDisabled: {
    opacity: 0.6,
    backgroundColor: '#F5F5F5',
  },
  inputRowWrapperAboveOverlay: {
    zIndex: 21,
    elevation: 21,
  },
  inputRowIcon: { marginRight: 12 },
  inputRowChipsScroll: { flex: 1, maxHeight: 56 },
  inputRowChipsContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 8,
  },
  chipWrap: { marginRight: 4 },
  inputRowTextInput: {
    minWidth: 120,
    flex: 1,
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontWeight: '400',
    color: colors.textPrimary,
    paddingVertical: 4,
    paddingHorizontal: 0,
    ...(Platform.OS === 'web' && { outlineStyle: 'none' as any }),
  },
  inputRowTextInputDisabled: { color: '#999' },
  suggestionsDropdown: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    maxHeight: 240,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 24,
    zIndex: 22,
  },
  suggestionsList: { maxHeight: 240 },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EAEAEA',
  },
  suggestionItemIcon: { marginRight: 10 },
  suggestionItemText: {
    flex: 1,
    fontSize: 15,
    color: '#222',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
  suggestionsLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  suggestionsLoadingText: {
    fontSize: 14,
    color: '#808080',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
  timeInputContainer: { width: '100%' },
  timeInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%' },
  timeInputBox: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 12,
    height: 56,
    justifyContent: 'center',
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  timeInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontWeight: '400',
    color: colors.textPrimary,
    lineHeight: 22,
    ...(Platform.OS === 'web' && { outlineStyle: 'none' as any }),
  },
  inputReadOnly: { opacity: 0.6, backgroundColor: '#F5F5F5' },
  unitCarouselContainer: {
    width: UNIT_CAROUSEL_CONTAINER_WIDTH,
    height: 56,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 12,
    overflow: 'hidden',
    justifyContent: 'center',
    position: 'relative',
  },
  unitCarouselReadOnly: { opacity: 0.6, backgroundColor: '#F5F5F5' },
  unitCarouselContent: { alignItems: 'center', justifyContent: 'center' },
  unitCarouselItem: { height: 56, alignItems: 'center', justifyContent: 'center' },
  unitCarouselItemText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 22,
  },
  unitCarouselItemTextSelected: { color: '#333333', fontWeight: '400' },
  unitCarouselItemTextFaded: { color: '#B0B0B0' },
  unitCarouselItemTextReadOnly: { color: '#999999' },
  unitCarouselGradientOverlay: { ...StyleSheet.absoluteFillObject, borderRadius: 12 },
  nextButton: {
    backgroundColor: '#2C2C2C',
    borderRadius: 14,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 0,
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
    marginBottom: 0,
  },
  saveButtonDisabled: { opacity: 0.5 },
});