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
 * ── Looks (Figma 14984-68574) ───────────────────────────────────────────────
 * A list of the six steps — icon, title, one line — each opening its own
 * bottom sheet with that step's controls (Ohad, 14 Sep). "Start Setup" opens
 * the first unfinished one. A finished row keeps its line and gains a check.
 * Still a checklist underneath: any row, any order.
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
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '../../components/BottomSheetShell';
import { TripIcon, type TripIconName } from '../../components/trips/tripIcons';
import { ff } from '../../theme/fonts';
import { useUserProfile } from '../../context/UserProfileContext';
import { showErrorAlert } from '../../utils/friendlyError';
import { ConnectStripeCard } from '../../components/trips/ConnectStripeCard';
import { DocumentViewer } from '../../components/trips/DocumentViewer';
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
  SETUP_STEP_ORDER,
  type SetupStep,
  type SetupStepKey,
} from '../../services/trips/operatorSetup';
import { useConnectStatus } from '../../hooks/trips/useConnectStatus';
import { currencyForCountry, isCurrencyCode, type CurrencyCode } from '../../utils/currency';

/** How each step reads on this screen (Figma 14984-68574). The service's own
 *  titles stay as they are — the Trips card and the Create gate use them. */
const ROW: Record<SetupStepKey, { icon: TripIconName; title: string; line: string }> = {
  stripe: { icon: 'credit-card-01', title: 'Payments', line: 'Connect Stripe to collect payments' },
  currency: { icon: 'coins-swap-02', title: 'Currency', line: 'Set your default billing currency' },
  policy: { icon: 'file-05', title: 'Cancellation policy', line: 'Define refund terms for travelers' },
  waiver: { icon: 'shield-01', title: 'Waiver', line: 'Upload your default traveler waiver' },
  insurance: { icon: 'file-shield-01', title: 'Liability insurance', line: 'Submit your insurance for review' },
  terms: { icon: 'file-check-03', title: 'Operator agreement', line: 'Sign the Swellyo Operator Agreement' },
};

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
  check: '#2BCCBD',
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
  /** The step whose sheet is open. Terms has no sheet of its own here — its
   *  existing sheet IS the step — so it never lands in this. */
  const [openStep, setOpenStep] = useState<Exclude<SetupStepKey, 'terms'> | null>(null);
  // The file being looked at, or null. Path only: the viewer mints its own
  // short-lived signed URL per open and never keeps it, same as everywhere
  // else a document is shown.
  const [viewing, setViewing] = useState<{ path: string; title: string } | null>(null);

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
      // Done with that step: back to the list, where its row now has a tick.
      setOpenStep(null);
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
      setOpenStep(null);
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
      setOpenStep(null);
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

  const openRow = (key: SetupStepKey) => {
    if (key === 'terms') setShowTerms(true);
    else setOpenStep(key);
  };

  // "Start Setup" goes where the work is: the first step still to do.
  const firstOpen = steps.find(st => !st.done)?.key ?? null;

  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  const byKey = Object.fromEntries(steps.map(st => [st.key, st])) as Record<SetupStepKey, SetupStep>;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
          </Pressable>
          {/* Once everything is done this screen is reached from Settings, not
              the setup banner — so it stops calling itself a setup. */}
          <Text style={styles.headerTitle}>{complete ? 'Operator settings' : 'Setup'}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 200 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.lede}>
          {complete
            ? 'You are all set. You can change any of this here later.'
            : 'Complete a few steps to publish paid trips and collect traveler payments.'}
        </Text>

        <View style={styles.list}>
          {SETUP_STEP_ORDER.map(key => {
            const row = ROW[key];
            const step = byKey[key];
            return (
              <Pressable
                key={key}
                onPress={() => openRow(key)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                accessibilityRole="button"
                accessibilityLabel={`${row.title}. ${step.done ? 'Done' : row.line}`}
              >
                <View style={styles.rowIcon}>
                  <TripIcon name={row.icon} size={18} color={C.ink} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {row.title}
                  </Text>
                  <Text style={styles.rowLine} numberOfLines={2}>
                    {row.line}
                  </Text>
                </View>
                {step.done ? (
                  <Ionicons name="checkmark-circle" size={24} color={C.check} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* The CTA over a fade, like the trip screens. */}
      <View style={styles.footer} pointerEvents="box-none">
        <LinearGradient
          colors={['rgba(250,250,250,0)', 'rgba(250,250,250,0.85)', '#FAFAFA']}
          locations={[0, 0.35, 0.7]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={[styles.footerInner, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <Pressable
            onPress={() => (firstOpen ? openRow(firstOpen) : onBack())}
            style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
            accessibilityRole="button"
          >
            <Text style={styles.ctaText}>
              {!firstOpen ? 'Start creating trips' : done === 0 ? 'Start Setup' : 'Continue Setup'}
            </Text>
          </Pressable>
          {firstOpen ? (
            <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button">
              <Text style={styles.later}>Maybe Later</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* ── One sheet per step ───────────────────────────────────────────── */}
      {/* Everything a step sheet opens (the currency / policy pickers, the file
          viewer) is rendered INSIDE it. A sheet opened as a sibling of an open
          sheet strands an invisible view controller on iOS and freezes touch. */}
      <BottomSheetShell visible={openStep !== null} onClose={() => setOpenStep(null)} swipeToDismiss={false}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
          <View style={styles.grabber} />
          {openStep ? (
            <>
              <View style={styles.sheetHead}>
                <View style={styles.rowIcon}>
                  <TripIcon name={ROW[openStep].icon} size={18} color={C.ink} />
                </View>
                <Text style={styles.sheetTitle}>{ROW[openStep].title}</Text>
                {byKey[openStep].pending ? (
                  <View style={styles.pill}>
                    <Text style={styles.pillText}>Checking</Text>
                  </View>
                ) : byKey[openStep].done ? (
                  <Ionicons name="checkmark-circle" size={22} color={C.check} />
                ) : null}
              </View>

              <View style={styles.sheetBody}>
                {openStep === 'stripe' ? (
                  // The card owns every one of the six Connect states and the
                  // button that reopens Stripe. Reproducing any of that here
                  // would be a second implementation of a rule with exactly one.
                  <ConnectStripeCard />
                ) : openStep === 'currency' ? (
                  <>
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
                  </>
                ) : openStep === 'policy' ? (
                  <>
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
                  </>
                ) : openStep === 'waiver' ? (
                  <>
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
                      {settings.defaultWaiver ? (
                        <SecondaryButton
                          label="View"
                          onPress={() =>
                            setViewing({ path: settings.defaultWaiver!.path, title: 'Your waiver' })
                          }
                        />
                      ) : null}
                    </View>
                  </>
                ) : (
                  <>
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
                      {settings.insurance ? (
                        <SecondaryButton
                          label="View"
                          onPress={() =>
                            setViewing({ path: settings.insurance!.path, title: 'Your insurance' })
                          }
                        />
                      ) : null}
                    </View>
                  </>
                )}
              </View>
            </>
          ) : null}
        </View>

        {/* Nested, see above. */}
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
          onSave={async next => {
            await savePolicy(next);
            setOpenStep(null);
          }}
        />
        {/* Read-only: no approve / reject, no export. The operator checking
            their own file, PDF or photo — the viewer picks by path. */}
        <DocumentViewer
          visible={!!viewing}
          storagePath={viewing?.path ?? null}
          title={viewing?.title ?? 'Document'}
          onClose={() => setViewing(null)}
        />
      </BottomSheetShell>

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

// Figma 14984-68574, EVERY size read with get_variable_defs on its node:
// lede Size/md 14/18; row title Size/lg 16/24 (bold override — the code export
// prints it as a bare 20, which is wrong); row line Size/s 12/18; "Maybe Later"
// Size/md 14/18 (export: 18); CTA Montserrat 16 / Size/2xl 22 (a real 16);
// header Headings/H-6 (Montserrat Bold, Size/md 14 / Size/2xl 22).
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAFAFA' },
  center: { alignItems: 'center', justifyContent: 'center' },

  header: { backgroundColor: '#212121' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  headerTitle: {
    flex: 1,
    fontFamily: ff('Montserrat', '700'),
    fontWeight: '700',
    fontSize: 14,
    lineHeight: 22,
    color: '#FFFFFF',
  },

  body: { paddingHorizontal: 16, paddingTop: 16 },
  lede: {
    paddingHorizontal: 8,
    paddingBottom: 20,
    fontFamily: ff('Inter', '400'),
    fontWeight: '400',
    fontSize: 14,
    lineHeight: 18,
    color: C.muted,
  },

  list: { gap: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: '#FFFFFF',
  },
  rowPressed: { backgroundColor: '#F7F7F7' },
  rowIcon: { padding: 10, borderRadius: 8, backgroundColor: '#F7F7F7' },
  rowText: { flex: 1 },
  rowTitle: {
    fontFamily: ff('Inter', '700'),
    fontWeight: '700',
    fontSize: 16,
    lineHeight: 24,
    color: '#333333',
  },
  rowLine: {
    fontFamily: ff('Inter', '400'),
    fontWeight: '400',
    fontSize: 12,
    lineHeight: 18,
    color: '#333333',
  },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 70 },
  footerInner: { paddingHorizontal: 40, gap: 16 },
  cta: {
    height: 56,
    borderRadius: 12,
    backgroundColor: '#212121',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  ctaPressed: { opacity: 0.85 },
  ctaText: {
    fontFamily: ff('Montserrat', '600'),
    fontWeight: '600',
    fontSize: 16,
    lineHeight: 22,
    color: '#FFFFFF',
  },
  later: {
    fontFamily: ff('Inter', '700'),
    fontWeight: '700',
    fontSize: 14,
    lineHeight: 18,
    color: '#333333',
    textAlign: 'center',
  },

  // ── step sheet ──
  // The shell paints no surface; without this the sheet is transparent.
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingHorizontal: 20,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D9D9D9',
    marginBottom: 16,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sheetTitle: {
    flex: 1,
    fontFamily: ff('Inter', '700'),
    fontWeight: '700',
    fontSize: 16,
    lineHeight: 24,
    color: '#333333',
  },
  sheetBody: { marginTop: 16, gap: 8 },
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
});

export default OperatorSetupScreen;
