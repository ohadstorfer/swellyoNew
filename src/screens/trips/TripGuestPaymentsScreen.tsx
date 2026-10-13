/**
 * TripGuestPaymentsScreen — where each traveler stands on paying (Figma node
 * 17776:48801). Opened from the "Total Guests Payments" tile on the Payments
 * page.
 *
 * It derives nothing of its own. A row's status is `travelerPayStatus` from
 * dashboardWork, read off the same cached `fetchTripMoney` result the tile
 * counts — so the list and the tile cannot disagree about a person.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import Thumb from '../../components/Thumb';
import { textStyle, textStyles } from '../../theme/typography';
import { PressableScale } from '../../components/trips/PressableScale';
import { TripIcon, type TripIconName } from '../../components/trips/tripIcons';
import { formatUsd } from '../../components/trips/dashboard/dashboardFormat';
import { travelerPayStatus, type PayStatus } from '../../components/trips/dashboard/dashboardWork';
import { useOnboarding } from '../../context/OnboardingContext';
import { useTripCore } from '../../hooks/trips/useTripDetail';
import { fetchTripMoney, type TravelerMoney } from '../../services/trips/operatorDashboardService';
import { showErrorAlert } from '../../utils/friendlyError';
import { shareTextAsFile } from '../../services/trips/exportService';

// Neutrals mirror the sibling "view all" screens. The status colours are the
// same three the Payments page draws its bar and legend with.
const T = {
  ink: '#212121',
  title: '#333333',
  count: '#7B7B7B',
  bg: '#FAFAFA',
  surface: '#FFFFFF',
  cardBorder: '#EEEEEE',
  rowPressed: '#F7F7F7',
} as const;

/** `null` = no pill. A traveler with no price is the operator's backlog, not a
 *  payment state, so the row says so in words instead. */
const PILL: Record<PayStatus, { label: string; color: string; icon: TripIconName } | null> = {
  full: { label: 'Full paid', color: '#2BCCBD', icon: 'check-verified-02' },
  deposit: { label: 'Deposit Made', color: '#FFB443', icon: 'refresh-ccw-01' },
  awaiting: { label: 'Awaiting', color: '#BDBDBD', icon: 'clock' },
  no_price: null,
};

/** What the CSV calls each status — plain words, no UI casing. */
const CSV_STATUS: Record<PayStatus, string> = {
  full: 'Fully paid',
  deposit: 'Deposit paid',
  awaiting: 'Awaiting',
  no_price: 'No price set',
};

