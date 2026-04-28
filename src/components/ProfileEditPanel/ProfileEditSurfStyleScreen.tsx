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
import { BoardCarousel } from '../BoardCarousel';
import type { BoardType } from '../../screens/OnboardingStep1Screen';

type Props = {
  visible: boolean;
  onClose: () => void;
  initialBoardType?: string | null;
  onSave?: (boardId: number, boardName: string) => void | Promise<void>;
  saving?: boolean;
};

const SafeAreaContainer = Platform.OS === 'web' ? View : SafeAreaView;

const FIGMA = {
  bg: '#FFFFFF',
  border: '#EEEEEE',
  textPrimary: '#212121',
  textSecondary: '#7B7B7B',
  brandTeal: '#0788B0',
  dotInactive: '#CFCFCF',
  buttonBg: '#212121',
  buttonText: '#FFFFFF',
};

// Mirrors BOARD_TYPES from OnboardingStep1Screen.tsx:54.
const BOARD_TYPES: BoardType[] = [
  {
    id: 0,
    name: 'Short Board',
    imageUrl:
      'https://api.builder.io/api/v1/image/assets/TEMP/9761796f6e2272f3cacf14c4fc9342525bb54ff8?width=371',
  },
  {
    id: 1,
    name: 'Mid Length',
    imageUrl:
      'https://api.builder.io/api/v1/image/assets/TEMP/377f67727b21485479e873ed3d93c57611722f74?width=371',
  },
  {
    id: 2,
    name: 'Long Board',
    imageUrl:
      'https://api.builder.io/api/v1/image/assets/TEMP/4692a28e8ac444a82eec1f691f5f008c8a9bbc8e?width=371',
  },
  {
    id: 3,
    name: 'Soft Top',
    imageUrl:
      'https://api.builder.io/api/v1/image/assets/TEMP/1d104557a7a5ea05c3b36931c1ee56fd01a6d426?width=371',
  },
];

const BOARD_DB_TO_ID: Record<string, number> = {
  shortboard: 0,
  mid_length: 1,
  longboard: 2,
  soft_top: 3,
};

function dbBoardToId(boardType?: string | null): number {
  if (!boardType) return 0;
  return BOARD_DB_TO_ID[boardType.toLowerCase()] ?? 0;
}

export const ProfileEditSurfStyleScreen: React.FC<Props> = ({
  visible,
  onClose,
  initialBoardType,
  onSave,
  saving = false,
}) => {
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(false);
  const translateX = useRef(new Animated.Value(screenWidth)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const initialId = dbBoardToId(initialBoardType);
  const [selectedBoardId, setSelectedBoardId] = useState<number>(initialId);
  const [activeBoardIndex, setActiveBoardIndex] = useState<number>(
    BOARD_TYPES.findIndex(b => b.id === initialId) >= 0
      ? BOARD_TYPES.findIndex(b => b.id === initialId)
      : 0,
  );

  // Reset to the latest initial value each time the screen is opened — the
  // Sync only on closed→open transition. A re-run during interaction (e.g. the
  // parent context emitting after another save) would snap the carousel back
  // to the upstream value while the user is mid-swipe.
  const prevVisibleRef = useRef(visible);
  useEffect(() => {
    if (visible && !prevVisibleRef.current) {
      const id = dbBoardToId(initialBoardType);
      setSelectedBoardId(id);
      const idx = BOARD_TYPES.findIndex(b => b.id === id);
      setActiveBoardIndex(idx >= 0 ? idx : 0);
    }
    prevVisibleRef.current = visible;
  }, [visible, initialBoardType]);

  useEffect(() => {
    if (visible && !mounted) {
      translateX.setValue(screenWidth);
      backdropOpacity.setValue(0);
      setMounted(true);
      // Run the enter animation directly — we no longer rely on Modal's onShow.
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
      ]).start();
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

  const handleBoardSelect = useCallback((board: BoardType) => {
    setSelectedBoardId(board.id);
  }, []);

  const handleSave = useCallback(async () => {
    const board = BOARD_TYPES[activeBoardIndex];
    if (!board) return;
    try {
      if (onSave) await onSave(board.id, board.name);
      onClose();
    } catch {
      // Error already surfaced by parent — keep editor open for retry.
    }
  }, [activeBoardIndex, onSave, onClose]);

  if (!mounted) return null;

  const activeBoardName = BOARD_TYPES[activeBoardIndex]?.name ?? '';

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
                <Text style={styles.backButtonText}>Edit profile</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.headerSeparator} />

            <View style={styles.titleBlock}>
              <Text style={styles.title}>Surf style</Text>
              <Text style={styles.subtitle}>Knowing the board you ride</Text>
            </View>

            <View style={styles.carouselContainer}>
              <BoardCarousel
                boards={BOARD_TYPES}
                selectedBoardId={selectedBoardId}
                onBoardSelect={handleBoardSelect}
                onActiveIndexChange={setActiveBoardIndex}
              />
            </View>

            <View style={styles.labelContainer}>
              <Text style={styles.boardName}>{activeBoardName}</Text>
              <View style={styles.dotsRow}>
                {BOARD_TYPES.map((_b, idx) => (
                  <View
                    key={idx}
                    style={[
                      styles.dot,
                      idx === activeBoardIndex ? styles.dotActive : styles.dotInactive,
                    ]}
                  />
                ))}
              </View>
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
  carouselContainer: {
    flex: 1,
    width: '100%',
    paddingTop: 32,
    minHeight: 320,
  },
  labelContainer: {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  boardName: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
    color: '#000000',
    textAlign: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    width: 24,
    backgroundColor: FIGMA.brandTeal,
  },
  dotInactive: {
    width: 8,
    backgroundColor: FIGMA.dotInactive,
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

export default ProfileEditSurfStyleScreen;
