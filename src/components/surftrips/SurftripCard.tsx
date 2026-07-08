import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../Text';
import { Thumb } from '../Thumb';
import type { SurftripGroupForUser } from '../../types/surftrips';

interface SurftripCardProps {
  group: SurftripGroupForUser;
  onPress: () => void;
  showDivider?: boolean;
}

const roleLabelFor = (role: SurftripGroupForUser['my_role']): string | null => {
  if (role === 'host') return 'Host';
  if (role === 'admin') return 'Admin';
  return null;
};

export const SurftripCard: React.FC<SurftripCardProps> = ({ group, onPress, showDivider }) => {
  const role = group.is_member ? roleLabelFor(group.my_role) : null;

  return (
    <TouchableOpacity activeOpacity={0.6} onPress={onPress} style={styles.row}>
      <View style={styles.thumbWrap}>
        {group.hero_image_url ? (
          <Thumb
            uri={group.hero_image_url}
            size={144}
            style={styles.thumb}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <Ionicons name="people" size={22} color="#FFFFFF" />
          </View>
        )}
      </View>

      <View style={styles.body}>
        <View style={styles.titleLine}>
          <Text style={styles.title} numberOfLines={1}>
            {group.name}
          </Text>
          {role && (
            <View style={styles.rolePill}>
              <Text style={styles.rolePillText}>{role}</Text>
            </View>
          )}
        </View>
        {group.description ? (
          <Text style={styles.description} numberOfLines={1}>
            {group.description}
          </Text>
        ) : null}
      </View>
      {showDivider && <View style={styles.divider} />}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
  },
  thumbWrap: { marginRight: 12 },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#F2F2F2',
  },
  thumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#A8DDE0',
  },
  body: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 16, fontWeight: '600', color: '#222B30', flexShrink: 1 },
  rolePill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    backgroundColor: '#E6F4F8',
    borderRadius: 4,
  },
  rolePillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#0788B0',
    letterSpacing: 0.2,
  },
  description: { fontSize: 13, color: '#5A6066', marginTop: 2 },
  divider: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#ECECEC',
  },
});
