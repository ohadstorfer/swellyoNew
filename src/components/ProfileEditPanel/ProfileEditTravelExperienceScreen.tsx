import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  TouchableOpacity,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { TravelExperienceSlider } from '../TravelExperienceSlider';

type Props = {
  visible: boolean;
  onClose: () => void;
  initialValue?: number | null;
  onSave?: (value: number) => void | Promise<void>;
  saving?: boolean;
};

const SafeAreaContainer = Platform.OS === 'web' ? View : SafeAreaView;

const FIGMA = {
  bg: '#FFFFFF',
  border: '#EEEEEE',
  textPrimary: '#212121',
  textSecondary: '#7B7B7B',
  buttonBg: '#212121',
  buttonText: '#FFFFFF',
};

export const ProfileEditTravelExperienceScreen: React.FC<Props> = ({
  visible,
  onClose,
  initialValue,
  onSave,
  saving = false,
}) => {
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(false);
  const translateX = useRef(new Animated.Value(screenWidth)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const initial = typeof initialValue === 'number' ? initialValue : 0;
  const [value, setValue] = useState<number>(initial);
  const [contentHeight, setContentHeight] = useState<number>(0);

  // Sync only on the closed→open transition, NOT on every re-render that
  // happens to flow a new initialValue. Otherwise, a parent re-render during a
  // drag (e.g. the user-profile context emitting) snaps the slider back to the
  // upstream value mid-interaction.
  const prevVisibleRef = useRef(visible);
  useEffect(() => {
    if (visible && !prevVisibleRef.current) {
      setValue(typeof initialValue === 'number' ? initialValue : 0);
    }
    prevVisibleRef.current = visible;
  }, [visible, initialValue]);

  useEffect(() => {
    if (visible && !mounted) {
      translateX.setValue(screenWidth);
      backdropOpacity.setValue(0);
      setMounted(true);
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 320,
          useNativeDriver: true,
        }),
        Animated.timing(translateX, {
          toValue: 0,
          duration: 520,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        // The @react-native-community/slider web impl caches its container's
        // pageX from getBoundingClientRect at onLayout time — which fires
        // while we're still translating in from the right. Without this nudge,
        // the slider reads its container as off-screen and snaps every drag
        // to minimumValue. A synthetic resize event flips the slider's
        // `containerPositionInvalidated` flag so the next pointer event
        // re-reads the current rect.
        if (finished && Platform.OS === 'web' && typeof window !== 'undefined') {
          window.dispatchEvent(new Event('resize'));
        }
      });
    }
  }, [visible, mounted, screenWidth, translateX, backdropOpacity]);

  useEffect(() => {
    if (mounted && !visible) {
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(translateX, {
          toValue: screenWidth,
          duration: 320,
          easing: Easing.bezier(0.64, 0, 0.78, 0),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [mounted, visible, screenWidth, translateX, backdropOpacity]);

  const handleSave = useCallback(async () => {
    try {
      if (onSave) await onSave(value);
      onClose();
    } catch {
      // Error already surfaced by parent — keep editor open for retry.
    }
  }, [value, onSave, onClose]);

  if (!mounted) return null;

  return (
    <View style={styles.root} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View
        style={[styles.backdrop, { opacity: backdropOpacity }]}
        pointerEvents="none"
      />
      <Animated.View
        style={[
          styles.panel,
          { width: screenWidth, transform: [{ translateX }] },
        ]}
      >
        <SafeAreaContainer style={styles.safeArea} edges={['top', 'bottom']}>
          <View
            style={[
              styles.backRow,
              { paddingTop: 6 },
            ]}
          >
            <TouchableOpacity
              style={styles.backButton}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-back" size={16} color={FIGMA.textPrimary} />
              <Text style={styles.backButtonText}>Back</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.headerSeparator} />

          <View style={styles.titleBlock}>
            <Text style={styles.title}>Travel experience</Text>
            <Text style={styles.subtitle}>What is your travel experience?</Text>
          </View>

          <View
            style={styles.sliderContainer}
            onLayout={e => setContentHeight(e.nativeEvent.layout.height)}
          >
            <TravelExperienceSlider
              value={value}
              onValueChange={setValue}
              availableHeight={contentHeight > 0 ? contentHeight : undefined}
              hideTitle
            />
          </View>

          <View
            style={[
              styles.saveButtonContainer,
              { paddingBottom: Math.max(insets.bottom, 24) },
            ]}
          >
            <TouchableOpacity
              onPress={handleSave}
              activeOpacity={0.85}
              disabled={saving}
              style={[styles.saveButton, saving && styles.saveButtonDisabled]}
            >
              <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaContainer>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    backgroundColor: FIGMA.bg,
  },
  safeArea: {
    flex: 1,
  },
  backRow: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    height: 40,
    minWidth: 70,
    paddingLeft: 8,
    paddingRight: 12,
    borderRadius: 48,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: FIGMA.border,
  },
  backButtonText: {
    fontSize: 12,
    lineHeight: 18,
    color: FIGMA.textPrimary,
  },
  headerSeparator: {
    height: 1,
    backgroundColor: FIGMA.border,
    marginHorizontal: 16,
  },
  titleBlock: {
    paddingTop: 32,
    paddingHorizontal: 16,
    paddingBottom: 12,
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 22,
    lineHeight: 32,
    fontWeight: '700',
    color: FIGMA.textPrimary,
    textAlign: 'center',
    ...Platform.select({
      web: { fontFamily: 'Montserrat, sans-serif' },
      default: { fontFamily: 'Montserrat' },
    }),
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: FIGMA.textSecondary,
    textAlign: 'center',
  },
  sliderContainer: {
    flex: 1,
    width: '100%',
  },
  saveButtonContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  saveButton: {
    height: 56,
    borderRadius: 12,
    backgroundColor: FIGMA.buttonBg,
    alignItems: 'center',
    justifyContent: 'center',
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
});

export default ProfileEditTravelExperienceScreen;
