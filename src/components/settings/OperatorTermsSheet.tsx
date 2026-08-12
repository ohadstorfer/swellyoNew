/**
 * Swellyo's operator terms — the page they are agreed on.
 *
 * The document itself lives in services/terms/operatorAgreement.ts, not here.
 * This file knows how to RENDER an agreement and take a tick; it knows nothing
 * about what the agreement says. That split is what makes the lawyer's text a
 * one-file swap instead of an edit threaded through JSX.
 *
 * ⚠️ WHAT IS SHOWN IS A SUMMARY, NOT A CONTRACT — and the sheet says so, at the
 * top, before anything else. See the header of operatorAgreement.ts for why a
 * described deal beats both an empty panel and invented clauses.
 *
 * ── The two details that matter here ────────────────────────────────────────
 * 1. A pinned footer. The agree button must never scroll away, so the list
 *    gets `flexShrink: 1` and gives up height to it rather than pushing it off.
 * 2. A fade at the bottom edge of the scroll, which lifts once the reader
 *    reaches the end. A document that is cut off by a hard edge looks finished
 *    when it is not, and somebody agreeing to terms they did not know continued
 *    is the exact failure this screen exists to prevent. Opacity only, 160ms —
 *    it is an affordance, not decoration, and reduced-motion users still need
 *    it, which is why nothing here moves.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '../BottomSheetShell';
import { ff } from '../../theme/fonts';
import { IS_DRAFT, LAST_REVIEWED, SECTIONS } from '../../services/terms/operatorAgreement';

const C = {
  ink: '#222B30',
  body: '#414651',
  muted: '#7B7B7B',
  line: '#EEEEEE',
  border: '#E4E4E4',
  accent: '#05BCD3',
  surface: '#F6F8F9',
  noticeBg: '#FFF8E8',
  noticeLine: '#F0DFB6',
  noticeInk: '#7A5A12',
};

/** Distance from the bottom that still counts as "read to the end". Momentum
 *  scrolling rarely lands on an exact zero, and a fade that refuses to lift
 *  reads as broken. */
const END_SLOP = 28;

export const OperatorTermsSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  /** True when they have already accepted the CURRENT version. */
  accepted: boolean;
  onAgree: () => Promise<void>;
}> = ({ visible, onClose, accepted, onAgree }) => {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;
  const viewportH = useRef(0);

  // Re-seed on open: an operator who closed without agreeing must not find the
  // box still ticked from last time.
  useEffect(() => {
    if (visible) {
      setChecked(accepted);
      setSaving(false);
      fade.setValue(1);
    }
  }, [visible, accepted, fade]);

  const setFade = (to: number) => {
    Animated.timing(fade, {
      toValue: to,
      duration: 160,
      useNativeDriver: true,
    }).start();
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const atEnd = contentOffset.y + layoutMeasurement.height >= contentSize.height - END_SLOP;
    setFade(atEnd ? 0 : 1);
  };

  // Content shorter than the viewport never scrolls, so `onScroll` never fires
  // and the fade would hang over a document with nothing below it.
  const onContentSize = (_w: number, h: number) => {
    if (viewportH.current > 0 && h <= viewportH.current + END_SLOP) fade.setValue(0);
  };

  const agree = async () => {
    if (!checked || saving) return;
    setSaving(true);
    try {
      await onAgree();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheetShell visible={visible} onClose={onClose} swipeToDismiss={false}>
      {({ panHandlers }) => (
        <View
          style={[
            styles.surface,
            { maxHeight: Math.round(height * 0.88), paddingBottom: Math.max(insets.bottom, 12) },
          ]}
        >
          <View {...panHandlers} style={styles.grabWrap}>
            <View style={styles.grabber} />
            <Text style={styles.title}>Swellyo operator terms</Text>
            <Text style={styles.sub}>For running paid trips on Swellyo.</Text>
          </View>

          <View style={styles.scrollWrap}>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollBody}
              onScroll={onScroll}
              scrollEventThrottle={32}
              onContentSizeChange={onContentSize}
              onLayout={e => {
                viewportH.current = e.nativeEvent.layout.height;
              }}
            >
              {IS_DRAFT ? (
                <View style={styles.notice}>
                  <Ionicons name="document-text-outline" size={18} color={C.noticeInk} />
                  <View style={styles.noticeText}>
                    <Text style={styles.noticeTitle}>This is a summary, not the final contract</Text>
                    <Text style={styles.noticeBody}>
                      It describes how Swellyo works today, in plain language, so you can
                      see the arrangement before the formal agreement is written. The full
                      legal document is being drafted — you will be asked to read and
                      accept it when it is ready.
                    </Text>
                  </View>
                </View>
              ) : null}

              {SECTIONS.map(section => (
                <View key={section.heading} style={styles.section}>
                  <Text style={styles.heading}>{section.heading}</Text>
                  {section.paragraphs.map(p => (
                    <Text key={p} style={styles.para}>
                      {p}
                    </Text>
                  ))}
                </View>
              ))}

              <Text style={styles.stamp}>Last reviewed {LAST_REVIEWED}</Text>
            </ScrollView>

            <Animated.View style={[styles.fade, { opacity: fade }]} pointerEvents="none">
              <LinearGradient
                colors={['rgba(255,255,255,0)', '#FFFFFF']}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          </View>

          <View style={styles.footer}>
            <Pressable
              onPress={() => setChecked(v => !v)}
              disabled={saving}
              style={({ pressed }) => [styles.checkRow, pressed && !saving && styles.pressed]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
            >
              <View style={[styles.box, checked && styles.boxOn]}>
                {checked ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
              </View>
              <Text style={styles.checkLabel}>
                {IS_DRAFT
                  ? 'I agree to Swellyo’s operator terms as summarised here, and to review the full agreement when it is published.'
                  : 'I agree to Swellyo’s operator terms.'}
              </Text>
            </Pressable>

            <Pressable
              onPress={agree}
              disabled={!checked || saving}
              style={({ pressed }) => [
                styles.btn,
                (!checked || saving) && styles.btnDisabled,
                pressed && checked && !saving && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !checked || saving }}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.btnText}>{accepted ? 'Done' : 'Agree'}</Text>
              )}
            </Pressable>
          </View>
        </View>
      )}
    </BottomSheetShell>
  );
};

