/**
 * Operator setup — the four things settled once, before selling a trip.
 *
 * ── A CHECKLIST, NOT A WIZARD ───────────────────────────────────────────────
 * Deliberate. A stepper would be wrong here for three reasons:
 *
 *  1. Stripe cannot be finished in one sitting. It leaves the app, and it can
 *     come back `under_review` — a stepper would either trap the operator on
 *     step 1 or lie about it being done.
 *  2. The steps are independent. Nothing about a currency depends on a waiver,
 *     so forcing an order buys nothing and costs anyone who wants to do the
 *     easy ones first.
 *  3. They WILL leave and come back. A checklist reopens showing exactly what
 *     is left; a wizard reopens asking where they were.
 *
 * ── The sheets are the same ones Settings uses ──────────────────────────────
 * CurrencySheet and CancellationPolicySheet are not re-implemented here. An
 * operator who sets their policy in setup and edits it later in Settings must
 * be looking at the same control, or the two will drift into disagreeing about
 * what a policy even is.
 *
 * ── Confirming is the point, not changing ───────────────────────────────────
 * Currency and policy both arrive with working defaults, so an operator can
 * finish those steps without altering a thing. That is allowed and expected —
 * what setup asks is that they LOOKED. Hence "Use USD" rather than a disabled
 * button waiting for a change that may never be needed.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ff } from '../../theme/fonts';
import { useUserProfile } from '../../context/UserProfileContext';
import { showErrorAlert } from '../../utils/friendlyError';
import { ConnectStripeCard } from '../../components/trips/ConnectStripeCard';
import { CurrencySheet } from '../../components/settings/CurrencySheet';
import { CancellationPolicySheet } from '../../components/settings/CancellationPolicySheet';
import {
  fetchOperatorSettings,
  saveOperatorSettings,
  EMPTY_OPERATOR_SETTINGS,
  type OperatorSettings,
} from '../../services/trips/operatorSettingsService';
import {
  uploadDefaultWaiver,
  uploadOperatorInsurance,
} from '../../services/trips/tripDocumentsService';
import { OperatorTermsSheet } from '../../components/settings/OperatorTermsSheet';
import { summarise, PRESET_LABEL } from '../../services/trips/cancellationPolicy';
import {
  operatorSetupSteps,
  isOperatorSetupComplete,
  OPERATOR_TERMS_VERSION,
  type SetupStep,
  type SetupStepKey,
} from '../../services/trips/operatorSetup';
import { useConnectStatus } from '../../hooks/trips/useConnectStatus';
import { currencyForCountry, isCurrencyCode, type CurrencyCode } from '../../utils/currency';

const C = {
  ink: '#222B30',
  muted: '#7B7B7B',
  line: '#EEEEEE',
  border: '#E4E4E4',
  accent: '#05BCD3',
  accentSoft: '#EBFAFC',
  ok: '#2E9E5B',
  okSoft: '#EAF7EF',
  warn: '#B26A00',
  warnSoft: '#FFF6E5',
  surface: '#F6F8F9',
};

interface Props {
  onBack: () => void;
  /** Fired once every step is done, so the caller can refresh its own gate. */
  onComplete?: () => void;
}

