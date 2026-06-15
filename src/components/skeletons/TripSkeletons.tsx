// Loading skeletons for the Trips surface (My Trips, Explore, Create/budget).
// Built on the shared SkeletonBase/Shimmer primitives so the shimmer animation
// matches the rest of the app. Each skeleton mirrors the real card's shape so the
// transition from loading → loaded doesn't shift layout.

import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SkeletonBase } from './SkeletonPrimitives';

const C = {
  surface: '#FFFFFF',
  // Slightly lighter than SkeletonBase's #E4E4E4 — used for the card "chrome"
  // (white card body) so the inner shimmer blocks read as content.
  chrome: '#FFFFFF',
};

// Deck card geometry — mirrors the constants in TripsScreen's TripDeck so the
// Explore skeleton lands on the exact same footprint as the real carousel (same
// card width/height → no size or position jump when loading → loaded).
const SCREEN_W = Dimensions.get('window').width;
const DECK_GAP = 28;
const DECK_PEEK = 12;
const DECK_CARD_W = Math.min(366, SCREEN_W - 2 * (DECK_GAP + DECK_PEEK));
const DECK_CARD_H = Math.round((DECK_CARD_W * 384) / 328);

// ---------------------------------------------------------------------------
// My Trips — full-width card (photo block + status badge row).
// ---------------------------------------------------------------------------
export const TripCardSkeleton: React.FC = () => (
  <View style={styles.card}>
    {/* Photo block (shimmering) with the card's overlaid content as light
        silhouettes — host row (top-left), title/location (bottom-left),
        participant cluster pill (bottom-right) — mirroring the real TripCard's
        exact element sizes and positions so loading → loaded never shifts. */}
    <View style={styles.cardImage}>
      <SkeletonBase
        width="100%"
        height={undefined as any}
        borderRadius={24}
        style={StyleSheet.absoluteFill as any}
      />
      {/* Host row (top-left) — 52px avatar + name, inset 16 (mirrors hostRow) */}
      <View style={styles.ovHostRow}>
        <View style={styles.ovHostAvatar} />
        <View style={styles.ovHostName} />
      </View>
      {/* Title (25/34) + location (15/20), 24px above the image bottom */}
      <View style={styles.ovTextBlock}>
        <View style={styles.ovTitle} />
        <View style={styles.ovDesc} />
      </View>
      {/* Participant cluster pill (bottom-right) — two 40px avatars + count */}
      <View style={styles.ovCluster}>
        <View style={styles.ovClusterAvatar} />
        <View style={[styles.ovClusterAvatar, styles.ovClusterAvatarOverlap]} />
        <View style={styles.ovClusterCount} />
      </View>
    </View>
    {/* Status badge: white icon circle + label (left) / date (right) on ONE row,
        inside a rounded pill — same footprint as the real colored statusBadge. */}
    <View style={styles.badgeRow}>
      <View style={styles.badgeIcon} />
      <View style={styles.badgeTextRow}>
        <SkeletonBase width={64} height={13} borderRadius={6} />
        <SkeletonBase width={96} height={13} borderRadius={6} />
      </View>
    </View>
  </View>
);

export const MyTripsSkeleton: React.FC<{ count?: number }> = ({ count = 3 }) => (
  <View style={styles.myTripsRoot}>
    {/* Filter pills — same row layout as TripFilterBar (space-between, 44px tall,
        marginHorizontal 6) so the chips land exactly where the real ones do. */}
    <View style={styles.filterRow}>
      <SkeletonBase width={44} height={44} borderRadius={12} />
      <SkeletonBase width={96} height={44} borderRadius={12} />
      <SkeletonBase width={100} height={44} borderRadius={12} />
      <SkeletonBase width={96} height={44} borderRadius={12} />
    </View>
    {Array.from({ length: count }).map((_, i) => (
      <TripCardSkeleton key={i} />
    ))}
  </View>
);

