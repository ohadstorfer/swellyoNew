import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GroupTrip } from '../../services/trips/groupTripsService';

// --------------------------------------------------------------------------
// TripPreviewCard — the canonical trip card used in two places:
//   1. The TripsScreen feed (current production card markup, extracted from
//      TripsScreen.tsx:106–149 — preserved verbatim so visual parity holds).
//   2. The CreateTripFlow preview step (wizard §4 Step 5) where a draft trip
//      may have missing fields (no id yet, no uploaded hero URL, etc).
//
// IMPORTANT: this is a NEW file — TripsScreen.tsx is NOT modified here
// (Eyal has uncommitted WIP). Stream E / a follow-up will swap the inline
// TripCard for this component.
//
// Spec refs:
//   • docs/create-trip-redesign-spec.md §4 Step 5 (preview card)
//   • docs/create-trip-redesign-spec.md §7.8 (component signature)
//   • docs/component-ux-research.md §14 (preview / summary card survey)
// --------------------------------------------------------------------------

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONTSERRAT =
  Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

export type TripCardBadge = 'approved' | 'pending' | 'completed';

const BADGE_LABEL: Record<TripCardBadge, string> = {
  approved: 'Approved',
  pending: 'Pending',
  completed: 'Completed',
};

// Partial of GroupTrip with all the fields the card actually reads.
// Wizard preview passes a sparse object — the card must degrade gracefully.
type TripCardData = Partial<GroupTrip> & {
  title?: string | null;
  hero_image_url?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  dates_set_in_stone?: boolean | null;
  date_months?: string[] | null;
  target_surf_levels?: string[] | null;
  trip_structure?: string[] | null;
  trip_vibes?: string[] | null;
  budget_min?: number | null;
  budget_max?: number | null;
  budget_currency?: string | null;
  age_min?: number | null;
  age_max?: number | null;
};

export interface TripPreviewCardProps {
  trip: TripCardData;
  /**
   * Local URI (e.g. file:// or content://) shown before the hero is uploaded.
   * Takes precedence over `trip.hero_image_url`. Lets the wizard preview show
   * the cover photo the user just picked, even though it isn't in Supabase
   * storage yet.
   */
  heroImageOverride?: string | null;
  /** Tap handler. Optional — wizard preview leaves this undefined. */
  onPress?: () => void;
  /** Optional badge shown in the body (My Trips uses this). */
  badge?: TripCardBadge;
}

// ---------- helpers (copied from TripsScreen.tsx, adapted for partial data)

const formatDestination = (trip: TripCardData): string =>
  trip.destination?.short_label ||
  trip.destination?.name ||
  trip.destination?.country ||
  'Destination TBD';

const formatTripDates = (trip: TripCardData): string => {
  if (trip.start_date && trip.end_date) {
    const fmt = (d: string): string =>
      new Date(d).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
    const setInStone = trip.dates_set_in_stone ? '' : ' (flexible)';
    return `${fmt(trip.start_date)} – ${fmt(trip.end_date)}${setInStone}`;
  }
  if (trip.date_months && trip.date_months.length > 0) {
    return trip.date_months
      .map(m => {
        const [y, mo] = m.split('-');
        const yr = Number(y);
        const mn = Number(mo);
        if (!Number.isFinite(yr) || !Number.isFinite(mn)) return m;
        const date = new Date(yr, mn - 1, 1);
        return date.toLocaleDateString(undefined, {
          month: 'short',
          year: 'numeric',
        });
      })
      .join(' / ');
  }
  return 'Dates TBD';
};

export const TripPreviewCard: React.FC<TripPreviewCardProps> = ({
  trip,
  heroImageOverride,
  onPress,
  badge,
}) => {
  const heroSrc = useMemo<string | null>(() => {
    if (heroImageOverride) return heroImageOverride;
    if (trip.hero_image_url) return trip.hero_image_url;
    return null;
  }, [heroImageOverride, trip.hero_image_url]);

  const titleText = trip.title?.trim() ? trip.title : null;
  const surfLevels = (trip.target_surf_levels ?? []).slice(0, 2);
  const hasAgeRange =
    typeof trip.age_min === 'number' && typeof trip.age_max === 'number';

  const Container: React.ComponentType<any> = onPress ? TouchableOpacity : View;
  const containerProps = onPress
    ? {
        activeOpacity: 0.85,
        onPress,
        accessibilityRole: 'button' as const,
        accessibilityLabel: titleText ?? 'Trip',
      }
    : {};

  return (
    <Container
      {...containerProps}
      style={[styles.card, badge === 'completed' && styles.cardPast]}
    >
      {heroSrc ? (
        <Image source={{ uri: heroSrc }} style={styles.cardImage} />
      ) : (
        <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
          <Ionicons name="image-outline" size={32} color="#B0B0B0" />
        </View>
      )}
      <View style={styles.cardBody}>
        {badge ? (
          <View
            style={[styles.badge, badge === 'completed' && styles.badgeCompleted]}
          >
            <Text
              style={[
                styles.badgeText,
                badge === 'completed' && styles.badgeTextCompleted,
              ]}
            >
              {BADGE_LABEL[badge]}
            </Text>
          </View>
        ) : null}

        {titleText ? (
          <Text style={styles.cardTitle} numberOfLines={1}>
            {titleText}
          </Text>
        ) : null}

        <Text style={styles.cardDest}>{formatDestination(trip)}</Text>
        <Text style={styles.cardDates}>{formatTripDates(trip)}</Text>

        {hasAgeRange || surfLevels.length > 0 ? (
          <View style={styles.tagRow}>
            {hasAgeRange ? (
              <View style={styles.tag}>
                <Text style={styles.tagText}>
                  {trip.age_min}–{trip.age_max} yrs
                </Text>
              </View>
            ) : null}
            {surfLevels.map(l => (
              <View key={l} style={styles.tag}>
                <Text style={styles.tagText}>{l}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Container>
  );
};

// Styles preserved verbatim from TripsScreen.tsx:502-542 so the feed and the
// wizard preview render identically. The only addition is `fontFamily` on the
// text styles — the feed currently renders the system fallback, which is fine
// but inconsistent with the rest of the redesigned wizard.
const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    marginBottom: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#EEE',
  },
  cardPast: { opacity: 0.6 },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#0A0A0A',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    marginBottom: 8,
  },
  badgeCompleted: { backgroundColor: '#D1D5DC' },
  badgeText: {
    fontFamily: FONT_INTER,
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  badgeTextCompleted: { color: '#0A0A0A' },
  cardImage: { width: '100%', height: 160, backgroundColor: '#F2F2F2' },
  cardImagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { padding: 12 },
  cardTitle: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 16,
    fontWeight: '700',
    color: '#222B30',
    marginBottom: 4,
  },
  cardDest: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    color: '#555',
    marginBottom: 2,
  },
  cardDates: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    color: '#7B7B7B',
    marginBottom: 8,
  },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: {
    backgroundColor: '#F2F2F2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginRight: 6,
    marginBottom: 4,
  },
  tagText: {
    fontFamily: FONT_INTER,
    fontSize: 11,
    color: '#555',
    fontWeight: '500',
  },
});

export default TripPreviewCard;
