import React from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './Text';
import { colors, spacing } from '../styles/theme';
import { InlineMapView } from './MapPickerModal';
import { BottomSheetShell } from './BottomSheetShell';

const SHEET_HEIGHT = Math.round(Dimensions.get('window').height * 0.55);
const PREVIEW_MAP_HEIGHT = 240;

type Props = {
  visible: boolean;
  onClose: () => void;
  name: string;          // short label, e.g. "Ocean Beach, San Diego"
  full?: string | null;  // full formatted address
  lat?: number | null;
  lng?: number | null;
};

// Inline static-map HTML — centers on the spot, drops a marker, no UI.
// Same shape as the preview used in HomeBreakSearchSheet so the picker and
// the read-only sheet show identical visuals.
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

export const HomeBreakViewSheet: React.FC<Props> = ({ visible, onClose, name, full, lat, lng }) => {
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;
  // Android: pad past the system nav/gesture bar (iOS keeps the static 24).
  const insets = useSafeAreaInsets();

  const previewHtml =
    apiKey && typeof lat === 'number' && typeof lng === 'number'
      ? getPreviewMapHtml(apiKey, lat, lng, name)
      : null;

  return (
    <BottomSheetShell visible={visible} onClose={onClose} backdropColor="rgba(0,0,0,0.5)">
      {({ panHandlers }) => (
        <View style={[styles.sheet, Platform.OS === 'android' && { paddingBottom: Math.max(insets.bottom, 24) }]}>
          <View {...panHandlers}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>Home Break</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.body}>
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

            <View style={styles.meta}>
              <Text style={styles.name} numberOfLines={2}>{name}</Text>
              {full ? <Text style={styles.full} numberOfLines={2}>{full}</Text> : null}
            </View>
          </View>
        </View>
      )}
    </BottomSheetShell>
  );
};

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.white || '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
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
  body: { padding: 16, flex: 1 },
  mapBox: {
    height: PREVIEW_MAP_HEIGHT,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#F0F0F0',
  },
  mapFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mapFallbackText: { marginTop: 8, color: '#888', fontSize: 14 },
  meta: { paddingTop: 16 },
  name: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary || '#333333',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
  full: {
    marginTop: 4,
    fontSize: 14,
    color: colors.textSecondary || '#666',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
});
