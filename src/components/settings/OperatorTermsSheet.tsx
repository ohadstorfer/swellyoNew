/**
 * Swellyo's operator agreement — the page it is read on (Figma 15286-77957).
 *
 * The document itself lives in services/terms/operatorAgreement.ts, not here.
 * This file knows how to RENDER an agreement; it knows nothing about what the
 * agreement says. That split is what makes the lawyer's text a one-file swap.
 *
 * ⚠️ WHAT IS SHOWN IS A SUMMARY, NOT A CONTRACT — and the sheet says so, at the
 * top, before anything else. See the header of operatorAgreement.ts. The
 * Figma's own sample clauses are NOT used; they were invented.
 *
 * ── Reading unlocks, signing happens on the step ────────────────────────────
 * This sheet no longer takes the agreement (15 Sep redesign). "I've read and
 * approved" only unlocks the signature on the setup step: full name + consent.
 * The button stays disabled until the reader reaches the end — a document cut
 * off by a hard edge looks finished when it is not, and approving terms you
 * did not know continued is the failure this screen exists to prevent.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
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
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '../BottomSheetShell';
import { TripIcon } from '../trips/tripIcons';
import { textStyle, textStyles } from '../../theme/typography';
import { IS_DRAFT, LAST_REVIEWED, SECTIONS } from '../../services/terms/operatorAgreement';

const C = {
  ink: '#333333',
  heading: '#101828',
  body: '#6A7282',
  muted: '#7B7B7B',
  page: '#F7F7F7',
  cta: '#212121',
  disabled: '#CFCFCF',
  noticeBg: '#FFF8E8',
  noticeLine: '#F0DFB6',
  noticeInk: '#7A5A12',
};

/** Distance from the bottom that still counts as "read to the end". Momentum
 *  scrolling rarely lands on an exact zero, and a button that refuses to
 *  unlock reads as broken. */
const END_SLOP = 28;

export const OperatorTermsSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  /** Fired by "I've read and approved". The sheet closes itself after. */
  onRead: () => void;
}> = ({ visible, onClose, onRead }) => {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [atEnd, setAtEnd] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;
  const viewportH = useRef(0);

  // Re-seed on open: every opening is a fresh read.
  useEffect(() => {
    if (visible) {
      setAtEnd(false);
      fade.setValue(1);
    }
  }, [visible, fade]);

  const reachEnd = (end: boolean) => {
    if (end && !atEnd) setAtEnd(true);
    // Opacity only, 160ms — an affordance, and nothing moves for reduced-motion users.
    Animated.timing(fade, { toValue: end ? 0 : 1, duration: 160, useNativeDriver: true }).start();
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    reachEnd(contentOffset.y + layoutMeasurement.height >= contentSize.height - END_SLOP);
  };

  // Content shorter than the viewport never scrolls, so `onScroll` never fires.
  const onContentSize = (_w: number, h: number) => {
    if (viewportH.current > 0 && h <= viewportH.current + END_SLOP) reachEnd(true);
  };

  const approve = () => {
    if (!atEnd) return;
    onRead();
    onClose();
  };

  return (
    <BottomSheetShell visible={visible} onClose={onClose}>
      {({ panHandlers }) => (
        <View
          style={[
            styles.surface,
            { maxHeight: Math.round(height * 0.84), paddingBottom: Math.max(insets.bottom, 12) + 12 },
          ]}
        >
          <View {...panHandlers} style={styles.grabWrap}>
            <View style={styles.grabber} />
            <Text style={styles.title}>Review the Operator Agreement</Text>
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
                  <TripIcon name="file-06" size={18} color={C.noticeInk} strokeWidth={1.33} />
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

              <Text style={styles.para}>Swellyo Operator Agreement</Text>
              <Text style={[styles.para, styles.gap]}>Last updated: {LAST_REVIEWED}</Text>

              {SECTIONS.map((section, i) => (
                <View key={section.heading} style={styles.gap}>
                  <Text style={styles.para}>
                    {i + 1}. {section.heading}
                  </Text>
                  {section.paragraphs.map(p => (
                    <Text key={p} style={styles.para}>
                      {p}
                    </Text>
                  ))}
                </View>
              ))}
            </ScrollView>

            <Animated.View style={[styles.fade, { opacity: fade }]} pointerEvents="none">
              <LinearGradient colors={['rgba(247,247,247,0)', C.page]} style={StyleSheet.absoluteFill} />
            </Animated.View>
          </View>

          <View style={styles.footer}>
            <Pressable
              onPress={approve}
              disabled={!atEnd}
              style={({ pressed }) => [
                styles.btn,
                !atEnd && styles.btnDisabled,
                pressed && atEnd && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !atEnd }}
              accessibilityHint={atEnd ? undefined : 'Scroll to the end of the agreement first'}
            >
              <Text style={[styles.btnText, !atEnd && styles.btnTextDisabled]}>
                I've read and approved
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </BottomSheetShell>
  );
};

const styles = StyleSheet.create({
  surface: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  grabWrap: { paddingTop: 2, paddingHorizontal: 16, paddingBottom: 12 },
  grabber: {
    alignSelf: 'center',
    width: 80,
    height: 4,
    borderRadius: 20,
    backgroundColor: C.muted,
    marginTop: 8,
    marginBottom: 16,
  },
  title: { ...textStyles.H6, color: C.heading },

  // flexShrink so the document gives up height to the pinned footer.
  scrollWrap: { flexShrink: 1, backgroundColor: C.page },
  scroll: { flexGrow: 0 },
  scrollBody: { padding: 16 },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 40 },

  notice: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: C.noticeBg,
    borderWidth: 1,
    borderColor: C.noticeLine,
    borderRadius: 12,
    padding: 12,
    marginBottom: 19.5,
  },
  noticeText: { flex: 1, gap: 4 },
  noticeTitle: { ...textStyle('B3', '600'), color: C.noticeInk },
  noticeBody: { ...textStyles.B3, color: C.noticeInk },

  // Figma body: 12 / 19.5, one blank line between blocks. A literal line
  // height — the loosest in the app, because this is where people read.
  para: { ...textStyles.B3, lineHeight: 19.5, color: C.body },
  gap: { marginBottom: 19.5 },

  footer: { paddingHorizontal: 16, paddingTop: 8 },
  btn: {
    height: 56,
    borderRadius: 12,
    backgroundColor: C.cta,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  btnDisabled: { backgroundColor: C.disabled },
  pressed: { transform: [{ scale: 0.97 }] },
  btnText: { ...textStyle('H6', '600'), fontSize: 16, color: '#FFFFFF' },
  btnTextDisabled: { color: C.muted },
});

export default OperatorTermsSheet;
