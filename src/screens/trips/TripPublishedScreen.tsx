// TripPublishedScreen — success screen shown right after a group trip is
// created. Figma node 13451:18151 ("Your trip is live!"), built to match the
// "You're in!" join overlay (JoinDecisionOverlay): full doodle illustration
// background (line + icons), a success check badge, the trip card, and a
// "Share your trip" / "Maybe later" footer.
//
// "Share your trip" opens ShareTripSheet (Figma node 14417:95452) rather than
// the OS share sheet: WhatsApp, Instagram (the branded story card), or Copy
// link. Every route carries the same join link — friends open the trip in-app
// and tap "Request to join" (group trips are host-approved).

import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { ff } from '../../theme/fonts';
import { ShareTripSheet } from '../../components/trips/ShareTripSheet';
import { ShareTripStorySheet, type TripStoryVM } from '../../components/trips/ShareTripStorySheet';
import { isExpoGo } from '../../utils/keyboardAvoidingView';

// Full "Your trip is live!" doodle illustration (line + icons) — Figma node
// 13451:18152, exported at the design's native 391×756. Its baked background is
// #FAFAFA (same as the screen), so it blends seamlessly (reads as transparent).
const ILLUSTRATION = require('../../assets/illustrations/trip-live-illustration.png');
const FIGMA_W = 393; // frame width the illustration coords are authored against
const ILLO_RATIO = 756 / 391; // illustration aspect (height / width)

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

export interface TripPublishedScreenProps {
  tripId: string;
  tripTitle: string | null;
  heroImageUri?: string | null;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  /** Shown on the Instagram story card under the title. */
  destinationLabel?: string | null;
  /** group_trips.trip_structure — becomes the "how it's run" line when sharing. */
  structureSlugs?: string[] | null;
  /** Drives the "N spots open" line when sharing. Null = no cap set. */
  maxParticipants?: number | null;
  /** Counts shown in the info pill — a just-created trip has 0/0. */
  requestCount?: number;
  memberCount?: number;
  /** Close the success screen and continue (into the app / trip list). */
  onDone: () => void;
}

export const TripPublishedScreen: React.FC<TripPublishedScreenProps> = ({
  tripId,
  tripTitle,
  heroImageUri,
  description,
  startDate,
  endDate,
  destinationLabel,
  structureSlugs,
  maxParticipants,
  requestCount = 0,
  memberCount = 0,
  onDone,
}) => {
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const [shareSheetVisible, setShareSheetVisible] = useState(false);
  const [storySheetVisible, setStorySheetVisible] = useState(false);
  // Set when the host taps Instagram: the story sheet may only open once the
  // share sheet's Modal has fully torn down (see ShareTripSheet.onDismissed).
  const [storyPending, setStoryPending] = useState(false);

  const title = tripTitle?.trim() || 'Your trip';
  const desc = description?.trim() || null;
  const dates = formatDateRange(startDate ?? null, endDate ?? null);

  // The story card is captured with react-native-view-shot — a native module
  // that isn't in Expo Go, and view-shot doesn't exist on web at all.
  const canCreatePost = Platform.OS !== 'web' && !isExpoGo;

  // Dates arrive as DATE columns ("YYYY-MM-DD"); slice defensively in case a
  // caller hands over a full timestamp, which would misparse on split('-').
  const storyVm: TripStoryVM = {
    heroImageUri: heroImageUri ?? null,
    title: tripTitle ?? null,
    destinationLabel: destinationLabel ?? null,
    startDateISO: startDate ? startDate.slice(0, 10) : null,
    endDateISO: endDate ? endDate.slice(0, 10) : null,
    durationDays: null,
    dateMonths: null,
  };

  const handleCreatePost = () => {
    if (!canCreatePost) {
      Alert.alert(
        'Not available here',
        'Creating an Instagram post needs the full app. Share the link instead — it works everywhere.'
      );
      return;
    }
    setStoryPending(true);
    setShareSheetVisible(false);
  };

  const handleShareSheetDismissed = () => {
    if (!storyPending) return;
    setStoryPending(false);
    setStorySheetVisible(true);
  };

  return (
    <View style={styles.root}>
      {/* Background doodle illustration. Explicit numeric width/height ON the
          Image (scaled to the device width) so the icon proportions match the
          Figma frame; otherwise the Image falls back to its huge intrinsic size. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Image
          source={ILLUSTRATION}
          style={{
            position: 'absolute',
            top: 84 * (screenW / FIGMA_W),
            left: 0,
            width: screenW,
            height: screenW * ILLO_RATIO,
          }}
          resizeMode="stretch"
        />
      </View>

      {/* Dark header — back returns to the app. */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={onDone}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Success check badge — green gradient disc on a soft white ring. */}
        <View style={styles.badgeWrap}>
          <View style={styles.badgeRing}>
            <LinearGradient
              colors={['#84EBB4', '#2BCCBD']}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={styles.badge}
            >
              <Ionicons name="checkmark" size={26} color="#FFFFFF" />
            </LinearGradient>
          </View>
        </View>

        {/* Headline */}
        <View style={styles.headlineWrap}>
          <Text style={styles.headline}>Your trip is live!</Text>
          <Text style={styles.subhead}>Start inviting people to join</Text>
        </View>

        {/* Trip card */}
        <View style={styles.card}>
          <View style={styles.tripsCard}>
            {heroImageUri ? (
              <Image source={{ uri: heroImageUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.heroFallback]}>
                <Ionicons name="image-outline" size={30} color="#9AA0A6" />
              </View>
            )}

            <LinearGradient
              colors={['rgba(0,0,0,0.35)', 'rgba(0,0,0,0)']}
              style={styles.topScrim}
              pointerEvents="none"
            />

            {/* LIVE tag (top-left) */}
            <View style={styles.profileRow}>
              <View style={styles.liveTag}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            </View>

            <View style={styles.heroSpacer} />

            {/* Bottom glass band with title + description. */}
            <View style={styles.eventContainer}>
              <LinearGradient
                colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.65)']}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
              <Text style={styles.tripTitle} numberOfLines={1}>{title}</Text>
              {desc ? <Text style={styles.tripDesc} numberOfLines={2}>{desc}</Text> : null}
            </View>
          </View>

          {/* Info pill — dates + counts */}
          <View style={styles.infoPill}>
            <View style={styles.infoIcon}>
              <Ionicons name="calendar-outline" size={18} color="#0A0A0A" />
            </View>
            <View style={styles.infoTextRow}>
              {dates ? <Text style={styles.infoDates}>{dates}</Text> : <View />}
              <View style={styles.infoCount}>
                <Ionicons name="people-outline" size={16} color="#333333" />
                <Text style={styles.infoCountText}>
                  {requestCount} request{requestCount === 1 ? '' : 's'} • {memberCount} member{memberCount === 1 ? '' : 's'}
                </Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
        <LinearGradient
          colors={['rgba(250,250,250,0)', '#FAFAFA']}
          style={styles.footerFade}
          pointerEvents="none"
        />
        <TouchableOpacity
          style={styles.cta}
          onPress={() => setShareSheetVisible(true)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Share your trip"
        >
          <Ionicons name="share-social-outline" size={22} color="#FFFFFF" />
          <Text style={styles.ctaText}>Share your trip</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={onDone}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Maybe later"
        >
          <Text style={styles.secondaryText}>Maybe later</Text>
        </TouchableOpacity>
      </View>

      <ShareTripSheet
        visible={shareSheetVisible}
        onClose={() => setShareSheetVisible(false)}
        onDismissed={handleShareSheetDismissed}
        tripId={tripId}
        tripTitle={tripTitle}
        details={{
          startDate,
          endDate,
          structureSlugs,
          participantCount: memberCount,
          maxParticipants,
        }}
        onCreatePost={handleCreatePost}
      />

      {storySheetVisible && (
        <ShareTripStorySheet
          visible={storySheetVisible}
          tripId={tripId}
          vm={storyVm}
          onClose={() => setStorySheetVisible(false)}
        />
      )}
    </View>
  );
};

