import React from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../Text';
import type { EnrichedSurftripRequest } from '../../types/surftrips';

interface PendingSurftripRequestCardProps {
  request: EnrichedSurftripRequest;
  onApprove: (id: string) => void;
  onDecline: (id: string) => void;
  onPressRequester?: (userId: string) => void;
  isProcessing?: boolean;
}

export const PendingSurftripRequestCard: React.FC<PendingSurftripRequestCardProps> = ({
  request,
  onApprove,
  onDecline,
  onPressRequester,
  isProcessing,
}) => {
  const { name, profile_image_url, age, surf_level_category } = request.requester;
  const detail = [age != null ? `${age} yo` : null, surf_level_category].filter(Boolean).join(' · ');

  const requesterContent = (
    <>
      {profile_image_url ? (
        <Image source={{ uri: profile_image_url }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarPlaceholder]}>
          <Text style={styles.avatarInitial}>{(name || 'U').charAt(0).toUpperCase()}</Text>
        </View>
      )}
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{name || 'User'}</Text>
        {detail ? <Text style={styles.detail} numberOfLines={1}>{detail}</Text> : null}
      </View>
    </>
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {onPressRequester ? (
          <TouchableOpacity
            style={styles.profileTouch}
            onPress={() => onPressRequester(request.requester_id)}
            activeOpacity={0.6}
            accessibilityLabel={`View ${name || 'requester'}'s profile`}
          >
            {requesterContent}
          </TouchableOpacity>
        ) : (
          <View style={styles.profileTouch}>{requesterContent}</View>
        )}
        {isProcessing ? (
          <ActivityIndicator color="#0788B0" />
        ) : (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.btn, styles.declineBtn]}
              onPress={() => onDecline(request.id)}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={18} color="#222B30" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.approveBtn]}
              onPress={() => onApprove(request.id)}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="checkmark" size={18} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        )}
      </View>
      {request.request_note ? (
        <Text style={styles.note} numberOfLines={3}>“{request.request_note}”</Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EEE',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  profileTouch: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, marginRight: 10, backgroundColor: '#F2F2F2' },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#A8DDE0' },
  avatarInitial: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  info: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: '600', color: '#222B30' },
  detail: { fontSize: 12, color: '#7B7B7B', marginTop: 2 },
  actions: { flexDirection: 'row', gap: 6 },
  btn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  declineBtn: { backgroundColor: '#F2F2F2' },
  approveBtn: { backgroundColor: '#0788B0' },
  note: {
    fontSize: 12,
    color: '#555',
    fontStyle: 'italic',
    marginTop: 8,
    paddingHorizontal: 4,
  },
});
