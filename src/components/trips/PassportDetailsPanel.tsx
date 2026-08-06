/**
 * PassportDetailsPanel — read a passport's details and put them on the clipboard.
 *
 * Opened from DocumentViewer while the operator is looking at a passport. It
 * reads the two code lines at the bottom of the page on the phone itself, shows
 * what it found, and copies it. Nothing is written to the database — see
 * passportScanService for why that is load-bearing rather than a preference.
 *
 * ── Three decisions worth keeping ────────────────────────────────────────────
 *
 * 1. A read that produced SOMETHING shows editable fields. A read that produced
 *    NOTHING shows no fields at all. The difference matters: on a partial read
 *    the operator is correcting a few characters, which is worth a form. On a
 *    failed read the form is seven empty boxes asking them to retype a passport
 *    into a screen whose only power is to copy it back out — a longer road to
 *    the same place as reading the photo. So a failed read says plainly that we
 *    could not read it and puts them back on the passport. Ohad, 5 August:
 *    "esta pantalla (con inputs de texto) no sirve… lo tiene que hacer él a mano."
 *
 * 2. A field whose check digit failed is marked, not hidden. Hiding it would
 *    mean the operator copies six fields and never learns the seventh was
 *    doubtful; marking it means they look at that one against the photo.
 *
 * 3. It is a LAYER, not a Modal. DocumentViewer already renders inline inside
 *    DocumentReviewScreen's Modal, and presenting a Modal from inside one is
 *    what strands an invisible view controller on iOS and kills every touch on
 *    the screen. One Modal per screen; everything else is a view inside it.
 *
 * Spec: docs/specs/operator-trips/passport-copy-details.md
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { KeyboardAvoidingView } from '../../utils/keyboardAvoidingView';
import { ff } from '../../theme/fonts';
import {
  EMPTY_FIELDS,
  FIELD_LABEL,
  FIELD_ORDER,
  formatPassportDetails,
  type PassportFieldKey,
  type PassportFields,
} from '../../services/trips/passportMrz';
import { scanPassport, SCAN_UNAVAILABLE_MESSAGE } from '../../services/trips/passportScanService';
import { friendlyErrorMessage } from '../../utils/friendlyError';

const ACCENT = '#05BCD3';
const WARN = '#E8A33D';

/** How the operator is told what to type, when the read came back blank. */
const FIELD_HINT: Record<PassportFieldKey, string> = {
  surname: 'As printed',
  givenNames: 'As printed',
  passportNumber: '',
  nationality: '3 letters, e.g. SLV',
  dateOfBirth: 'YYYY-MM-DD',
  sex: 'F, M or X',
  expiryDate: 'YYYY-MM-DD',
};

