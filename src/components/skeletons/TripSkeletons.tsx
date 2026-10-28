// Loading skeletons for the Trips surface (My Trips, Explore, Trip detail,
// Create/budget). Built on the shared SkeletonBase/Shimmer primitives so the
// shimmer animation matches the rest of the app. Each skeleton mirrors the real
// layout's sizes and positions so loading → loaded doesn't shift anything.
//
// Keep these in step with the real screens. Sources:
//   My Trips     → TripsScreen: TripFilterBar, TripCard
//   Explore      → TripsScreen: ExploreTripCard + ExploreSwipeDeck
//   Trip detail  → TripDetailViewRedesigned (cover, hero card, info cards,
//                  sections) + TripTabToggle + TripDetailScreen's cover buttons

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SkeletonBase } from './SkeletonPrimitives';
import { DECK_PEEK } from '../trips/ExploreSwipeDeck';

/** Light silhouette drawn on top of a shimmering photo block. */
const ON_PHOTO = 'rgba(255,255,255,0.7)';
const ON_PHOTO_STRONG = 'rgba(255,255,255,0.85)';

// ---------------------------------------------------------------------------
// My Trips — full-width card (photo block + status badge row).
// ---------------------------------------------------------------------------
export const TripCardSkeleton: React.FC = () => (
  <View style={styles.card}>
    <View style={styles.cardImage}>
      <SkeletonBase
        width="100%"
        height={undefined as any}
        borderRadius={0}
        containerStyle={StyleSheet.absoluteFillObject}
        style={styles.fill}
      />
      {/* Host row (top-left): 40 avatar + name, padding 16, gap 10. */}
      <View style={styles.ovHostRow}>
        <View style={styles.ovHostAvatar} />
        <View style={styles.ovHostName} />
      </View>
      {/* Title + location on the bottom glass panel (16 in, 24 above the edge). */}
      <View style={styles.ovTextBlock}>
        <View style={styles.ovTitle} />
        <View style={styles.ovDesc} />
      </View>
      {/* Participant cluster (bottom-right): 32 avatars, -16 overlap. */}
      <View style={styles.ovCluster}>
        <View style={styles.clusterAvatar} />
        <View style={[styles.clusterAvatar, styles.clusterOverlap]} />
        <View style={[styles.clusterAvatar, styles.clusterOverlap]} />
        <View style={styles.clusterCount} />
      </View>
    </View>
    {/* Status badge: white icon circle + label (left) / date (right). */}
    <View style={styles.badgeRow}>
      <View style={styles.badgeIcon} />
      <View style={styles.badgeTextRow}>
        <SkeletonBase width={64} height={12} borderRadius={6} />
        <SkeletonBase width={96} height={12} borderRadius={6} />
      </View>
    </View>
  </View>
);

export const MyTripsSkeleton: React.FC<{ count?: number }> = ({ count = 3 }) => (
  <View style={styles.myTripsRoot}>
    {/* Filter pills — "All", "Upcoming (n)", "Completed (n)": hug-width,
        33 tall, packed left 11 apart (TripFilterBar). */}
    <View style={styles.filterRow}>
      <SkeletonBase width={42} height={33} borderRadius={12} />
      <SkeletonBase width={108} height={33} borderRadius={12} />
      <SkeletonBase width={118} height={33} borderRadius={12} />
    </View>
    {Array.from({ length: count }).map((_, i) => (
      <TripCardSkeleton key={i} />
    ))}
  </View>
);

// ---------------------------------------------------------------------------
// Explore — the card stack (ExploreSwipeDeck) with the front card filled in.
// ---------------------------------------------------------------------------
// Same as ExploreSwipeDeck's BACK_SCALE_STEP: each card behind is 10% smaller.
const BACK_SCALE_STEP = 0.1;
// ExploreTripCard geometry.
const EX_FRAME_PAD = 8;
const EX_INFO_H = 64;

/** Where ExploreSwipeDeck draws the card `depth` slots behind the front one. */
const deckTransform = (depth: number, height: number) => [
  { translateY: depth * (height * (BACK_SCALE_STEP / 2) + DECK_PEEK) },
  { scale: 1 - BACK_SCALE_STEP * depth },
];

