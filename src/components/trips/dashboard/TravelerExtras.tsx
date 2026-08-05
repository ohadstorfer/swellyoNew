/**
 * TravelerExtras — everything about one traveler that is not a document.
 *
 * Rendered inside DocumentReviewScreen's traveler level, under their document
 * list, through that screen's `renderTravelerExtras` slot. It lives here rather
 * than there because this is operator business — money, medical, and the two
 * things an operator does about a person — while that screen is about deciding
 * on files.
 *
 * Medical is COUNTS on the Dashboard and ANSWERS here. That split is the whole
 * point: a trip screen has no business carrying anyone's allergies around, and
 * an operator feeding fifteen people has every business reading them once they
 * have deliberately opened that person.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { ff } from '../../../theme/fonts';
import { fetchMyMedicalForm } from '../../../services/trips/tripDocumentsService';
import type { TravelerMoney } from '../../../services/trips/operatorDashboardService';
import { D } from './dashboardTheme';
import { formatUsd } from './dashboardFormat';

const STEP_LABEL: Record<'paid' | 'unpaid' | 'no_price', string> = {
  paid: 'Paid',
  unpaid: 'Not paid',
  no_price: 'No price set',
};

export const TravelerExtras: React.FC<{
  tripId: string;
  userId: string;
  name: string;
  /** From the Dashboard's trip-wide money read — never fetched again here, so
   *  this card and the summary above it cannot disagree. Null while loading. */
  money: TravelerMoney | null;
  moneyLoading: boolean;
  /** 'offline' trips are paid outside Swellyo, so no paid figure is truthful. */
  isOffline: boolean;
  /** Absent when this viewer is not the operator of record. Setting a price is
   *  authorised on `group_trips.host_id` alone — a promoted admin gets a raw
   *  server error, so they must not see the button. */
  onSetPrice?: () => void;
  onMessage: () => void;
}> = ({ tripId, userId, name, money, moneyLoading, isOffline, onSetPrice, onMessage }) => {
  const medical = useQuery({
    queryKey: ['operatorDashboard', 'medicalForm', tripId, userId],
    queryFn: () => fetchMyMedicalForm(tripId, userId),
  });

  const form = medical.data ?? null;

  return (
    <View style={styles.root}>
      {/* ── Money ──────────────────────────────────────────────────────── */}
      <Block
        title="Money"
        right={
          onSetPrice ? (
            <Pressable onPress={onSetPrice} hitSlop={10}>
              <Text style={styles.link}>Set price</Text>
            </Pressable>
          ) : undefined
        }
      >
        {moneyLoading ? (
          <ActivityIndicator />
        ) : !money ? (
          <Text style={styles.muted}>No money on this trip.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            <Text style={styles.body}>
              <Text style={styles.muted}>Total: </Text>
              {money.totalUsd === null ? 'No price set' : formatUsd(money.totalUsd)}
              {!isOffline && (
                <>
                  <Text style={styles.muted}> · Paid: </Text>
                  {formatUsd(money.paidUsd)}
                </>
              )}
            </Text>

            {money.steps.map(s => (
              <Text key={s.requirementId} style={styles.body}>
                <Text style={styles.muted}>{s.title}: </Text>
                {STEP_LABEL[s.state]}
                {s.state === 'unpaid' && s.dueUsd !== null && (
                  <Text style={styles.muted}>
                    {' — '}
                    {s.paidUsd > 0
                      ? `${formatUsd(s.paidUsd)} of ${formatUsd(s.dueUsd)}`
                      : `${formatUsd(s.dueUsd)} owed`}
                  </Text>
                )}
              </Text>
            ))}

            {isOffline && (
              <Text style={styles.muted}>
                Paid outside Swellyo. Swellyo does not know what has arrived.
              </Text>
            )}

            {/* The rows, not just a total. An operator reconciles this against
                their Stripe dashboard, and a single number cannot be checked
                against anything. */}
            {money.events.length > 0 && (
              <View style={{ gap: 3, marginTop: 2 }}>
                {money.events.map((e, i) => (
                  <Text key={`${e.createdAt}-${i}`} style={styles.muted}>
                    {formatDay(e.createdAt)} ·{' '}
                    {e.eventType === 'refunded' ? 'Refund' : 'Payment'}{' '}
                    {formatUsd(e.amountUsd)}
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}
      </Block>

      {/* ── Medical ────────────────────────────────────────────────────── */}
      <Block title="Medical">
        {medical.isPending ? (
          <ActivityIndicator />
        ) : medical.isError ? (
          <Text style={styles.muted}>Could not load.</Text>
        ) : !form?.completedAt ? (
          <Text style={styles.muted}>Not filled in yet.</Text>
        ) : (
          <View style={{ gap: 6 }}>
            <Line label="Allergies" value={answer(form.allergies, form.allergiesNone)} />
            <Line label="Dietary" value={answer(form.dietary, form.dietaryNone)} />
            <Line label="Injuries" value={answer(form.injuries, form.injuriesNone)} />
            <Line label="Medications" value={answer(form.medications, form.medicationsNone)} />
            <Text style={[styles.muted, { marginTop: 2 }]}>
              Collected to run this trip. Never used for matching or anything else.
            </Text>
          </View>
        )}
      </Block>

      {/* ── Actions ────────────────────────────────────────────────────── */}
      <Pressable
        onPress={onMessage}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Message ${name}`}
      >
        <Ionicons name="chatbubble-ellipses-outline" size={18} color="#FFFFFF" />
        <Text style={styles.actionText}>Message {firstName(name)}</Text>
      </Pressable>
    </View>
  );
};

const Block: React.FC<{ title: string; right?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  right,
  children,
}) => (
  <View style={styles.block}>
    <View style={styles.blockHead}>
      <Text style={styles.blockTitle}>{title}</Text>
      {right}
    </View>
    {children}
  </View>
);

const Line: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <Text style={styles.body}>
    <Text style={styles.muted}>{label}: </Text>
    {value}
  </Text>
);

/** "None" is an answer. Empty is not. */
function answer(text: string | null | undefined, none: boolean): string {
  if (none) return 'None';
  return text?.trim() ? text : 'Not answered';
}

/** Just the first word — the button says "Message Maya", not the full name,
 *  which on a long one would wrap the button to two lines. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || 'them';
}

/** Local calendar date. The ledger is read next to a bank statement, so the day
 *  matters and the minute does not. */
function formatDay(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const styles = StyleSheet.create({
  root: { gap: 12, marginTop: 12 },
  block: {
    borderWidth: 1,
    borderColor: D.cardBorder,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  blockHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  blockTitle: {
    fontFamily: ff('Inter', '700'),
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    color: '#333333',
  },
  body: { fontFamily: ff('Inter', '400'), fontSize: 13, lineHeight: 19, color: D.ink },
  muted: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: D.muted },
  link: { fontFamily: ff('Inter', '400'), fontSize: 13, lineHeight: 18, color: D.accent },

  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 24,
    backgroundColor: D.accent,
  },
  actionText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  // Instant feedback. 0.97 is the app-wide press scale.
  pressed: { transform: [{ scale: 0.97 }] },
});

export default TravelerExtras;
