import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Image,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { UnseenJoinDecision } from '../../../services/trips/groupTripsService';

interface Props {
  visible: boolean;
  decision: UnseenJoinDecision | null;
  /** Called when the user taps the primary CTA (Enter Trip / Explore trips). */
  onPrimaryAction: (decision: UnseenJoinDecision) => void;
  /** Called when the user dismisses without taking the primary action (e.g. close button). */
  onDismiss: (decision: UnseenJoinDecision) => void;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatDateRange(startIso: string | null, endIso: string | null): string | null {
  if (!startIso) return null;
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return null;
  const startStr = `${MONTHS[start.getMonth()]} ${start.getDate()}`;
  if (!endIso) return `${startStr}, ${start.getFullYear()}`;
  const end = new Date(endIso);
  if (Number.isNaN(end.getTime())) return `${startStr}, ${start.getFullYear()}`;
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${MONTHS[start.getMonth()]} ${start.getDate()}-${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${startStr} - ${MONTHS[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
}

export const JoinDecisionOverlay: React.FC<Props> = ({
  visible,
  decision,
  onPrimaryAction,
  onDismiss,
}) => {
  if (!decision) return null;
  const approved = decision.status === 'approved';
  const tripTitle = decision.trip.title?.trim() || 'this trip';
  const location = decision.trip.destination_label;
  const dates = formatDateRange(decision.trip.start_date, decision.trip.end_date);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => onDismiss(decision)}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={() => onDismiss(decision)}
            hitSlop={12}
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={22} color="#222B30" />
          </TouchableOpacity>

          <View style={styles.content}>
            <View style={[styles.iconCircle, approved ? styles.iconApproved : styles.iconDeclined]}>
              <Ionicons
                name={approved ? 'checkmark' : 'close'}
                size={48}
                color="#FFFFFF"
              />
            </View>

            <Text style={styles.headline}>
              {approved ? "You're in!" : 'Not a match this time'}
            </Text>
            <Text style={styles.sub}>
              {approved
                ? 'Welcome to the group'
                : 'The host is looking for a different vibe for this trip'}
            </Text>

            <View style={styles.tripCard}>
              {decision.trip.hero_image_url ? (
                <Image
                  source={{ uri: decision.trip.hero_image_url }}
                  style={styles.heroImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.heroImage, styles.heroFallback]}>
                  <Ionicons name="image-outline" size={26} color="#9AA0A6" />
                </View>
              )}
              <View style={styles.tripText}>
                <Text style={styles.tripTitle} numberOfLines={2}>{tripTitle}</Text>
                {location ? <Text style={styles.tripMeta}>{location}</Text> : null}
                {dates ? <Text style={styles.tripMeta}>{dates}</Text> : null}
              </View>
            </View>
          </View>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.cta, approved ? styles.ctaApproved : styles.ctaDeclined]}
              onPress={() => onPrimaryAction(decision)}
              activeOpacity={0.85}
            >
              <Text style={[styles.ctaText, !approved && styles.ctaTextDeclined]}>
                {approved ? 'Enter Trip' : 'Explore trips'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  container: { flex: 1 },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 16,
    zIndex: 2,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F1F3F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  iconApproved: { backgroundColor: '#16A34A' },
  iconDeclined: { backgroundColor: '#9AA0A6' },
  headline: {
    fontSize: 26,
    fontWeight: '800',
    color: '#222B30',
    textAlign: 'center',
  },
  sub: {
    fontSize: 14.5,
    color: '#4A5565',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 21,
    maxWidth: 320,
  },
  tripCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    gap: 12,
    marginTop: 28,
    width: '100%',
    backgroundColor: '#FAFAFA',
  },
  heroImage: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: '#E5E7EB',
  },
  heroFallback: { alignItems: 'center', justifyContent: 'center' },
  tripText: { flex: 1 },
  tripTitle: { fontSize: 15, fontWeight: '700', color: '#222B30' },
  tripMeta: { fontSize: 12.5, color: '#7B7B7B', marginTop: 2 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
  cta: {
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  ctaApproved: { backgroundColor: '#222B30' },
  ctaDeclined: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#222B30',
  },
  ctaText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  ctaTextDeclined: { color: '#222B30' },
});