const ExploreFrontCardSkeleton: React.FC = () => (
  <View style={styles.exFrame}>
    <View style={styles.exImage}>
      <SkeletonBase
        width="100%"
        height={undefined as any}
        borderRadius={0}
        containerStyle={StyleSheet.absoluteFillObject}
        style={styles.fill}
      />
      {/* Level + vibe pills (top-left). */}
      <View style={styles.exPills}>
        <View style={[styles.exPill, { width: 96 }]} />
        <View style={[styles.exPill, { width: 72 }]} />
      </View>
      {/* Details panel: title, location, then dates + the occupancy pill. */}
      <View style={styles.exPanel}>
        <LinearGradient
          colors={['rgba(78,78,78,0)', 'rgba(78,78,78,0.35)']}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={styles.exPanelContent}>
          <View style={styles.exRoute}>
            <View style={styles.exTitleLine}>
              <View style={styles.exTitle} />
            </View>
            <View style={styles.exLocationLine}>
              <View style={styles.exLocation} />
            </View>
          </View>
          <View style={styles.exDateRow}>
            <View style={styles.exDates} />
            <View style={styles.exCluster}>
              <View style={styles.clusterAvatarSm} />
              <View style={[styles.clusterAvatarSm, styles.clusterOverlap]} />
              <View style={[styles.clusterAvatarSm, styles.clusterOverlap]} />
              <View style={styles.clusterCount} />
            </View>
          </View>
        </View>
      </View>
    </View>
    {/* Host (avatar + "Host" + name) on the left, price on the right. */}
    <View style={styles.exInfo}>
      <View style={styles.exHost}>
        <SkeletonBase width={40} height={40} borderRadius={20} />
        <View style={styles.exHostText}>
          <SkeletonBase width={30} height={10} borderRadius={5} />
          <SkeletonBase width={92} height={12} borderRadius={6} />
        </View>
      </View>
      <SkeletonBase width={92} height={22} borderRadius={8} />
    </View>
  </View>
);

/**
 * Explore loading state. Only the stack is a skeleton — the title and filter
 * button are static and render from TripsScreen. Pass the same width/height
 * the real deck gets so the stack lands on the exact same footprint.
 */
