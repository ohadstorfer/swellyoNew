/**
 * The operator's document screens, as DocumentReviewScreen renders them
 * (Figma 14980-66552 / 14980-66698 / 14981-68385 / 14980-67220):
 *
 *   DocumentsList      — every requirement, "Passport 2/3" with a bar.
 *   RequirementPeople  — one requirement: totals, filters, one row per traveler.
 *   DocumentDetail     — one traveler's file: preview, facts, status.
 *
 * Presentational only. State, data and the database calls stay in
 * DocumentReviewScreen, which also owns the Modal these render inside — see
 * that file for why nothing here may be a Modal of its own.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Thumb from '../../Thumb';
import { Images } from '../../../assets/images';
import { TripIcon, type TripIconName } from '../tripIcons';
import { ff } from '../../../theme/fonts';
import { getViewUrl, type ReviewItem } from '../../../services/trips/tripDocumentsService';

export type ReviewPerson = { userId: string; name: string | null; avatarUrl: string | null };
export type PersonRow = { traveler: ReviewPerson; item: ReviewItem };

const C = {
  ink: '#333333',
  muted: '#7B7B7B',
  faint: '#A0A0A0',
  border: '#EEEEEE',
  surface: '#FFFFFF',
  surface2: '#F7F7F7',
  track: '#E4E4E4',
  accent: '#05BCD3',
  green: '#2BCCBD',
  yellow: '#FFB443',
  grey: '#BDBDBD',
  greyDot: '#CFCFCF',
  pendingText: '#6E87E8',
  black: '#212121',
} as const;

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

/** Per-kind glyph, from the Figma list. Anything new falls back to a page. */
const KIND_ICON: Record<string, TripIconName> = {
  passport: 'passport',
  medical: 'medical-cross',
  insurance: 'shield-tick',
  visa: 'file-05',
  flights: 'plane',
};

/** Uploads are the only thing with a file to open, approve or send back. */
export const isUpload = (item: ReviewItem) =>
  item.reqType !== 'acknowledge' && item.kind !== 'medical' && item.reqType !== 'pay';

export const canOpenFile = (item: ReviewItem) =>
  isUpload(item) && !!item.storagePath && !item.fileDeleted;

/** "2 weeks ago" under a name — how long something has been sitting. */
function uploadedAgo(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** "Aug 3, 2025" in the detail facts. */
export function longDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const Avatar: React.FC<{ uri: string | null; size: number }> = ({ uri, size }) => {
  const style = { width: size, height: size, borderRadius: size / 2, backgroundColor: '#EFEFEF' };
  return uri ? (
    <Thumb uri={uri} size={size * 2} style={style} contentFit="cover" cachePolicy="memory-disk" />
  ) : (
    <Image source={Images.defaultAvatar} style={style} contentFit="cover" />
  );
};

/** The dark header every document screen wears. */
export const DarkHeader: React.FC<{
  title: string;
  topInset: number;
  onBack: () => void;
  right?: React.ReactNode;
}> = ({ title, topInset, onBack, right }) => (
  <View style={[styles.header, { paddingTop: topInset }]}>
    <View style={styles.headerRow}>
      <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      {right}
    </View>
  </View>
);

/** "Export all" — the outlined pill in the header. */
export const HeaderPill: React.FC<{ label: string; onPress: () => void; disabled?: boolean }> = ({
  label,
  onPress,
  disabled,
}) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    style={({ pressed }) => [styles.headerPill, (pressed || disabled) && { opacity: 0.6 }]}
    accessibilityRole="button"
  >
    <TripIcon name="upload-01" size={14} color="#DADADA" />
    <Text style={styles.headerPillText}>{label}</Text>
  </Pressable>
);

const Meter: React.FC<{ pct: number }> = ({ pct }) => (
  <View style={styles.meter}>
    <View style={[styles.meterFill, { width: `${Math.round(pct * 100)}%` }]} />
  </View>
);

// ---------------------------------------------------------------------------
// 1. Documents list
// ---------------------------------------------------------------------------

