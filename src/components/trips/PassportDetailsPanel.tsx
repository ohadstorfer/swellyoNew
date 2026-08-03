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
 * 1. Every field is EDITABLE, always. A passport read is a guess about a photo
 *    someone took on their kitchen table. A screen that shows a failed read and
 *    offers no way forward sends the operator back to squinting at the image and
 *    retyping — which is the thing this replaces. A blank editable form is a
 *    worse read but a better screen.
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
  ActivityIndicator,
  Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
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
import { scanPassport } from '../../services/trips/passportScanService';
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
          <View style={styles.center}>
            <ActivityIndicator color="#FFFFFF" />
            <Text style={styles.centerText}>Reading the passport…</Text>
          </View>
        ) : (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[styles.body, { paddingBottom: 24 }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <Banner problem={problem} trusted={trusted} suspectCount={suspect.length} />

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
      </KeyboardAvoidingView>
    </Animated.View>
  );
};

/** One line telling the operator how much to trust what they are looking at. */
const Banner: React.FC<{
  problem: string | null;
  trusted: boolean;
  suspectCount: number;
}> = ({ problem, trusted, suspectCount }) => {
  if (problem) {
    return (
      <View style={[styles.banner, styles.bannerWarn]}>
        <Text style={styles.bannerText}>{problem}</Text>
        <Text style={styles.bannerSub}>Type the details in from the photo.</Text>
      </View>
    );
  }

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

  banner: { borderRadius: 12, padding: 12, marginBottom: 18 },
  bannerOk: { backgroundColor: 'rgba(5,188,211,0.14)' },
  bannerWarn: { backgroundColor: 'rgba(232,163,61,0.16)' },
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