// ---------------------------------------------------------------------------
// Explore — a single centered card (the focused card of the swipe deck).
// ---------------------------------------------------------------------------
// Center card — mirrors the real ExploreTripCard: host row, bottom gradient,
// title (2 lines), location, price + dates, spots-left and the participant
// cluster pill. (The trip-type pill is intentionally omitted from the skeleton.)
const ExploreCardSkeleton: React.FC = () => (
  <View style={styles.deckCard}>
    <View style={styles.exPhoto}>
      <SkeletonBase width="100%" height={DECK_CARD_H} borderRadius={24} />

      {/* Host row (top-left) */}
      <View style={styles.exHostRow}>
        <View style={styles.exHostAvatar} />
        <View style={styles.exHostName} />
      </View>

      {/* Bottom gradient so the white silhouettes read on the photo */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.6)']}
        style={styles.exGradient}
        pointerEvents="none"
      />

      {/* Bottom info block */}
      <View style={styles.exBottom}>
        <View style={styles.exTitleA} />
        <View style={styles.exTitleB} />
        <View style={styles.exLocation} />
        <View style={styles.exInfoRow}>
          <View style={styles.exInfoLeft}>
            <View style={styles.exPrice} />
            <View style={styles.exDates} />
          </View>
          <View style={styles.exInfoRight}>
            <View style={styles.exSpots} />
            <View style={styles.exCluster}>
              <View style={styles.exClusterAvatar} />
              <View style={[styles.exClusterAvatar, styles.exClusterAvatarOverlap]} />
              <View style={styles.exClusterCount} />
            </View>
          </View>
        </View>
      </View>
    </View>
  </View>
);

// Explore loading state — ONLY the swipe-deck card is a skeleton (it's the real
// data). The title, filter chips and "Popular" heading are static and render
// immediately from TripsScreen, so we don't fake them here. The card lands on
// the same footprint as the real centered card → no jump when data arrives.
export const ExploreDeckSkeleton: React.FC = () => (
  <View style={styles.deckRegion}>
    <ExploreCardSkeleton />
  </View>
);

// ---------------------------------------------------------------------------
// Create (budget step) — 3 tier cards in a row.
// ---------------------------------------------------------------------------
export const BudgetCardsSkeleton: React.FC = () => (
  <View style={styles.budgetRow}>
    {[0, 1, 2].map(i => (
      <SkeletonBase key={i} width={undefined as any} height={120} borderRadius={16} style={styles.budgetCard} />
    ))}
  </View>
);

// ---------------------------------------------------------------------------
// Trip Detail — hero + section placeholders matching the real layout.
// ---------------------------------------------------------------------------
export const TripDetailSkeleton: React.FC = () => (
  <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
    <SkeletonBase width="100%" height={260} borderRadius={0} />
    <View style={{ padding: 20, gap: 12 }}>
      <SkeletonBase width="70%" height={24} borderRadius={6} />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <SkeletonBase width={120} height={16} borderRadius={6} />
        <SkeletonBase width={100} height={16} borderRadius={6} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
        {[0, 1, 2, 3].map(i => (
          <SkeletonBase key={i} width={36} height={36} borderRadius={18} />
        ))}
      </View>
      <SkeletonBase width="40%" height={18} borderRadius={6} style={{ marginTop: 16 } as any} />
      <SkeletonBase width="100%" height={14} borderRadius={6} />
      <SkeletonBase width="90%" height={14} borderRadius={6} />
      <SkeletonBase width="60%" height={14} borderRadius={6} />
      <SkeletonBase width="40%" height={18} borderRadius={6} style={{ marginTop: 16 } as any} />
      <SkeletonBase width="100%" height={14} borderRadius={6} />
      <SkeletonBase width="80%" height={14} borderRadius={6} />
    </View>
  </View>
);