export type RequirementSummary = {
  requirementId: string;
  title: string;
  kind: string;
  approved: number;
  total: number;
};

export const DocumentsList: React.FC<{
  rows: RequirementSummary[];
  onOpen: (requirementId: string) => void;
}> = ({ rows, onOpen }) => (
  <View style={styles.block}>
    <Text style={styles.sectionTitle}>Documents</Text>
    {rows.length === 0 ? (
      <Text style={styles.empty}>This trip does not ask travelers for any documents.</Text>
    ) : (
      <View style={styles.card}>
        {rows.map((r, i) => (
          <Pressable
            key={r.requirementId}
            onPress={() => onOpen(r.requirementId)}
            style={({ pressed }) => [
              styles.docRow,
              i > 0 && styles.rowDivider,
              pressed && styles.rowPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${r.title}, ${r.approved} of ${r.total} approved`}
          >
            <View style={styles.iconBox}>
              <TripIcon name={KIND_ICON[r.kind] ?? 'file-05'} size={18} color="#222B30" />
            </View>
            <View style={styles.docRowBody}>
              <View style={styles.docRowTop}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {r.title}
                </Text>
                <View style={styles.docRowRight}>
                  {/* Approved of everyone asked (Ohad, 14 Sep). */}
                  <Text style={styles.docCount}>
                    {r.approved}/{r.total}
                  </Text>
                  <TripIcon name="chevron-right" size={18} color={C.ink} />
                </View>
              </View>
              <Meter pct={r.total > 0 ? r.approved / r.total : 0} />
            </View>
          </Pressable>
        ))}
      </View>
    )}
  </View>
);

// ---------------------------------------------------------------------------
// 2. One requirement, everyone
// ---------------------------------------------------------------------------

export type PeopleFilter = 'all' | 'awaiting' | 'resubmit' | 'approved';

const FILTERS: { key: PeopleFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'awaiting', label: 'Awaiting review' },
  { key: 'resubmit', label: 'Resubmit needed' },
  { key: 'approved', label: 'Approved' },
];

export const matchesFilter = (item: ReviewItem, f: PeopleFilter) =>
  f === 'all' ||
  (f === 'awaiting' && item.state === 'submitted') ||
  (f === 'resubmit' && item.state === 'rejected') ||
  (f === 'approved' && item.state === 'approved');

/** What each state looks like as a pill. Not-done rows get a button instead. */
function statusPill(item: ReviewItem): { label: string; bg: string; icon: TripIconName } | null {
  switch (item.state) {
    case 'approved':
      return {
        label:
          item.reqType === 'acknowledge' ? 'Agreed' : item.kind === 'medical' ? 'Filled in' : 'Approved',
        bg: C.green,
        icon: 'check-verified-02',
      };
    case 'submitted':
      return { label: 'Pending review', bg: C.grey, icon: 'clock' };
    case 'rejected':
      return { label: 'Resubmit needed', bg: C.yellow, icon: 'refresh-ccw-01' };
    default:
      return null;
  }
}

function personSubtitle(item: ReviewItem): string {
  if (item.state === 'not_started') return 'Not submitted';
  if (item.state === 'overdue') return 'Not submitted · overdue';
  const ago = uploadedAgo(item.submittedAt);
  if (item.reqType === 'acknowledge') return `Agreed ${ago}`;
  if (item.kind === 'medical') return `Filled in ${ago}`;
  return `Uploaded ${ago}`;
}

export const RequirementPeople: React.FC<{
  rows: PersonRow[];
  filter: PeopleFilter;
  onFilter: (f: PeopleFilter) => void;
  onOpen: (row: PersonRow) => void;
  /** Absent = this viewer may not remind, or this requirement cannot be. */
  onRemind?: (row: PersonRow) => void;
  /** Keyed by userId: 'sending' while in flight, or what the server said. */
  reminded: Record<string, 'sending' | 'sent' | 'skipped'>;
}> = ({ rows, filter, onFilter, onOpen, onRemind, reminded }) => {
  const count = (s: ReviewItem['state']) => rows.filter(r => r.item.state === s).length;
  const shown = rows.filter(r => matchesFilter(r.item, filter));

  return (
    <View style={styles.peopleRoot}>
      <View style={styles.totals}>
        <TotalCard n={count('approved')} label="Approved" dot={C.green} />
        <TotalCard n={count('rejected')} label="Resubmit needed" dot={C.yellow} />
        <TotalCard n={count('submitted')} label="Pending review" dot={C.greyDot} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
      >
        {FILTERS.map(f => {
          const on = f.key === filter;
          return (
            <Pressable
              key={f.key}
              onPress={() => onFilter(f.key)}
              style={[styles.filterChip, on && styles.filterChipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.filterText, on && styles.filterTextOn]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={styles.membersCount}>
        {shown.length}/{rows.length} members
      </Text>

      <View style={styles.card}>
        {shown.length === 0 ? (
          <Text style={[styles.empty, styles.emptyInCard]}>Nobody here.</Text>
        ) : (
          shown.map(({ traveler, item }, i) => {
            const pill = statusPill(item);
            const openable = canOpenFile(item);
            const r = reminded[traveler.userId];
            return (
              <Pressable
                key={traveler.userId}
                onPress={openable ? () => onOpen({ traveler, item }) : undefined}
                disabled={!openable}
                style={({ pressed }) => [
                  styles.personRow,
                  i > 0 && styles.rowDivider,
                  pressed && styles.rowPressed,
                ]}
              >
                <Avatar uri={traveler.avatarUrl} size={56} />
                <View style={styles.personText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {traveler.name ?? 'Traveler'}
                  </Text>
                  <Text
                    style={[styles.personSub, item.state === 'overdue' && styles.personSubBad]}
                    numberOfLines={1}
                  >
                    {personSubtitle(item)}
                  </Text>
                </View>
                {pill ? (
                  <View style={[styles.pill, { backgroundColor: pill.bg }]}>
                    <TripIcon name={pill.icon} size={12} color="#FFFFFF" />
                    <Text style={styles.pillText}>{pill.label}</Text>
                  </View>
                ) : onRemind ? (
                  r === 'sent' || r === 'skipped' ? (
                    <View style={[styles.pill, styles.pillOutline]}>
                      <TripIcon name="bell-01" size={12} color={C.faint} strokeWidth={2} />
                      <Text style={[styles.pillText, { color: C.faint }]}>
                        {r === 'sent' ? 'Reminded' : 'Reminded today'}
                      </Text>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => onRemind({ traveler, item })}
                      disabled={r === 'sending'}
                      hitSlop={8}
                      style={({ pressed }) => [
                        styles.pill,
                        styles.pillOutline,
                        pressed && { opacity: 0.6 },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Send ${traveler.name ?? 'this traveler'} a reminder`}
                    >
                      {r === 'sending' ? (
                        <ActivityIndicator size="small" color={C.ink} style={styles.pillSpinner} />
                      ) : (
                        <TripIcon name="bell-01" size={12} color={C.ink} strokeWidth={2} />
                      )}
                      <Text style={[styles.pillText, { color: C.ink }]}>Send reminder</Text>
                    </Pressable>
                  )
                ) : null}
              </Pressable>
            );
          })
        )}
      </View>
    </View>
  );
};