export const OperatorSetupScreen: React.FC<Props> = ({ onBack, onComplete }) => {
  const insets = useSafeAreaInsets();
  // Read here rather than passed in: the currency step names what "automatic"
  // resolves to, and a caller that forgot the prop would silently show every
  // operator "Automatic — USD".
  const { profile } = useUserProfile();
  const country = profile?.country_from;

  const [settings, setSettings] = useState<OperatorSettings>(EMPTY_OPERATOR_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [busyStep, setBusyStep] = useState<SetupStepKey | null>(null);
  const [showCurrency, setShowCurrency] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  // The SAME cache ConnectStripeCard reads. Fetching Stripe separately here
  // would ask twice and then let the checklist and the card inside it disagree
  // about whether Stripe is connected — and the card's post-onboarding poll
  // updates this hook, so ticking step 1 needs no wiring at all.
  const { state: connectState } = useConnectStatus();

  const steps = operatorSetupSteps({ connect: connectState, settings });
  const done = steps.filter(s => s.done).length;
  const complete = isOperatorSetupComplete({ connect: connectState, settings });

  const load = useCallback(async () => {
    try {
      setSettings(await fetchOperatorSettings());
    } catch (e) {
      // Not fatal and not worth an alert on mount: an operator with no row yet
      // is the normal first case, and EMPTY_OPERATOR_SETTINGS renders it
      // correctly as "nothing done".
      console.warn('[OperatorSetup] settings read failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Announce completion upward, not on every render — the caller invalidates
  // caches on this, and firing it repeatedly would refetch the trips list on
  // every state change once setup is done.
  const announcedRef = React.useRef(false);
  useEffect(() => {
    if (complete && !announcedRef.current) {
      announcedRef.current = true;
      onComplete?.();
    }
  }, [complete, onComplete]);

  const autoCurrency = currencyForCountry(country);
  const shownCurrency: CurrencyCode = isCurrencyCode(settings.defaultCurrency)
    ? settings.defaultCurrency
    : autoCurrency;

  const patch = async (
    step: SetupStepKey,
    body: Parameters<typeof saveOperatorSettings>[0],
    optimistic: Partial<OperatorSettings>,
  ) => {
    setBusyStep(step);
    const before = settings;
    setSettings({ ...settings, ...optimistic });
    try {
      await saveOperatorSettings(body);
      setSettings(await fetchOperatorSettings());
    } catch (e) {
      setSettings(before);
      showErrorAlert('Could not save', e, 'That did not save. Please try again.');
    } finally {
      setBusyStep(null);
    }
  };

  const confirmCurrency = () =>
    patch('currency', { confirmCurrency: true }, { currencyConfirmedAt: new Date().toISOString() });

  const confirmPolicy = () =>
    patch('policy', { confirmPolicy: true }, { policyConfirmedAt: new Date().toISOString() });

  const chooseCurrency = (next: CurrencyCode | null) =>
    patch(
      'currency',
      { defaultCurrency: next, confirmCurrency: true },
      { defaultCurrency: next, currencyConfirmedAt: new Date().toISOString() },
    );

  const savePolicy = async (next: OperatorSettings['policy']) => {
    // Thrown, not swallowed: CancellationPolicySheet keeps itself open and
    // shows the message when this rejects, which is the behaviour its own
    // save() was written for.
    await saveOperatorSettings({ policy: next, confirmPolicy: true });
    setSettings(await fetchOperatorSettings());
  };

  const pickWaiver = async () => {
    try {
      const DocumentPicker = require('expo-document-picker');
      const res = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });
      const asset = !res.canceled ? res.assets?.[0] : null;
      if (!asset?.uri) return;

      setBusyStep('waiver');
      const stored = await uploadDefaultWaiver(asset.uri, settings.defaultWaiver?.path ?? null);
      await saveOperatorSettings({
        defaultWaiver: {
          path: stored.path,
          name: asset.name ?? 'waiver.pdf',
          hash: stored.hash,
          sizeBytes: stored.sizeBytes,
          uploadedAt: new Date().toISOString(),
        },
      });
      setSettings(await fetchOperatorSettings());
    } catch (e) {
      showErrorAlert('Could not upload', e, 'That file did not upload. Please try again.');
    } finally {
      setBusyStep(null);
    }
  };

  const pickInsurance = async () => {
    try {
      const DocumentPicker = require('expo-document-picker');
      const res = await DocumentPicker.getDocumentAsync({
        // Photo OR PDF. An insurance certificate is a paper document at least as
        // often as a file, and refusing a photo of it sends them off to find a
        // scanner. Matches the storage policy's extension allowlist.
        type: ['application/pdf', 'image/jpeg', 'image/png', 'image/heic'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      const asset = !res.canceled ? res.assets?.[0] : null;
      if (!asset?.uri) return;

      setBusyStep('insurance');
      const name = asset.name ?? 'insurance.pdf';
      const stored = await uploadOperatorInsurance(
        asset.uri,
        name,
        settings.insurance?.path ?? null,
      );
      await saveOperatorSettings({
        insurance: {
          path: stored.path,
          name,
          mime: stored.mime,
          sizeBytes: stored.sizeBytes,
          uploadedAt: new Date().toISOString(),
        },
      });
      setSettings(await fetchOperatorSettings());
    } catch (e) {
      showErrorAlert('Could not upload', e, 'That file did not upload. Please try again.');
    } finally {
      setBusyStep(null);
    }
  };

  const agreeToTerms = async () => {
    await saveOperatorSettings({ acceptTermsVersion: OPERATOR_TERMS_VERSION });
    setSettings(await fetchOperatorSettings());
  };

  if (loading) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  const byKey = Object.fromEntries(steps.map(s => [s.key, s])) as Record<SetupStepKey, SetupStep>;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.backBtn} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={C.ink} />
        </Pressable>
        <Text style={styles.headerTitle}>Set up</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.lede}>
          {complete
            ? 'You are all set. You can change any of this later in Settings.'
            : 'Four things, once. Then you can create trips people pay for.'}
        </Text>

        {/* Progress as a count, not a bar. Four items is few enough that "2 of 4"
            is exact where a bar is only approximate, and it does not imply an
            order the checklist deliberately does not have. */}
        <View style={styles.progress}>
          <Ionicons
            name={complete ? 'checkmark-circle' : 'ellipse-outline'}
            size={18}
            color={complete ? C.ok : C.muted}
          />
          <Text style={[styles.progressText, complete && styles.progressDone]}>
            {complete ? 'All done' : `${done} of ${steps.length} done`}
          </Text>
        </View>

        {/* ── 1. Stripe ─────────────────────────────────────────────────── */}
        <StepCard step={byKey.stripe} n={1}>
          {/* The card owns every one of the six Connect states and the button
              that reopens Stripe. Reproducing any of that here would be a
              second implementation of a rule that already has exactly one. */}
          <ConnectStripeCard />
        </StepCard>

        {/* ── 2. Currency ───────────────────────────────────────────────── */}
        <StepCard step={byKey.currency} n={2}>
          <Text style={styles.value}>
            {settings.defaultCurrency ?? `Automatic — ${autoCurrency}`}
          </Text>
          <Text style={styles.hint}>
            The currency you type prices in. Travelers still see their own, and
            you are always paid in US dollars.
          </Text>
          <View style={styles.actions}>
            {!byKey.currency.done && (
              <PrimaryButton
                label={`Use ${shownCurrency}`}
                busy={busyStep === 'currency'}
                onPress={confirmCurrency}
              />
            )}
            <SecondaryButton
              label={byKey.currency.done ? 'Change' : 'Pick another'}
              onPress={() => setShowCurrency(true)}
            />
          </View>
        </StepCard>

        {/* ── 3. Cancellation policy ────────────────────────────────────── */}
        <StepCard step={byKey.policy} n={3}>
          <Text style={styles.value}>{PRESET_LABEL[settings.policy.preset]}</Text>
          <Text style={styles.hint}>{summarise(settings.policy)}</Text>
          <View style={styles.actions}>
            {!byKey.policy.done && (
              <PrimaryButton
                label="Use this"
                busy={busyStep === 'policy'}
                onPress={confirmPolicy}
              />
            )}
            <SecondaryButton
              label={byKey.policy.done ? 'Change' : 'Pick another'}
              onPress={() => setShowPolicy(true)}
            />
          </View>
        </StepCard>

        {/* ── 4. Waiver ─────────────────────────────────────────────────── */}
        <StepCard step={byKey.waiver} n={4}>
          {settings.defaultWaiver ? (
            <View style={styles.fileRow}>
              <Ionicons name="document-text-outline" size={20} color={C.muted} />
              <Text style={styles.fileName} numberOfLines={1}>
                {settings.defaultWaiver.name}
              </Text>
            </View>
          ) : null}
          <Text style={styles.hint}>
            A PDF every traveler agrees to before they join. Each trip gets its
            own copy, so replacing this never changes a trip you already
            published.
          </Text>
          <View style={styles.actions}>
            <PrimaryButton
              label={settings.defaultWaiver ? 'Replace PDF' : 'Upload PDF'}
              busy={busyStep === 'waiver'}
              onPress={pickWaiver}
              outline={Boolean(settings.defaultWaiver)}
            />
          </View>
        </StepCard>

        {/* ── 5. Insurance ──────────────────────────────────────────────── */}
        <StepCard step={byKey.insurance} n={5}>
          {settings.insurance ? (
            <View style={styles.fileRow}>
              <Ionicons
                name={
                  settings.insurance.mime === 'application/pdf'
                    ? 'document-text-outline'
                    : 'image-outline'
                }
                size={20}
                color={C.muted}
              />
              <Text style={styles.fileName} numberOfLines={1}>
                {settings.insurance.name}
              </Text>
            </View>
          ) : null}
          <Text style={styles.hint}>
            Your liability insurance certificate. A photo of the paper one is
            fine — Swellyo keeps it, travelers never see it.
          </Text>
          <View style={styles.actions}>
            <PrimaryButton
              label={settings.insurance ? 'Replace' : 'Upload'}
              busy={busyStep === 'insurance'}
              onPress={pickInsurance}
              outline={Boolean(settings.insurance)}
            />
          </View>
        </StepCard>

        {/* ── 6. Terms ──────────────────────────────────────────────────── */}
        <StepCard step={byKey.terms} n={6}>
          <Text style={styles.hint}>
            The terms for running paid trips on Swellyo.
          </Text>
          <View style={styles.actions}>
            <PrimaryButton
              label={byKey.terms.done ? 'Read again' : 'Read and agree'}
              onPress={() => setShowTerms(true)}
              outline={byKey.terms.done}
            />
          </View>
        </StepCard>

        {complete && (
          <Pressable
            onPress={onBack}
            style={({ pressed }) => [styles.doneBtn, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.doneText}>Start creating trips</Text>
          </Pressable>
        )}
      </ScrollView>

      <CurrencySheet
        visible={showCurrency}
        onClose={() => setShowCurrency(false)}
        value={isCurrencyCode(settings.defaultCurrency) ? settings.defaultCurrency : null}
        country={country}
        onSelect={chooseCurrency}
        title="Price currency"
        subtitle="New trips start priced in this. You can change it on any trip."
        autoLabel="Follow my country"
      />
      <CancellationPolicySheet
        visible={showPolicy}
        onClose={() => setShowPolicy(false)}
        value={settings.policy}
        onSave={savePolicy}
      />
      <OperatorTermsSheet
        visible={showTerms}
        onClose={() => setShowTerms(false)}
        accepted={byKey.terms.done}
        onAgree={agreeToTerms}
      />
    </View>
  );
};

// ───────────────────────────────────────────────────────────────────────────

const StepCard: React.FC<{ step: SetupStep; n: number; children: React.ReactNode }> = ({
  step,
  n,
  children,
}) => (
  <View style={[styles.card, step.done && styles.cardDone]}>
    <View style={styles.cardHead}>
      {/* The number survives after the tick: it is what makes "4 things" on the
          Trips card and this list obviously the same four. */}
      <View style={[styles.badge, step.done && styles.badgeDone]}>
        {step.done ? (
          <Ionicons name="checkmark" size={14} color="#FFFFFF" />
        ) : (
          <Text style={styles.badgeText}>{n}</Text>
        )}
      </View>
      <Text style={styles.cardTitle}>{step.title}</Text>
      {step.pending ? (
        <View style={styles.pill}>
          <Text style={styles.pillText}>Checking</Text>
        </View>
      ) : null}
    </View>
    <View style={styles.cardBody}>{children}</View>
  </View>
);

const PrimaryButton: React.FC<{
  label: string;
  onPress: () => void;
  busy?: boolean;
  outline?: boolean;
}> = ({ label, onPress, busy, outline }) => (
  <Pressable
    onPress={onPress}
    disabled={busy}
    style={({ pressed }) => [
      styles.btn,
      outline ? styles.btnOutline : styles.btnPrimary,
      busy && styles.btnBusy,
      pressed && !busy && styles.pressed,
    ]}
    accessibilityRole="button"
  >
    {busy ? (
      <ActivityIndicator size="small" color={outline ? C.accent : '#FFFFFF'} />
    ) : (
      <Text style={[styles.btnText, outline && styles.btnTextOutline]}>{label}</Text>
    )}
  </Pressable>
);

const SecondaryButton: React.FC<{ label: string; onPress: () => void }> = ({ label, onPress }) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && styles.pressed]}
    accessibilityRole="button"
  >
    <Text style={[styles.btnText, styles.btnTextGhost]}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    fontFamily: ff('Inter', '700'),
    fontWeight: '700',
    fontSize: 17,
    color: C.ink,
  },

  body: { paddingHorizontal: 16, paddingTop: 4 },
  lede: {
    fontFamily: ff('Inter', '400'),
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: C.muted,
    marginBottom: 14,
  },

  progress: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 16 },
  progressText: {
    fontFamily: ff('Inter', '500'),
    fontWeight: '500',
    fontSize: 13,
    color: C.muted,
  },
  progressDone: { color: C.ok },

  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 12,
    backgroundColor: '#FFFFFF',
  },
  // Finished steps recede rather than disappear. An operator has to be able to
  // check what they chose without undoing it to find out.
  cardDone: { borderColor: C.line, backgroundColor: C.surface },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accentSoft,
  },
  badgeDone: { backgroundColor: C.ok },
  badgeText: {
    fontFamily: ff('Inter', '600'),
    fontWeight: '600',
    fontSize: 12,
    color: C.accent,
  },
  cardTitle: {
    flex: 1,
    fontFamily: ff('Inter', '600'),
    fontWeight: '600',
    fontSize: 16,
    color: C.ink,
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 99,
    backgroundColor: C.warnSoft,
  },
  pillText: {
    fontFamily: ff('Inter', '600'),
    fontWeight: '600',
    fontSize: 11,
    color: C.warn,
  },
  cardBody: { marginTop: 10, gap: 8 },

  value: {
    fontFamily: ff('Inter', '600'),
    fontWeight: '600',
    fontSize: 15,
    color: C.ink,
  },
  hint: {
    fontFamily: ff('Inter', '400'),
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: C.muted,
  },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fileName: {
    flex: 1,
    fontFamily: ff('Inter', '500'),
    fontWeight: '500',
    fontSize: 14,
    color: C.ink,
  },

  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  btn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 99,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 96,
  },
  btnPrimary: { backgroundColor: C.accent },
  btnOutline: { borderWidth: 1, borderColor: C.accent, backgroundColor: '#FFFFFF' },
  btnGhost: { backgroundColor: 'transparent', paddingHorizontal: 8, minWidth: 0 },
  btnBusy: { opacity: 0.7 },
  btnText: {
    fontFamily: ff('Inter', '600'),
    fontWeight: '600',
    fontSize: 14,
    color: '#FFFFFF',
  },
  btnTextOutline: { color: C.accent },
  btnTextGhost: { color: C.muted },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },

  doneBtn: {
    marginTop: 8,
    height: 52,
    borderRadius: 99,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: {
    fontFamily: ff('Inter', '700'),
    fontWeight: '700',
    fontSize: 16,
    color: '#FFFFFF',
  },
});

export default OperatorSetupScreen;
