import React, { useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Animated,
  Modal,
} from 'react-native';
import { Text } from './Text';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface GalleryPermissionOverlayProps {
  visible: boolean;
  onAllow: () => void;
  onDismiss: () => void;
}

export function GalleryPermissionOverlay({ visible, onAllow, onDismiss }: GalleryPermissionOverlayProps) {
  const fade = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      fade.setValue(0);
      Animated.timing(fade, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    }
  }, [visible]);

  const handleDismiss = () => {
    Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      onDismiss();
    });
  };

  const handleAllow = () => {
    Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      onAllow();
    });
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleDismiss}>
      <Animated.View style={[styles.container, { opacity: fade, paddingTop: insets.top }]}>
        {/* Back button */}
        <TouchableOpacity style={[styles.backButton, { top: insets.top + 10 }]} onPress={handleDismiss} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={16} color="#333" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        {/* Content */}
        <View style={styles.content}>
          {/* Divider line */}
          <View style={styles.divider} />

          {/* Camera icon in circle */}
          <View style={styles.iconCircle}>
            <Ionicons name="camera-outline" size={84} color="#cfcfcf" />
          </View>

          {/* Title */}
          <Text style={styles.title}>Allow gallery access</Text>

          {/* Description */}
          <Text style={styles.description}>
            We use your gallery to upload profile photos and share surf moments. We never access your gallery without your action.
          </Text>
        </View>

        {/* Bottom buttons */}
        <View style={[styles.bottomButtons, { paddingBottom: insets.bottom + 24 }]}>
          <TouchableOpacity style={styles.allowButton} onPress={handleAllow} activeOpacity={0.8}>
            <Text style={styles.allowButtonText}>Allow</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleDismiss} activeOpacity={0.7}>
            <Text style={styles.maybeLaterText}>Maybe later</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  backButton: {
    position: 'absolute',
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEEEEE',
    borderRadius: 48,
    paddingLeft: 8,
    paddingRight: 12,
    paddingVertical: 10,
    height: 40,
    minWidth: 70,
    zIndex: 10,
  },
  backText: {
    fontSize: 12,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    color: '#333333',
    marginLeft: 4,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 102,
    paddingHorizontal: 16,
  },
  divider: {
    width: '100%',
    height: 1,
    backgroundColor: '#E3E3E3',
    marginBottom: 24,
  },
  iconCircle: {
    width: 170,
    height: 170,
    borderRadius: 999,
    borderWidth: 4,
    borderColor: '#CFCFCF',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat-Bold',
    color: '#333333',
    textAlign: 'center',
    lineHeight: 32,
    marginBottom: 8,
  },
  description: {
    fontSize: 16,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    color: '#333333',
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 12,
  },
  bottomButtons: {
    paddingHorizontal: 26,
    gap: 16,
    alignItems: 'center',
  },
  allowButton: {
    backgroundColor: '#212121',
    borderRadius: 12,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    minWidth: 150,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  allowButtonText: {
    fontSize: 18,
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat-SemiBold',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 24,
  },
  maybeLaterText: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    color: '#333333',
    textAlign: 'center',
    lineHeight: 22,
  },
});
