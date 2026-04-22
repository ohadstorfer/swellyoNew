import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  View,
  Modal,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  Platform,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from './Text';

// WebView is native-only; wrap in try/catch so Expo Go (which lacks the native module) doesn't crash
let WebView: any = null;
if (Platform.OS !== 'web') {
  try {
    WebView = require('react-native-webview').WebView;
  } catch {
    console.warn('react-native-webview not available, map picker will be disabled');
  }
}
import { colors } from '../styles/theme';

/**
 * Card-sized inline map. The WebView renders a static country-zoomed map
 * only — all autocomplete / selection is owned by native RN above this view.
 * onMessage only surfaces MAP_ERROR; PLACE_SELECTED no longer originates here.
 */
export interface InlineMapViewProps {
  htmlContent: string;
  width: number;
  height: number;
  onMessage?: (payload: { type: string; place?: MapPickerPlace }) => void;
}

export function InlineMapView({ htmlContent, width, height, onMessage }: InlineMapViewProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const handleMessage = useCallback(
    (data: string) => {
      if (!onMessage) return;
      try {
        const payload = JSON.parse(data);
        onMessage(payload);
      } catch {
        // ignore
      }
    },
    [onMessage]
  );

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      handleMessage(event.data);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [handleMessage]);

  const containerStyle = { width, height };

  if (Platform.OS === 'web') {
    return (
      // pointerEvents="none": the inline map is purely visual; blocking
      // touches here prevents the WebView/iframe from ever becoming first
      // responder (which would dismiss the IME and blur the native TextInput
      // above). All interactivity — suggestion list, selection — lives in RN.
      <View style={[styles.inlineMapContainer, containerStyle]} pointerEvents="none">
        <iframe
          ref={(el) => {
            iframeRef.current = el;
          }}
          title="Inline map"
          srcDoc={htmlContent}
          tabIndex={-1}
          style={{
            width,
            height,
            border: 'none',
            borderRadius: 8,
            pointerEvents: 'none',
          } as React.CSSProperties}
          sandbox="allow-scripts allow-same-origin"
        />
      </View>
    );
  }

  return (
    <View style={[styles.inlineMapContainer, containerStyle]} pointerEvents="none">
      {WebView && (
        <WebView
          source={{ html: htmlContent, baseUrl: 'https://swellyo.com' }}
          style={[styles.inlineWebView, { width, height }]}
          onMessage={(e: { nativeEvent: { data: string } }) => handleMessage(e.nativeEvent.data)}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          nestedScrollEnabled
          pointerEvents="none"
        />
      )}
    </View>
  );
}

export interface MapPickerPlace {
  name: string;
  placeId: string;
  lat: number;
  lng: number;
  formatted_address?: string;
}

export interface MapPopoverProps {
  visible: boolean;
  inputRowHeight: number;
  htmlContent: string;
  onMessage?: (payload: { type: string; place?: MapPickerPlace }) => void;
  onClose: () => void;
}

export function MapPopover({
  visible,
  inputRowHeight,
  htmlContent,
  onMessage,
  onClose,
}: MapPopoverProps) {
  const [overlaySize, setOverlaySize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <View
      style={[styles.mapOverlay, { top: inputRowHeight }]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setOverlaySize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
      }}
    >
      {/* Pressable forced non-interactive via the prop (not style) so no
          RN version variant can accidentally let it capture touches and
          trigger an onClose responder transition while the user is typing. */}
      <Pressable style={StyleSheet.absoluteFill} pointerEvents="none" onPress={onClose} />
      {overlaySize.width > 0 && overlaySize.height > 0 && (
        <InlineMapView
          htmlContent={htmlContent}
          width={overlaySize.width}
          height={overlaySize.height}
          onMessage={onMessage}
        />
      )}
      <TouchableOpacity
        style={styles.mapOverlayCloseButton}
        onPress={onClose}
        activeOpacity={0.8}
        accessibilityLabel="Close map"
      >
        <Text style={styles.mapOverlayCloseText}>Done</Text>
      </TouchableOpacity>
    </View>
  );
}

