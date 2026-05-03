import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  TouchableOpacity,
  Platform,
  useWindowDimensions,
  Alert,
  Keyboard,
  KeyboardEvent,
  PanResponder,
  TextInput,
  ScrollView,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CountrySearchModal } from '../CountrySearchModal';
import { DestinationDurationInput } from '../DestinationDurationInput';
import { PlaceChip } from '../PlaceChip';
import { normalizeMapPickerPlace } from '../../utils/googlePlaceNormalizer';
import { getDisplayLabelAndFlagKey } from '../../utils/destinationDisplay';
import type { MapPickerPlace } from '../MapPickerModal';
import type { DurationTimeUnit } from '../../utils/destinationDuration';
import {
  computeDurationParts,
  decomposeDaysForDurationInput,
} from '../../utils/destinationDuration';

type Destination = {
  country: string;
  state?: string;
  area?: string[];
  time_in_days: number;
  time_in_text?: string;
};

type Props = {
  visible: boolean;
  mode?: 'edit' | 'add';
  onClose: () => void;
  destination: Destination | null;
  onSave?: (next: {
    country: string;
    area: string[];
    time_in_days: number;
    time_in_text: string;
  }) => void | Promise<void>;
  saving?: boolean;
  onDelete?: () => void | Promise<void>;
  deleting?: boolean;
};

const FIGMA = {
  sheetBg: '#FFFFFF',
  fieldBg: '#FFFFFF',
  fieldBorder: '#CFCFCF',
  textPrimary: '#333333',
  textSecondary: '#7B7B7B',
  textLight: '#A0A0A0',
  buttonBg: '#212121',
  buttonText: '#FFFFFF',
};

// Maps a country name to a Google Places region code so autocomplete results
// stay scoped to the destination country. Mirrors the table in
// DestinationMapPickerCard — kept local to avoid refactoring that file.
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

const PLACES_AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const PLACES_DETAILS_URL = 'https://places.googleapis.com/v1/places';
const SUGGESTION_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;
const MAX_SUGGESTIONS = 5;

interface PlaceSuggestion {
  placeId: string;
  text: string;
}