const TotalCard: React.FC<{ n: number; label: string; dot: string }> = ({ n, label, dot }) => (
  <View style={styles.totalCard}>
    <View style={[styles.totalDot, { backgroundColor: dot }]}>
      <Text style={styles.totalDotText}>{n}</Text>
    </View>
    <Text style={styles.totalLabel} numberOfLines={1}>
      {label}
    </Text>
  </View>
);

// ---------------------------------------------------------------------------
// 3. One traveler's file
// ---------------------------------------------------------------------------

/**
 * The preview mints its own signed URL on mount and never caches the image —
 * the same two rules DocumentViewer keeps (see its header). A PDF is not
 * rendered inline; the expand button opens the full viewer, which can.
 */
const FilePreview: React.FC<{ storagePath: string; onExpand: () => void }> = ({
  storagePath,
  onExpand,
}) => {
  const isPdf = storagePath.toLowerCase().endsWith('.pdf');
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (isPdf) return;
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    getViewUrl(storagePath)
      .then(u => !cancelled && setUrl(u))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      setUrl(null); // drop the token with the screen
    };
  }, [storagePath, isPdf]);

  return (
    <Pressable onPress={onExpand} style={styles.preview} accessibilityLabel="Open the document">
      {isPdf ? (
        <View style={styles.previewCenter}>
          <TripIcon name="file-05" size={40} color={C.muted} />
          <Text style={styles.previewNote}>PDF document</Text>
        </View>
      ) : url ? (
        <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="none" />
      ) : (
        <View style={styles.previewCenter}>
          {failed ? (
            <Text style={styles.previewNote}>Could not load the preview</Text>
          ) : (
            <ActivityIndicator color={C.muted} />
          )}
        </View>
      )}
      <View style={styles.expandBtn}>
        <TripIcon name="expand-01" size={24} color="#222B30" strokeWidth={1.5} />
      </View>
    </Pressable>
  );
};

