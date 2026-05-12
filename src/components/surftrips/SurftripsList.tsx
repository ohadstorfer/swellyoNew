import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../Text';
import { SurftripCard } from './SurftripCard';
import { listSurftripsForUser } from '../../services/surftrips/surftripsService';
import type { SurftripGroupForUser } from '../../types/surftrips';

interface SurftripsListProps {
  currentUserId: string | null;
  onOpenGroupChat: (group: SurftripGroupForUser) => void;
  onOpenGroupDetail: (groupId: string) => void;
  onCreatePress: () => void;
  reloadKey?: number;
}

export const SurftripsList: React.FC<SurftripsListProps> = ({
  currentUserId,
  onOpenGroupChat,
  onOpenGroupDetail,
  onCreatePress,
  reloadKey,
}) => {
  const [items, setItems] = useState<SurftripGroupForUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!currentUserId) {
      setItems([]);
      setLoading(false);
      return;
    }
    try {
      const rows = await listSurftripsForUser(currentUserId);
      setItems(rows);
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load, reloadKey]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const { mine, browse } = useMemo(() => {
    const mine: SurftripGroupForUser[] = [];
    const browse: SurftripGroupForUser[] = [];
    for (const g of items) {
      (g.is_member ? mine : browse).push(g);
    }
    return { mine, browse };
  }, [items]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#0788B0" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.wrap}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0788B0" />
      }
    >
      {/* My surftrips */}
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>My Surf Trips</Text>
        <TouchableOpacity
          style={styles.newChatBtn}
          onPress={onCreatePress}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel="New surftrip"
        >
          <Ionicons name="add" size={26} color="#222B30" />
        </TouchableOpacity>
      </View>

      <View style={styles.sectionCard}>
        {mine.length === 0 ? (
          <View style={styles.emptyMine}>
            <Text style={styles.emptyText}>
              You haven't joined or created a surf trip yet.
            </Text>
          </View>
        ) : (
          mine.map((g, i) => (
            <SurftripCard
              key={g.id}
              group={g}
              onPress={() => onOpenGroupChat(g)}
              showDivider={i < mine.length - 1}
            />
          ))
        )}
      </View>

      {/* Browse surftrips */}
      <View style={[styles.sectionHeaderRow, styles.browseHeader]}>
        <Text style={styles.sectionTitle}>Browse Surf Trips</Text>
      </View>
      <View style={styles.sectionCard}>
        {browse.length === 0 ? (
          <View style={styles.emptyBrowse}>
            <Ionicons name="compass-outline" size={36} color="#B0B0B0" />
            <Text style={styles.emptyText}>No other surf trips out there yet.</Text>
          </View>
        ) : (
          browse.map((g, i) => (
            <SurftripCard
              key={g.id}
              group={g}
              onPress={() => onOpenGroupDetail(g.id)}
              showDivider={i < browse.length - 1}
            />
          ))
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#F0F2F5' },
  content: { paddingTop: 12, paddingBottom: 140 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  browseHeader: { paddingTop: 24 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7B7B7B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  newChatBtn: { padding: 4 },

  sectionCard: {
    backgroundColor: '#FFFFFF',
  },

  emptyMine: {
    paddingVertical: 22,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  emptyBrowse: {
    paddingVertical: 32,
    alignItems: 'center',
    gap: 10,
  },
  emptyText: { fontSize: 14, color: '#7B7B7B', textAlign: 'center', lineHeight: 20 },
});
