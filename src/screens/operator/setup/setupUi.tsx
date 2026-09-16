/**
 * The operator setup wizard's frame and the few pieces every step shares.
 *
 * Figma: Stripe 15225-20972 · Currency 15234-21385 · Policy 15244-21648 ·
 * Waiver 15258-74979 · Insurance 15265-76107 · Agreement 15286-77769.
 *
 * ── How a step talks to the footer ──────────────────────────────────────────
 * The chrome (header, progress, Continue, Save and Exit) stays mounted while
 * steps swap underneath it, so the progress bar can move instead of blinking.
 * A step describes its button with `useWizardFooter` — label and state go
 * through React state, the handlers through a ref, so a step re-rendering on
 * every keystroke never re-renders the chrome with a stale `onPress`.
 */
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { textStyle, textStyles } from '../../../theme/typography';
import { TripIcon } from '../../../components/trips/tripIcons';

// Figma variables: Text/M-01, Text/M-02, Stroke/M-04, Stroke/M-03, Surface/M-02,
// Fill/secondary, Green/M-200, Accent/100, Yellow/100.
export const C = {
  bg: '#FAFAFA',
  card: '#FFFFFF',
  ink: '#333333',
  icon: '#222B30',
  muted: '#7B7B7B',
  subtle: '#6A7282',
  line: '#EEEEEE',
  divider: '#CFCFCF',
  iconBg: '#F7F7F7',
  header: '#212121',
  track: '#333333',
  accent: '#05BCD3',
  ok: '#2BCCBD',
  okText: '#009689',
  danger: '#FF5367',
  warn: '#FFB443',
  warnSoft: '#FFF7EB',
  dangerSoft: '#FFF0F2',
  okSoft: '#EAFAF8',
  disabled: '#CFCFCF',
};

// Strong ease-out: the bar answers the tap at once and settles.
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

// ── Footer contract ─────────────────────────────────────────────────────────

export interface FooterConfig {
  label: string;
  onPress: () => void | Promise<void>;
  disabled?: boolean;
  busy?: boolean;
  /**
   * "Save and Exit". Omit when the step has nothing unsaved — the chrome then
   * just exits. Return false to stay (a save that failed).
   */
  onSaveExit?: () => Promise<boolean>;
}

interface FooterView {
  label: string;
  disabled: boolean;
  busy: boolean;
}

const FooterCtx = createContext<{
  setView: (v: FooterView) => void;
  handlers: React.MutableRefObject<FooterConfig | null>;
} | null>(null);

export function useWizardFooter(cfg: FooterConfig) {
  const ctx = useContext(FooterCtx);
  if (!ctx) throw new Error('useWizardFooter outside SetupWizardChrome');
  ctx.handlers.current = cfg;
  const { setView } = ctx;
  const disabled = Boolean(cfg.disabled);
  const busy = Boolean(cfg.busy);
  useEffect(() => {
    setView({ label: cfg.label, disabled, busy });
  }, [setView, cfg.label, disabled, busy]);
}

// ── Chrome ──────────────────────────────────────────────────────────────────

