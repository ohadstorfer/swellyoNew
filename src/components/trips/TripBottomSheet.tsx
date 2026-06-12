// TripBottomSheet — the single shared shell for every trip bottom sheet.
//
// Why this exists: all trip sheets used to hand-roll Modal + KeyboardAvoidingView
// + backdrop, and several had the keyboard-covers-input bug. This shell bakes in
// the correct structure (KAV wraps the whole bottom-anchored sheet so the entire
// sheet — body AND sticky footer — rises above the keyboard) and one consistent
// visual language (tokens below), so individual sheets only describe their content.
//
// Design language matches TripDetailView (Montserrat headings, Inter body).

import React from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSheetTransition } from '../../hooks/useSheetTransition';

const SHEET_MAX_HEIGHT = Dimensions.get('window').height * 0.9;

const FONT_HEAD = Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';
const FONT_BODY = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';

/** Shared design tokens — import these in every trip sheet for consistency. */
export const SHEET = {
  brandTeal: '#0788B0',
  brandTealText: '#066b8c',
  brandTealTint: '#E6F4F8',
  inkDark: '#212121',
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  border: '#E0E0E0',
  hairline: '#EEEEEE',
  surface: '#FFFFFF',
  surfaceMuted: '#F7F8F9',
  danger: '#C0392B',
  done: '#34C759',
  fontHead: FONT_HEAD,
  fontBody: FONT_BODY,
} as const;

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** When set, a back chevron shows on the left and calls this instead of close. */
  onBack?: () => void;
  /** Optional node on the right of the header (e.g. a Host tag). */
  headerRight?: React.ReactNode;
  /** Sticky footer pinned to the bottom (e.g. primary action button). */
  footer?: React.ReactNode;
  /** Wrap children in a scroll view (default true). Set false for custom bodies. */
  scroll?: boolean;
  children: React.ReactNode;
}

export const TripBottomSheet: React.FC<Props> = ({
  visible,
  onClose,
  title,
  subtitle,
  onBack,
  headerRight,
  footer,
  scroll = true,
  children,
}) => {
  // Backdrop fades in; the sheet itself slides up (separate animations).
  const { mounted, backdropOpacity, translateY, onSheetLayout } = useSheetTransition(visible);
  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      {/* KAV wraps the whole bottom-anchored sheet so the ENTIRE sheet (incl. the
          footer) rises above the keyboard, not just the body. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kavRoot}
      >
        <Pressable style={styles.container} onPress={onClose}>
          <Animated.View
            pointerEvents="none"
            style={[styles.backdrop, { opacity: backdropOpacity }]}
          />
          <Animated.View
            style={{ transform: [{ translateY }] }}
            onLayout={onSheetLayout}
          >
            <Pressable style={styles.sheet} onPress={e => e.stopPropagation()}>
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                {onBack ? (
                  <TouchableOpacity onPress={onBack} hitSlop={10} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={20} color={SHEET.inkBody} />
                  </TouchableOpacity>
                ) : null}
                <View style={styles.headerTitles}>
                  <Text style={styles.title}>{title}</Text>
                  {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
                </View>
              </View>
              <View style={styles.headerRight}>
                {headerRight}
                <TouchableOpacity onPress={onClose} hitSlop={10} style={styles.closeBtn}>
                  <Ionicons name="close" size={20} color={SHEET.inkBody} />
                </TouchableOpacity>
              </View>
            </View>

            {scroll ? (
              <ScrollView
                contentContainerStyle={styles.body}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {children}
              </ScrollView>
            ) : (
              <View style={styles.body}>{children}</View>
            )}

            {footer ? <View style={styles.footer}>{footer}</View> : null}
            </Pressable>
          </Animated.View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

export default TripBottomSheet;

const styles = StyleSheet.create({
  kavRoot: { flex: 1 },
  container: { flex: 1, justifyContent: 'flex-end' },
  // Fades in (opacity-animated); fills the whole screen behind the sheet.
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: SHEET.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: SHEET_MAX_HEIGHT,
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: SHEET.hairline,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 6 },
  backBtn: { marginLeft: -4 },
  headerTitles: { flex: 1 },
  title: {
    fontFamily: FONT_HEAD,
    fontSize: 18,
    fontWeight: '800',
    color: SHEET.inkDark,
  },
  subtitle: {
    fontFamily: FONT_BODY,
    fontSize: 13,
    color: SHEET.textMuted,
    marginTop: 2,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: SHEET.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 18,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: SHEET.hairline,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 22,
  },
});