export default TripPublishedScreen;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAFAFA' },

  // Header
  header: { backgroundColor: '#212121', paddingHorizontal: 12, paddingBottom: 12 },
  backBtn: { flexDirection: 'row', alignItems: 'center' },
  backText: {
    fontFamily: ff('Montserrat', '700'),
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    marginLeft: 4,
  },

  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },

  // Success check badge
  badgeWrap: { alignItems: 'center', paddingTop: 28 },
  badgeRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2BCCBD',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  badge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Headline
  headlineWrap: { alignItems: 'center', paddingHorizontal: 30, paddingTop: 16, paddingBottom: 8 },
  headline: {
    fontFamily: ff('Montserrat', '700'),
    fontSize: 24, // Size/3-xl
    lineHeight: 29, // 1.2
    letterSpacing: -1,
    fontWeight: '700',
    color: '#333333',
    textAlign: 'center',
  },
  subhead: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12, // Size/s
    lineHeight: 18,
    color: '#333333',
    textAlign: 'center',
    marginTop: 8,
  },

  // Card
  card: {
    marginHorizontal: 20,
    marginTop: 24,
    backgroundColor: '#FFFFFF',
    borderRadius: 32,
    padding: 10,
    gap: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.09,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  tripsCard: { height: 246, borderRadius: 24, overflow: 'hidden', backgroundColor: '#E5E7EB' },
  heroFallback: { alignItems: 'center', justifyContent: 'center' },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0, height: 88 },
  profileRow: { flexDirection: 'row', alignItems: 'center', padding: 16 },

  // LIVE tag
  liveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F7F7F7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 16,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#2BCCBD' },
  liveText: {
    fontFamily: ff('Inter', '400'),
    fontSize: 9, // Size/xxs
    lineHeight: 14,
    color: '#000000',
  },

  heroSpacer: { flex: 1 },
  eventContainer: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20 },
  tripTitle: {
    fontFamily: ff('Montserrat', '700'),
    fontSize: 22, // Size/2-xl
    lineHeight: 32,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  tripDesc: {
    fontFamily: ff('Inter', '400'),
    fontSize: 14, // Size/md
    lineHeight: 18, // Size/xl
    color: '#FFFFFF',
    marginTop: 4,
  },

  // Info pill (green)
  infoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 32,
    backgroundColor: '#84EBB4',
  },
  infoIcon: { backgroundColor: '#FFFFFF', padding: 10, borderRadius: 32 },
  infoTextRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  infoDates: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12, // Size/s
    lineHeight: 18,
    color: '#0A0A0A',
  },
  infoCount: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  infoCountText: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12, // Size/s
    lineHeight: 18,
    color: '#333333',
  },

  // Footer CTA
  footer: { paddingHorizontal: 40, paddingTop: 12 },
  footerFade: { position: 'absolute', left: 0, right: 0, bottom: '100%', height: 96 },
  cta: {
    height: 56,
    borderRadius: 12,
    backgroundColor: '#212121',
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontFamily: ff('Montserrat', '600'),
    fontSize: 16,
    lineHeight: 22, // Size/2-xl
    fontWeight: '600',
    color: '#FFFFFF',
  },
  secondaryBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 14, marginTop: 4 },
  secondaryText: {
    fontFamily: ff('Inter', '700'),
    fontSize: 14, // Size/md
    lineHeight: 18,
    fontWeight: '700',
    color: '#333333',
  },
});