export const SetupWizardChrome: React.FC<{
  index: number;
  total: number;
  onBack: () => void;
  onExit: () => void;
  children: React.ReactNode;
}> = ({ index, total, onBack, onExit, children }) => {
  const insets = useSafeAreaInsets();
  const handlers = useRef<FooterConfig | null>(null);
  const [view, setView] = useState<FooterView>({ label: 'Continue', disabled: false, busy: false });
  const [saving, setSaving] = useState(false);
  const [trackW, setTrackW] = useState(0);

  // The fill slides in from the left rather than growing its width: a
  // transform stays off the layout pass.
  const progress = useSharedValue((index + 1) / total);
  useEffect(() => {
    progress.value = withTiming((index + 1) / total, { duration: 260, easing: EASE_OUT });
  }, [index, total, progress]);
  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -trackW * (1 - progress.value) }],
  }));

  // Android back goes a step back, like the chevron, instead of dropping the
  // whole wizard.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  const press = async () => {
    if (view.disabled || view.busy) return;
    await handlers.current?.onPress();
  };

  const saveExit = async () => {
    const save = handlers.current?.onSaveExit;
    if (!save) return onExit();
    setSaving(true);
    try {
      if (await save()) onExit();
    } finally {
      setSaving(false);
    }
  };

  const blocked = view.disabled || view.busy || saving;

  return (
    <FooterCtx.Provider value={{ setView, handlers }}>
      <View style={styles.root}>
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <View style={styles.headerRow}>
            <Pressable
              onPress={onBack}
              hitSlop={12}
              style={styles.headerSide}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <TripIcon name="chevron-left" size={32} color="#FFFFFF" strokeWidth={1.5} />
            </Pressable>
            <Text style={styles.headerTitle}>
              Step {index + 1} of {total}
            </Text>
            <Pressable
              onPress={onExit}
              hitSlop={12}
              style={[styles.headerSide, styles.headerRight]}
              accessibilityRole="button"
            >
              <Text style={styles.exit}>Exit</Text>
            </Pressable>
          </View>
          <View
            style={styles.track}
            onLayout={e => setTrackW(e.nativeEvent.layout.width)}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: total, now: index + 1 }}
          >
            {trackW > 0 ? <Animated.View style={[styles.fill, fillStyle]} /> : null}
          </View>
        </View>

        <View style={styles.body}>{children}</View>

        <View style={styles.footer} pointerEvents="box-none">
          <LinearGradient
            colors={['rgba(250,250,250,0)', 'rgba(250,250,250,0.9)', C.bg]}
            locations={[0, 0.3, 0.55]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={[styles.footerInner, { paddingBottom: Math.max(insets.bottom, 12) + 4 }]}>
            <Pressable
              onPress={press}
              disabled={blocked}
              style={({ pressed }) => [
                styles.cta,
                (view.disabled || saving) && styles.ctaDisabled,
                pressed && !blocked && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: blocked, busy: view.busy }}
            >
              {view.busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={[styles.ctaText, (view.disabled || saving) && styles.ctaTextDisabled]}>
                  {view.label}
                </Text>
              )}
            </Pressable>
            <Pressable
              onPress={saveExit}
              disabled={saving || view.busy}
              hitSlop={8}
              accessibilityRole="button"
              style={({ pressed }) => pressed && styles.pressedText}
            >
              {saving ? (
                <ActivityIndicator size="small" color={C.muted} />
              ) : (
                <Text style={styles.saveExit}>Save and Exit</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </FooterCtx.Provider>
  );
};

/** Room for the floating footer, so the last card is never under it. */
export const FOOTER_SPACE = 170;

// ── Shared pieces ───────────────────────────────────────────────────────────

export const StepHeading: React.FC<{ title: string; sub: string }> = ({ title, sub }) => (
  <View style={styles.heading}>
    <Text style={styles.title}>{title}</Text>
    <Text style={styles.sub}>{sub}</Text>
  </View>
);

/** The filled cyan circle with a white tick that marks a selected card. */
export const CheckBadge: React.FC = () => (
  <View style={styles.checkBadge}>
    <TripIcon name="check" size={14} color="#FFFFFF" strokeWidth={3} />
  </View>
);

/** A white card that takes the cyan ring when selected. */
export const SelectCard: React.FC<{
  selected?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  accessibilityLabel?: string;
  accessibilityRole?: 'radio' | 'button';
}> = ({ selected, onPress, style, children, accessibilityLabel, accessibilityRole = 'radio' }) => {
  const inner = <View style={[styles.card, selected && styles.cardOn, style]}>{children}</View>;
  if (!onPress) return inner;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityRole === 'radio' ? { selected: !!selected } : undefined}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {inner}
    </Pressable>
  );
};

export const IconTile: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <View style={styles.iconTile}>{children}</View>
);