const styles = StyleSheet.create({
  // My Trips — mirrors listContent (paddingHorizontal 16) so cards align with the
  // real ones; the filter row owns the top gap via marginTop (real list has none).
  myTripsRoot: {
    flex: 1,
    paddingHorizontal: 16,
  },
  // Matches the real TripFilterBar's filterRow exactly.
  filterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 22,
    marginBottom: 28,
    marginHorizontal: 6,
    alignItems: 'center',
  },
  card: {
    backgroundColor: C.chrome,
    borderRadius: 32,
    padding: 10,
    marginBottom: 16,
    gap: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.09,
    shadowRadius: 12,
    elevation: 3,
  },
  cardImage: {
    width: '100%',
    aspectRatio: 328 / 246,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#E4E4E4',
    position: 'relative',
  },
  // Overlaid content silhouettes (light patches on the gray photo) — each mirrors
  // the real TripCard element's size and position.
  // hostRow: padding 16 → top/left 16; gap 10; avatar 52 (hostAvatar).
  ovHostRow: {
    position: 'absolute',
    top: 16,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ovHostAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.75)',
  },
  ovHostName: {
    width: 72,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.65)',
  },
  // cardTextContent: paddingLeft 16, paddingBottom 24, gap 4.
  ovTextBlock: {
    position: 'absolute',
    left: 16,
    bottom: 24,
  },
  ovTitle: {
    width: 160,
    height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
  ovDesc: {
    marginTop: 4,
    width: 150,
    height: 14,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  // avatarCluster: right 12, bottom 14; clusterAvatar 40, overlap -20; pill bg.
  ovCluster: {
    position: 'absolute',
    right: 12,
    bottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F7F7',
    borderRadius: 56,
    paddingVertical: 0,
    paddingLeft: 0,
    paddingRight: 7,
  },
  ovClusterAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#DDDDDD',
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  ovClusterAvatarOverlap: {
    marginLeft: -20,
  },
  ovClusterCount: {
    width: 16,
    height: 10,
    borderRadius: 5,
    marginLeft: 1,
    backgroundColor: '#CFCFCF',
  },
  // statusBadge: gap 8, paddingH 8, paddingV 7, borderRadius 32; icon 38 white;
  // statusTextRow: flex 1, space-between, paddingRight 8 (label left / date right).
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 32,
    backgroundColor: '#EFEFEF',
  },
  badgeIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
  },
  badgeTextRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 8,
  },

  // Explore deck region — same height as the real carousel (deckRoot), card
  // centered horizontally like the focused card.
  deckRegion: {
    height: DECK_CARD_H + 12,
    alignItems: 'center',
  },
  deckCard: {
    width: DECK_CARD_W,
    height: DECK_CARD_H,
  },
  // Center Explore card detail
  exPhoto: {
    width: '100%',
    height: DECK_CARD_H,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#E4E4E4',
    position: 'relative',
  },
  exHostRow: {
    position: 'absolute',
    top: 16,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  exHostAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  exHostName: {
    width: 84,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  exGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 220,
  },
  exBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 8,
    paddingRight: 16,
    paddingBottom: 24,
    paddingLeft: 16,
    gap: 10,
  },
  exTitleA: {
    width: '72%',
    height: 20,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  exTitleB: {
    width: '52%',
    height: 20,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  exLocation: {
    width: '40%',
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  exInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 2,
  },
  exInfoLeft: {
    gap: 6,
    flexShrink: 1,
  },
  exPrice: {
    width: 64,
    height: 18,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  exDates: {
    width: 120,
    height: 14,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  exInfoRight: {
    alignItems: 'flex-end',
    gap: 8,
  },
  exSpots: {
    width: 78,
    height: 14,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
  exCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F7F7',
    borderRadius: 56,
    paddingVertical: 2,
    paddingLeft: 2,
    paddingRight: 8,
  },
  exClusterAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#DDDDDD',
  },
  exClusterAvatarOverlap: {
    marginLeft: -12,
  },
  exClusterCount: {
    width: 18,
    height: 10,
    borderRadius: 5,
    marginLeft: 6,
    backgroundColor: '#CFCFCF',
  },

  // Create budget
  budgetRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  budgetCard: {
    flex: 1,
  },
});
