// TripPublishedScreen — success screen shown right after a trip is published.
// Mirrors the surftrip invite-share UX: a "Published!" confirmation with a
// Share button that sends a join link. The link opens the trip in-app where
// friends tap "Request to join" (group trips are host-approved).

import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Share,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getGroupTripInviteUrl } from '../../services/trips/groupTripsService';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONTSERRAT = Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

const C = {
  brandTeal: '#0788B0',
  brandTealText: '#066b8c',
  brandTealTint: '#E6F4F8',
  inkDark: '#212121',
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF2F4',
  success: '#34C759',
  bg: '#FAFAFA',
};

export interface TripPublishedScreenProps {
  tripId: string;
  tripTitle: string | null;
  heroImageUri?: string | null;
  /** Close the success screen and continue (into the app / trip list). */
  onDone: () => void;
}

export const TripPublishedScreen: React.FC<TripPublishedScreenProps> = ({
  tripId,
  tripTitle,
  heroImageUri,
  onDone,
}) => {
  const [sharing, setSharing] = useState(false);

  const handleShare = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const url = getGroupTripInviteUrl(tripId);
      const name = tripTitle?.trim() || 'my surf trip';
      await Share.share({
        // `message` carries the link on Android + as the body on iOS; `url`
        // gives iOS a rich link target. Keep the URL in the message so it
        // survives apps that ignore the url field (WhatsApp, etc.).
        message: `Join ${name} on Swellyo 🌊\n${url}`,
        url,
      });
    } catch (e: any) {
      // Share sheet dismissed is not an error; only surface real failures.
      if (e?.message && !/cancel/i.test(e.message)) {
        Alert.alert('Could not share', e.message);
      }
    } finally {
      setSharing(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.body}>
        {heroImageUri ? (
          <Image source={{ uri: heroImageUri }} style={styles.hero} resizeMode="cover" />
        ) : (
          <View style={[styles.hero, styles.heroPlaceholder]}>
            <Ionicons name="image-outline" size={36} color="#B0B0B0" />
          </View>
        )}

        <View style={styles.badge}>
          <Ionicons name="checkmark" size={36} color="#FFFFFF" />
        </View>

        <Text style={styles.title}>Published!</Text>
        <Text style={styles.subtitle}>
          {tripTitle?.trim() ? `"${tripTitle.trim()}" is live.` : 'Your trip is live.'}
          {'\n'}Invite friends with a link — they can request to join.
        </Text>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleShare}
          accessibilityRole="button"
          accessibilityLabel="Invite friends"
          style={styles.shareBtn}
        >
          <Ionicons name="share-social-outline" size={20} color="#FFFFFF" />
          <Text style={styles.shareBtnText}>Invite friends</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onDone}
        accessibilityRole="button"
        accessibilityLabel="Done"
        style={styles.doneBtn}
      >
        <Text style={styles.doneBtnText}>Done</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

export default TripPublishedScreen;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  hero: {
    width: 200,
    height: 130,
    borderRadius: 18,
    backgroundColor: C.surfaceMuted,
    marginBottom: 24,
  },
  heroPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  title: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 26,
    fontWeight: '800',
    color: C.inkDark,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    lineHeight: 20,
    color: C.textMuted,
    textAlign: 'center',
    marginBottom: 28,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: C.brandTeal,
    paddingVertical: 16,
    paddingHorizontal: 28,
    borderRadius: 30,
    minWidth: 220,
  },
  shareBtnText: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  doneBtn: {
    alignSelf: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    marginBottom: 8,
  },
  doneBtnText: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 16,
    fontWeight: '600',
    color: C.textMuted,
  },
});
