/**
 * Step 5 — liability insurance, sent to Swellyo for review (Figma 15265-76107,
 * submitted sheet 15265-76582).
 *
 * ── Reviewed, not just uploaded ─────────────────────────────────────────────
 * Submitting does NOT finish the step. An admin approves it with
 * `review_operator_insurance()`; until then the checklist says "In review"
 * (Ohad, 15 Sep). Any change to the file or the three fields is a new
 * submission — the DB trigger puts it back to pending, whatever the client
 * sends. So Submit only appears when something actually changed.
 *
 * ── The file waits for Submit ───────────────────────────────────────────────
 * Picking a file only holds it. Uploading on pick would store a certificate
 * with no provider or policy number, and trigger a review of half a form.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { saveOperatorSettings } from '../../../../services/trips/operatorSettingsService';
import { uploadOperatorInsurance } from '../../../../services/trips/tripDocumentsService';
import { insuranceBlock, localToday } from '../../../../services/trips/operatorSetup';
import { showErrorAlert } from '../../../../utils/friendlyError';
import { TripIcon } from '../../../../components/trips/tripIcons';
import { BottomSheetShell } from '../../../../components/BottomSheetShell';
import { textStyle, textStyles } from '../../../../theme/typography';
import { useWizard } from '../OperatorSetupWizard';
import { C, DashedUpload, FOOTER_SPACE, StatusNote, StepHeading, useWizardFooter } from '../setupUi';

/** Matches the DB length check (80), with the counter the design shows. */
const MAX_TEXT = 80;

interface PickedFile {
  uri: string;
  name: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function formatDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function dateToIso(d: Date): string {
  return localToday(d);
}

export const InsuranceStep: React.FC = () => {
  const { settings, reload, next } = useWizard();
  const insets = useSafeAreaInsets();
  const stored = settings.insurance;
  const block = insuranceBlock(settings);

  const [provider, setProvider] = useState(stored?.provider ?? '');
  const [policyNumber, setPolicyNumber] = useState(stored?.policyNumber ?? '');
  const [expiresOn, setExpiresOn] = useState(stored?.expiresOn ?? '');
  const [file, setFile] = useState<PickedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickingDate, setPickingDate] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const advanceRef = useRef(false);

  const today = localToday();
  const dirty =
    file !== null ||
    provider.trim() !== (stored?.provider ?? '') ||
    policyNumber.trim() !== (stored?.policyNumber ?? '') ||
    expiresOn !== (stored?.expiresOn ?? '');

  const problem = useMemo(() => {
    if (!provider.trim()) return 'Add your insurance provider.';
    if (!policyNumber.trim()) return 'Add your policy number.';
    if (!DATE_RE.test(expiresOn)) return 'Add the expiration date.';
    if (expiresOn < today) return 'That policy has already expired.';
    if (!file && !stored) return 'Upload your insurance document.';
    return null;
  }, [provider, policyNumber, expiresOn, today, file, stored]);

