import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
  Platform,
  Animated,
  TouchableWithoutFeedback,
  Dimensions,
  ActivityIndicator,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { colors, spacing } from '../styles/theme';
import { InlineMapView } from './MapPickerModal';

const PLACES_AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const PLACE_DETAILS_URL = 'https://places.googleapis.com/v1/places';
const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const SHEET_HEIGHT = Math.round(Dimensions.get('window').height * 0.8);
const PREVIEW_MAP_HEIGHT = 220;

export type HomeBreakSelection = {
  placeId: string;
  full: string;       // e.g. "Ocean Beach, San Diego, CA, USA"
  short: string;      // e.g. "Ocean Beach, San Diego"
  name: string;       // e.g. "Ocean Beach"
  locality: string | null;
  country: string | null; // ISO-2
  lat: number | null;
  lng: number | null;
};

type HomeBreakSearchSheetProps = {
  visible: boolean;
  onClose: () => void;
  onSelect: (selection: HomeBreakSelection) => void;
};

type Suggestion = {
  placeId: string;
  mainText: string;
  secondaryText: string;
};

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// Generate a UUID v4 for Places session tokens. Same session token must be
// passed to autocomplete requests AND the final place-details call so the
// keystrokes are billed as one session, not per-request.
function generateSessionToken(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Walk addressComponents and pull out city + country code, with fallback chain
// for locality (locality → sublocality_level_1 → postal_town → admin_level_2).
function extractCityAndCountry(components: any[]): { locality: string | null; country: string | null } {
  let locality: string | null = null;
  let sublocality: string | null = null;
  let postalTown: string | null = null;
  let adminL2: string | null = null;
  let country: string | null = null;
  for (const comp of components || []) {
    const types: string[] = comp.types || [];
    const longText: string | undefined = comp.longText || comp.long_name;
    const shortText: string | undefined = comp.shortText || comp.short_name;
    if (!longText && !shortText) continue;
    if (types.includes('locality')) locality = longText || null;
    else if (types.includes('sublocality_level_1') || types.includes('sublocality')) sublocality = longText || null;
    else if (types.includes('postal_town')) postalTown = longText || null;
    else if (types.includes('administrative_area_level_2')) adminL2 = longText || null;
    if (types.includes('country')) country = (shortText || null);
  }
  return {
    locality: locality || sublocality || postalTown || adminL2,
    country,
  };
}

// Inline preview map: centers on the picked lat/lng, drops a single marker.
// Static (no UI), no message events — used only to confirm the user's pick.
function getPreviewMapHtml(apiKey: string, lat: number, lng: number, label: string): string {
  const safeKey = apiKey.replace(/[<>"']/g, '');
  const safeLabel = label.replace(/[<>"'\\]/g, '');
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html, body { margin: 0; height: 100%; font-family: system-ui, sans-serif; }
    #map { width: 100%; height: 100%; position: absolute; left: 0; top: 0; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    (function() {
      var API_KEY = '${safeKey}';
      var center = { lat: ${lat}, lng: ${lng} };
      function initMap() {
        var map = new google.maps.Map(document.getElementById('map'), {
          center: center,
          zoom: 13,
          mapTypeControl: false,
          fullscreenControl: false,
          streetViewControl: false,
          zoomControl: false,
          gestureHandling: 'none',
          disableDefaultUI: true,
        });
        new google.maps.Marker({ position: center, map: map, title: '${safeLabel}' });
      }
      window.initMap = initMap;
      var s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?key=' + API_KEY + '&callback=initMap';
      s.async = true; s.defer = true;
      document.head.appendChild(s);
    })();
  </script>
</body>
</html>`;
}

export const HomeBreakSearchSheet: React.FC<HomeBreakSearchSheetProps> = ({
  visible,
  onClose,
  onSelect,
}) => {
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolvingPlaceId, setResolvingPlaceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(visible);
  const [pending, setPending] = useState<HomeBreakSelection | null>(null);

  const overlayAnim = useRef(new Animated.Value(0)).current;
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const sessionTokenRef = useRef<string>(generateSessionToken());
  const requestSeqRef = useRef(0);
  const isMountedRef = useRef(true);
  const searchInputRef = useRef<TextInput>(null);

  // Swipe-down to dismiss
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => gs.dy > 4,
      onPanResponderMove: (_, gs) => {
        if (gs.dy > 0) {
          sheetAnim.setValue(Math.max(0, 1 - gs.dy / SHEET_HEIGHT));
        }
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 100 || gs.vy > 0.5) {
          onCloseRef.current();
        } else {
          Animated.spring(sheetAnim, {
            toValue: 1,
            tension: 65,
            friction: 11,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  const debouncedQuery = useDebounce(query, DEBOUNCE_MS);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setQuery('');
      setSuggestions([]);
      setError(null);
      setPending(null);
      sessionTokenRef.current = generateSessionToken();
      Animated.parallel([
        Animated.timing(overlayAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.spring(sheetAnim, { toValue: 1, tension: 65, friction: 11, useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(overlayAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(sheetAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (pending) return; // don't search while previewing
    const trimmed = debouncedQuery.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      return;
    }
    if (!apiKey) {
      setError('Places API key missing');
      return;
    }

    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch(PLACES_AUTOCOMPLETE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask':
              'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat',
          },
          body: JSON.stringify({
            input: trimmed,
            sessionToken: sessionTokenRef.current,
            includeQueryPredictions: false,
          }),
        });
        if (!isMountedRef.current || seq < requestSeqRef.current) return;
        if (!res.ok) {
          setSuggestions([]);
          setError('Search failed');
          return;
        }
        const data = await res.json();
        const list: Suggestion[] = [];
        for (const s of data.suggestions || []) {
          const pred = s.placePrediction;
          const sf = pred?.structuredFormat;
          if (pred?.placeId && sf?.mainText?.text) {
            list.push({
              placeId: pred.placeId,
              mainText: sf.mainText.text,
              secondaryText: sf.secondaryText?.text || '',
            });
          }
        }
        setSuggestions(list);
      } catch {
        if (isMountedRef.current && seq === requestSeqRef.current) {
          setSuggestions([]);
          setError('Network error');
        }
      } finally {
        if (isMountedRef.current && seq === requestSeqRef.current) setLoading(false);
      }
    })();
  }, [debouncedQuery, apiKey, pending]);

  const handlePick = async (s: Suggestion) => {
    if (!apiKey) return;
    setResolvingPlaceId(s.placeId);
    try {
      const res = await fetch(`${PLACE_DETAILS_URL}/${encodeURIComponent(s.placeId)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'id,formattedAddress,location,addressComponents,displayName',
          'X-Goog-Places-Session-Token': sessionTokenRef.current,
        },
      });
      if (!res.ok) {
        setError('Failed to resolve place');
        return;
      }
      const data = await res.json();
      const { locality, country } = extractCityAndCountry(data.addressComponents || []);
      const name = data.displayName?.text || s.mainText;
      const short = locality && locality !== name ? `${name}, ${locality}` : name;
      const selection: HomeBreakSelection = {
        placeId: data.id || s.placeId,
        full: data.formattedAddress || `${s.mainText}${s.secondaryText ? ', ' + s.secondaryText : ''}`,
        short,
        name,
        locality,
        country,
        lat: typeof data.location?.latitude === 'number' ? data.location.latitude : null,
        lng: typeof data.location?.longitude === 'number' ? data.location.longitude : null,
      };
      sessionTokenRef.current = generateSessionToken();
      setPending(selection);
    } catch {
      setError('Network error');
    } finally {
      setResolvingPlaceId(null);
    }
  };

  const handleConfirm = () => {
    if (pending) onSelect(pending);
  };

  // "Change" returns to the search state but preserves whatever the user
  // had typed and the suggestions list — so they're not forced to retype.
  // Also re-focuses the search input so the keyboard pops up immediately.
  const handleChangePick = () => {
    setPending(null);
    setTimeout(() => searchInputRef.current?.focus(), 50);
  };

  if (!mounted) return null;

  const sheetTranslate = sheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [SHEET_HEIGHT, 0],
  });

  const previewHtml =
    pending && apiKey && pending.lat != null && pending.lng != null
      ? getPreviewMapHtml(apiKey, pending.lat, pending.lng, pending.name)
      : null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.container}>
        <TouchableWithoutFeedback onPress={onClose}>
          <Animated.View style={[styles.overlay, { opacity: overlayAnim }]} />
        </TouchableWithoutFeedback>
        <Animated.View style={[styles.sheet, { transform: [{ translateY: sheetTranslate }] }]}>
          {/* Drag area — swipe down on the handle/header to dismiss */}
          <View {...pan.panHandlers}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>{pending ? 'Confirm Home Break' : 'Select Home Break'}</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
          </View>

          {pending ? (
            <View style={styles.previewWrap}>
              <View style={styles.mapBox}>
                {previewHtml ? (
                  <InlineMapView
                    htmlContent={previewHtml}
                    width={Dimensions.get('window').width - 32}
                    height={PREVIEW_MAP_HEIGHT}
                  />
                ) : (
                  <View style={styles.mapFallback}>
                    <Ionicons name="map-outline" size={32} color="#999" />
                    <Text style={styles.mapFallbackText}>Map unavailable for this place</Text>
                  </View>
                )}
              </View>

              <View style={styles.previewMeta}>
                <Text style={styles.previewName} numberOfLines={2}>{pending.short}</Text>
                <Text style={styles.previewFull} numberOfLines={2}>{pending.full}</Text>
              </View>

              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={handleChangePick} activeOpacity={0.7}>
                  <Text style={styles.secondaryBtnText}>Change</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.primaryBtn} onPress={handleConfirm} activeOpacity={0.7}>
                  <Text style={styles.primaryBtnText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <>
              <TextInput
                ref={searchInputRef}
                style={[styles.search, Platform.OS === 'web' && styles.searchWeb]}
                placeholder="Search beaches, breaks, spots..."
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
                autoCapitalize="words"
              />

              {error && <Text style={styles.errorText}>{error}</Text>}

              <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
                {loading && suggestions.length === 0 && (
                  <View style={styles.centerRow}>
                    <ActivityIndicator color="#00A2B6" />
                  </View>
                )}
                {!loading && suggestions.length === 0 && query.trim().length >= MIN_QUERY_LENGTH && (
                  <Text style={styles.noResults}>No places found</Text>
                )}
                {suggestions.map(s => {
                  const isResolving = resolvingPlaceId === s.placeId;
                  return (
                    <TouchableOpacity
                      key={s.placeId}
                      style={styles.item}
                      onPress={() => handlePick(s)}
                      disabled={!!resolvingPlaceId}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemMain} numberOfLines={1}>{s.mainText}</Text>
                        {!!s.secondaryText && (
                          <Text style={styles.itemSecondary} numberOfLines={1}>{s.secondaryText}</Text>
                        )}
                      </View>
                      {isResolving && <ActivityIndicator color="#00A2B6" />}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <Text style={styles.attribution}>Powered by Google</Text>
            </>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'flex-end' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.5)' },
  sheet: {
    backgroundColor: colors.white || '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    height: SHEET_HEIGHT,
    paddingBottom: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#D0D0D0',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    color: colors.textPrimary || '#333333',
  },
  closeBtn: { padding: spacing.xs },
  search: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    padding: spacing.md,
    margin: spacing.lg,
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    color: colors.textPrimary || '#333333',
  },
  searchWeb: { outlineStyle: 'none' as any },
  errorText: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    color: '#FF4444',
    fontSize: 14,
  },
  list: {
    flex: 1,
    ...(Platform.OS === 'web' && { overflowY: 'auto' as const }),
  },
  centerRow: { paddingVertical: spacing.lg, alignItems: 'center' },
  item: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  itemMain: {
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    color: colors.textPrimary || '#333333',
    fontWeight: '500',
  },
  itemSecondary: {
    fontSize: 13,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    color: colors.textSecondary || '#888888',
    marginTop: 2,
  },
  noResults: {
    padding: spacing.lg,
    textAlign: 'center',
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    color: colors.textSecondary || '#666666',
  },
  attribution: {
    textAlign: 'center',
    fontSize: 11,
    color: '#999',
    paddingVertical: 8,
  },
  previewWrap: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  mapBox: {
    height: PREVIEW_MAP_HEIGHT,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#F0F0F0',
  },
  mapFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapFallbackText: {
    marginTop: 8,
    color: '#888',
    fontSize: 14,
  },
  previewMeta: {
    paddingVertical: spacing.lg,
  },
  previewName: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary || '#333333',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
  previewFull: {
    marginTop: 4,
    fontSize: 14,
    color: colors.textSecondary || '#666',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 'auto',
    marginBottom: 12,
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: '#212121',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  secondaryBtn: {
    flex: 1,
    backgroundColor: '#F0F0F0',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#333',
    fontWeight: '600',
    fontSize: 16,
  },
});