// Saved chip: identified by placeId when known, displayed by label.
interface SavedPlace {
  placeId: string;
  displayLabel: string;
  areaParts?: string[];
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

function placesFromAreaArray(area: string[] | undefined): SavedPlace[] {
  if (!area || area.length === 0) return [];
  return area
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .map((displayLabel) => ({ placeId: '', displayLabel }));
}

export const ProfileEditDestinationScreen: React.FC<Props> = ({
  visible,
  mode = 'edit',
  onClose,
  destination,
  onSave,
  saving = false,
  onDelete,
  deleting = false,
}) => {
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const translateY = useRef(new Animated.Value(screenHeight)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  // Swipe-down to dismiss — drag the handle/header area, sheet follows finger.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => gs.dy > 4,
      onPanResponderMove: (_, gs) => {
        if (gs.dy > 0) translateY.setValue(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 100 || gs.vy > 0.5) {
          onCloseRef.current();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            tension: 65,
            friction: 11,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  // Lift the sheet above the on-screen keyboard. Native uses `Keyboard` events;
  // web (mobile browsers) uses visualViewport, which shrinks when the OS
  // keyboard opens — neither RN-Web's Keyboard module nor the iOS Safari
  // window resize fires reliably for that case.
  useEffect(() => {
    if (!visible) return;
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return;
      const vv = (window as any).visualViewport as VisualViewport | undefined;
      if (!vv) return;
      const onResize = () => {
        const diff = window.innerHeight - vv.height;
        setKeyboardHeight(Math.max(0, Math.round(diff)));
      };
      vv.addEventListener('resize', onResize);
      vv.addEventListener('scroll', onResize);
      onResize();
      return () => {
        vv.removeEventListener('resize', onResize);
        vv.removeEventListener('scroll', onResize);
        setKeyboardHeight(0);
      };
    }
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e: KeyboardEvent) => {
      setKeyboardHeight(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
      setKeyboardHeight(0);
    };
  }, [visible]);

  const initial = useMemo(
    () => decomposeDaysForDurationInput(destination?.time_in_days ?? 0),
    [destination?.time_in_days],
  );
  const [dayValue, setDayValue] = useState<string>(initial.value);
  const [timeUnit, setTimeUnit] = useState<DurationTimeUnit>(initial.unit);
  const [selectedCountry, setSelectedCountry] = useState('');
  const [countryModalVisible, setCountryModalVisible] = useState(false);
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [inputRowHeight, setInputRowHeight] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const autocompleteSeqRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Sync only on closed→open transition (matches every other slide-in editor).
  const prevVisibleRef = useRef(visible);
  useEffect(() => {
    if (visible && !prevVisibleRef.current) {
      setQuery('');
      setSuggestions([]);
      setSuggestionsLoading(false);
      if (mode === 'add') {
        setSelectedCountry('');
        setPlaces([]);
        const next = decomposeDaysForDurationInput(0);
        setDayValue(next.value);
        setTimeUnit(next.unit);
      } else {
        setSelectedCountry(destination?.country ?? '');
        setPlaces(placesFromAreaArray(destination?.area));
        const next = decomposeDaysForDurationInput(destination?.time_in_days ?? 0);
        setDayValue(next.value);
        setTimeUnit(next.unit);
      }
    }
    prevVisibleRef.current = visible;
  }, [visible, mode, destination?.country, destination?.area, destination?.time_in_days]);

  useEffect(() => {
    if (visible && !mounted) {
      translateY.setValue(screenHeight);
      backdropOpacity.setValue(0);
      setMounted(true);
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 320,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 520,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, mounted, screenHeight, translateY, backdropOpacity]);

  useEffect(() => {
    if (mounted && !visible) {
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: screenHeight,
          duration: 320,
          easing: Easing.bezier(0.64, 0, 0.78, 0),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [mounted, visible, screenHeight, translateY, backdropOpacity]);

  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;
  const regionCode = useMemo(() => {
    const country = selectedCountry || destination?.country || '';
    // California / Hawaii are stored as "United States - California" / etc.
    // and aren't in COUNTRY_TO_REGION directly — fall back to "us" for those.
    // Same handling as DestinationMapPickerCard in onboarding.
    const { flagKey } = getDisplayLabelAndFlagKey(country);
    if (flagKey === 'California' || flagKey === 'Hawaii') return 'us';
    return COUNTRY_TO_REGION[country];
  }, [selectedCountry, destination?.country]);

  const debouncedQuery = useDebounce(query, SUGGESTION_DEBOUNCE_MS);

  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (!apiKey || trimmed.length < MIN_QUERY_LENGTH) {
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
      .catch(() => {
        if (!isMountedRef.current || seq < autocompleteSeqRef.current) return;
        setSuggestions([]);
      })
      .finally(() => {
        if (!isMountedRef.current || seq !== autocompleteSeqRef.current) return;
        setSuggestionsLoading(false);
      });
  }, [debouncedQuery, apiKey, regionCode]);

  const addPlace = useCallback((place: MapPickerPlace) => {
    const normalized = normalizeMapPickerPlace(place);
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

  const handleSuggestionSelect = useCallback(
    async (suggestion: PlaceSuggestion) => {
      if (!apiKey) return;
      // Invalidate any in-flight autocomplete so a late response doesn't
      // re-open the dropdown after we close it.
      autocompleteSeqRef.current++;
      setSuggestions([]);
      setSuggestionsLoading(false);
      // Clear both the controlled value and the native input buffer to avoid
      // the iOS/Android autocorrect commit re-firing onChangeText with stale
      // text after the suggestion tap. Same race we hit in the onboarding card.
      setQuery('');
      inputRef.current?.clear?.();
      const place = await fetchPlaceDetails(suggestion.placeId, apiKey);
      if (!isMountedRef.current) return;
      if (place) {
        addPlace(place);
      } else {
        addPlace({
          name: suggestion.text,
          placeId: suggestion.placeId,
          lat: 0,
          lng: 0,
          formatted_address: suggestion.text,
        });
      }
    },
    [apiKey, addPlace],
  );

  const dropdownVisible =
    query.trim().length >= MIN_QUERY_LENGTH && (suggestions.length > 0 || suggestionsLoading);

  const handleDelete = useCallback(() => {
    if (!onDelete) return;
    const country = destination?.country || 'this destination';
    Alert.alert(
      'Delete destination',
      `Remove ${country} from your top destinations?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await onDelete();
              onClose();
            } catch {
              // Parent surfaced the alert; keep editor open for retry.
            }
          },
        },
      ],
    );
  }, [onDelete, onClose, destination?.country]);

  const handleSave = useCallback(async () => {
    const country = selectedCountry.trim();
    if (!country) {
      Alert.alert('Select a country', 'Choose where you surfed before saving.');
      return;
    }
    const duration = computeDurationParts(dayValue, timeUnit);
    if (!duration) {
      Alert.alert('Duration', 'Enter a valid time spent (a number greater than zero).');
      return;
    }
    // Match the onboarding card: prefer the normalized address parts when we
    // have them, otherwise fall back to the human-readable label.
    const area = places.flatMap((p) =>
      p.areaParts && p.areaParts.length > 0 ? p.areaParts : [p.displayLabel],
    );
    try {
      if (onSave) {
        await onSave({
          country,
          area,
          time_in_days: duration.timeInDays,
          time_in_text: duration.timeInText,
        });
      }
      onClose();
    } catch {
      // Error already surfaced by parent — keep editor open for retry.
    }
  }, [selectedCountry, places, dayValue, timeUnit, onSave, onClose]);

  if (!mounted) return null;

  // Show the friendly label ("California" / "Hawaii") even though we keep
  // storing the canonical "United States - California" form for matching/DB.
  const displayCountry = selectedCountry
    ? getDisplayLabelAndFlagKey(selectedCountry).displayLabel
    : '';
  const placesInputDisabled = !selectedCountry || !apiKey;
  const placesPlaceholder = !selectedCountry
    ? 'Pick a country first'
    : !apiKey
      ? 'Spots unavailable'
      : places.length === 0
        ? 'City / town / surf spot...'
        : 'Add another...';

  return (
    <View style={styles.root} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View
        style={[styles.backdrop, { opacity: backdropOpacity }]}
        // Backdrop intercepts taps to close — tapping outside the sheet dismisses.
        onTouchEnd={onClose}
      />
      <Animated.View
        style={[
          styles.sheet,
          {
            transform: [{ translateY }],
            paddingBottom: Math.max(insets.bottom, 16) + 24,
            // Lifts the sheet above the on-screen keyboard. 0 when hidden.
            marginBottom: keyboardHeight,
          },
        ]}
      >
        {/* Drag area — swipe down on the handle/title to dismiss */}
        <View {...pan.panHandlers}>
          <View style={styles.handleRow}>
            <View style={styles.handle} />
          </View>

          <View style={styles.header}>
            <Text style={styles.title}>
              {mode === 'add' ? 'Add destination' : 'Top Destination'}
            </Text>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <Ionicons name="close" size={24} color={FIGMA.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={styles.countryField}
          onPress={() => setCountryModalVisible(true)}
          activeOpacity={0.7}
        >
          <Text
            style={[styles.countryText, !displayCountry && styles.countryPlaceholder]}
            numberOfLines={1}
          >
            {displayCountry || 'Select country'}
          </Text>
          <Ionicons name="chevron-forward" size={20} color={FIGMA.textPrimary} />
        </TouchableOpacity>

        {/* Places input + chips. The suggestions dropdown is positioned
            absolutely below this row so it overlays the duration block. */}
        <View style={styles.placesBlock}>
          <View
            style={[styles.placesField, placesInputDisabled && styles.placesFieldDisabled]}
            onLayout={(e) => setInputRowHeight(e.nativeEvent.layout.height)}
          >
            <Ionicons
              name="location-outline"
              size={20}
              color={FIGMA.textLight}
              style={styles.placesIcon}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipsScroll}
              contentContainerStyle={styles.chipsContent}
              keyboardShouldPersistTaps="always"
            >
              {places.map((p, index) => (
                <View key={p.placeId || `${p.displayLabel}-${index}`} style={styles.chipWrap}>
                  <PlaceChip
                    label={p.displayLabel}
                    onRemove={() =>
                      setPlaces((prev) => prev.filter((_, j) => j !== index))
                    }
                  />
                </View>
              ))}
              <TextInput
                ref={inputRef}
                keyboardType="web-search"
                underlineColorAndroid="transparent"
                // Place-search input must treat user input literally — autocorrect
                // re-fires onChangeText after suggestion tap and re-opens the
                // dropdown with stale ghost text. Disable everything correction
                // related on this field. Same fix as DestinationMapPickerCard.
                autoCorrect={false}
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                textContentType="none"
                importantForAutofill="no"
                style={styles.placesInput}
                value={query}
                onChangeText={setQuery}
                placeholder={placesPlaceholder}
                placeholderTextColor={FIGMA.textLight}
                editable={!placesInputDisabled}
              />
            </ScrollView>
          </View>

          {dropdownVisible && inputRowHeight > 0 && (
            <View
              style={[styles.suggestionsDropdown, { top: inputRowHeight + 4 }]}
              // Claim the touch responder at the RN layer so the gesture never
              // falls through to anything below. Same pattern as the onboarding
              // card and MultiPlaceAutocompleteInput.
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
                      <Ionicons
                        name="location-outline"
                        size={18}
                        color="#808080"
                        style={styles.suggestionItemIcon}
                      />
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
        </View>

        <View style={styles.durationBlock}>
          <DestinationDurationInput
            timeValue={dayValue}
            timeUnit={timeUnit}
            onTimeValueChange={setDayValue}
            onTimeUnitChange={setTimeUnit}
          />
        </View>

        <TouchableOpacity
          style={[styles.saveButton, (saving || deleting) && styles.saveButtonDisabled]}
          onPress={handleSave}
          activeOpacity={0.85}
          disabled={saving || deleting}
        >
          <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save'}</Text>
        </TouchableOpacity>

        {mode === 'edit' && onDelete ? (
          <TouchableOpacity
            style={[styles.deleteButton, (saving || deleting) && styles.deleteButtonDisabled]}
            onPress={handleDelete}
            activeOpacity={0.6}
            disabled={saving || deleting}
            accessibilityLabel="Delete destination"
          >
            <Ionicons name="trash-outline" size={18} color="#FF3B30" />
            <Text style={styles.deleteButtonText}>
              {deleting ? 'Deleting...' : 'Delete destination'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </Animated.View>

      <CountrySearchModal
        visible={countryModalVisible}
        selectedCountry={selectedCountry}
        onSelect={c => {
          setSelectedCountry(c);
          setCountryModalVisible(false);
        }}
        onClose={() => setCountryModalVisible(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sheet: {
    backgroundColor: FIGMA.sheetBg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 8,
    width: '100%',
  },
  handleRow: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E5E5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 16,
  },
  title: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700',
    color: FIGMA.textPrimary,
    ...Platform.select({
      web: { fontFamily: 'Montserrat, sans-serif' },
      default: { fontFamily: 'Montserrat' },
    }),
  },
  closeButton: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countryField: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: FIGMA.fieldBorder,
    backgroundColor: FIGMA.fieldBg,
    marginBottom: 12,
  },
  countryText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
    color: FIGMA.textPrimary,
  },
  countryPlaceholder: {
    color: FIGMA.textLight,
  },
  placesBlock: {
    position: 'relative',
    marginBottom: 12,
    // Lifts the suggestions dropdown above the duration block below it.
    zIndex: 20,
    elevation: 20,
  },
  placesField: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: FIGMA.fieldBorder,
    backgroundColor: FIGMA.fieldBg,
  },
  placesFieldDisabled: {
    backgroundColor: '#F5F5F5',
    opacity: 0.7,
  },
  placesIcon: {
    marginRight: 8,
  },
  chipsScroll: {
    flex: 1,
    maxHeight: 56,
  },
  chipsContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 4,
  },
  chipWrap: {
    marginRight: 4,
  },
  placesInput: {
    minWidth: 140,
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
    color: FIGMA.textPrimary,
    paddingVertical: 4,
    paddingHorizontal: 0,
    ...(Platform.OS === 'web' && { outlineStyle: 'none' as any }),
  },
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
    ...Platform.select({
      web: { fontFamily: 'Inter, sans-serif' },
      default: { fontFamily: 'Inter' },
    }),
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
    ...Platform.select({
      web: { fontFamily: 'Inter, sans-serif' },
      default: { fontFamily: 'Inter' },
    }),
  },
  durationBlock: {
    marginBottom: 16,
  },
  saveButton: {
    height: 56,
    borderRadius: 12,
    backgroundColor: FIGMA.buttonBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    color: FIGMA.buttonText,
    ...Platform.select({
      web: { fontFamily: 'Montserrat, sans-serif' },
      default: { fontFamily: 'Montserrat' },
    }),
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    marginTop: 8,
  },
  deleteButtonDisabled: {
    opacity: 0.5,
  },
  deleteButtonText: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
    color: '#FF3B30',
    ...Platform.select({
      web: { fontFamily: 'Montserrat, sans-serif' },
      default: { fontFamily: 'Montserrat' },
    }),
  },
});

export default ProfileEditDestinationScreen;
