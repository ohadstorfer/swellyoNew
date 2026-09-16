/**
 * Operator setup — the checklist (Figma 15286-78166).
 *
 * Six things settled once before selling a trip. This screen is the hub: a row
 * per step with a tick when done. "Start / Continue Setup" opens the step-by-
 * step wizard (setup/OperatorSetupWizard.tsx) at the first unfinished step;
 * tapping a row opens the wizard on that step. Leaving the wizard — finished,
 * Exit, or Save and Exit — comes back here.
 *
 * ── Still a checklist underneath ────────────────────────────────────────────
 * The wizard walks the steps in order, but nothing depends on that order:
 * Stripe cannot always finish in one sitting (it can come back under review),
 * insurance waits on Swellyo's review, and operators leave and come back. The
 * checklist is what reopens showing exactly what is left.
 *
 * The rule for "done" lives in services/trips/operatorSetup.ts, shared with
 * the Trips banner, the Create gate and the web dashboard.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TripIcon, type TripIconName } from '../../components/trips/tripIcons';
import { ff } from '../../theme/fonts';
import { useUserProfile } from '../../context/UserProfileContext';
import {
  fetchOperatorSettings,
  EMPTY_OPERATOR_SETTINGS,
  type OperatorSettings,
} from '../../services/trips/operatorSettingsService';
import {
  operatorSetupSteps,
  isOperatorSetupComplete,
  SETUP_STEP_ORDER,
  type InsuranceBlock,
  type SetupStep,
  type SetupStepKey,
} from '../../services/trips/operatorSetup';
import { useConnectStatus } from '../../hooks/trips/useConnectStatus';
import { OperatorSetupWizard } from './setup/OperatorSetupWizard';

/** How each step reads on this screen. The service's own titles stay as they
 *  are — the Trips card and the Create gate use them. */
const ROW: Record<SetupStepKey, { icon: TripIconName; title: string; line: string }> = {
  stripe: { icon: 'credit-card-01', title: 'Payments', line: 'Connect Stripe to collect payments' },
  currency: { icon: 'coins-swap-02', title: 'Currency', line: 'Set your default billing currency' },
  policy: { icon: 'file-05', title: 'Cancellation policy', line: 'Define refund terms for travelers' },
  waiver: { icon: 'shield-01', title: 'Waiver', line: 'Upload your default traveler waiver' },
  insurance: { icon: 'file-shield-01', title: 'Liability insurance', line: 'Submit your insurance for review' },
  terms: { icon: 'file-check-03', title: 'Operator agreement', line: 'Sign the Swellyo Operator Agreement' },
};

/** Insurance is the one step that can sit between "sent" and "done". */
const REVIEW_PILL: Record<InsuranceBlock, { text: string; color: string; bg: string }> = {
  under_review: { text: 'In review', color: '#B26A00', bg: '#FFF6E5' },
  rejected: { text: 'Not approved', color: '#D92D46', bg: '#FFF0F2' },
  expired: { text: 'Expired', color: '#D92D46', bg: '#FFF0F2' },
};

const C = {
  accent: '#05BCD3',
  muted: '#7B7B7B',
  line: '#EEEEEE',
};

interface Props {
  onBack: () => void;
  /** Fired once every step is done, so the caller can refresh its own gate. */
  onComplete?: () => void;
}

export const OperatorSetupScreen: React.FC<Props> = ({ onBack, onComplete }) => {
  const insets = useSafeAreaInsets();
  const { profile } = useUserProfile();
  const country = profile?.country_from;

  const [settings, setSettings] = useState<OperatorSettings>(EMPTY_OPERATOR_SETTINGS);
  const [loading, setLoading] = useState(true);
  /** The step the wizard is open on, or null for the checklist. */
  const [wizardStep, setWizardStep] = useState<SetupStepKey | null>(null);

  // The SAME cache the Stripe step and ConnectStripeCard read, so the tick here
  // and the step's own screen can never disagree.
  const { state: connectState } = useConnectStatus();

  const steps = operatorSetupSteps({ connect: connectState, settings });
  const done = steps.filter(st => st.done).length;
  const complete = isOperatorSetupComplete({ connect: connectState, settings });

  const reload = useCallback(async () => {
    const fresh = await fetchOperatorSettings();
    setSettings(fresh);
    return fresh;
  }, []);

  useEffect(() => {
    reload()
      // Not fatal: an operator with no row yet is the normal first case, and
      // EMPTY_OPERATOR_SETTINGS renders it correctly as "nothing done".
      .catch(e => console.warn('[OperatorSetup] settings read failed:', e))
      .finally(() => setLoading(false));
  }, [reload]);

  // Announce completion upward once, not on every render — the caller
  // invalidates caches on this.
  const announcedRef = useRef(false);
  useEffect(() => {
    if (complete && !announcedRef.current) {
      announcedRef.current = true;
      onComplete?.();
    }
  }, [complete, onComplete]);

  const closeWizard = useCallback(() => setWizardStep(null), []);

  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  if (wizardStep) {
    return (
      <OperatorSetupWizard
        initialStep={wizardStep}
        settings={settings}
        reload={reload}
        country={country}
        onExit={closeWizard}
      />
    );
  }

  const byKey = Object.fromEntries(steps.map(st => [st.key, st])) as Record<SetupStepKey, SetupStep>;
  // "Continue Setup" goes where the work is: the first step still to do.
  const firstOpen = steps.find(st => !st.done)?.key ?? null;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <TripIcon name="chevron-left" size={32} color="#FFFFFF" strokeWidth={1.5} />
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
            const pill = step.review ? REVIEW_PILL[step.review] : null;
            return (
              <Pressable
                key={key}
                onPress={() => setWizardStep(key)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                accessibilityRole="button"
                accessibilityLabel={`${row.title}. ${step.done ? 'Done' : pill ? pill.text : row.line}`}
              >
                <View style={styles.rowIcon}>
                  <TripIcon name={row.icon} size={18} color="#222B30" />
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
                  <View style={styles.check}>
                    <TripIcon name="check" size={14} color="#FFFFFF" strokeWidth={3} />
                  </View>
                ) : pill ? (
                  <View style={[styles.pill, { backgroundColor: pill.bg }]}>
                    <Text style={[styles.pillText, { color: pill.color }]}>{pill.text}</Text>
                  </View>
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
            onPress={() => (firstOpen ? setWizardStep(firstOpen) : onBack())}
            style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
            accessibilityRole="button"
          >
            <Text style={styles.ctaText}>
              {!firstOpen ? 'Finish Setup' : done === 0 ? 'Start Setup' : 'Continue Setup'}
            </Text>
          </Pressable>
          {firstOpen ? (
            <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button">
              <Text style={styles.later}>Maybe Later</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
};

// ───────────────────────────────────────────────────────────────────────────

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

  check: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },
  pillText: { fontFamily: ff('Inter', '600'), fontWeight: '600', fontSize: 11 },
});

export default OperatorSetupScreen;