/** Dashed drop area. The whole box is the button. */
export const DashedUpload: React.FC<{
  icon: React.ReactNode;
  title: string;
  sub: string;
  onPress: () => void;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}> = ({ icon, title, sub, onPress, busy, style }) => (
  <Pressable
    onPress={onPress}
    disabled={busy}
    accessibilityRole="button"
    accessibilityLabel={title}
    style={({ pressed }) => [styles.dashed, style, pressed && !busy && styles.pressed]}
  >
    {busy ? (
      <ActivityIndicator color={C.accent} />
    ) : (
      <>
        <View style={[styles.iconTile, styles.iconTileLg]}>{icon}</View>
        <Text style={styles.dashedTitle}>{title}</Text>
        <Text style={styles.dashedSub}>{sub}</Text>
      </>
    )}
  </Pressable>
);

/** A coloured one-line state: under review, not approved, and so on. */
export const StatusNote: React.FC<{
  tone: 'ok' | 'warn' | 'danger';
  title: string;
  body?: string | null;
}> = ({ tone, title, body }) => {
  const color = tone === 'ok' ? C.ok : tone === 'warn' ? C.warn : C.danger;
  const bg = tone === 'ok' ? C.okSoft : tone === 'warn' ? C.warnSoft : C.dangerSoft;
  const icon = tone === 'ok' ? 'check-circle-broken' : 'alert-triangle';
  return (
    <View style={[styles.note, { backgroundColor: bg }]}>
      <TripIcon name={icon} size={18} color={color} strokeWidth={1.33} />
      <View style={styles.noteText}>
        <Text style={[styles.noteTitle, { color }]}>{title}</Text>
        {body ? <Text style={styles.noteBody}>{body}</Text> : null}
      </View>
    </View>
  );
};

export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  header: { backgroundColor: C.header },
  headerRow: {
    height: 68,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  headerSide: { width: 72 },
  headerRight: { alignItems: 'flex-end', paddingRight: 8 },
  headerTitle: { flex: 1, textAlign: 'center', ...textStyles.MB2, color: '#FFFFFF' },
  exit: { ...textStyles.MB2, color: '#FFFFFF' },
  track: { height: 3, backgroundColor: C.track, overflow: 'hidden' },
  fill: { ...StyleSheet.absoluteFillObject, backgroundColor: C.accent },

  body: { flex: 1 },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 48 },
  footerInner: { paddingHorizontal: 40, gap: 16, alignItems: 'stretch' },
  cta: {
    height: 56,
    borderRadius: 12,
    backgroundColor: C.header,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  ctaDisabled: { backgroundColor: C.disabled },
  // Figma has two labels for this button (SF Pro 14 and Montserrat 16/22). The
  // Montserrat one matches the checklist's CTA, so the flow reads as one screen.
  ctaText: { ...textStyle('H6', '600'), fontSize: 16, color: '#FFFFFF' },
  ctaTextDisabled: { color: C.muted },
  saveExit: { ...textStyles.MB2, color: C.subtle, textAlign: 'center' },
  pressed: { transform: [{ scale: 0.97 }] },
  pressedText: { opacity: 0.6 },

  // Title sits a few px further in than the cards (x23 vs x16 in Figma).
  heading: { gap: 8, marginBottom: 32, paddingHorizontal: 6 },
  title: { ...textStyles.MH5, color: C.ink, paddingRight: 24 },
  sub: { ...textStyles.MB2, color: C.muted },

  card: {
    backgroundColor: C.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.line,
    padding: 12,
  },
  cardOn: { borderColor: C.accent },
  checkBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },

  iconTile: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: C.iconBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconTileLg: { width: 44, height: 44 },

  dashed: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: C.divider,
    borderRadius: 16,
    minHeight: 148,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    gap: 4,
  },
  dashedTitle: { ...textStyle('MB2', '700'), color: C.ink, marginTop: 12 },
  dashedSub: { ...textStyles.MB2, color: C.muted },

  note: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 12, alignItems: 'flex-start' },
  noteText: { flex: 1, gap: 2 },
  noteTitle: { ...textStyle('MB2', '600') },
  noteBody: { ...textStyles.B3, color: C.ink },
});
