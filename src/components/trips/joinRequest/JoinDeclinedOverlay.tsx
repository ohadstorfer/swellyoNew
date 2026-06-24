import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Image,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as CachedImage } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
import { ff } from '../../../theme/fonts';
import type { UnseenJoinDecision } from '../../../services/trips/groupTripsService';

// Full doodle illustration (line + icons) — Figma node 13073:15813, native
// 391×706, baked #FAFAFA background. Same asset the "You're in!" screen uses.
const ILLUSTRATION = require('../../../assets/illustrations/youre-in-illustration.png');
// Figma frame width the illustration coords are authored against.
const FIGMA_W = 393;

interface Props {
  visible: boolean;
  decision: UnseenJoinDecision | null;
  /** Called when the user taps the primary CTA (Explore trips). */
  onPrimaryAction: (decision: UnseenJoinDecision) => void;
  /** Called when the user dismisses without taking the primary action (back). */
  onDismiss: (decision: UnseenJoinDecision) => void;
  /** "Message admin" — open a DM with the trip's host. Falls back to onDismiss. */
  onMessageAdmin?: (decision: UnseenJoinDecision) => void;
}

const initialsOf = (name: string | null | undefined): string =>
  (name || '?').trim().charAt(0).toUpperCase() || '?';

// Round avatar with initials fallback — mirrors JoinDecisionOverlay's Avatar.
const Avatar: React.FC<{
  url: string | null;
  name: string | null;
  size: number;
  ring?: boolean;
}> = ({ url, name, size, ring }) => {
  const dim = { width: size, height: size, borderRadius: size / 2 };
  if (url) {
    return <Image source={{ uri: url }} style={[dim, ring && styles.avatarRing]} />;
  }
  return (
    <View style={[dim, styles.avatarFallback, ring && styles.avatarRing]}>
      <Text style={[styles.avatarInitial, { fontSize: size * 0.42 }]}>{initialsOf(name)}</Text>
    </View>
  );
};

// "annotation-x" glyph from Figma (node 13431:7008) — a message bubble with an x,
// stroked in Colors/Accent/100 (#FF5367). Inlined so it has no 7-day URL dependency.
const MessageXIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
    <Path
      d="M7.125 6L10.875 9.75M10.875 6L7.125 9.75M7.425 14.4L8.52 15.86C8.68284 16.0771 8.76426 16.1857 8.86407 16.2245C8.9515 16.2585 9.0485 16.2585 9.13593 16.2245C9.23574 16.1857 9.31716 16.0771 9.48 15.86L10.575 14.4C10.7949 14.1069 10.9048 13.9603 11.0389 13.8484C11.2177 13.6992 11.4287 13.5936 11.6554 13.5401C11.8253 13.5 12.0086 13.5 12.375 13.5C13.4234 13.5 13.9476 13.5 14.361 13.3287C14.9124 13.1004 15.3504 12.6624 15.5787 12.111C15.75 11.6976 15.75 11.1734 15.75 10.125V5.85C15.75 4.58988 15.75 3.95982 15.5048 3.47852C15.289 3.05516 14.9448 2.71095 14.5215 2.49524C14.0402 2.25 13.4101 2.25 12.15 2.25H5.85C4.58988 2.25 3.95982 2.25 3.47852 2.49524C3.05516 2.71095 2.71095 3.05516 2.49524 3.47852C2.25 3.95982 2.25 4.58988 2.25 5.85V10.125C2.25 11.1734 2.25 11.6976 2.42127 12.111C2.64963 12.6624 3.08765 13.1004 3.63896 13.3287C4.05245 13.5 4.57663 13.5 5.625 13.5C5.99143 13.5 6.17465 13.5 6.34463 13.5401C6.57127 13.5936 6.78234 13.6992 6.96112 13.8484C7.09521 13.9603 7.20514 14.1069 7.425 14.4Z"
      stroke="#FF5367"
      strokeWidth={1}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