export const TripGuestPaymentsScreen: React.FC<{
  tripId: string;
  tripTitle?: string | null;
  onBack: () => void;
  /** Names and faces, from the roster the caller already holds. */
  travelers: { userId: string; name: string | null; avatarUrl: string | null }[];
  /** Open one traveler's page. */
  onOpenTraveler?: (userId: string) => void;
}> = ({ tripId, tripTitle, onBack, travelers, onOpenTraveler }) => {
  const insets = useSafeAreaInsets();
  const { user: contextUser } = useOnboarding();
  const currentUserId = contextUser?.id?.toString() ?? null;
  const [exporting, setExporting] = useState(false);

  // Same key the Dashboard and the Payments page use — already cached.
  const money = useQuery({
    queryKey: ['operatorDashboard', 'money', tripId],
    queryFn: () => fetchTripMoney(tripId),
  });
  // Only for the cap in "9/12 members". Hits the cache TripDetail seeded.
  const maxParticipants =
    useTripCore(tripId, currentUserId).data?.trip?.max_participants ?? null;

  const profiles = useMemo(() => {
    const m = new Map<string, { name: string; avatarUrl: string | null }>();
    travelers.forEach(t => m.set(t.userId, { name: t.name ?? 'Traveler', avatarUrl: t.avatarUrl }));
    return m;
  }, [travelers]);

  const rows = money.data?.travelers ?? [];
  // An offline trip collects nothing through Swellyo, so a status per person
  // would be invented. The list stays; the pills go.
  const isOffline = money.data?.isOffline ?? false;

  const exportCsv = async () => {
    if (exporting || rows.length === 0) return;
    setExporting(true);
    try {
      const csv = guestsToCsv(rows, profiles, isOffline);
      const safe = (tripTitle ?? 'trip').replace(/[^\w\-]+/g, '-').slice(0, 40);
      await shareTextAsFile(csv, `guest-payments-${safe}.csv`, 'text/csv');
    } catch (e) {
      showErrorAlert('Could not export', e, 'Could not build the payments file.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          hitSlop={12}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Members
        </Text>
        <PressableScale
          onPress={exportCsv}
          disabled={exporting || rows.length === 0}
          style={[styles.exportBtn, rows.length === 0 && styles.exportOff]}
          accessibilityLabel="Export what each guest has paid as a spreadsheet"
        >
          <Text style={styles.exportText}>Export</Text>
          {exporting ? (
            <ActivityIndicator size="small" color="#FFFFFF" style={styles.exportIcon} />
          ) : (
            <Ionicons name="share-outline" size={18} color="#FFFFFF" />
          )}
        </PressableScale>
      </View>

      <View style={styles.body}>
        {money.isPending ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : money.isError ? (
          <View style={styles.center}>
            <Text style={styles.muted}>That did not load.</Text>
            <Pressable onPress={() => void money.refetch()} hitSlop={8}>
              <Text style={styles.link}>Try again</Text>
            </Pressable>
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.muted}>No travelers yet.</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={[
              styles.content,
              { paddingBottom: Math.max(insets.bottom, 16) + 16 },
            ]}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.countText}>
              {rows.length}
              {maxParticipants ? `/${maxParticipants}` : ''} member{rows.length === 1 ? '' : 's'}
            </Text>
            <View style={styles.card}>
              {rows.map((t, i) => {
                const profile = profiles.get(t.userId);
                return (
                  <GuestRow
                    key={t.userId}
                    traveler={t}
                    name={profile?.name ?? 'Traveler'}
                    avatarUrl={profile?.avatarUrl ?? null}
                    isOffline={isOffline}
                    divider={i < rows.length - 1}
                    onPress={onOpenTraveler ? () => onOpenTraveler(t.userId) : undefined}
                  />
                );
              })}
            </View>
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
};

/** "$1,000 of $2,400 paid" — the figure behind the pill. */
function subLine(t: TravelerMoney, isOffline: boolean): string {
  if (isOffline) return 'Paid outside Swellyo';
  if (t.totalUsd === null) return 'No price set';
  return `${formatUsd(t.paidUsd)} of ${formatUsd(t.totalUsd)} paid`;
}

const GuestRow: React.FC<{
  traveler: TravelerMoney;
  name: string;
  avatarUrl: string | null;
  isOffline: boolean;
  divider: boolean;
  onPress?: () => void;
}> = ({ traveler, name, avatarUrl, isOffline, divider, onPress }) => {
  const pill = isOffline ? null : PILL[travelerPayStatus(traveler)];
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.row,
        divider && styles.rowDivider,
        pressed && styles.rowPressed,
      ]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${name}, ${pill ? pill.label : subLine(traveler, isOffline)}`}
    >
      {avatarUrl ? (
        <Thumb
          uri={avatarUrl}
          size={96}
          style={styles.avatar}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={[styles.avatar, styles.avatarEmpty]}>
          <Ionicons name="person" size={26} color="#FFFFFF" />
        </View>
      )}
      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {subLine(traveler, isOffline)}
        </Text>
      </View>
      {pill ? (
        <View style={[styles.pill, { backgroundColor: pill.color }]}>
          <TripIcon name={pill.icon} size={12} color="#FFFFFF" />
          <Text style={styles.pillText}>{pill.label}</Text>
        </View>
      ) : null}
    </Pressable>
  );
};

/**
 * The list as CSV. Same quoting rule as `ledgerToCsv`. On an offline trip the
 * status column says so rather than calling everyone unpaid.
 */
function guestsToCsv(
  rows: TravelerMoney[],
  profiles: Map<string, { name: string }>,
  isOffline: boolean,
): string {
  const cell = (v: string | number) => {
    const t = String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lines = [['Traveler', 'Status', 'Paid USD', 'Total USD'].join(',')];
  for (const t of rows) {
    lines.push(
      [
        cell(profiles.get(t.userId)?.name ?? t.userId),
        cell(isOffline ? 'Paid outside Swellyo' : CSV_STATUS[travelerPayStatus(t)]),
        cell(isOffline ? '' : t.paidUsd.toFixed(2)),
        cell(t.totalUsd === null ? '' : t.totalUsd.toFixed(2)),
      ].join(','),
    );
  }
  return lines.join('\n');
}

// Text sizes are the Figma styles read per node with get_variable_defs
// (mobile mode), not the px the export prints.
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: T.ink,
  },
  backBtn: { padding: 4 },
  // Headings/H-6
  headerTitle: { ...textStyles.H6, color: '#FFFFFF', flex: 1, marginLeft: 8 },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  exportOff: { opacity: 0.4 },
  // Body/M B-2
  exportText: { ...textStyles.MB2, color: '#FFFFFF' },
  exportIcon: { width: 18, height: 18 },

  body: { flex: 1, backgroundColor: T.bg },
  content: { paddingHorizontal: 16, paddingTop: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32 },
  muted: { ...textStyles.MB2, color: T.count },
  link: { ...textStyle('MB2', '500'), color: '#066B8C' },

  // Body/B-3
  countText: {
    ...textStyles.B3,
    color: T.title,
    textAlign: 'right',
    paddingHorizontal: 2,
    marginBottom: 16,
  },

  // One rounded card, hairline dividers — same shell as TripMembersScreen.
  card: {
    backgroundColor: T.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: T.cardBorder,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: T.cardBorder },
  rowPressed: { backgroundColor: T.rowPressed },
  avatar: { width: 56, height: 56, borderRadius: 40 },
  avatarEmpty: { backgroundColor: '#C9CED2', alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0, justifyContent: 'center' },
  // Body/B-3, bold override
  name: { ...textStyle('B3', '700'), color: T.title },
  // Body/B-4
  sub: { ...textStyles.B4, color: T.count },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    padding: 4,
    borderRadius: 6,
  },
  // Body/B-5
  pillText: { ...textStyles.B5, color: '#FFFFFF', textAlign: 'center' },
});

export default TripGuestPaymentsScreen;
