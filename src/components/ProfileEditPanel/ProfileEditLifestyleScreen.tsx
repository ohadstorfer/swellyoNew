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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LIFESTYLE_ICON_MAP, EXCLUDED_FROM_SCORING_KEYWORDS } from '../../utils/lifestyleIconMap';

type Props = {
  visible: boolean;
  mode?: 'edit' | 'add';
  onClose: () => void;
  keyword: string | null;
  existingKeywords: string[];
  onSave?: (keyword: string) => void | Promise<void>;
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
  brandTeal: '#0788B0',
};

const capitalize = (s: string) =>
  s
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map(w => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');

export const ProfileEditLifestyleScreen: React.FC<Props> = ({
  visible,
  mode = 'edit',
  onClose,
  keyword,
  existingKeywords,
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

  // Lift the sheet above the on-screen keyboard. Mirrors ProfileEditDestinationScreen.
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

  const [selectedKeyword, setSelectedKeyword] = useState<string>('');
  const [customMode, setCustomMode] = useState<boolean>(false);
  const [customText, setCustomText] = useState<string>('');

  // Sync state on closed→open transition only (matches destination screen pattern).
  const prevVisibleRef = useRef(visible);
  useEffect(() => {
    if (visible && !prevVisibleRef.current) {
      if (mode === 'add') {
        setSelectedKeyword('');
        setCustomMode(false);
        setCustomText('');
      } else {
        const k = (keyword ?? '').toLowerCase();
        if (k && Object.prototype.hasOwnProperty.call(LIFESTYLE_ICON_MAP, k)) {
          setSelectedKeyword(k);
          setCustomMode(false);
          setCustomText('');
        } else {
          setSelectedKeyword('');
          setCustomMode(true);
          setCustomText(keyword ?? '');
        }
      }
    }
    prevVisibleRef.current = visible;
  }, [visible, mode, keyword]);

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

  // In add mode hide chips already in the user's list. In edit mode keep the
  // current keyword's chip visible so the user can see it's selected — even
  // if it's an excluded-from-scoring keyword (legacy data); the scoring filter
  // applies to all other chips.
  const visibleChips = useMemo(() => {
    const taken = new Set(existingKeywords.map(k => k.toLowerCase()));
    const current = (keyword ?? '').toLowerCase();
    const all = Object.keys(LIFESTYLE_ICON_MAP);
    return all.filter(k => {
      if (mode === 'edit' && k === current) return true;
      if (EXCLUDED_FROM_SCORING_KEYWORDS.has(k)) return false;
      return !taken.has(k);
    });
  }, [existingKeywords, mode, keyword]);

  const handleDelete = useCallback(() => {
    if (!onDelete) return;
    const label = (keyword || 'this interest').toString();
    Alert.alert(
      'Remove lifestyle',
      `Remove ${capitalize(label)} from your lifestyle?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
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
  }, [onDelete, onClose, keyword]);

  const handleSave = useCallback(async () => {
    const raw = customMode ? customText.trim() : selectedKeyword;
    const final = raw.toLowerCase();
    if (!final) {
      Alert.alert('Lifestyle', 'Pick or type an interest first.');
      return;
    }
    if (final.length > 30) {
      Alert.alert('Lifestyle', 'Keep it under 30 characters.');
      return;
    }
    if (mode === 'add') {
      const dup = existingKeywords.some(k => k.toLowerCase() === final);
      if (dup) {
        Alert.alert('Already added', `"${capitalize(final)}" is already in your lifestyle.`);
        return;
      }
    } else if ((keyword ?? '').toLowerCase() === final) {
      onClose();
      return;
    }
    try {
      if (onSave) {
        await onSave(final);
      }
      onClose();
    } catch {
      // Parent surfaced alert — keep editor open for retry.
    }
  }, [customMode, customText, selectedKeyword, mode, existingKeywords, keyword, onSave, onClose]);

  if (!mounted) return null;

  return (
    <View style={styles.root} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View
        style={[styles.backdrop, { opacity: backdropOpacity }]}
        onTouchEnd={onClose}
      />
      <Animated.View
        style={[
          styles.sheet,
          {
            transform: [{ translateY }],
            paddingBottom: Math.max(insets.bottom, 16) + 24,
            marginBottom: keyboardHeight,
          },
        ]}
      >
        <View {...pan.panHandlers}>
          <View style={styles.handleRow}>
            <View style={styles.handle} />
          </View>

          <View style={styles.header}>
            <Text style={styles.title}>
              {mode === 'add' ? 'Add lifestyle' : 'Lifestyle interest'}
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

        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.chipGrid}>
            {visibleChips.map(kw => {
              const active = !customMode && selectedKeyword === kw;
              const iconName = (LIFESTYLE_ICON_MAP[kw] ?? 'ellipse-outline') as any;
              return (
                <TouchableOpacity
                  key={kw}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => {
                    setSelectedKeyword(kw);
                    setCustomMode(false);
                    setCustomText('');
                    Keyboard.dismiss();
                  }}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name={iconName}
                    size={16}
                    color={active ? FIGMA.brandTeal : FIGMA.textSecondary}
                  />
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {capitalize(kw)}
                  </Text>
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity
              style={[styles.chip, customMode && styles.chipActive]}
              onPress={() => {
                setCustomMode(true);
                setSelectedKeyword('');
              }}
              activeOpacity={0.75}
            >
              <Ionicons
                name="create-outline"
                size={16}
                color={customMode ? FIGMA.brandTeal : FIGMA.textSecondary}
              />
              <Text style={[styles.chipText, customMode && styles.chipTextActive]}>
                Other
              </Text>
            </TouchableOpacity>
          </View>

          {customMode ? (
            <View style={styles.customField}>
              <TextInput
                style={styles.customInput}
                value={customText}
                onChangeText={setCustomText}
                placeholder="Type your interest"
                placeholderTextColor={FIGMA.textLight}
                autoFocus
                autoCapitalize="words"
                maxLength={30}
                returnKeyType="done"
                onSubmitEditing={handleSave}
              />
            </View>
          ) : null}
        </ScrollView>

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
            accessibilityLabel="Remove lifestyle interest"
          >
            <Ionicons name="trash-outline" size={18} color="#FF3B30" />
            <Text style={styles.deleteButtonText}>
              {deleting ? 'Removing...' : 'Remove interest'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </Animated.View>
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
    maxHeight: '85%',
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
  body: {
    maxHeight: 380,
  },
  bodyContent: {
    paddingBottom: 8,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: FIGMA.fieldBorder,
    backgroundColor: '#FFFFFF',
  },
  chipActive: {
    borderColor: FIGMA.brandTeal,
    backgroundColor: '#0788B014',
  },
  chipText: {
    fontSize: 14,
    lineHeight: 18,
    color: FIGMA.textPrimary,
  },
  chipTextActive: {
    color: FIGMA.brandTeal,
    fontWeight: '600',
  },
  customField: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: FIGMA.fieldBorder,
    backgroundColor: FIGMA.fieldBg,
    marginTop: 16,
  },
  customInput: {
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
    color: FIGMA.textPrimary,
    ...(Platform.OS === 'web' && {
      // @ts-ignore web-only outline removal
      outlineStyle: 'none' as any,
    }),
  },
  saveButton: {
    height: 56,
    borderRadius: 12,
    backgroundColor: FIGMA.buttonBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
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

export default ProfileEditLifestyleScreen;
