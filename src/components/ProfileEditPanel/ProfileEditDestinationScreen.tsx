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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CountrySearchModal } from '../CountrySearchModal';
import { DestinationDurationInput } from '../DestinationDurationInput';
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
        // Difference between layout viewport and visible viewport ≈ keyboard height.
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

  // Sync only on closed→open transition (see same pattern in slide-in editors).
  const prevVisibleRef = useRef(visible);
  useEffect(() => {
    if (visible && !prevVisibleRef.current) {
      if (mode === 'add') {
        setSelectedCountry('');
        const next = decomposeDaysForDurationInput(0);
        setDayValue(next.value);
        setTimeUnit(next.unit);
      } else {
        const next = decomposeDaysForDurationInput(destination?.time_in_days ?? 0);
        setDayValue(next.value);
        setTimeUnit(next.unit);
      }
    }
    prevVisibleRef.current = visible;
  }, [visible, mode, destination?.time_in_days]);

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
    const country =
      mode === 'add'
        ? selectedCountry.trim()
        : (destination?.country ?? '').trim();
    if (!country) {
      Alert.alert(
        mode === 'add' ? 'Select a country' : 'Missing country',
        mode === 'add' ? 'Choose where you surfed before saving.' : 'This destination has no country set.',
      );
      return;
    }
    const duration = computeDurationParts(dayValue, timeUnit);
    if (!duration) {
      Alert.alert('Duration', 'Enter a valid time spent (a number greater than zero).');
      return;
    }
    try {
      if (onSave) {
        await onSave({
          country,
          time_in_days: duration.timeInDays,
          time_in_text: duration.timeInText,
        });
      }
      onClose();
    } catch {
      // Error already surfaced by parent — keep editor open for retry.
    }
  }, [mode, selectedCountry, destination?.country, dayValue, timeUnit, onSave, onClose]);

  if (!mounted) return null;

  const displayCountry =
    mode === 'add' ? selectedCountry : destination?.country || '';

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
            // Lifts the sheet above the on-screen keyboard. When the keyboard
            // is hidden this is 0 and has no effect.
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

        {mode === 'add' ? (
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
        ) : (
          <View style={styles.countryField}>
            <Text style={styles.countryText} numberOfLines={1}>
              {destination?.country || 'Destination'}
            </Text>
            <Ionicons name="chevron-forward" size={20} color={FIGMA.textSecondary} />
          </View>
        )}

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
    marginBottom: 16,
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
