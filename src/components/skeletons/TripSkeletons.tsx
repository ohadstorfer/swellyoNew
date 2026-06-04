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
// Explore skeleton lands on the same footprint as the real carousel.
const SCREEN_W = Dimensions.get('window').width;
const DECK_CARD_W = Math.min(330, SCREEN_W - 64);
const DECK_CARD_H = Math.round((DECK_CARD_W * 384) / 328);

// ---------------------------------------------------------------------------
// My Trips — full-width card (photo block + status badge row).
// ---------------------------------------------------------------------------
export const TripCardSkeleton: React.FC = () => (
  <View style={styles.card}>
    {/* Photo block (shimmering) with the card's overlaid content as light
        silhouettes — host row (top-left), title/desc (bottom-left), participant
        avatar (bottom-right) — mirroring the real TripCard. */}
    <View style={styles.cardImage}>
      <SkeletonBase
        width="100%"
        height={undefined as any}
        borderRadius={24}
        style={StyleSheet.absoluteFill as any}
      />
      <View style={styles.ovHostRow}>
        <View style={styles.ovHostAvatar} />
        <View style={styles.ovHostName} />
      </View>
      <View style={styles.ovTextBlock}>
        <View style={styles.ovTitle} />
        <View style={styles.ovDesc} />
      </View>
      <View style={styles.ovParticipant} />
    </View>
    {/* Status badge row: round icon + two stacked bars */}
    <View style={styles.badgeRow}>
      <SkeletonBase width={38} height={38} borderRadius={19} />
      <View style={styles.badgeText}>
        <SkeletonBase width={90} height={12} borderRadius={6} />
        <SkeletonBase width={130} height={12} borderRadius={6} style={{ marginTop: 6 }} />
      </View>
    </View>
  </View>
);

export const MyTripsSkeleton: React.FC<{ count?: number }> = ({ count = 3 }) => (
  <View style={styles.myTripsRoot}>
    {/* Filter pills */}
    <View style={styles.filterRow}>
      <SkeletonBase width={48} height={34} borderRadius={12} />
      <SkeletonBase width={96} height={34} borderRadius={12} />
      <SkeletonBase width={104} height={34} borderRadius={12} />
      <SkeletonBase width={100} height={34} borderRadius={12} />
    </View>
    {Array.from({ length: count }).map((_, i) => (
      <TripCardSkeleton key={i} />
    ))}
  </View>
);

// ---------------------------------------------------------------------------
// Explore — a single centered card (the focused card of the swipe deck).
// ---------------------------------------------------------------------------
// Center card — mirrors every element of the real ExploreTripCard: host row,
// trip-type pill, bottom gradient, title (2 lines), location, price + dates,
// spots-left and the participant cluster pill.
const ExploreCardSkeleton: React.FC = () => (
  <View style={styles.deckCard}>
    <View style={styles.exPhoto}>
      <SkeletonBase width="100%" height={DECK_CARD_H} borderRadius={24} />

      {/* Host row (top-left) */}
      <View style={styles.exHostRow}>
        <View style={styles.exHostAvatar} />
        <View style={styles.exHostName} />
      </View>

      {/* Trip-type pill (top-right) — white pill with icon + label silhouettes */}
      <View style={styles.exTypePill}>
        <View style={styles.exTypeIcon} />
        <View style={styles.exTypeLabel} />
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

export const ExploreDeckSkeleton: React.FC = () => (
  <View style={styles.deckRoot}>
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

const styles = StyleSheet.create({
  // My Trips
  myTripsRoot: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 11,
    paddingBottom: 12,
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
  // Overlaid content silhouettes (light patches on the gray photo).
  ovHostRow: {
    position: 'absolute',
    top: 16,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ovHostAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.75)',
  },
  ovHostName: {
    width: 64,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.65)',
  },
  ovTextBlock: {
    position: 'absolute',
    left: 16,
    bottom: 16,
  },
  ovTitle: {
    width: 120,
    height: 18,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.75)',
  },
  ovDesc: {
    marginTop: 8,
    width: 180,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  ovParticipant: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.75)',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  badgeText: {
    flex: 1,
  },

  // Explore deck
  deckRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
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
  exTypePill: {
    position: 'absolute',
    top: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  exTypeIcon: {
    width: 14,
    height: 14,
    borderRadius: 4,
    backgroundColor: '#D8D8D8',
  },
  exTypeLabel: {
    width: 72,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#D8D8D8',
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