const styles = StyleSheet.create({
  surface: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  grabWrap: { alignItems: 'center', paddingTop: 10, paddingHorizontal: 20, paddingBottom: 14 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, marginBottom: 12 },
  title: {
    fontFamily: ff('Inter', '700'),
    fontWeight: '700',
    fontSize: 19,
    lineHeight: 25,
    color: C.ink,
  },
  sub: {
    marginTop: 3,
    fontFamily: ff('Inter', '400'),
    fontWeight: '400',
    fontSize: 13,
    color: C.muted,
  },

  // flexShrink so the document gives up height to the pinned footer — the agree
  // button must never scroll away.
  scrollWrap: { flexShrink: 1, borderTopWidth: 1, borderTopColor: C.line },
  scroll: { flexGrow: 0 },
  scrollBody: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24 },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 40 },

  notice: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: C.noticeBg,
    borderWidth: 1,
    borderColor: C.noticeLine,
    borderRadius: 12,
    padding: 14,
    marginBottom: 22,
  },
  noticeText: { flex: 1, gap: 4 },
  noticeTitle: {
    fontFamily: ff('Inter', '600'),
    fontWeight: '600',
    fontSize: 13.5,
    lineHeight: 19,
    color: C.noticeInk,
  },
  noticeBody: {
    fontFamily: ff('Inter', '400'),
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 19,
    color: C.noticeInk,
  },

  // 22 between sections against 10 between paragraphs: the gap has to carry the
  // grouping on its own here, because a legal document has no other visual
  // rhythm — no images, no cards, nothing but text down the page.
  section: { marginBottom: 22 },
  heading: {
    fontFamily: ff('Inter', '600'),
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 21,
    color: C.ink,
    marginBottom: 8,
  },
  para: {
    fontFamily: ff('Inter', '400'),
    fontWeight: '400',
    fontSize: 14,
    // 21 — a little looser than the app's usual 1.4, because this is the one
    // screen where somebody reads several hundred words in a row.
    lineHeight: 21,
    color: C.body,
    marginBottom: 10,
  },
  stamp: {
    fontFamily: ff('Inter', '400'),
    fontWeight: '400',
    fontSize: 12,
    color: C.muted,
    marginTop: 2,
  },

  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  boxOn: { backgroundColor: C.accent, borderColor: C.accent },
  checkLabel: {
    flex: 1,
    fontFamily: ff('Inter', '400'),
    fontWeight: '400',
    fontSize: 13.5,
    lineHeight: 19,
    color: C.ink,
  },

  btn: {
    height: 50,
    borderRadius: 99,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.4 },
  pressed: { transform: [{ scale: 0.97 }], opacity: 0.92 },
  btnText: {
    fontFamily: ff('Inter', '700'),
    fontWeight: '700',
    fontSize: 16,
    color: '#FFFFFF',
  },
});

export default OperatorTermsSheet;