export const PassportDetailsPanel: React.FC<{
  visible: boolean;
  onClose: () => void;
  storagePath: string | null;
  travelerName?: string | null;
}> = ({ visible, onClose, storagePath, travelerName }) => {
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(false);
  const [fields, setFields] = useState<PassportFields>({ ...EMPTY_FIELDS });
  const [suspect, setSuspect] = useState<PassportFieldKey[]>([]);
  const [trusted, setTrusted] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enter = useSharedValue(0);
  const panelStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    // Only transform and opacity — nothing here triggers layout.
    transform: [{ translateY: (1 - enter.value) * 14 }],
  }));

  // Read the passport once per open. Re-reading on every render would mean a
  // fresh signed URL and a fresh download for nothing.
  useEffect(() => {
    if (!visible || !storagePath) {
      enter.value = 0;
      return;
    }

    let cancelled = false;
    setLoading(true);
    setCopied(false);
    setFields({ ...EMPTY_FIELDS });
    setSuspect([]);
    setTrusted(false);
    setProblem(null);
    enter.value = withTiming(1, { duration: 180 });

    (async () => {
      try {
        const result = await scanPassport(storagePath);
        if (cancelled) return;
        setFields(result.fields);
        setSuspect(result.suspect);
        setTrusted(result.trusted);
        setProblem(result.problem);
      } catch (e) {
        if (cancelled) return;
        // Never log the error object — it can carry the signed URL.
        setProblem(friendlyErrorMessage(e, 'Could not open this passport.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, storagePath, enter]);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const setField = useCallback((key: PassportFieldKey, value: string) => {
    setFields(prev => ({ ...prev, [key]: value }));
    // Typing over a doubtful field is the operator vouching for it.
    setSuspect(prev => prev.filter(k => k !== key));
    setCopied(false);
  }, []);

  const text = formatPassportDetails(fields);
  const canCopy = text.length > 0;

  const handleCopy = useCallback(async () => {
    if (!canCopy) return;
    await Clipboard.setStringAsync(text);
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2400);
  }, [canCopy, text]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.root, panelStyle]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={onClose} hitSlop={12} style={styles.iconBtn}>
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Passport details</Text>
            {!!travelerName && <Text style={styles.subtitle}>{travelerName}</Text>}
          </View>
          <View style={styles.iconBtn} />
        </View>

        {loading ? (
          <ReadingSkeleton />
        ) : problem ? (
          <CouldNotRead problem={problem} onClose={onClose} />
        ) : (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[styles.body, { paddingBottom: 24 }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <Banner trusted={trusted} suspectCount={suspect.length} />

            {FIELD_ORDER.map(key => (
              <Field
                key={key}
                fieldKey={key}
                value={fields[key]}
                suspect={suspect.includes(key)}
                onChange={setField}
              />
            ))}

            <Text style={styles.footnote}>
              Read on this phone. Nothing is saved — close this and it is gone.
            </Text>
          </ScrollView>
        )}

        {/* No Copy on a failed read — there is nothing to copy, and its own
            screen already gives the operator the one thing to do next. */}
        {!problem && (
          <View style={[styles.actions, { paddingBottom: insets.bottom + 16 }]}>
            <Pressable
              onPress={handleCopy}
              disabled={!canCopy || loading}
              style={({ pressed }) => [
                styles.copyBtn,
                (!canCopy || loading) && styles.btnDisabled,
                // Pressing must be felt. Subtle, and transform-only.
                pressed && styles.btnPressed,
              ]}
            >
              <Ionicons
                name={copied ? 'checkmark' : 'copy-outline'}
                size={18}
                color="#FFFFFF"
                style={styles.copyIcon}
              />
              <Text style={styles.copyText}>{copied ? 'Copied' : 'Copy details'}</Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </Animated.View>
  );
};

/**
 * Nothing was read. Say so, and hand the operator back the passport.
 *
 * The old version of this screen showed seven empty boxes here. That asked the
 * operator to type a passport into a form whose only job is to copy it back
 * out — strictly more work than reading the photo, which is what they will do
 * anyway. See note 1 at the top of this file.
 */
const CouldNotRead: React.FC<{ problem: string; onClose: () => void }> = ({
  problem,
  onClose,
}) => {
  const unavailable = problem === SCAN_UNAVAILABLE_MESSAGE;

  return (
    <View style={styles.failed}>
      <View style={styles.failedIcon}>
        <Ionicons name={unavailable ? 'phone-portrait-outline' : 'scan-outline'} size={26} color={WARN} />
      </View>

      <Text style={styles.failedTitle}>
        {unavailable ? 'Reading passports is off here' : 'Could not read this passport'}
      </Text>
      <Text style={styles.failedBody}>{problem}</Text>
      {!unavailable && (
        <Text style={styles.failedBody}>
          Open the photo and take the details off it yourself.
        </Text>
      )}

      <Pressable
        onPress={onClose}
        style={({ pressed }) => [styles.failedBtn, pressed && styles.btnPressed]}
      >
        <Text style={styles.failedBtnText}>Back to the passport</Text>
      </Pressable>
    </View>
  );
};

/** One line telling the operator how much to trust what they are looking at. */
/**
 * The form, drawn in grey, while the passport is being read.
 *
 * A spinner said "wait" and nothing else. This says what is being built — one
 * labelled box per field, in the order they will appear — so the read finishes
 * into a layout the operator has already been looking at.
 *
 * The banner slot is not left empty either: an OCR read of a photo takes a few
 * seconds and there is no way to guess why from an empty screen, so the one
 * line that explains it lives exactly where the result banner will.
 *
 * A group pulse rather than a sweep. The fields are separated boxes, not one
 * surface, and a band travelling across the gaps between them reads as a
 * glitch. The pulse stays above 0.5 opacity so nothing ever looks switched off.
 */
const ReadingSkeleton: React.FC = () => {
  const reducedMotion = useReducedMotion();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (reducedMotion) return;
    pulse.value = withRepeat(
      withSequence(
        withTiming(0.5, { duration: 780, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 780, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(pulse);
  }, [reducedMotion, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View style={styles.body}>
      <View style={[styles.banner, styles.bannerReading]}>
        <Text style={styles.bannerText}>Reading the passport…</Text>
        <Text style={styles.bannerSub}>
          The two code lines at the bottom hold every field.
        </Text>
      </View>
      <Animated.View style={pulseStyle}>
        {FIELD_ORDER.map(key => (
          <View key={key} style={styles.field}>
            <View style={styles.skelLabel} />
            <View style={styles.skelInput} />
          </View>
        ))}
      </Animated.View>
    </View>
  );
};

const Banner: React.FC<{
  trusted: boolean;
  suspectCount: number;
}> = ({ trusted, suspectCount }) => {
  if (trusted) {
    return (
      <View style={[styles.banner, styles.bannerOk]}>
        <Text style={styles.bannerText}>Read and checked.</Text>
        <Text style={styles.bannerSub}>
          The passport&apos;s own check digits agree with every field.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.banner, styles.bannerWarn]}>
      <Text style={styles.bannerText}>
        {suspectCount > 0
          ? `Check ${suspectCount === 1 ? 'the marked field' : 'the marked fields'} against the photo.`
          : 'This read could not be fully checked.'}
      </Text>
      <Text style={styles.bannerSub}>Close this to look at the passport again.</Text>
    </View>
  );
};

const Field: React.FC<{
  fieldKey: PassportFieldKey;
  value: string;
  suspect: boolean;
  onChange: (key: PassportFieldKey, value: string) => void;
}> = ({ fieldKey, value, suspect, onChange }) => (
  <View style={styles.field}>
    <View style={styles.fieldHead}>
      <Text style={styles.label}>{FIELD_LABEL[fieldKey]}</Text>
      {suspect && <Text style={styles.checkTag}>check this</Text>}
    </View>
    <TextInput
      value={value}
      onChangeText={t => onChange(fieldKey, t)}
      placeholder={FIELD_HINT[fieldKey]}
      placeholderTextColor="#6B6B6B"
      style={[styles.input, suspect && styles.inputSuspect]}
      autoCapitalize="characters"
      autoCorrect={false}
      spellCheck={false}
      // A passport is not a sentence; predictive text only gets in the way.
      keyboardType={Platform.OS === 'ios' ? 'ascii-capable' : 'visible-password'}
    />
  </View>
);

const styles = StyleSheet.create({
  // Covers DocumentViewer rather than presenting a new window. See note 3.
  root: { ...StyleSheet.absoluteFillObject, zIndex: 60, backgroundColor: '#0B0B0B' },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  headerText: { flex: 1, alignItems: 'center' },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: {
    fontFamily: ff('Inter', '600'),
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  subtitle: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    color: '#9A9A9A',
    marginTop: 1,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  centerText: {
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    color: '#9A9A9A',
  },
  body: { paddingHorizontal: 20, paddingTop: 4 },

  // The failed read. Centred and short — it is a full stop, not a form.
  failed: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    paddingBottom: 40,
  },
  failedIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(232,163,61,0.14)',
    marginBottom: 18,
  },
  failedTitle: {
    fontFamily: ff('Inter', '600'),
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 8,
  },
  failedBody: {
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    lineHeight: 20,
    color: '#9A9A9A',
    textAlign: 'center',
    marginBottom: 4,
  },
  failedBtn: {
    marginTop: 26,
    height: 44,
    borderRadius: 22,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  failedBtnText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  banner: { borderRadius: 12, padding: 12, marginBottom: 18 },
  bannerOk: { backgroundColor: 'rgba(5,188,211,0.14)' },
  bannerWarn: { backgroundColor: 'rgba(232,163,61,0.16)' },
  // Colourless on purpose — the read has not said "ok" or "check this" yet.
  bannerReading: { backgroundColor: 'rgba(255,255,255,0.07)' },
  bannerText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  bannerSub: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    color: '#C9C9C9',
    marginTop: 3,
  },

  field: { marginBottom: 14 },
  fieldHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  label: {
    fontFamily: ff('Inter', '500'),
    fontSize: 12,
    fontWeight: '500',
    color: '#9A9A9A',
  },
  checkTag: {
    fontFamily: ff('Inter', '600'),
    fontSize: 11,
    fontWeight: '600',
    color: WARN,
  },
  input: {
    fontFamily: ff('Inter', '500'),
    fontSize: 16,
    fontWeight: '500',
    color: '#FFFFFF',
    backgroundColor: '#1A1A1A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
  },
  inputSuspect: { borderColor: WARN },

  // Same box the real field draws, minus the text — matched by hand because
  // `input` sets its height through padding and font size.
  skelLabel: {
    width: 84,
    height: 10,
    borderRadius: 5,
    marginBottom: 8,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  skelInput: {
    height: Platform.OS === 'ios' ? 46 : 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#1A1A1A',
  },

  footnote: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    color: '#7A7A7A',
    marginTop: 6,
  },

  actions: { paddingHorizontal: 20, paddingTop: 12 },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: 24,
    backgroundColor: ACCENT,
  },
  copyIcon: { marginRight: 8 },
  copyText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  btnDisabled: { opacity: 0.45 },
  btnPressed: { transform: [{ scale: 0.97 }] },
});
