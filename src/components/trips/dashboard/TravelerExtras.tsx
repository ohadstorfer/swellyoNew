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
import { PressableScale } from '../PressableScale';
import { fetchMyMedicalForm } from '../../../services/trips/tripDocumentsService';
import type { TravelerMoney } from '../../../services/trips/operatorDashboardService';
import type { TripRefund } from '../../../services/trips/refundsService';
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
  /** Absent when this viewer cannot move money. Same shape and same reason as
   *  `onSetPrice` — the server gate is `money.manage`, this only hides a row. */
  onRefund?: (paymentEventId: string, amountUsd: number) => void;
  /** This traveler's refund attempts that did NOT move money. Succeeded ones
   *  already appear in `money.events` as Stripe's own `refunded` row; listing
   *  them here too would read as two refunds. */
  blockedRefunds?: TripRefund[];
  /**
   * A refund just issued from this screen, so it can be confirmed on screen.
   *
   * `seenRefunds` is how many refund rows were showing at the moment it
   * succeeded. Stripe's webhook writes the real row a second or two later, so
   * comparing counts tells us whether it has landed — without a timer, which
   * would either lie early or linger.
   */
  justRefunded?: { amountUsd: number; seenRefunds: number } | null;
  onMessage: () => void;
  /**
   * Absent when this viewer cannot remove travelers (`travelers.remove`).
   *
   * Deliberately a SEPARATE gate from `onRefund`: the database splits removing
   * a traveler from moving their money, and a Manager can hold the first alone.
   * What happens when such a Manager tries to remove someone who has PAID is
   * decided inside the sheet this opens, not here — it has the paid figure.
   */
  onRemove?: () => void;
}> = ({
  tripId,
  userId,
  name,
  money,
  moneyLoading,
  isOffline,
  onSetPrice,
  onRefund,
  blockedRefunds = [],
  justRefunded,
  onMessage,
  onRemove,
}) => {
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
            {/* Money moved and cannot be taken back. Saying so is not a
                nicety: the row below is written by Stripe's webhook a second
                or two later, and for that gap a sheet that simply closed was
                indistinguishable from a button that did nothing. */}
            {justRefunded && (
              <View style={styles.okBanner}>
                <Ionicons name="checkmark-circle" size={16} color={D.ok} />
                <Text style={styles.okBannerText}>
                  Refunded {formatUsd(justRefunded.amountUsd)} to {firstName(name)}.
                  {money.events.filter(e => e.eventType === 'refunded').length <=
                    justRefunded.seenRefunds &&
                    ' Stripe is confirming it — the record appears below in a moment.'}
                </Text>
              </View>
            )}

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
                  <View key={`${e.id}-${i}`} style={styles.eventRow}>
                    {/* A refund is the one line in this list that runs the
                        other way, and it used to render in the same muted grey
                        as every payment. Marked with a chip rather than a
                        state colour: green would read "good" and red "failed",
                        and a completed refund is neither — and the orange lines
                        below are refunds that did NOT happen, so a warning
                        colour here would collide with them. */}
                    {e.eventType === 'refunded' ? (
                      <View style={styles.refundRow}>
                        <View style={styles.refundChip}>
                          <Text style={styles.refundChipText}>Refund</Text>
                        </View>
                        <Text style={styles.refundAmount}>{formatUsd(e.amountUsd)}</Text>
                        <Text style={styles.muted}>{formatDay(e.createdAt)}</Text>
                      </View>
                    ) : (
                      <Text style={styles.muted}>
                        {formatDay(e.createdAt)} · Payment {formatUsd(e.amountUsd)}
                      </Text>
                    )}
                    {/* Hiding this is UX only — `payments-refund` re-checks
                        `money.manage` server-side, so a hidden button is not
                        the security boundary. */}
                    {onRefund && e.eventType === 'paid' && (
                      <Pressable
                        onPress={() => onRefund(e.id, e.amountUsd)}
                        hitSlop={10}
                        style={({ pressed }) => pressed && { opacity: 0.6 }}
                      >
                        <Text style={styles.link}>Refund</Text>
                      </Pressable>
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* Attempts that never moved money. An operator who was blocked and
                sees nothing here will assume the refund went through. */}
            {blockedRefunds.length > 0 && (
              <View style={{ gap: 3, marginTop: 4 }}>
                {blockedRefunds.map(r => (
                  <Text key={r.id} style={styles.warn}>
                    {formatDay(r.createdAt)} · Refund of {formatUsd(r.amountUsd)}{' '}
                    {r.status === 'blocked_insufficient_balance'
                      ? 'was not sent — your balance did not cover it'
                      : r.status === 'pending'
                        ? 'is still in progress — check Stripe'
                        : 'failed'}
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
      <PressableScale
        onPress={onMessage}
        style={styles.action}
        accessibilityLabel={`Message ${name}`}
      >
        <Ionicons name="chatbubble-ellipses-outline" size={18} color="#FFFFFF" />
        <Text style={styles.actionText}>Message {firstName(name)}</Text>
      </PressableScale>

      {/* Removing lives at the very bottom, under Message and visually quieter
          than it: this screen exists to review someone, and the destructive
          action should be the one you have to travel to, not the one your
          thumb lands on. Same reasoning as the refund link sitting inside the
          money block rather than up here. */}
      {onRemove && (
        <PressableScale
          onPress={onRemove}
          style={styles.actionDanger}
          accessibilityLabel={`Remove ${name} from the trip`}
        >
          <Ionicons name="person-remove-outline" size={18} color={D.danger} />
          <Text style={styles.actionDangerText}>Remove from trip</Text>
        </PressableScale>
      )}
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

/**
 * Local date AND time.
 *
 * ⚠️ This used to be date only, on the reasoning that the ledger is read next
 * to a bank statement so the minute does not matter. 2026-08-12 disproved it:
 * one trip had taken two $1,000 charges an hour apart on the same day, one
 * routed to the operator and one to the platform, and only the second could be
 * refunded. Rendered as bare dates the two rows were identical, and the
 * operator picked the wrong one. The minute is what tells them apart.
 */
function formatDay(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${date}, ${hh}:${mm}`;
}

// This file renders INSIDE DocumentReviewScreen, not in the Dashboard tab, so
// it stays on that screen's 12 / 13 / 14 / 15 type scale rather than the Figma
// scale the tab moved to. The two are neighbours, not the same page. See §2 and
// §6 of `docs/specs/operator-trips/dashboard-tab-design.md`.
const styles = StyleSheet.create({
  root: { gap: 12, marginTop: 12 },
  // 14/14 matches `PlanSections.card`.
  block: {
    borderWidth: 1,
    borderColor: D.cardBorder,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  // 12 — a sub-block header sitting under the tab's 16. Was 10, which was a
  // third value for a gap that only has two legitimate ones.
  blockHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
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
  // A refund that did not happen. `warn`, not `muted`: it has to survive being
  // skimmed, or the operator reads past it and assumes the money went back.
  warn: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: D.warn },
  eventRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },

  // A refund line: chip + amount + when. Full ink on the amount, because the
  // number is what an operator is checking against Stripe.
  refundRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  refundChip: {
    backgroundColor: '#F2F2F2',
    borderWidth: 1,
    borderColor: D.hairline,
    borderRadius: 99,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  refundChipText: {
    fontFamily: ff('Inter', '500'),
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '500',
    color: D.ink,
  },
  refundAmount: {
    fontFamily: ff('Inter', '600'),
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    color: D.ink,
  },

  okBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: D.okBg,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  okBannerText: {
    flex: 1,
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 18,
    color: D.ok,
  },

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
  // Outlined, not filled: the destructive action must not compete with Message
  // for the eye. Colour comes from the dashboard theme, which no longer mirrors
  // the web palette — do not substitute a raw hex here.
  actionDanger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: D.danger,
    backgroundColor: 'transparent',
  },
  actionDangerText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 15,
    fontWeight: '600',
    color: D.danger,
  },
});

export default TravelerExtras;
