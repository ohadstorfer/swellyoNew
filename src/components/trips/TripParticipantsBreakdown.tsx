import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { EnrichedParticipant } from '../../services/trips/groupTripsService';

interface TripParticipantsBreakdownProps {
  participants: EnrichedParticipant[];
}

const BOARD_LABELS: Record<string, string> = {
  shortboard: 'Shortboard',
  midlength: 'Mid-length',
  mid_length: 'Mid-length',
  longboard: 'Longboard',
  softtop: 'Soft-top',
  soft_top: 'Soft-top',
};

const LEVEL_LABELS: Record<string, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  pro: 'Pro',
};

const formatLabel = (raw: string, dict: Record<string, string>): string => {
  const key = raw.toLowerCase().trim();
  if (dict[key]) return dict[key];
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
};

const tally = (
  values: (string | null | undefined)[],
  dict: Record<string, string>
): { label: string; count: number }[] => {
  const counts = new Map<string, number>();
  values.forEach(v => {
    if (!v) return;
    const label = formatLabel(v, dict);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
};

const intersectKeywords = (lists: string[][]): string[] => {
  if (lists.length === 0) return [];
  const [first, ...rest] = lists;
  const normalized = (s: string) => s.toLowerCase().trim();
  const seen = new Set(first.map(normalized));
  rest.forEach(list => {
    const next = new Set(list.map(normalized));
    seen.forEach(k => {
      if (!next.has(k)) seen.delete(k);
    });
  });
  // Preserve original casing from the first list, deduped.
  const out: string[] = [];
  const added = new Set<string>();
  first.forEach(k => {
    const n = normalized(k);
    if (seen.has(n) && !added.has(n)) {
      out.push(k);
      added.add(n);
    }
  });
  return out;
};

const DistributionBlock: React.FC<{
  title: string;
  rows: { label: string; count: number }[];
  total: number;
}> = ({ title, rows, total }) => (
  <View style={styles.block}>
    <Text style={styles.blockTitle}>{title}</Text>
    {rows.length === 0 ? (
      <Text style={styles.muted}>Not specified</Text>
    ) : (
      rows.map(r => {
        const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
        return (
          <View key={r.label} style={styles.row}>
            <Text style={styles.rowLabel} numberOfLines={1}>
              {r.label}
            </Text>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${pct}%` }]} />
            </View>
            <Text style={styles.rowCount}>{r.count}</Text>
          </View>
        );
      })
    )}
  </View>
);

export const TripParticipantsBreakdown: React.FC<TripParticipantsBreakdownProps> = ({
  participants,
}) => {
  const breakdown = useMemo(() => {
    const total = participants.length;
    const boards = tally(
      participants.map(p => p.surfboard_type),
      BOARD_LABELS
    );
    const levels = tally(
      participants.map(p => p.surf_level_category),
      LEVEL_LABELS
    );
    const keywordLists = participants
      .map(p => p.lifestyle_keywords ?? [])
      .filter(list => list.length > 0);
    const commonLifestyles =
      keywordLists.length >= 2 ? intersectKeywords(keywordLists) : [];
    return { total, boards, levels, commonLifestyles, keywordListsCount: keywordLists.length };
  }, [participants]);

  return (
    <View style={styles.container}>
      <DistributionBlock title="Boards" rows={breakdown.boards} total={breakdown.total} />
      <DistributionBlock title="Surf level" rows={breakdown.levels} total={breakdown.total} />

      <View style={styles.block}>
        <Text style={styles.blockTitle}>Lifestyles in common</Text>
        {breakdown.keywordListsCount < 2 ? (
          <Text style={styles.muted}>Need at least two participants with lifestyle tags.</Text>
        ) : breakdown.commonLifestyles.length === 0 ? (
          <Text style={styles.muted}>No shared lifestyles yet.</Text>
        ) : (
          <View style={styles.chipsRow}>
            {breakdown.commonLifestyles.map(k => (
              <View key={k} style={styles.chip}>
                <Text style={styles.chipText}>{k}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { gap: 16 },
  block: { gap: 8 },
  blockTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#222B30',
    marginBottom: 4,
    ...(Platform.OS === 'web' ? { fontFamily: 'Inter, sans-serif' } : {}),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  rowLabel: {
    width: 110,
    fontSize: 13,
    color: '#333',
  },
  barTrack: {
    flex: 1,
    height: 6,
    backgroundColor: '#F2F2F2',
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: '#B72DF2',
    borderRadius: 4,
  },
  rowCount: {
    width: 24,
    textAlign: 'right',
    fontSize: 13,
    color: '#7B7B7B',
    fontVariant: ['tabular-nums'],
  },
  muted: { fontSize: 13, color: '#7B7B7B' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#F4E8FB',
    borderRadius: 999,
  },
  chipText: {
    fontSize: 12,
    color: '#7A1FB0',
    fontWeight: '500',
  },
});

export default TripParticipantsBreakdown;
