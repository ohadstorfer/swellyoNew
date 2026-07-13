// Invitee-facing sheet: accept or decline a pending group-trip invite.
import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '../BottomSheetShell';
import { respondToInvite } from '../../services/trips/tripInvitesService';
import { ff } from '../../theme/fonts';

interface TripInviteResponseSheetProps {
  visible: boolean;
  inviteId: string;
  tripName: string;
  respondingUserId: string;
  onClose: () => void;
  onResponded: (response: 'accepted' | 'declined') => void;
}

export function TripInviteResponseSheet({
  visible, inviteId, tripName, respondingUserId, onClose, onResponded,
}: TripInviteResponseSheetProps) {
  const insets = useSafeAreaInsets();
  const [submitting, setSubmitting] = useState(false);

  const respond = useCallback(async (response: 'accepted' | 'declined') => {
    setSubmitting(true);
    try {
      await respondToInvite(inviteId, response, respondingUserId);
      onResponded(response);
    } finally {
      setSubmitting(false);
    }
  }, [inviteId, respondingUserId, onResponded]);

  return (
    <BottomSheetShell visible={visible} onClose={onClose}>
      <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
        <Text style={styles.title}>You've been invited</Text>
        <Text style={styles.body}>Join "{tripName}"?</Text>
        {submitting ? (
          <ActivityIndicator style={styles.loading} />
        ) : (
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.button, styles.decline]} onPress={() => respond('declined')}>
              <Text style={styles.declineText}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.accept]} onPress={() => respond('accepted')}>
              <Text style={styles.acceptText}>Accept</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </BottomSheetShell>
  );
}

export default TripInviteResponseSheet;

const styles = StyleSheet.create({
  container: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  title: { fontFamily: ff('Montserrat', '700'), fontSize: 18, color: '#212121', marginBottom: 8, includeFontPadding: false },
  body: { fontFamily: ff('Inter', '400'), fontSize: 15, color: '#444', marginBottom: 20, includeFontPadding: false },
  loading: { marginVertical: 20 },
  actions: { flexDirection: 'row', gap: 12 },
  button: { flex: 1, paddingVertical: 12, borderRadius: 24, alignItems: 'center' },
  decline: { backgroundColor: '#eee' },
  accept: { backgroundColor: '#111' },
  declineText: { fontFamily: ff('Montserrat', '600'), color: '#333', includeFontPadding: false },
  acceptText: { fontFamily: ff('Montserrat', '600'), color: '#fff', includeFontPadding: false },
});
