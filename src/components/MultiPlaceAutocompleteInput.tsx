import React, { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  ScrollView,
  TouchableOpacity,
  FlatList,
  Platform,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PlaceChip } from './PlaceChip';
import { Text } from './Text';
import { colors } from '../styles/theme';

const PLACES_AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

const DEBUG_PLACES_AUTOCOMPLETE =
  process.env.EXPO_PUBLIC_PLACES_DEBUG === 'true' ||
  process.env.EXPO_PUBLIC_LOCAL_MODE === 'true';

function logPlacesAutocomplete(...args: any[]) {
  if (__DEV__ || DEBUG_PLACES_AUTOCOMPLETE) {
    // eslint-disable-next-line no-console
    console.log('[MultiPlaceAutocompleteInput]', ...args);
  }
}

interface MultiPlaceAutocompleteInputProps {
  value: string[];
  onChange: (places: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  /** CLDR two-character region codes to bias/restrict results (e.g. ['us'], ['cr']). */
  includedRegionCodes?: string[];
}

export interface MultiPlaceAutocompleteInputRef {
  focus: () => void;
}

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

export const MultiPlaceAutocompleteInput = forwardRef<
  MultiPlaceAutocompleteInputRef,
  MultiPlaceAutocompleteInputProps
>(function MultiPlaceAutocompleteInput(
  {
    value,
    onChange,
    placeholder = 'Search for a place...',
    disabled = false,
    includedRegionCodes,
  },
  ref
) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const requestSeqRef = useRef(0);
  const latestAppliedSeqRef = useRef(0);
  const isMountedRef = useRef(true);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }), []);
  const debouncedQuery = useDebounce(query, DEBOUNCE_MS);

  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;

  useEffect(() => {
    logPlacesAutocomplete('mount');
    isMountedRef.current = true;
    return () => {
      logPlacesAutocomplete('unmount');
      isMountedRef.current = false;
    };
  }, []);

  const fetchSuggestions = useCallback(
    async (input: string) => {
      if (!apiKey || input.length < MIN_QUERY_LENGTH) {
        logPlacesAutocomplete('fetchSuggestions: skip (missing apiKey or short input)', {
          hasApiKey: !!apiKey,
          input,
        });
        if (!isMountedRef.current) return;
        setSuggestions([]);
        setDropdownVisible(false);
        return;
      }

      const currentSeq = ++requestSeqRef.current;
      logPlacesAutocomplete('fetchSuggestions: start', { input, seq: currentSeq });
      setLoading(true);

      try {
        const body: Record<string, unknown> = {
          input,
          includeQueryPredictions: false,
        };
        if (includedRegionCodes && includedRegionCodes.length > 0) {
          body.includedRegionCodes = includedRegionCodes;
        }
        const res = await fetch(PLACES_AUTOCOMPLETE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text',
          },
          body: JSON.stringify(body),
        });

        if (!isMountedRef.current || currentSeq < requestSeqRef.current) {
          logPlacesAutocomplete('fetchSuggestions: response ignored (stale or unmounted)', {
            seq: currentSeq,
            latestSeq: requestSeqRef.current,
          });
          return;
        }

        if (!res.ok) {
          const errText = await res.text();
          logPlacesAutocomplete('fetchSuggestions: http error', {
            status: res.status,
            body: errText,
          });
          setSuggestions([]);
          setDropdownVisible(false);
          return;
        }
        const data = await res.json();
        const list: PlaceSuggestion[] = [];
        for (const s of data.suggestions || []) {
          const pred = s.placePrediction;
          if (pred?.text?.text && pred?.placeId) {
            list.push({ placeId: pred.placeId, text: pred.text.text });
          }
        }
        latestAppliedSeqRef.current = currentSeq;
        logPlacesAutocomplete('fetchSuggestions: success', {
          seq: currentSeq,
          suggestionsCount: list.length,
        });
        setSuggestions(list);
        setDropdownVisible(list.length > 0);
      } catch (e) {
        if (!isMountedRef.current || currentSeq < requestSeqRef.current) {
          return;
        }
        logPlacesAutocomplete('fetchSuggestions: network error', e);
        setSuggestions([]);
        setDropdownVisible(false);
      } finally {
        if (isMountedRef.current && currentSeq === requestSeqRef.current) {
          logPlacesAutocomplete('fetchSuggestions: finished', { seq: currentSeq });
          setLoading(false);
        }
      }
    },
    [apiKey, includedRegionCodes]
  );

  useEffect(() => {
    logPlacesAutocomplete('debouncedQuery effect', {
      debouncedQuery,
      length: debouncedQuery.trim().length,
    });
    if (debouncedQuery.trim().length >= MIN_QUERY_LENGTH) {
      fetchSuggestions(debouncedQuery.trim());
    } else {
      if (suggestions.length > 0 || dropdownVisible) {
        logPlacesAutocomplete('debouncedQuery: clearing suggestions (below min length)');
      }
      setSuggestions([]);
      setDropdownVisible(false);
    }
  }, [debouncedQuery, fetchSuggestions, suggestions.length, dropdownVisible]);

  const handleSelect = (suggestion: PlaceSuggestion) => {
    const name = suggestion.text.trim();
    logPlacesAutocomplete('handleSelect', { name });
    if (!name) return;
    const normalized = value.map((v) => v.toLowerCase());
    if (normalized.includes(name.toLowerCase())) return;
    onChange([...value, name]);
    setQuery('');
    setSuggestions([]);
    setDropdownVisible(false);
    inputRef.current?.focus();
  };

  const handleRemove = (index: number) => {
    logPlacesAutocomplete('handleRemove', { index });
    onChange(value.filter((_, i) => i !== index));
  };

  const handleBlur = () => {
    logPlacesAutocomplete('handleBlur');
    setTimeout(() => setDropdownVisible(false), 200);
  };

  return (
    <View style={[styles.container, dropdownVisible && styles.containerRaised]}>
      <View style={[styles.inputRow, disabled && styles.inputRowDisabled]}>
        <Ionicons name="location-outline" size={20} color="#A0A0A0" style={styles.icon} />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsScroll}
          contentContainerStyle={styles.chipsContent}
          keyboardShouldPersistTaps="handled"
        >
          {value.map((label, index) => (
            <View key={`${label}-${index}`} style={styles.chipWrap}>
              <PlaceChip
                label={label}
                onRemove={() => handleRemove(index)}
                disabled={disabled}
              />
            </View>
          ))}
          <TextInput
            ref={inputRef}
            style={[styles.textInput, disabled && styles.textInputDisabled]}
            value={query}
            onChangeText={(text) => {
              logPlacesAutocomplete('onChangeText', {
                prevQuery: query,
                nextQuery: text,
              });
              setQuery(text);
            }}
            placeholder={value.length === 0 ? placeholder : 'Add another...'}
            placeholderTextColor="#A0A0A0"
            editable={!disabled}
            onFocus={() => suggestions.length > 0 && setDropdownVisible(true)}
            onBlur={handleBlur}
            {...(Platform.OS === 'web' && {
              // @ts-ignore
              style: [
                styles.textInput,
                disabled && styles.textInputDisabled,
                { outline: 'none', outlineWidth: 0, borderWidth: 0 },
              ],
            })}
          />
        </ScrollView>
      </View>
      {dropdownVisible && suggestions.length > 0 && (
        <View style={styles.dropdown} onStartShouldSetResponder={() => true}>
          <FlatList
            data={suggestions}
            keyExtractor={(item) => item.placeId}
            keyboardShouldPersistTaps="always"
            style={styles.dropdownList}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.dropdownItem}
                onPress={() => handleSelect(item)}
                activeOpacity={0.7}
              >
                <Text style={styles.dropdownItemText} numberOfLines={2}>
                  {item.text}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}
      {loading && query.length >= MIN_QUERY_LENGTH && (
        <View style={styles.loadingRowAbsolute}>
          <Text style={styles.loadingText}>Searching...</Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    minHeight: 56,
    position: 'relative',
  },
  containerRaised: {
    zIndex: 10000,
    elevation: 24,
  },
  inputRow: {
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
  inputRowDisabled: {
    opacity: 0.6,
    backgroundColor: '#F5F5F5',
  },
  icon: {
    marginRight: 12,
  },
  chipsScroll: {
    flex: 1,
    maxHeight: 56,
  },
  chipsContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 8,
  },
  chipWrap: {
    marginRight: 4,
  },
  textInput: {
    minWidth: 120,
    flex: 1,
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    fontWeight: '400',
    color: colors.textPrimary,
    paddingVertical: 4,
    paddingHorizontal: 0,
  },
  textInputDisabled: {
    color: '#999',
  },
  dropdown: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 58,
    backgroundColor: '#fff',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 24,
    zIndex: 10001,
    maxHeight: 240,
  },
  dropdownList: {
    maxHeight: 236,
  },
  dropdownItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E4E4E4',
  },
  dropdownItemText: {
    fontSize: 15,
    color: '#333333',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
  },
  loadingRowAbsolute: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 58,
    paddingVertical: 4,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    zIndex: 9999,
  },
  loadingText: {
    fontSize: 12,
    color: '#888',
  },
});