interface MapPickerModalProps {
  visible: boolean;
  htmlContent: string;
  onSelect: (place: MapPickerPlace) => void;
  onDone?: () => void;
  onCancel: () => void;
}

const MESSAGE_TYPE_PLACE_SELECTED = 'PLACE_SELECTED';
const MESSAGE_TYPE_PLACE_PICKER_DONE = 'PLACE_PICKER_DONE';

export function MapPickerModal({
  visible,
  htmlContent,
  onSelect,
  onDone,
  onCancel,
}: MapPickerModalProps) {
  const backHandlerRef = useRef<(() => void) | null>(null);

  const handleMessage = useCallback(
    (data: string) => {
      try {
        const payload = JSON.parse(data);
        if (payload.type === MESSAGE_TYPE_PLACE_SELECTED && payload.place) {
          onSelect(payload.place as MapPickerPlace);
        } else if (payload.type === MESSAGE_TYPE_PLACE_PICKER_DONE) {
          onDone?.();
          onCancel();
        }
      } catch {
        // ignore parse errors
      }
    },
    [onSelect, onDone, onCancel]
  );

  // Web: listen to window message events from iframe
  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;
    const handler = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      const origin = event.origin;
      const allowed = typeof window !== 'undefined' && (origin === window.location.origin || origin === 'null' || origin === '');
      if (!allowed && origin !== 'null') return;
      handleMessage(event.data);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [visible, handleMessage, Platform.OS]);

  // Android: hardware back closes modal
  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onCancel();
      return true;
    });
    return () => sub.remove();
  }, [visible, onCancel]);

  if (!visible) return null;

  const header = (
    <View style={styles.header}>
      <TouchableOpacity onPress={onCancel} style={styles.headerButton} accessibilityLabel="Cancel">
        <Text style={styles.headerButtonText}>Cancel</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Pick a place on map</Text>
      {/* <TouchableOpacity
        onPress={() => {
          onDone?.();
          onCancel();
        }}
        style={styles.headerButton}
        accessibilityLabel="Done"
      >
        <Text style={[styles.headerButtonText, styles.headerButtonPrimary]}>Done</Text>
      </TouchableOpacity> */}
    </View>
  );

  if (Platform.OS === 'web') {
    return (
      <Modal visible={visible} onRequestClose={onCancel} animationType="slide" transparent={false}>
        <View style={styles.container}>
          {header}
          <View style={styles.mapContainer}>
            <iframe
              title="Map picker"
              srcDoc={htmlContent}
              style={{
                width: '100%',
                flex: 1,
                border: 'none',
                alignSelf: 'stretch',
              } as React.CSSProperties}
              sandbox="allow-scripts allow-same-origin"
            />
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} onRequestClose={onCancel} animationType="slide">
      <SafeAreaView style={styles.container} edges={['top']}>
        {header}
        <View style={styles.mapContainer}>
          {WebView && (
            <WebView
              source={{ html: htmlContent, baseUrl: 'https://swellyo.com' }}
              style={styles.webView}
              onMessage={(e: { nativeEvent: { data: string } }) => handleMessage(e.nativeEvent.data)}
              originWhitelist={['*']}
              javaScriptEnabled
              domStorageEnabled
            />
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    height: 56,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#333',
  },
  headerButton: {
    padding: 8,
    minWidth: 60,
  },
  headerButtonText: {
    fontSize: 16,
    color: '#666',
  },
  headerButtonPrimary: {
    color: colors.primary ?? '#1a73e8',
    fontWeight: '600',
    textAlign: 'right',
  },
  mapContainer: {
    flex: 1,
  },
  webView: {
    flex: 1,
  },
  inlineMapContainer: {
    overflow: 'hidden',
    borderRadius: 8,
  },
  inlineWebView: {
    borderRadius: 8,
  },
  mapOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  mapOverlayCloseButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    zIndex: 25,
  },
  mapOverlayCloseText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