export const ExploreDeckSkeleton: React.FC<{ cardWidth: number; cardHeight: number }> = ({
  cardWidth,
  cardHeight,
}) => (
  <View style={{ width: cardWidth, height: cardHeight + DECK_PEEK * 2 }}>
    {[2, 1].map(depth => (
      <View
        key={depth}
        style={[
          styles.exSlot,
          { width: cardWidth, height: cardHeight, transform: deckTransform(depth, cardHeight) },
        ]}
      >
        <View style={styles.exFrame}>
          <View style={[styles.exImage, styles.exImageBack]} />
          <View style={{ height: EX_INFO_H }} />
        </View>
      </View>
    ))}
    <View style={[styles.exSlot, { width: cardWidth, height: cardHeight }]}>
      <ExploreFrontCardSkeleton />
    </View>
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
// Trip Detail — the Overview tab: full-bleed cover under the status bar, the
// white hero card overlapping it, the tab toggle, the three info cards and the
// first sections.
// ---------------------------------------------------------------------------
/** TripDetailViewRedesigned's HERO_H: cover height below the status bar. */
const HERO_H = 340;

export const TripDetailSkeleton: React.FC<{
  /** Status-bar inset — the cover runs under it, like the real one. */
  topInset?: number;
  /** Real, pressable control for the cover's top-left (the back button). */
  leading?: React.ReactNode;
}> = ({ topInset = 0, leading }) => (
  <View style={styles.dtRoot}>
    <View style={styles.dtWhite}>
      <View style={styles.dtHeroWrap}>
        <SkeletonBase width="100%" height={HERO_H + topInset} borderRadius={0} />
        <View style={[styles.dtControls, { top: topInset + 8 }]} pointerEvents="box-none">
          {leading ?? <View style={styles.dtCoverBtn} />}
          <View style={styles.dtCoverActions}>
            <View style={styles.dtCoverBtn} />
            <View style={styles.dtCoverBtn} />
            <View style={styles.dtCoverBtn} />
          </View>
        </View>

        {/* Hero card: date + title, then host and the surf stats. */}
        <View style={styles.dtHeroCard}>
          <View style={styles.dtHeroCardTop}>
            <View style={styles.line18}>
              <SkeletonBase width={150} height={11} borderRadius={6} />
            </View>
            <View style={[styles.line24, { marginTop: 2 }]}>
              <SkeletonBase width={190} height={16} borderRadius={8} />
            </View>
          </View>
          <View style={styles.dtHeroCardBottom}>
            <View style={styles.dtHeroHost}>
              <SkeletonBase width={74} height={74} borderRadius={37} />
              <View style={styles.line17}>
                <SkeletonBase width={52} height={10} borderRadius={5} />
              </View>
            </View>
            <View style={styles.dtHeroStats}>
              {[0, 1, 2].map(i => (
                <View key={i} style={styles.dtHeroStat}>
                  <SkeletonBase width={30} height={30} borderRadius={4} />
                  <View style={styles.dtHeroStatText}>
                    <SkeletonBase width={44} height={9} borderRadius={5} />
                    <SkeletonBase width={72} height={12} borderRadius={6} />
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>
      </View>

      {/* Overview / Plan toggle. */}
      <View style={styles.dtToggle}>
        <View style={styles.dtSegment}>
          <SkeletonBase width={72} height={14} borderRadius={7} />
        </View>
        <View style={styles.dtSegment}>
          <SkeletonBase width={44} height={14} borderRadius={7} />
        </View>
      </View>
    </View>

    <View style={styles.dtBody}>
      {/* Participants / Local Crew / Trip Vibe. */}
      <View style={styles.dtInfoRow}>
        {[0, 1, 2].map(i => (
          <View key={i} style={styles.dtInfoCard}>
            <SkeletonBase width={38} height={38} borderRadius={8} />
            <View>
              <View style={styles.line17}>
                <SkeletonBase width={56} height={9} borderRadius={5} />
              </View>
              <View style={styles.line18}>
                <SkeletonBase width={40} height={12} borderRadius={6} />
              </View>
            </View>
          </View>
        ))}
      </View>

      {/* About this trip. */}
      <View style={[styles.dtSection, styles.dtSectionLine]}>
        <View style={[styles.line24, styles.dtSectionTitle]}>
          <SkeletonBase width={124} height={16} borderRadius={8} />
        </View>
        {['100%', '100%', '94%', '62%'].map((w, i) => (
          <View key={i} style={styles.line18}>
            <SkeletonBase width={w} height={11} borderRadius={6} />
          </View>
        ))}
      </View>

      {/* About the host: avatar + name, then the bio. */}
      <View style={styles.dtSection}>
        <View style={styles.dtHostHeader}>
          <SkeletonBase width={53} height={53} borderRadius={27} />
          <SkeletonBase width={150} height={16} borderRadius={8} />
        </View>
        {['100%', '88%', '70%'].map((w, i) => (
          <View key={i} style={styles.line18}>
            <SkeletonBase width={w} height={11} borderRadius={6} />
          </View>
        ))}
      </View>
    </View>
  </View>
);

const styles = StyleSheet.create({
  fill: { width: '100%', height: '100%' },
  // Text-line boxes: a block centred in the text's line height, so the rows
  // take the same vertical space as the real text.
  line17: { height: 17, justifyContent: 'center' },
  line18: { height: 18, justifyContent: 'center' },
  line24: { height: 24, justifyContent: 'center' },

  // ── My Trips ──
  myTripsRoot: {
    flex: 1,
    paddingHorizontal: 16,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
    marginBottom: 28,
    marginHorizontal: 6,
    gap: 11,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 32,
    padding: 10,
    marginHorizontal: 5,
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
  },
  ovHostRow: {
    position: 'absolute',
    top: 16,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ovHostAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: ON_PHOTO_STRONG,
  },
  ovHostName: {
    width: 84,
    height: 12,
    borderRadius: 6,
    backgroundColor: ON_PHOTO,
  },
  ovTextBlock: {
    position: 'absolute',
    left: 16,
    bottom: 24,
    gap: 8,
  },
  ovTitle: {
    width: 170,
    height: 22,
    borderRadius: 8,
    backgroundColor: ON_PHOTO_STRONG,
  },
  ovDesc: {
    width: 130,
    height: 12,
    borderRadius: 6,
    backgroundColor: ON_PHOTO,
  },
  ovCluster: {
    position: 'absolute',
    right: 11,
    bottom: 11,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F7F7',
    borderRadius: 56,
    borderWidth: 1,
    borderColor: '#CFCFCF',
    paddingVertical: 1,
    paddingLeft: 1,
    paddingRight: 8,
  },
  clusterAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#DDDDDD',
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  clusterAvatarSm: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#DDDDDD',
  },
  clusterOverlap: { marginLeft: -16 },
  clusterCount: {
    width: 22,
    height: 10,
    borderRadius: 5,
    marginLeft: 6,
    backgroundColor: '#CFCFCF',
  },
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

  // ── Explore ──
  exSlot: { position: 'absolute', top: 0, left: 0 },
  exFrame: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 32,
    padding: EX_FRAME_PAD,
    gap: EX_FRAME_PAD,
    shadowColor: '#3E3E3E',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 6,
  },
  exImage: { flex: 1, borderRadius: 24, overflow: 'hidden', backgroundColor: '#E4E4E4' },
  exImageBack: { backgroundColor: '#EDEDED' },
  exPills: { position: 'absolute', top: 20, left: 8, flexDirection: 'row', gap: 8 },
  exPill: { height: 33, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.6)' },
  exPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '39%',
    justifyContent: 'flex-end',
  },
  exPanelContent: { paddingLeft: 20, paddingRight: 16, paddingVertical: 16, gap: 9 },
  exRoute: { gap: 4 },
  exTitleLine: { height: 24, justifyContent: 'center' },
  exTitle: { width: '62%', height: 18, borderRadius: 7, backgroundColor: ON_PHOTO_STRONG },
  exLocationLine: { height: 20, justifyContent: 'center' },
  exLocation: { width: '40%', height: 12, borderRadius: 6, backgroundColor: ON_PHOTO },
  exDateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  exDates: { width: 128, height: 13, borderRadius: 6, backgroundColor: ON_PHOTO },
  exCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F7F7',
    borderRadius: 56,
    paddingLeft: 1,
    paddingVertical: 1,
    paddingRight: 8,
  },
  exInfo: {
    height: EX_INFO_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 8,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  exHost: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  exHostText: { gap: 6 },

  // ── Create budget ──
  budgetRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  budgetCard: {
    flex: 1,
  },

  // ── Trip detail ──
  dtRoot: { flex: 1, backgroundColor: '#FAFAFA' },
  dtWhite: { backgroundColor: '#FFFFFF' },
  dtHeroWrap: { paddingBottom: 8 },
  dtControls: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  dtCoverActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // Same footprint as the real coverBtn: padding 10 round a 24 icon.
  dtCoverBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.7)' },
  dtHeroCard: {
    marginTop: -61,
    marginHorizontal: 18,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    shadowColor: '#000000',
    shadowOpacity: 0.09,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },
  dtHeroCardTop: { paddingHorizontal: 20, paddingVertical: 10, alignItems: 'center' },
  dtHeroCardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 81,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },
  dtHeroHost: { alignItems: 'center', gap: 8, width: 74 },
  dtHeroStats: { gap: 8, flexShrink: 1 },
  dtHeroStat: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  dtHeroStatText: { gap: 6 },
  dtToggle: {
    flexDirection: 'row',
    marginTop: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  dtSegment: { flex: 1, height: 52, alignItems: 'center', justifyContent: 'center' },
  dtBody: { paddingHorizontal: 16 },
  dtInfoRow: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 2,
    marginTop: 20,
    marginBottom: 8,
  },
  dtInfoCard: {
    flex: 1,
    alignItems: 'flex-start',
    gap: 8,
    padding: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    backgroundColor: '#FFFFFF',
  },
  dtSection: { paddingVertical: 20 },
  dtSectionLine: { borderBottomWidth: 1, borderBottomColor: '#EEEEEE' },
  dtSectionTitle: { marginBottom: 16 },
  dtHostHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
});
