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

/** Card-sized inline map: receives query from parent, sends PLACE_SELECTED on select. */
export interface InlineMapViewProps {
  htmlContent: string;
  width: number;
  height: number;
  query: string;
  onMessage: (payload: { type: string; place?: MapPickerPlace }) => void;
}

export function InlineMapView({ htmlContent, width, height, query, onMessage }: InlineMapViewProps) {
  const webViewRef = useRef<{ injectJavaScript: (script: string) => void } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendQuery = useCallback((q: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      const escaped = JSON.stringify(q);
      const script = `(function(){ var w = window.__receiveQuery; if(w) w(${escaped}); })();`;
      if (Platform.OS === 'web' && iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(JSON.stringify({ type: 'SEARCH_QUERY', query: q }), '*');
      } else if (webViewRef.current) {
        webViewRef.current.injectJavaScript(script);
      }
    }, 200);
  }, []);

  useEffect(() => {
    sendQuery(query);
  }, [query, sendQuery]);

  const handleLoad = useCallback(() => {
    sendQuery(query);
  }, [query, sendQuery]);

  const handleMessage = useCallback(
    (data: string) => {
      try {
        const payload = JSON.parse(data);
        if (payload.type === 'PLACE_SELECTED' && payload.place) {
          onMessage({ type: 'PLACE_SELECTED', place: payload.place as MapPickerPlace });
        }
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
      <View style={[styles.inlineMapContainer, containerStyle]}>
        <iframe
          ref={(el) => {
            iframeRef.current = el;
          }}
          title="Inline map"
          srcDoc={htmlContent}
          onLoad={handleLoad}
          tabIndex={0}
          style={{
            width,
            height,
            border: 'none',
            borderRadius: 8,
            touchAction: 'pan-y',
          } as React.CSSProperties}
          sandbox="allow-scripts allow-same-origin"
        />
      </View>
    );
  }

  return (
    <View style={[styles.inlineMapContainer, containerStyle]}>
      {WebView && (
        <WebView
          ref={(r: { injectJavaScript: (script: string) => void } | null) => {
            webViewRef.current = r;
          }}
          source={{ html: htmlContent }}
          style={[styles.inlineWebView, { width, height }]}
          onMessage={(e: { nativeEvent: { data: string } }) => handleMessage(e.nativeEvent.data)}
          onLoadEnd={handleLoad}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          nestedScrollEnabled
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
  query: string;
  onMessage: (payload: { type: string; place?: MapPickerPlace }) => void;
  onClose: () => void;
}

export function MapPopover({
  visible,
  inputRowHeight,
  htmlContent,
  query,
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
      <Pressable style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]} onPress={onClose} />
      {overlaySize.width > 0 && overlaySize.height > 0 && (
        <InlineMapView
          htmlContent={htmlContent}
          width={overlaySize.width}
          height={overlaySize.height}
          query={query}
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
      <SafeAreaView style={styles.container}>
        {header}
        <View style={styles.mapContainer}>
          {WebView && (
            <WebView
              source={{ html: htmlContent }}
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