/**
 * Declined counterpart of JoinDecisionOverlay ("You're in!"). Shown when a
 * group-trip join request was declined. Same Modal / header / hero-card shell,
 * but a red "message-x" info pill and an "Explore trips" / "Message admin" CTA.
 *
 * Matches Figma node 13431:6818.
 */
export const JoinDeclinedOverlay: React.FC<Props> = ({
  visible,
  decision,
  onPrimaryAction,
  onDismiss,
  onMessageAdmin,
}) => {
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  if (!decision) return null;

  const trip = decision.trip;
  const tripTitle = trip.title?.trim() || 'this trip';
  const location = trip.destination_label;
  const description = trip.description?.trim() || null;
  const hostName = trip.host_name?.trim() || null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => onDismiss(decision)}>
      <View style={styles.root}>
        {/* Background — the full doodle illustration (line + icons), scaled to the
            device width so the proportions match the Figma frame (393 wide). Same
            asset/positioning as the "You're in!" screen. */}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Image
            source={ILLUSTRATION}
            style={{
              position: 'absolute',
              top: 84 * (screenW / FIGMA_W),
              left: 0,
              width: screenW,
              height: screenW * (706 / 391),
            }}
            resizeMode="stretch"
          />
        </View>

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
            <Text style={styles.headline}>Not this time...</Text>
            <Text style={styles.subhead}>This trip isn&rsquo;t a match right now.</Text>
            <Text style={styles.subtext}>but there are more waves out there</Text>
          </View>

          {/* Trip card */}
          <View style={styles.card}>
            <View style={styles.tripsCard}>
              {trip.hero_image_url ? (
                <CachedImage
                  source={{ uri: trip.hero_image_url }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
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
                <Text style={styles.tripTitle} numberOfLines={1}>
                  {tripTitle}
                </Text>
                {description ? (
                  <Text style={styles.tripDesc} numberOfLines={2}>
                    {description}
                  </Text>
                ) : location ? (
                  <Text style={styles.tripDesc} numberOfLines={1}>
                    {location}
                  </Text>
                ) : null}
              </View>
            </View>

            {/* Info pill — declined message */}
            <View style={styles.infoPill}>
              <View style={styles.infoIcon}>
                <MessageXIcon size={18} />
              </View>
              <View style={styles.infoTextRow}>
                <Text style={styles.infoText}>
                  Your request to join {tripTitle} was declined
                </Text>
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
          <TouchableOpacity
            style={styles.cta}
            onPress={() => onPrimaryAction(decision)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Explore trips"
          >
            <Text style={styles.ctaText}>Explore trips</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => (onMessageAdmin ?? onDismiss)(decision)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Message admin"
          >
            <Text style={styles.secondaryText}>Message admin</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAFAFA' },

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

  // Headline (Figma: "Not this time..." accent 32 / subhead Montserrat 18 / subtext Inter 16)
  headlineWrap: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 72, paddingBottom: 8 },
  headline: {
    fontFamily: ff('Montserrat', '700'),
    fontSize: 32,
    lineHeight: 34,
    fontWeight: '700',
    color: '#05BCD3',
    textAlign: 'center',
  },
  subhead: {
    fontFamily: ff('Montserrat', '700'),
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: '#333333',
    textAlign: 'center',
    marginTop: 8,
  },
  subtext: {
    fontFamily: ff('Inter', '400'),
    fontSize: 16,
    lineHeight: 24,
    color: '#333333',
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 336,
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

  // Info pill — gray (Surface/M 04 #CFCFCF) with the red message-x glyph.
  infoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 32,
    backgroundColor: '#CFCFCF',
  },
  infoIcon: {
    backgroundColor: '#FFFFFF',
    padding: 10,
    borderRadius: 32,
  },
  infoTextRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoText: {
    flex: 1,
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 18,
    color: '#0A0A0A',
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
  // "Message admin" — secondary text button (Figma: Inter Bold, Size/md 14 / Size/xl 18, #333).
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
  avatarFallback: {
    backgroundColor: '#0788B0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: ff('Montserrat', '700'),
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
