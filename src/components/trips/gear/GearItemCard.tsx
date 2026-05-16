import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { EnrichedGearItem } from '../../../services/trips/groupTripsService';

interface Props {
  item: EnrichedGearItem;
  onPress: () => void;
}

const MAX_DOTS = 5; // beyond this we collapse with "+N" to avoid overflow on long rows

export const GearItemCard: React.FC<Props> = ({ item, onPress }) => {
  const { name, needed_qty, claimed_qty } = item;
  const isCovered = claimed_qty >= needed_qty;
  const remaining = Math.max(needed_qty - claimed_qty, 0);

  let statusText: string;
  if (isCovered) {
    statusText = 'Covered · All set';
  } else if (claimed_qty === 0) {
    statusText = 'Not covered yet';
  } else {
    statusText = `${claimed_qty} / ${needed_qty} collected · ${remaining} more needed`;
  }

  const dotCount = Math.min(needed_qty, MAX_DOTS);
  const overflow = needed_qty - dotCount;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{name}</Text>
        {isCovered ? <Ionicons name="checkmark-circle" size={20} color="#34C759" /> : null}
      </View>
      <Text style={styles.status}>{statusText}</Text>
      <View style={styles.dotsRow}>
        {Array.from({ length: dotCount }).map((_, i) => (
          <View key={i} style={[styles.dot, i < claimed_qty && styles.dotFilled]} />
        ))}
        {overflow > 0 ? <Text style={styles.dotsMore}>+{overflow}</Text> : null}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    backgroundColor: '#FFFFFF',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 15, fontWeight: '700', color: '#222B30', flex: 1, marginRight: 8 },
  status: { fontSize: 13, color: '#4A5565', marginTop: 4 },
  dotsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#0788B0',
    backgroundColor: '#FFFFFF',
  },
  dotFilled: { backgroundColor: '#0788B0', borderColor: '#0788B0' },
  dotsMore: { fontSize: 12, color: '#7B7B7B', marginLeft: 4 },
});
