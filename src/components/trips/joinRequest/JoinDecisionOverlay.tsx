import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Image,
  ScrollView,
  Share,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as CachedImage } from 'expo-image';
import { ff } from '../../../theme/fonts';
import Thumb from '../../Thumb';
import { getStorageThumbUrl } from '../../../services/media/imageService';
import type { UnseenJoinDecision } from '../../../services/trips/groupTripsService';
import { getGroupTripInviteUrl } from '../../../services/trips/groupTripsService';
import { YoureInIllustration } from './YoureInIllustration';
import { Images } from '../../../assets/images';

const DOODLES = require('../../../assets/images/trips/welcome-doodles.png');

interface Props {
  visible: boolean;
  decision: UnseenJoinDecision | null;
  /** Called when the user taps the primary CTA (Enter Trip / Explore trips). */
  onPrimaryAction: (decision: UnseenJoinDecision) => void;
  /** Called when the user dismisses without taking the primary action (back). */
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

// Round avatar with default-avatar fallback (matches the gear/member avatars elsewhere).
const Avatar: React.FC<{
  url: string | null;
  name: string | null;
  size: number;
  ring?: boolean;
}> = ({ url, name, size, ring }) => {
  const dim = { width: size, height: size, borderRadius: size / 2 };
  if (url) {
    return (
      <Thumb
        uri={url}
        size={size}
        style={[dim, ring && styles.avatarRing]}
        contentFit="cover"
        cachePolicy="memory-disk"
      />
    );
  }
  return (
    <CachedImage
      source={Images.defaultAvatar}
      style={[dim, ring && styles.avatarRing]}
      contentFit="cover"
    />
  );
};

export const JoinDecisionOverlay: React.FC<Props> = ({
  visible,
  decision,
  onPrimaryAction,
  onDismiss,
}) => {
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  if (!decision) return null;

  const approved = decision.status === 'approved';
  const trip = decision.trip;
  const tripTitle = trip.title?.trim() || 'this trip';
  const location = trip.destination_label;
  const description = trip.description?.trim() || null;
  const dates = formatDateRange(trip.start_date, trip.end_date);
  const hostName = trip.host_name?.trim() || null;

  const avatars = trip.member_avatars ?? [];
  const overflow = Math.max(0, (trip.member_count ?? avatars.length) - avatars.length);

  // Native share — includes the trip invite link (matching TripDetailScreen /
  // TripPublishedScreen) so it doesn't paste as plain text without a link.
  const handleShare = async () => {
    try {
      const url = getGroupTripInviteUrl(trip.id);
      const name = trip.title?.trim() || 'my surf trip';
      await Share.share({
        message: `Join ${name} on Swellyo 🌊\n${url}`,
        url,
      });
    } catch {
      // user cancelled or share unavailable — silently no-op
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => onDismiss(decision)}>
      <View style={styles.root}>
        {/* Background — approved shows the full "You're in!" doodle illustration
            (line + icons) at the design's native coords; declined falls back to
            the faint surf doodles. */}
        {approved ? (
          // Animated doodle: the line crawls in from the left while the icons
          // pop in one-by-one along it, both starting together on mount.
          <YoureInIllustration screenW={screenW} />
        ) : (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <Image source={DOODLES} style={styles.doodles} resizeMode="cover" />
          </View>
        )}

        {/* Dark header — back chevron dismisses. */}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => onDismiss(decision)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Close"
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
          {/* Headline */}
          <View style={styles.headlineWrap}>
            <Text style={[styles.headline, approved && styles.headlineApproved]}>
              {approved ? "You're in!" : 'Not a match this time'}
            </Text>
            <Text style={[styles.subhead, approved && styles.subheadApproved]}>
              {approved
                ? 'Welcome to the group'
                : 'The host is looking for a different vibe for this trip'}
            </Text>
          </View>

          {/* Trip card */}
          <View style={styles.card}>
            <View style={styles.tripsCard}>
              {trip.hero_image_url ? (
                <CachedImage
                  source={{ uri: getStorageThumbUrl(trip.hero_image_url, 320) ?? trip.hero_image_url }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <View style={[StyleSheet.absoluteFill, styles.heroFallback]}>
                  <Ionicons name="image-outline" size={30} color="#9AA0A6" />
                </View>
              )}

              {/* Top scrim so the host name stays legible on bright photos. */}
              <LinearGradient
                colors={['rgba(0,0,0,0.35)', 'rgba(0,0,0,0)']}
                style={styles.topScrim}
                pointerEvents="none"
              />

              {/* Host */}
              {hostName || trip.host_avatar ? (
                <View style={styles.profileRow}>
                  <Avatar url={trip.host_avatar} name={hostName} size={40} ring />
                  {hostName ? <Text style={styles.hostName}>{hostName}</Text> : null}
                </View>
              ) : null}

              <View style={styles.heroSpacer} />

              {/* Bottom glass band with title + description. */}
              <View style={styles.eventContainer}>
                <LinearGradient
                  colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.65)']}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                />
                <Text style={styles.tripTitle} numberOfLines={1}>{tripTitle}</Text>
                {description ? (
                  <Text style={styles.tripDesc} numberOfLines={2}>{description}</Text>
                ) : location ? (
                  <Text style={styles.tripDesc} numberOfLines={1}>{location}</Text>
                ) : null}
              </View>

              {/* Member avatar stack */}
              {avatars.length > 0 ? (
                <View style={styles.avatarStack}>
                  {avatars.map((url, i) => (
                    <View key={i} style={[styles.stackItem, i > 0 && styles.stackOverlap]}>
                      <Avatar url={url} name={null} size={32} />
                    </View>
                  ))}
                  {overflow > 0 ? <Text style={styles.stackNumber}>+{overflow}</Text> : null}
                </View>
              ) : null}
            </View>

            {/* Info pill */}
            <View style={[styles.infoPill, approved ? styles.infoPillApproved : styles.infoPillDeclined]}>
              <View style={styles.infoIcon}>
                <Ionicons
                  name={approved ? 'calendar-outline' : 'compass-outline'}
                  size={18}
                  color="#0A0A0A"
                />
              </View>
              <View style={styles.infoTextRow}>
                <Text style={styles.infoStatus}>{approved ? 'Upcoming' : 'Closed'}</Text>
                {dates ? <Text style={styles.infoDates}>{dates}</Text> : null}
              </View>
            </View>
          </View>
        </ScrollView>

        {/* CTA */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
          <LinearGradient
            colors={['rgba(250,250,250,0)', '#FAFAFA']}
            style={styles.footerFade}
            pointerEvents="none"
          />
          {approved ? (
            <>
              <TouchableOpacity
                style={styles.cta}
                onPress={handleShare}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Share your trip"
              >
                <Ionicons name="share-social-outline" size={22} color="#FFFFFF" />
                <Text style={styles.ctaText}>Share your trip</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => onPrimaryAction(decision)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Maybe later"
              >
                <Text style={styles.secondaryText}>Maybe later</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={styles.cta}
              onPress={() => onPrimaryAction(decision)}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Text style={styles.ctaText}>Explore trips</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAFAFA' },
  doodles: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.9,
  },
  // Full doodle illustration (Figma 13073:15813, native 391×706). left/right:0
  // makes it span the screen width; aspectRatio derives the height — no
  // screenW math (a NaN there made the Image fall back to its huge intrinsic
  // size). top mirrors the Figma illustration offset (84 in a 393-wide frame).
  illustration: { position: 'absolute', top: 84, left: 0, right: 0, aspectRatio: 391 / 706 },

  // Header
  header: {
    backgroundColor: '#212121',
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
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

  // Headline
  headlineWrap: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 72, paddingBottom: 8 },
  headline: {
    fontFamily: ff('Montserrat', '700'),
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '700',
    color: '#0A0A0A',
    textAlign: 'center',
  },
  // Approved → big accent "You're in!" (Figma: Text/M Accent, Size/4-xl 32).
  headlineApproved: {
    color: '#05BCD3',
    fontSize: 32,
    lineHeight: 34,
  },
  subhead: {
    fontFamily: ff('Inter', '400'),
    fontSize: 16,
    lineHeight: 24,
    color: '#4A5565',
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 280,
  },
  // Approved → "Welcome to the group" (Figma: Text/M 01 #333, Size/xl 18).
  subheadApproved: {
    color: '#333333',
    fontSize: 18,
  },

  // Card
  card: {
    marginHorizontal: 20,
    marginTop: 28,
    backgroundColor: '#FFFFFF',
    borderRadius: 32,
    padding: 10,
    gap: 12,
    // Card Shadow — Figma: #00000017, radius 24.
    shadowColor: '#000000',
    shadowOpacity: 0.09,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  tripsCard: {
    height: 246,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#E5E7EB',
  },
  heroFallback: { alignItems: 'center', justifyContent: 'center' },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0, height: 88 },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
  },
  hostName: {
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    lineHeight: 18,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  heroSpacer: { flex: 1 },
  eventContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 20,
    paddingRight: 96, // keep text clear of the avatar stack
  },
  tripTitle: {
    fontFamily: ff('Montserrat', '700'),
    fontSize: 22,
    lineHeight: 32,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  tripDesc: {
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    lineHeight: 18,
    color: '#FFFFFF',
    marginTop: 4,
  },

  // Member avatar stack (bottom-right of hero)
  avatarStack: {
    position: 'absolute',
    right: 12,
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F7F7',
    borderWidth: 1,
    borderColor: '#CFCFCF',
    borderRadius: 56,
    paddingVertical: 1,
    paddingLeft: 1,
    paddingRight: 8,
  },
  stackItem: { borderRadius: 16 },
  stackOverlap: { marginLeft: -16 },
  stackNumber: {
    fontFamily: ff('Montserrat', '400'),
    fontSize: 16,
    lineHeight: 20,
    color: '#7B7B7B',
    marginLeft: 6,
  },

  // Info pill
  infoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 32,
  },
  infoPillApproved: { backgroundColor: '#84EBB4' },
  infoPillDeclined: { backgroundColor: '#E7EAEE' },
  infoIcon: {
    backgroundColor: '#FFFFFF',
    padding: 10,
    borderRadius: 32,
  },
  infoTextRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  infoStatus: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 18,
    color: '#0A0A0A',
  },
  infoDates: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 18,
    color: '#4A5565',
  },

  // CTA
  footer: {
    paddingHorizontal: 40,
    paddingTop: 12,
  },
  footerFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '100%',
    height: 96,
  },
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
  // "Maybe later" — secondary text button under the share CTA (Figma: Inter Bold,
  // Size/md 14 / Size/xl 18, #333).
  secondaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    marginTop: 4,
  },
  secondaryText: {
    fontFamily: ff('Inter', '700'),
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    color: '#333333',
  },

  // Avatars
  avatarRing: { borderWidth: 1.5, borderColor: '#FFFFFF' },
});