  const submit = async (): Promise<boolean> => {
    if (problem) return false;
    setBusy(true);
    try {
      let doc = stored
        ? { path: stored.path, name: stored.name, mime: stored.mime, sizeBytes: stored.sizeBytes, uploadedAt: stored.uploadedAt }
        : null;
      if (file) {
        const up = await uploadOperatorInsurance(file.uri, file.name, stored?.path ?? null);
        doc = {
          path: up.path,
          name: file.name,
          mime: up.mime,
          sizeBytes: up.sizeBytes,
          uploadedAt: new Date().toISOString(),
        };
      }
      await saveOperatorSettings({
        insurance: {
          ...doc!,
          provider: provider.trim(),
          policyNumber: policyNumber.trim(),
          expiresOn,
        },
      });
      await reload();
      setFile(null);
      return true;
    } catch (e) {
      showErrorAlert('Could not submit', e, 'That did not send. Please try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  useWizardFooter({
    label: dirty || !stored ? 'Submit for Review' : 'Continue',
    busy,
    disabled: (dirty || !stored) && problem !== null,
    onPress: async () => {
      if (!dirty && stored) return next();
      if (await submit()) {
        advanceRef.current = true;
        setSubmitted(true);
      }
    },
    // Only a complete form is sent. A half-filled one is kept on screen, not
    // saved: saving part of it would start a review of an incomplete record.
    onSaveExit: async () => (dirty && !problem ? submit() : true),
  });

  const pickFile = async () => {
    try {
      const DocumentPicker = require('expo-document-picker');
      const res = await DocumentPicker.getDocumentAsync({
        // Photo OR PDF — matches the storage policy's extension allowlist.
        type: ['application/pdf', 'image/jpeg', 'image/png', 'image/heic'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      const asset = !res.canceled ? res.assets?.[0] : null;
      if (!asset?.uri) return;
      setFile({ uri: asset.uri, name: asset.name ?? 'insurance.pdf' });
    } catch (e) {
      showErrorAlert('Could not open files', e, 'Could not open your files. Please try again.');
    }
  };

  const openDate = () => {
    if (Platform.OS === 'android') {
      const { DateTimePickerAndroid } = require('@react-native-community/datetimepicker');
      DateTimePickerAndroid.open({
        value: DATE_RE.test(expiresOn) ? new Date(`${expiresOn}T12:00:00`) : new Date(),
        mode: 'date',
        minimumDate: new Date(),
        onChange: (e: { type: string }, d?: Date) => {
          if (e.type === 'set' && d) setExpiresOn(dateToIso(d));
        },
      });
    } else {
      setPickingDate(true);
    }
  };

  const review =
    block === 'under_review'
      ? { tone: 'warn' as const, title: 'In review', body: 'Swellyo is checking your insurance. You can keep setting up meanwhile.' }
      : block === 'rejected'
        ? { tone: 'danger' as const, title: 'Not approved', body: settings.insuranceReview?.note || 'Please check the details and submit again.' }
        : block === 'expired'
          ? { tone: 'danger' as const, title: 'Expired', body: 'Add your renewed policy and submit it again.' }
          : block === null
            ? { tone: 'ok' as const, title: 'Approved', body: null }
            : null;

  const shownFile = file?.name ?? stored?.name ?? null;

  return (
    <>
      <KeyboardAwareScrollView
        contentContainerStyle={[s.body, { paddingBottom: FOOTER_SPACE }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={FOOTER_SPACE}
        showsVerticalScrollIndicator={false}
      >
        <StepHeading
          title="Add liability insurance"
          sub="Upload your current liability insurance so Swellyo can review it before you publish paid trips."
        />

        {review && !dirty ? (
          <View style={s.review}>
            <StatusNote tone={review.tone} title={review.title} body={review.body} />
          </View>
        ) : null}

        <View style={s.form}>
          <TextField
            label="Insurance provider"
            value={provider}
            onChange={setProvider}
            placeholder="e.g. Lloyds of London"
          />
          <TextField
            label="Policy number"
            value={policyNumber}
            onChange={setPolicyNumber}
            placeholder="e.g. POL-2025-08821"
            autoCapitalize="characters"
          />

          <View style={s.group}>
            <Text style={s.label}>Expiration date</Text>
            {Platform.OS === 'web' ? (
              // No native picker on web. A typed date, checked by the same rule.
              <View style={s.input}>
                <TripIcon name="calendar" size={24} color={C.icon} strokeWidth={0.67} />
                <TextInput
                  value={expiresOn}
                  onChangeText={t => setExpiresOn(t.replace(/[^0-9-]/g, '').slice(0, 10))}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={C.muted}
                  style={s.inputText}
                />
              </View>
            ) : (
              <Pressable
                onPress={openDate}
                accessibilityRole="button"
                accessibilityLabel="Expiration date"
                style={({ pressed }) => [s.input, pressed && s.pressedField]}
              >
                <TripIcon name="calendar" size={24} color={C.icon} strokeWidth={0.67} />
                <Text style={[s.inputText, !expiresOn && s.placeholder]}>
                  {DATE_RE.test(expiresOn) ? formatDay(expiresOn) : 'Select expiry date'}
                </Text>
              </Pressable>
            )}
          </View>

          <View style={s.docGroup}>
            <Text style={s.label}>Insurance document</Text>
            {shownFile ? (
              <View style={s.file}>
                {file ? (
                  <TripIcon name="file-06" size={18} color={C.icon} strokeWidth={1.33} />
                ) : (
                  <TripIcon name="check-circle-broken" size={18} color={C.ok} strokeWidth={1.33} />
                )}
                <View style={s.fileText}>
                  <Text style={s.fileName} numberOfLines={1}>
                    {shownFile}
                  </Text>
                  <Text style={s.fileSub}>{file ? 'Ready to submit' : 'Submitted'}</Text>
                </View>
                <Pressable
                  onPress={pickFile}
                  hitSlop={8}
                  accessibilityRole="button"
                  style={({ pressed }) => [s.replace, pressed && s.pressedField]}
                >
                  <Text style={s.replaceText}>Replace</Text>
                </Pressable>
              </View>
            ) : (
              <DashedUpload
                icon={<TripIcon name="file-shield-01" size={24} color={C.icon} strokeWidth={0.75} />}
                title="Upload PDF or image"
                sub="Tap to select a file"
                onPress={pickFile}
              />
            )}
          </View>

          {(dirty || !stored) && problem && (provider || policyNumber || expiresOn || file) ? (
            <Text style={s.hint}>{problem}</Text>
          ) : null}
        </View>
      </KeyboardAwareScrollView>

      {/* iOS date sheet. Android uses the system dialog; web types the date. */}
      <BottomSheetShell visible={pickingDate} onClose={() => setPickingDate(false)}>
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <View style={s.grabber} />
          {pickingDate ? (
            <IosDatePicker
              value={expiresOn}
              onChange={setExpiresOn}
            />
          ) : null}
          <Pressable
            onPress={() => {
              if (!DATE_RE.test(expiresOn)) setExpiresOn(today);
              setPickingDate(false);
            }}
            accessibilityRole="button"
            style={({ pressed }) => [s.sheetBtn, pressed && s.pressed]}
          >
            <Text style={s.sheetBtnText}>Done</Text>
          </Pressable>
        </View>
      </BottomSheetShell>

      {/* Moves on only once the Modal is fully gone. Unmounting this step
          while its Modal is still dismissing can strand an invisible view
          controller on iOS that swallows every touch. */}
      <BottomSheetShell
        visible={submitted}
        onClose={() => setSubmitted(false)}
        onDismissed={() => {
          if (advanceRef.current) {
            advanceRef.current = false;
            next();
          }
        }}
      >
        <View style={[s.sheet, s.sheetCenter, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <View style={s.grabber} />
          <View style={s.submittedBadge}>
            <TripIcon name="alert-triangle" size={24} color={C.icon} strokeWidth={1.5} />
          </View>
          <View style={s.submittedText}>
            <Text style={s.submittedTitle}>Insurance submitted</Text>
            <Text style={s.submittedBody}>
              We'll review your document. You can continue setting up your account while it is under review.
            </Text>
          </View>
          <Pressable
            onPress={() => setSubmitted(false)}
            accessibilityRole="button"
            style={({ pressed }) => [s.sheetBtn, s.sheetBtnFull, pressed && s.pressed]}
          >
            <Text style={s.sheetBtnText}>Continue</Text>
          </Pressable>
        </View>
      </BottomSheetShell>
    </>
  );
};

const TextField: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}> = ({ label, value, onChange, placeholder, autoCapitalize = 'words' }) => (
  <View style={s.group}>
    <View style={s.labelRow}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.counter}>
        {value.length} /{MAX_TEXT}
      </Text>
    </View>
    <View style={s.input}>
      <TripIcon name="pencil-04" size={24} color={C.ink} strokeWidth={1.5} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={C.muted}
        maxLength={MAX_TEXT}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        style={s.inputText}
        accessibilityLabel={label}
      />
    </View>
  </View>
);

const IosDatePicker: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const DateTimePicker = require('@react-native-community/datetimepicker').default;
  return (
    <DateTimePicker
      value={DATE_RE.test(value) ? new Date(`${value}T12:00:00`) : new Date()}
      mode="date"
      display="spinner"
      minimumDate={new Date()}
      onChange={(_e: unknown, d?: Date) => d && onChange(dateToIso(d))}
    />
  );
};

const s = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 35 },
  review: { marginTop: -8, marginBottom: 24 },
  form: { gap: 24 },
  group: { gap: 8 },
  docGroup: { gap: 16 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 4 },
  label: { ...textStyle('MB1', '700'), color: C.ink },
  counter: { ...textStyles.B3, color: C.muted },
  input: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.card,
  },
  inputText: { flex: 1, ...textStyles.MB2, color: C.ink, paddingVertical: 0 },
  placeholder: { color: C.muted },
  pressedField: { opacity: 0.7 },

  file: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.card,
  },
  fileText: { flex: 1 },
  fileName: { ...textStyle('MB1', '700'), color: C.ink },
  fileSub: { ...textStyles.B3, color: C.muted },
  replace: { paddingHorizontal: 8, paddingVertical: 4 },
  replaceText: { ...textStyle('MB2', '700'), color: C.accent },
  hint: { ...textStyles.B3, color: C.muted, paddingHorizontal: 4 },

  sheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    paddingHorizontal: 16,
  },
  sheetCenter: { alignItems: 'center', gap: 24 },
  grabber: {
    alignSelf: 'center',
    width: 80,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.muted,
    marginBottom: 16,
  },
  submittedBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#D98AF7',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#B72DF2',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.24,
    shadowRadius: 7,
    backgroundColor: C.card,
  },
  submittedText: { gap: 8, alignItems: 'center' },
  submittedTitle: { ...textStyles.MH5, color: C.ink, textAlign: 'center' },
  submittedBody: { ...textStyles.MB2, color: '#99A1AF', textAlign: 'center' },
  sheetBtn: {
    height: 56,
    borderRadius: 12,
    backgroundColor: C.header,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  sheetBtnFull: { alignSelf: 'stretch' },
  sheetBtnText: { ...textStyle('H6', '600'), fontSize: 16, color: '#FFFFFF' },
  pressed: { transform: [{ scale: 0.97 }] },
});