export const DocumentDetail: React.FC<{
  row: PersonRow;
  fileName: string;
  onExpand: () => void;
  /** Absent = no download for this viewer (or on web). */
  onDownload?: () => void;
  downloading?: boolean;
}> = ({ row, fileName, onExpand, onDownload, downloading }) => {
  const { item, traveler } = row;
  const status =
    item.state === 'approved'
      ? { label: 'Approved', color: C.accent, icon: 'check-verified-02-solid' as TripIconName }
      : item.state === 'rejected'
        ? { label: 'Resubmit needed', color: C.yellow, icon: 'refresh-ccw-01' as TripIconName }
        : { label: 'Pending review', color: C.pendingText, icon: 'clock' as TripIconName };

  const facts: { label: string; value: React.ReactNode }[] = [
    { label: 'Document', value: item.title },
    { label: 'Traveler', value: traveler.name ?? 'Traveler' },
    { label: 'Uploaded', value: longDate(item.submittedAt) },
  ];
  if (item.state === 'approved' && item.reviewedAt) {
    facts.push({ label: 'Reviewed', value: longDate(item.reviewedAt) });
  }

  return (
    <View style={styles.detailRoot}>
      {item.storagePath && !item.fileDeleted ? (
        <View style={styles.fileCard}>
          <FilePreview storagePath={item.storagePath} onExpand={onExpand} />
          {onDownload ? (
            <Pressable
              onPress={onDownload}
              disabled={downloading}
              style={({ pressed }) => [styles.downloadRow, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel="Download file"
            >
              <View style={styles.downloadIcon}>
                {downloading ? (
                  <ActivityIndicator size="small" color="#0F0F10" />
                ) : (
                  <TripIcon name="download-01" size={18} color="#0F0F10" />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.downloadTitle}>Download file</Text>
                <Text style={styles.downloadName} numberOfLines={1}>
                  {fileName}
                </Text>
              </View>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={styles.card}>
        {facts.map((f, i) => (
          <View key={f.label} style={[styles.factRow, i > 0 && styles.rowDivider]}>
            <Text style={styles.factLabel}>{f.label}</Text>
            <Text style={styles.factValue} numberOfLines={1}>
              {f.value}
            </Text>
          </View>
        ))}
        <View style={[styles.factRow, styles.rowDivider]}>
          <Text style={styles.factLabel}>Status</Text>
          <View style={styles.statusRow}>
            <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
            <TripIcon name={status.icon} size={12} color={status.color} />
          </View>
        </View>
      </View>
    </View>
  );
};

// Every size read with get_variable_defs on its own node: the "Documents"
// heading Size/lg 16/24; names, row titles, counts, fact values and "Download
// file" Size/s 12/18; captions Size/xs 10/17; pills Size/xxs 9/14. The bold
// ones come out of the code export 4px too big (20 / 16) — do not use it.
const styles = StyleSheet.create({
  // ── header ──
  header: { backgroundColor: C.black },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },
  headerTitle: {
    flex: 1,
    fontFamily: ff('Montserrat', '700'),
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 9,
    borderWidth: 0.5,
    borderColor: C.greyDot,
  },
  headerPillText: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: '#DADADA' },

  // ── shared ──
  block: { gap: 16 },
  sectionTitle: {
    fontFamily: ff('Inter', '700'),
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '700',
    color: C.ink,
  },
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    overflow: 'hidden',
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: C.border },
  rowPressed: { backgroundColor: '#F4F4F2' },
  rowTitle: {
    flexShrink: 1,
    fontFamily: ff('Inter', '700'),
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
    color: C.ink,
  },
  empty: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: C.muted },
  emptyInCard: { padding: 16, textAlign: 'center' },
  meter: { height: 6, borderRadius: 8, backgroundColor: C.track, overflow: 'hidden' },
  meterFill: { height: 6, borderRadius: 8, backgroundColor: C.accent },

  // ── documents list ──
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8, paddingRight: 16, paddingVertical: 16 },
  iconBox: { backgroundColor: C.surface2, borderRadius: 8, padding: 10 },
  docRowBody: { flex: 1, gap: 8 },
  docRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  docRowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  docCount: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: C.ink },

  // ── requirement people ──
  peopleRoot: { gap: 16 },
  totals: { flexDirection: 'row', gap: 8 },
  totalCard: {
    flex: 1,
    gap: 4,
    padding: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  totalDot: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  totalDotText: { fontFamily: ff('Inter', '400'), fontSize: 10, lineHeight: 17, color: '#FFFFFF' },
  totalLabel: { fontFamily: ff('Inter', '400'), fontSize: 10, lineHeight: 17, color: C.ink },
  // Bleeds to the screen edge so chips scroll under it, like the Figma row.
  filterScroll: { marginHorizontal: -16 },
  filterRow: { paddingHorizontal: 16, gap: 11 },
  filterChip: {
    minWidth: 42,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface2,
  },
  filterChipOn: { backgroundColor: C.black, borderColor: C.black },
  filterText: { fontFamily: ff('Inter', '400'), fontSize: 10, lineHeight: 17, color: C.ink, textAlign: 'center' },
  filterTextOn: { color: '#FFFFFF' },
  membersCount: {
    alignSelf: 'flex-end',
    paddingHorizontal: 2,
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 18,
    color: C.ink,
  },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  personText: { flex: 1, minWidth: 0 },
  personSub: { fontFamily: ff('Inter', '400'), fontSize: 10, lineHeight: 17, color: C.muted },
  personSubBad: { color: '#C4361E' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    padding: 4,
    borderRadius: 6,
  },
  pillOutline: { gap: 4, backgroundColor: C.surface, borderWidth: 0.5, borderColor: C.greyDot },
  pillText: { fontFamily: ff('Inter', '400'), fontSize: 9, lineHeight: 14, color: '#FFFFFF', textAlign: 'center' },
  pillSpinner: { width: 12, height: 12, transform: [{ scale: 0.6 }] },

  // ── detail ──
  detailRoot: { gap: 24 },
  fileCard: { backgroundColor: C.surface, borderRadius: 32, padding: 10, gap: 12 },
  preview: { height: 198, borderRadius: 24, overflow: 'hidden', backgroundColor: C.border },
  previewCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  previewNote: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: C.muted },
  expandBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    padding: 8,
    borderRadius: 60,
    backgroundColor: C.surface,
  },
  downloadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 32,
    backgroundColor: C.surface2,
  },
  downloadIcon: { padding: 10, borderRadius: 32, backgroundColor: C.surface, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  downloadTitle: { fontFamily: ff('Inter', '700'), fontSize: 12, lineHeight: 18, fontWeight: '700', color: '#0A0A0A' },
  downloadName: { fontFamily: ff('Inter', '400'), fontSize: 10, lineHeight: 17, color: '#4A5565' },
  factRow: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
  },
  factLabel: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: C.muted },
  factValue: {
    flexShrink: 1,
    fontFamily: ff('Inter', '700'),
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
    color: C.ink,
    textAlign: 'right',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 4 },
  statusText: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18 },
});
