// TripDetailView — the rich, read-only trip layout shared by the create-trip
// wizard PREVIEW step and the real TripDetailScreen. Renders the informational
// body only (hero + live countdown, info chips, About, Focus vibe, Surf style,
// "How this trip works", Participants, Who it's for, Wave info, Accommodation).
//
// It owns NO data fetching and NO actions — callers pass a fully-built view
// model (TripDetailVM) and render their own headers / footers / action bars
// around it. Design: Figma node 12418-1946.

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Platform,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  TRIP_VIBE_OPTIONS,
  TRIP_STRUCTURE_OPTIONS,
  type SurfStyle,
  type HostingStyle,
} from '../../services/trips/groupTripsService';
import {
  priceInclusionSections,
  priceInclusionAddOns,
  CATEGORY_TITLE,
  type PriceInclusions,
} from '../../services/trips/priceInclusions';
import { WizardBottomSheet } from './WizardBottomSheet';
import { Images } from '../../assets/images';

// Upright (standing) board PNGs for the Surf style section.
export const BOARD_IMAGE: Partial<Record<SurfStyle, ReturnType<typeof require>>> = {
  shortboard: Images.boards.shortboard,
  midlength: Images.boards.midlength,
  softtop: Images.boards.softtop,
  longboard: Images.boards.longboard,
};

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONTSERRAT = Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

// Overview cards show ~2.5 per screen width. Page gutter is 16, gap is 10.
const SCREEN_WIDTH = Dimensions.get('window').width;
const OVERVIEW_CARD_WIDTH = Math.round((SCREEN_WIDTH - 16) / 2.5) - 8;

const C = {
  brandTeal: '#0788B0',
  brandTealText: '#066b8c',
  brandTealTint: '#E6F4F8',
  // Cyan accent — the same blue used across the create-trip flow.
  accent: '#05BCD3',
  accentTint: '#EAF9FC',
  inkDark: '#212121',
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  borderCard: '#E0E0E0',
  borderHairline: '#EEEEEE',
  iconBubble: '#F4F6F7',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF2F4',
  avatarBg: '#D6E2E8',
};

// Icon per "What's included" category — keyed by display title so the read-only
// sheet can show the same glyphs as the create-flow pricing step.
const INCLUDE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  [CATEGORY_TITLE.meals]: 'restaurant-outline',
  [CATEGORY_TITLE.accommodation]: 'bed-outline',
  [CATEGORY_TITLE.transportation]: 'car-outline',
  [CATEGORY_TITLE.surfSessions]: 'water-outline',
  [CATEGORY_TITLE.surfEquipment]: 'construct-outline',
  [CATEGORY_TITLE.surfFilm]: 'film-outline',
  [CATEGORY_TITLE.videoAnalysis]: 'videocam-outline',
  [CATEGORY_TITLE.activities]: 'compass-outline',
  [CATEGORY_TITLE.wellness]: 'leaf-outline',
  [CATEGORY_TITLE.custom]: 'sparkles-outline',
};

// ---------------------------------------------------------------------------
// View model — semi-raw so label logic lives here, not in every caller.
// ---------------------------------------------------------------------------
export interface TripDetailVM {
  heroImageUri: string | null;
  title: string | null;
  destinationLabel: string | null;

  // Dates / countdown
  startDateISO: string | null; // exact start "YYYY-MM-DD"
  endDateISO: string | null;
  dateMonths: string[] | null; // ["YYYY-MM", ...]
  durationDays: number | null;

  // Audience
  skillLevels: string[]; // slugs: beginner | intermediate | advanced | all
  ageMin: number | null;
  ageMax: number | null;
  participantCount: number;
  maxParticipants: number | null;

  // Content
  description: string;
  vibeSlug: string | null; // first selected vibe
  surfStyles: SurfStyle[];
  structureSlugs: string[];

  // Wave
  waveSizeMin: number | null;
  waveSizeMax: number | null;
  waveShapeLabel: string | null;

  // Accommodation
  specificStaySelected: boolean | null;
  accommodationKindLabel: string | null;
  accommodationName: string | null;
  accommodationImageUri: string | null;

  // Flow C — fixed per-person price + rich "What's included". Null for A/B.
  costPerPerson?: number | null;
  priceInclusions?: PriceInclusions | null;

  // Flow A/B — approximate budget range (for the overview "Budget" card).
  budgetMin?: number | null;
  budgetMax?: number | null;
  // The AI tier the host picked — drives the "paying vibe" tag.
  budgetTier?: 'low' | 'medium' | 'high' | null;

  // Drives the "Trip type" overview card.
  hostingStyle?: HostingStyle | null;

  // Flow B only — the leader's identity + this-trip credibility. Null otherwise.
  leader?: TripLeaderVM | null;
}

/** "Meet your leader" block — identity (from profile) + this-trip creds. */
export interface TripLeaderVM {
  name: string | null;
  avatarUrl: string | null;
  age: number | null;
  countryFrom: string | null;
  surfLevelLabel: string | null;
  tripsCount: number | null;
  destinationFamiliarityLabel: string | null;
  stayFamiliarityLabel: string | null;
  leadNote: string | null;
}

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------
const SKILL_LABEL: Record<string, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  pro: 'Pro',
};
const SKILL_ORDER = ['beginner', 'intermediate', 'advanced', 'pro'];

/** "Intermediate+" — lowest selected level, with "+" if higher ones are also on. */
export function formatSkillLevel(levels: string[]): string {
  const real = levels.filter(l => l !== 'all' && SKILL_LABEL[l]);
  if (real.length === 0) return 'All levels';
  const sorted = [...real].sort((a, b) => SKILL_ORDER.indexOf(a) - SKILL_ORDER.indexOf(b));
  const lowest = sorted[0];
  const hasHigher = sorted.length > 1;
  return `${SKILL_LABEL[lowest]}${hasHigher ? '+' : ''}`;
}

/** "Beginner – Intermediate" — lowest–highest range (or a single label). */
export function formatSkillRange(levels: string[]): string {
  const real = levels.filter(l => l !== 'all' && SKILL_LABEL[l]);
  if (real.length === 0) return 'All levels';
  const sorted = [...real].sort((a, b) => SKILL_ORDER.indexOf(a) - SKILL_ORDER.indexOf(b));
  const lowest = SKILL_LABEL[sorted[0]];
  const highest = SKILL_LABEL[sorted[sorted.length - 1]];
  return lowest === highest ? lowest : `${lowest} - ${highest}`;
}

export function formatAge(min: number | null, max: number | null): string {
  if (min == null && max == null) return 'Any';
  if (min != null && max != null) return `${min}-${max}`;
  return String(min ?? max);
}

// "Trip type" overview card — friendly label per hosting style.
export const TRIP_TYPE_LABEL: Record<HostingStyle, string> = {
  A: 'Planned together',
  B: 'Leader-led',
  C: 'Fully planned',
};

// "Paying vibe" tag per AI budget tier.
export const BUDGET_VIBE: Record<'low' | 'medium' | 'high', string> = {
  low: 'On a budget',
  medium: 'Mid-range',
  high: 'Premium',
};

/** "1500–2000$" / "1500$+" / "up to 2000$" from a min/max range. */
export function formatBudgetRange(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) return `${min}-${max}$`;
  if (min != null) return `${min}$+`;
  return `up to ${max}$`;
}

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** "Jun 15–22, 2026 · 7 days" (exact) or "Aug – Sep 2026" (months). */
export function formatDateRange(vm: TripDetailVM): string {
  if (vm.startDateISO) {
    const [y, m, d] = vm.startDateISO.split('-').map(Number);
    const startLabel = `${MONTH_SHORT[m - 1]} ${d}`;
    let main = startLabel;
    if (vm.endDateISO) {
      const [ey, em, ed] = vm.endDateISO.split('-').map(Number);
      main =
        em === m
          ? `${MONTH_SHORT[m - 1]} ${d}-${ed}, ${ey}`
          : `${startLabel} - ${MONTH_SHORT[em - 1]} ${ed}, ${ey}`;
    } else {
      main = `${startLabel}, ${y}`;
    }
    if (vm.durationDays && vm.durationDays > 0) {
      main += ` · ${vm.durationDays} day${vm.durationDays === 1 ? '' : 's'}`;
    }
    return main;
  }
  if (vm.dateMonths && vm.dateMonths.length) {
    const sorted = [...vm.dateMonths].sort();
    const first = sorted[0].split('-').map(Number);
    const last = sorted[sorted.length - 1].split('-').map(Number);
    const a = `${MONTH_SHORT[first[1] - 1]} ${first[0]}`;
    if (sorted.length === 1) return a;
    const b = `${MONTH_SHORT[last[1] - 1]} ${last[0]}`;
    return `${a} - ${b}`;
  }
  return 'Dates TBD';
}

/** Live-countdown target in the device's local timezone (midnight). */
export function computeCountdownTarget(vm: TripDetailVM): Date | null {
  if (vm.startDateISO) {
    const [y, m, d] = vm.startDateISO.split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  if (vm.dateMonths && vm.dateMonths.length) {
    const sorted = [...vm.dateMonths].sort();
    const [y, m] = sorted[0].split('-').map(Number);
    return new Date(y, m - 1, 1, 0, 0, 0, 0);
  }
  return null;
}

// "How this trip works" — icon + title + description per structure slug.
export const STRUCTURE_DISPLAY: Record<
  string,
  { icon: keyof typeof Ionicons.glyphMap; title: string; desc: string }
> = {
  shared_decisions: {
    icon: 'people-outline',
    title: 'Shared decisions',
    desc: 'Everyone votes on key choices',
  },
  structured_schedule: {
    icon: 'calendar-outline',
    title: 'Structured schedule',
    desc: 'A planned daily schedule',
  },
  loose_schedule: {
    icon: 'sunny-outline',
    title: 'Loose schedule',
    desc: 'Go with the flow each day',
  },
  book_own_stay: {
    icon: 'bed-outline',
    title: 'Book your own travel',
    desc: 'Flights and accommodation booked individually',
  },
  book_together: {
    icon: 'home-outline',
    title: 'Booked together',
    desc: 'Accommodation booked as a group',
  },
  group_all_day: {
    icon: 'people-circle-outline',
    title: 'Together all day',
    desc: 'Group together most of the day',
  },
  own_thing_day: {
    icon: 'walk-outline',
    title: 'Own thing by day',
    desc: 'Do your own thing during the day',
  },
};

// ---------------------------------------------------------------------------
// Countdown timer — ticks every second.
// ---------------------------------------------------------------------------
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function addMonths(base: Date, n: number): Date {
  const d = new Date(base.getTime());
  d.setMonth(d.getMonth() + n);
  return d;
}

const MS_MIN = 60_000;
const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;

const CountdownTimer: React.FC<{ target: Date | null }> = ({ target }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!target) return null;
  const diffMs = Math.max(0, target.getTime() - now);
  // "Under a month" = less than one calendar month away (not a fixed 31 days).
  // At/over a month we lead with Months (no seconds); under it we lead with Days
  // and reveal Seconds (per Figma).
  const underOneMonth = target.getTime() < addMonths(new Date(now), 1).getTime();

  let blocks: { value: string; label: string }[];

  if (!underOneMonth) {
    // ≥ 1 month out → Months / Days / Hours / Minutes (no seconds).
    const nowDate = new Date(now);
    let months = 0;
    while (addMonths(nowDate, months + 1).getTime() <= target.getTime()) months++;
    let rem = Math.max(0, target.getTime() - addMonths(nowDate, months).getTime());
    const days = Math.floor(rem / MS_DAY);
    rem -= days * MS_DAY;
    const hours = Math.floor(rem / MS_HOUR);
    rem -= hours * MS_HOUR;
    const minutes = Math.floor(rem / MS_MIN);
    blocks = [
      { value: String(months), label: months === 1 ? 'Month' : 'Months' },
      { value: String(days), label: days === 1 ? 'Day' : 'Days' },
      { value: String(hours), label: hours === 1 ? 'Hour' : 'Hours' },
      { value: String(minutes), label: minutes === 1 ? 'Minute' : 'Minutes' },
    ];
  } else {
    // < 1 month out → Days / Hours / Minutes / Seconds.
    const totalSec = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    blocks = [
      { value: String(days), label: days === 1 ? 'Day' : 'Days' },
      { value: pad2(hours), label: 'Hours' },
      { value: pad2(minutes), label: 'Minutes' },
      { value: pad2(seconds), label: 'Seconds' },
    ];
  }

  return (
    <View style={styles.countdownRow}>
      {blocks.map((b, i) => (
        <View key={b.label} style={styles.countdownBlock}>
          <Text style={styles.countdownValue}>{b.value}</Text>
          <Text style={styles.countdownLabel}>{b.label}</Text>
        </View>
      ))}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------
const SectionTitle: React.FC<{ title: string; right?: React.ReactNode }> = ({
  title,
  right,
}) => (
  <View style={styles.sectionTitleRow}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {right ?? null}
  </View>
);

const TwoCell: React.FC<{ a: { label: string; value: string }; b?: { label: string; value: string } }> = ({
  a,
  b,
}) => (
  <View style={styles.cellRow}>
    <View style={styles.cell}>
      <Text style={styles.cellLabel}>{a.label}</Text>
      <Text style={styles.cellValue}>{a.value}</Text>
    </View>
    {b ? (
      <View style={styles.cell}>
        <Text style={styles.cellLabel}>{b.label}</Text>
        <Text style={styles.cellValue}>{b.value}</Text>
      </View>
    ) : (
      <View style={styles.cell} />
    )}
  </View>
);

// Placeholder participant avatars (real pics wired later).
const ParticipantsRow: React.FC<{ count: number }> = ({ count }) => {
  const shown = Math.min(Math.max(count, 0), 5);
  const extra = count - shown;
  return (
    <View style={styles.avatarRow}>
      {Array.from({ length: shown }).map((_, i) => (
        <View key={i} style={[styles.avatar, i > 0 && styles.avatarOverlap]}>
          <Ionicons name="person" size={18} color="#FFFFFF" />
        </View>
      ))}
      {extra > 0 ? (
        <View style={[styles.avatar, styles.avatarOverlap, styles.avatarExtra]}>
          <Text style={styles.avatarExtraText}>+{extra}</Text>
        </View>
      ) : null}
      {shown === 0 ? <Text style={styles.mutedSmall}>No one yet</Text> : null}
    </View>
  );
};

// ---------------------------------------------------------------------------
export interface TripDetailViewProps {
  vm: TripDetailVM;
  /** Real participant avatar URLs (host first), for the Participants row.
   *  Falls back to placeholder circles when empty. */
  participantAvatars?: string[];
  /** Real participants (host first) for the tappable, horizontally-scrolling
   *  avatar row. Tapping an avatar opens that user's profile. */
  participants?: { id: string; avatarUrl: string | null; name: string | null }[];
  /** Open a participant's profile (tap on their avatar). */
  onParticipantPress?: (userId: string) => void;
  /** Optional handler for the Participants "See all" link. */
  onSeeAllParticipants?: () => void;
  /** Optional — tap the leader card to open their full profile. */
  onLeaderPress?: () => void;
  /** Rendered directly under the hero card — used by TripDetailScreen to inject
   *  the Overview/Plan tab toggle as shared chrome above both tabs. */
  afterHeroSlot?: React.ReactNode;
  /** When true, render only the hero + afterHeroSlot and hide the read-only
   *  overview body (used when the Plan tab is active). */
  bodyHidden?: boolean;

  // ---- Admin (host) edit affordances — only used by TripDetailViewRedesigned.
  /** When true, the viewer is the trip host: inline "Edit" pills are shown on the
   *  cover, the about-host block and the trip description (Figma admin view). */
  isHost?: boolean;
  /** Host self-introduction block ("About <name>") shown above "About this trip".
   *  bio is the host's `host_lead_note`. Rendered when present, or always for the
   *  host (so they can add one via Edit Profile). */
  aboutHost?: {
    name: string | null;
    avatarUrl: string | null;
    bio: string | null;
    /** Profile detail badges (Trip Operator view) — mirror the host stats shown
     *  in the create-trip "About you" card. All optional; each badge is skipped
     *  when its value is missing. */
    age?: number | null;
    countryFrom?: string | null;
    surfLevelLabel?: string | null;
    boardLabel?: string | null;
    surfTrips?: number | null;
  } | null;
  /** Host taps "Edit cover" → open the cover-image edit sheet. */
  onEditCover?: () => void;
  /** Host taps "Edit Profile" → open the about-host (host_lead_note) edit sheet. */
  onEditAboutHost?: () => void;
  /** Host taps "Edit" on "About this trip" → open the description edit sheet. */
  onEditDescription?: () => void;
  /** Host taps "Set dates" → open the dates edit sheet (A/B trips without exact dates). */
  onEditDates?: () => void;
  /** Host taps "Add stay" → open the accommodation edit sheet (A/B trips without a specific stay). */
  onEditAccommodation?: () => void;
}

export const TripDetailView: React.FC<TripDetailViewProps> = ({
  vm,
  onSeeAllParticipants,
  onLeaderPress,
  afterHeroSlot,
  bodyHidden,
}) => {
  const [showIncludes, setShowIncludes] = useState(false);
  const [showBudgetInfo, setShowBudgetInfo] = useState(false);
  const dateRange = formatDateRange(vm);
  const countdownTarget = computeCountdownTarget(vm);
  const skillLabel = formatSkillLevel(vm.skillLevels);
  const ageLabel = formatAge(vm.ageMin, vm.ageMax);
  const participantsLabel = vm.maxParticipants
    ? `${vm.participantCount}/${vm.maxParticipants} going`
    : `${vm.participantCount} going`;

  const vibeLabel = vm.vibeSlug
    ? TRIP_VIBE_OPTIONS.find(v => v.slug === vm.vibeSlug)?.label ?? null
    : null;

  const surfStyles = vm.surfStyles.filter(s => s !== 'all');
  const structures = vm.structureSlugs.filter(s => STRUCTURE_DISPLAY[s]);

  const waveSizeLabel =
    vm.waveSizeMin != null && vm.waveSizeMax != null
      ? vm.waveSizeMin === vm.waveSizeMax
        ? `${vm.waveSizeMax} ft`
        : `${vm.waveSizeMin}-${vm.waveSizeMax} ft`
      : null;

  const showAccommodation =
    !!vm.accommodationName || !!vm.accommodationKindLabel || vm.specificStaySelected != null;

  const priceLabel =
    vm.costPerPerson != null ? `$${vm.costPerPerson.toLocaleString('en-US')}` : null;
  const includeSections = priceInclusionSections(vm.priceInclusions);
  const addOns = priceInclusionAddOns(vm.priceInclusions);
  const hasPriceDetail = includeSections.length > 0 || addOns.length > 0;

  // Horizontal overview cards below the countdown — fixed order, each shown only
  // when it has data. (Spec: screenshot 2026-06-01 154101.)
  const budgetLabel = formatBudgetRange(vm.budgetMin ?? null, vm.budgetMax ?? null);
  const budgetVibe = vm.budgetTier ? BUDGET_VIBE[vm.budgetTier] : null;
  const tripTypeLabel = vm.hostingStyle ? TRIP_TYPE_LABEL[vm.hostingStyle] : null;
  const overviewCards: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    value: string;
    highlight?: boolean;
    footer?: string;
    onPress?: () => void;
  }[] = [];
  if (vm.costPerPerson != null) {
    // Flow C — highlighted, taps open the "what's included" sheet.
    overviewCards.push({
      icon: 'cash-outline',
      label: 'Price',
      value: `${vm.costPerPerson}$`,
      highlight: true,
      footer: hasPriceDetail ? 'See what’s included' : undefined,
      onPress: hasPriceDetail ? () => setShowIncludes(true) : undefined,
    });
  } else if (budgetLabel) {
    // AI-estimated budget range — taps open the "About this estimate" sheet.
    overviewCards.push({
      icon: 'cash-outline',
      label: budgetVibe ?? 'Budget',
      value: budgetLabel,
      footer: 'How is this estimated?',
      onPress: () => setShowBudgetInfo(true),
    });
  }
  overviewCards.push({ icon: 'ribbon-outline', label: 'Level', value: skillLabel });
  overviewCards.push({ icon: 'person-outline', label: 'Age range', value: ageLabel });
  overviewCards.push({ icon: 'people-outline', label: 'Participants', value: participantsLabel });
  if (tripTypeLabel) {
    overviewCards.push({ icon: 'flag-outline', label: 'Trip type', value: tripTypeLabel });
  }
  if (vibeLabel) {
    overviewCards.push({ icon: 'sparkles-outline', label: 'Focus vibe', value: vibeLabel });
  }
  if (waveSizeLabel) {
    overviewCards.push({ icon: 'resize-outline', label: 'Wave size', value: waveSizeLabel });
  }
  if (vm.waveShapeLabel) {
    overviewCards.push({ icon: 'water-outline', label: 'Wave type', value: vm.waveShapeLabel });
  }

  // Static "Based on" chips for the budget-info sheet — from data we already
  // have, no extra AI call.
  const budgetBasedOn: string[] = (
    [
      vm.destinationLabel,
      vm.durationDays ? `${vm.durationDays} day${vm.durationDays === 1 ? '' : 's'}` : null,
      vm.accommodationKindLabel,
    ].filter(Boolean) as string[]
  );
  // What the estimate covers — mirrors the AI prompt (accommodation + food +
  // local transport + surf activities; international flights excluded).
  const budgetAccLower = vm.accommodationKindLabel?.toLowerCase();
  const budgetStayLine = vm.durationDays
    ? `${vm.durationDays} ${vm.durationDays === 1 ? 'day' : 'days'} at a ${budgetAccLower ?? 'place to stay'}`
    : budgetAccLower
      ? `Your stay at a ${budgetAccLower}`
      : 'Accommodation for your whole stay';
  const budgetCovers: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
    { icon: 'bed-outline', text: budgetStayLine },
    { icon: 'restaurant-outline', text: 'Three meals a day' },
    { icon: 'airplane-outline', text: 'Airport transfers both ways' },
    { icon: 'car-outline', text: 'Getting around the spot and nearby' },
    { icon: 'water-outline', text: 'Everyday surf activities' },
  ];

  return (
    <View style={styles.root}>
      {/* ---- Hero + overlapping card with countdown ---- */}
      <View style={styles.heroWrap}>
        {vm.heroImageUri ? (
          <Image source={{ uri: vm.heroImageUri }} style={styles.hero} resizeMode="cover" />
        ) : (
          <View style={[styles.hero, styles.heroPlaceholder]}>
            <Ionicons name="image-outline" size={40} color="#B0B0B0" />
          </View>
        )}
        <View style={styles.heroCard}>
          <Text style={styles.heroDate}>{dateRange}</Text>
          <Text style={styles.heroTitle} numberOfLines={2}>
            {vm.title || vm.destinationLabel || 'Your trip'}
          </Text>
          <CountdownTimer target={countdownTarget} />
        </View>
      </View>

      {/* Shared chrome slot (Overview/Plan toggle) — sits between hero and body. */}
      {afterHeroSlot ?? null}

      {!bodyHidden && (
      <>
      {/* ---- Overview cards — horizontal scroll, fixed order ---- */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.cardsScroll}
        contentContainerStyle={styles.cardsScrollContent}
      >
        {overviewCards.map((c, i) => {
          const inner = (
            <>
              <Ionicons
                name={c.icon}
                size={22}
                color={c.highlight ? '#FFFFFF' : C.brandTeal}
              />
              <Text
                style={[styles.ovLabel, c.highlight && styles.ovLabelHi]}
                numberOfLines={1}
              >
                {c.label}
              </Text>
              <Text
                style={[styles.ovValue, c.highlight && styles.ovValueHi]}
                numberOfLines={1}
              >
                {c.value}
              </Text>
              {c.footer ? (
                <View style={styles.ovFooterRow}>
                  <Text
                    style={[styles.ovFooter, !c.highlight && styles.ovFooterDark]}
                    numberOfLines={1}
                  >
                    {c.footer}
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={12}
                    color={c.highlight ? '#FFFFFF' : C.brandTeal}
                  />
                </View>
              ) : null}
            </>
          );
          const cardStyle = [styles.ovCard, c.highlight && styles.ovCardHi];
          return c.onPress ? (
            <TouchableOpacity
              key={`${c.label}-${i}`}
              activeOpacity={0.85}
              onPress={c.onPress}
              style={cardStyle}
              accessibilityRole="button"
              accessibilityLabel={`${c.label} ${c.value}.${c.footer ? ` ${c.footer}` : ''}`}
            >
              {inner}
            </TouchableOpacity>
          ) : (
            <View key={`${c.label}-${i}`} style={cardStyle}>
              {inner}
            </View>
          );
        })}
      </ScrollView>

      {/* ---- About ---- */}
      {vm.description ? (
        <View style={styles.section}>
          <SectionTitle title="About this trip" />
          <Text style={styles.body}>{vm.description}</Text>
        </View>
      ) : null}

      {/* ---- Surf style ---- */}
      {surfStyles.length > 0 ? (
        <View style={styles.section}>
          <SectionTitle
            title="Surf style"
            right={
              <View style={styles.styleChips}>
                {surfStyles.map(s => (
                  <View key={s} style={styles.styleChip}>
                    <Text style={styles.styleChipText}>{BOARD_SHORT[s] ?? s}</Text>
                  </View>
                ))}
              </View>
            }
          />
          <View style={styles.boardsRow}>
            {surfStyles.map(s => {
              const img = BOARD_IMAGE[s];
              if (!img) return null;
              return (
                <Image key={s} source={img} style={styles.boardImg} resizeMode="contain" />
              );
            })}
          </View>
        </View>
      ) : null}

      {/* ---- How this trip works ---- */}
      {structures.length > 0 ? (
        <View style={styles.section}>
          <SectionTitle title="How this trip works" />
          <View style={{ gap: 14, marginTop: 4 }}>
            {structures.map(slug => {
              const d = STRUCTURE_DISPLAY[slug];
              return (
                <View key={slug} style={styles.howRow}>
                  <View style={styles.howIcon}>
                    <Ionicons name={d.icon} size={20} color={C.brandTeal} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.howTitle}>{d.title}</Text>
                    <Text style={styles.howDesc}>{d.desc}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* ---- Meet your leader (Flow B) ---- */}
      {vm.leader ? (
        <View style={styles.section}>
          <SectionTitle title="Meet your leader" />
          <View style={styles.leaderBlock}>
            <TouchableOpacity
              activeOpacity={onLeaderPress ? 0.8 : 1}
              onPress={onLeaderPress}
              disabled={!onLeaderPress}
              style={styles.leaderTop}
              accessibilityRole={onLeaderPress ? 'button' : undefined}
              accessibilityLabel={onLeaderPress ? "Open leader's profile" : undefined}
            >
              {vm.leader.avatarUrl ? (
                <Image source={{ uri: vm.leader.avatarUrl }} style={styles.leaderAvatar} />
              ) : (
                <View style={[styles.leaderAvatar, styles.leaderAvatarEmpty]}>
                  <Ionicons name="person" size={22} color="#FFFFFF" />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.leaderName} numberOfLines={1}>
                  {vm.leader.name || 'The leader'}
                  {vm.leader.age != null ? (
                    <Text style={styles.leaderMeta}>{`  ·  ${vm.leader.age}${
                      vm.leader.countryFrom ? ` from ${vm.leader.countryFrom}` : ''
                    }`}</Text>
                  ) : null}
                </Text>
                {(vm.leader.surfLevelLabel || vm.leader.tripsCount != null) && (
                  <Text style={styles.leaderMeta}>
                    {[
                      vm.leader.surfLevelLabel,
                      vm.leader.tripsCount != null ? `${vm.leader.tripsCount} Surf Trips` : null,
                    ]
                      .filter(Boolean)
                      .join('  ·  ')}
                  </Text>
                )}
              </View>
              {onLeaderPress ? (
                <Ionicons name="chevron-forward" size={18} color={C.textMuted} />
              ) : null}
            </TouchableOpacity>

            <View style={styles.leaderCreds}>
              {vm.leader.destinationFamiliarityLabel ? (
                <View style={styles.leaderCredRow}>
                  <Ionicons name="navigate-outline" size={16} color={C.brandTeal} />
                  <Text style={styles.leaderCredText}>
                    {vm.leader.destinationFamiliarityLabel}
                  </Text>
                </View>
              ) : null}
              {vm.leader.stayFamiliarityLabel ? (
                <View style={styles.leaderCredRow}>
                  <Ionicons name="home-outline" size={16} color={C.brandTeal} />
                  <Text style={styles.leaderCredText}>{vm.leader.stayFamiliarityLabel}</Text>
                </View>
              ) : null}
              {vm.leader.leadNote ? (
                <Text style={styles.leaderNote}>“{vm.leader.leadNote}”</Text>
              ) : null}
            </View>
          </View>
        </View>
      ) : null}

      {/* ---- Participants (placeholder avatars) ---- */}
      <View style={styles.section}>
        <SectionTitle
          title="Participants"
          right={
            onSeeAllParticipants ? (
              <TouchableOpacity onPress={onSeeAllParticipants} activeOpacity={0.7}>
                <Text style={styles.seeAll}>See all</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.seeAll}>See all</Text>
            )
          }
        />
        <ParticipantsRow count={vm.participantCount} />
      </View>

      {/* ---- Accommodation ---- */}
      {showAccommodation ? (
        <View style={styles.section}>
          <SectionTitle title="Accommodation" />
          {vm.specificStaySelected && vm.accommodationName ? (
            <View style={styles.stayCard}>
              {vm.accommodationImageUri ? (
                <Image
                  source={{ uri: vm.accommodationImageUri }}
                  style={styles.stayImage}
                  resizeMode="cover"
                />
              ) : null}
              <View style={styles.stayBody}>
                <Text style={styles.stayName}>{vm.accommodationName}</Text>
                <View style={styles.stayMetaRow}>
                  <Ionicons name="home-outline" size={14} color={C.textMuted} />
                  <Text style={styles.stayMeta}>
                    {vm.accommodationKindLabel
                      ? `${vm.accommodationKindLabel} · Leading option`
                      : 'Leading option'}
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            <TwoCell
              a={{
                label: 'Type',
                value: vm.accommodationKindLabel ?? '-',
              }}
              b={{
                label: 'Specific stay',
                value:
                  vm.specificStaySelected == null
                    ? '-'
                    : vm.specificStaySelected
                      ? 'Selected'
                      : 'Not yet',
              }}
            />
          )}
        </View>
      ) : null}

      </>
      )}

      {/* ---- "What's included" sheet (Flow C — opened from the Price card) ---- */}
      <WizardBottomSheet
        visible={showIncludes}
        title="What's included"
        titleAlign="left"
        hideHeaderDivider
        largeTitle
        onClose={() => setShowIncludes(false)}
        heightMode="full"
      >
        {priceLabel ? (
          <View style={styles.priceHero}>
            <View style={styles.priceHeroLeft}>
              <Text style={styles.priceHeroValue} numberOfLines={1} adjustsFontSizeToFit>
                {priceLabel}
              </Text>
              <Text style={styles.priceHeroPer}>per person</Text>
            </View>
            <View style={styles.priceHeroTag}>
              <Ionicons name="shield-checkmark" size={13} color="#FFFFFF" />
              <Text style={styles.priceHeroTagText}>Set by host</Text>
            </View>
          </View>
        ) : null}

        <Text style={styles.sheetIntro}>
          One fixed, all-in price. Here’s everything it covers.
        </Text>

        {includeSections.length > 0 ? (
          <View style={styles.sheetList}>
            {includeSections.map((sec, i) => (
              <View
                key={sec.title}
                style={[styles.sheetRow, i > 0 && styles.sheetRowDivider]}
              >
                <View style={styles.sheetRowIcon}>
                  <Ionicons
                    name={INCLUDE_ICON[sec.title] ?? 'checkmark'}
                    size={18}
                    color={C.inkBody}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sheetRowTitle}>{sec.title}</Text>
                  {sec.asTags ? (
                    <Text style={styles.sheetRowItem}>{sec.items.join(', ')}</Text>
                  ) : (
                    sec.items.map((it, j) => (
                      <Text key={j} style={styles.sheetRowItem}>
                        {it}
                      </Text>
                    ))
                  )}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {addOns.length > 0 ? (
          <View style={styles.addOnsCard}>
            <Text style={styles.addOnsTitle}>Add-ons for extra price</Text>
            <Text style={styles.addOnsHint}>Available on the trip for an extra cost.</Text>
            <View style={styles.addOnTags}>
              {addOns.map(label => (
                <View key={label} style={styles.addOnTag}>
                  <Text style={styles.addOnTagText}>{label}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </WizardBottomSheet>

      {/* ---- "About this estimate" sheet (A/B — opened from the Budget card).
              Pure description from data we already have; no AI call. ---- */}
      <WizardBottomSheet
        visible={showBudgetInfo}
        title="About this estimate"
        titleAlign="left"
        hideHeaderDivider
        largeTitle
        onClose={() => setShowBudgetInfo(false)}
        heightMode="auto"
      >
        {budgetLabel ? (
          <View style={styles.priceHero}>
            <View style={styles.priceHeroLeft}>
              <Text style={styles.priceHeroValue} numberOfLines={1} adjustsFontSizeToFit>
                {budgetLabel}
              </Text>
              <Text style={styles.priceHeroPer}>per person · estimated</Text>
            </View>
            {budgetVibe ? (
              <View style={styles.priceHeroTag}>
                <Ionicons name="pricetag" size={12} color="#FFFFFF" />
                <Text style={styles.priceHeroTagText}>{budgetVibe}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <Text style={styles.sheetIntro}>
          A rough AI estimate to plan around - not a price the organizer set. What
          you actually spend depends on how you travel.
        </Text>

        {budgetBasedOn.length > 0 ? (
          <>
            <Text style={styles.sheetSectionLabel}>Based on</Text>
            <View style={styles.chipRow}>
              {budgetBasedOn.map((t, i) => (
                <View key={`${t}-${i}`} style={styles.chip}>
                  <Text style={styles.chipText}>{t}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.sheetSectionLabel}>What it covers</Text>
        <View style={styles.sheetList}>
          {budgetCovers.map((c, i) => (
            <View
              key={c.text}
              style={[styles.sheetRow, i > 0 && styles.sheetRowDivider]}
            >
              <View style={styles.sheetRowIcon}>
                <Ionicons name={c.icon} size={18} color={C.inkBody} />
              </View>
              <Text style={[styles.sheetRowTitle, styles.sheetRowTitleFlex]}>{c.text}</Text>
            </View>
          ))}
        </View>

        <View style={styles.callout}>
          <Ionicons name="airplane-outline" size={16} color={C.textMuted} />
          <Text style={styles.calloutText}>
            International flights aren’t included - book those separately.
          </Text>
        </View>
      </WizardBottomSheet>
    </View>
  );
};

export const BOARD_SHORT: Partial<Record<SurfStyle, string>> = {
  shortboard: 'Shortboard',
  midlength: 'Mid - Length',
  softtop: 'Soft - Top',
  longboard: 'Longboard',
};

export default TripDetailView;

const styles = StyleSheet.create({
  // Owns its own horizontal padding so the hero can bleed edge-to-edge via
  // negative margins. Callers must render it inside a 0-horizontal-padding
  // container (wizard preview uses flushContent; TripDetailScreen has none).
  root: {
    paddingHorizontal: 16,
  },

  // Hero + card — hero bleeds full-width and to the very top.
  heroWrap: {
    marginHorizontal: -16,
    marginBottom: 8,
  },
  hero: {
    width: '100%',
    height: 230,
    backgroundColor: C.surfaceMuted,
  },
  heroPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCard: {
    marginTop: -56,
    marginHorizontal: 16,
    backgroundColor: C.surface,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 16,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
    alignItems: 'center',
  },
  heroDate: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    fontWeight: '500',
    color: C.textMuted,
  },
  heroTitle: {
    marginTop: 4,
    fontFamily: FONT_MONTSERRAT,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '800',
    color: C.inkDark,
    textAlign: 'center',
  },
  countdownRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignSelf: 'stretch',
    justifyContent: 'space-around',
  },
  countdownBlock: {
    alignItems: 'center',
    minWidth: 56,
  },
  countdownValue: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
    color: C.brandTeal,
  },
  countdownLabel: {
    marginTop: 2,
    fontFamily: FONT_INTER,
    fontSize: 11,
    fontWeight: '500',
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  // Overview cards — horizontal scroll. Bleeds edge-to-edge; first/last card
  // padded so they align with the page gutter.
  cardsScroll: {
    marginTop: 12,
    marginHorizontal: -16,
  },
  cardsScrollContent: {
    paddingHorizontal: 16,
    gap: 10,
  },
  ovCard: {
    width: OVERVIEW_CARD_WIDTH,
    borderWidth: 1,
    borderColor: C.borderCard,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 14,
    gap: 8,
  },
  ovLabel: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    fontWeight: '500',
    color: C.textMuted,
  },
  ovValue: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 16,
    fontWeight: '700',
    color: C.inkBody,
  },
  // Highlighted Price card (Flow C).
  ovCardHi: {
    backgroundColor: C.brandTeal,
    borderColor: C.brandTeal,
  },
  ovLabelHi: {
    color: 'rgba(255,255,255,0.85)',
  },
  ovValueHi: {
    color: '#FFFFFF',
  },
  ovFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 2,
  },
  ovFooter: {
    fontFamily: FONT_INTER,
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  ovFooterDark: {
    color: C.brandTeal,
  },

  // Generic section
  section: {
    marginTop: 24,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 17,
    fontWeight: '800',
    color: C.inkDark,
  },
  body: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    lineHeight: 21,
    color: C.inkBody,
  },
  seeAll: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    fontWeight: '600',
    color: C.brandTeal,
  },

  // Surf style — upright standing boards in a centered row
  boardsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 18,
    marginTop: 8,
    height: 150,
  },
  boardImg: {
    width: 46,
    height: 150,
  },

  // Surf style chips
  styleChips: {
    flexDirection: 'row',
    gap: 6,
  },
  styleChip: {
    borderWidth: 1,
    borderColor: C.borderCard,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  styleChipText: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    fontWeight: '600',
    color: C.inkBody,
  },

  // How it works
  howRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  howIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.brandTealTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  howTitle: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 14,
    fontWeight: '700',
    color: C.inkBody,
  },
  howDesc: {
    marginTop: 1,
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 16,
    color: C.textMuted,
  },

  // ---- Shared "info sheet" design (price/included + budget estimate) ----
  // Price hero — the headline number on a soft cyan field, with a small
  // qualifier tag (Set by host / paying vibe).
  priceHero: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: C.surface,
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 20,
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  priceHeroLeft: {
    flex: 1,
  },
  priceHeroValue: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '800',
    color: C.inkDark,
  },
  priceHeroPer: {
    marginTop: 2,
    fontFamily: FONT_INTER,
    fontSize: 13,
    fontWeight: '500',
    color: C.textMuted,
  },
  priceHeroTag: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: C.inkDark,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  priceHeroTagText: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  // Intro paragraph under the hero.
  sheetIntro: {
    marginTop: 16,
    fontFamily: FONT_INTER,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
    color: C.inkBody,
  },
  // Bold section label (matches the create-flow field labels).
  sheetSectionLabel: {
    marginTop: 24,
    marginBottom: 12,
    fontFamily: FONT_INTER,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: C.inkBody,
  },
  // Icon-bubble list (one row per included thing).
  // One light container around the whole list — gives the "included" block
  // structure without boxing every row.
  sheetList: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: C.borderCard,
    borderRadius: 16,
    paddingHorizontal: 16,
  },
  // Add-ons — a distinct cyan-bordered card so "extra cost" reads apart from
  // what's already included.
  addOnsCard: {
    marginTop: 28,
    backgroundColor: C.surface,
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 18,
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  addOnsTitle: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: C.inkDark,
  },
  addOnsHint: {
    marginTop: 4,
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: C.textMuted,
  },
  addOnTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  addOnTag: {
    backgroundColor: C.inkDark,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addOnTagText: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
  },
  sheetRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.borderHairline,
  },
  sheetRowIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.iconBubble,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetRowTitle: {
    fontFamily: FONT_INTER,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: C.inkBody,
  },
  sheetRowTitleFlex: {
    flex: 1,
  },
  sheetRowItem: {
    marginTop: 3,
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: C.textMuted,
  },
  // "Based on" chips.
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    backgroundColor: '#F2F2F2',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    fontWeight: '500',
    color: C.inkBody,
  },
  // Subtle footnote callout (e.g. flights excluded).
  callout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 24,
    backgroundColor: '#F6F8F9',
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  calloutText: {
    flex: 1,
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: C.textMuted,
  },

  // Meet your leader
  leaderBlock: {
    borderWidth: 1,
    borderColor: C.borderCard,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  leaderTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  leaderAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: C.surfaceMuted,
  },
  leaderAvatarEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#9CB6C0',
  },
  leaderName: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 16,
    fontWeight: '700',
    color: C.inkBody,
  },
  leaderMeta: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    fontWeight: '400',
    color: C.textMuted,
  },
  leaderCreds: {
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: C.borderHairline,
    paddingTop: 12,
  },
  leaderCredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  leaderCredText: {
    flex: 1,
    fontFamily: FONT_INTER,
    fontSize: 13,
    color: C.inkBody,
  },
  leaderNote: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    fontStyle: 'italic',
    color: C.textMuted,
    lineHeight: 18,
  },

  // Participants
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.avatarBg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: C.surface,
  },
  avatarOverlap: {
    marginLeft: -10,
  },
  avatarExtra: {
    backgroundColor: C.brandTeal,
  },
  avatarExtraText: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  mutedSmall: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    color: C.textMuted,
  },

  // Two-cell rows (Who it's for / Wave / Accommodation fallback)
  cellRow: {
    flexDirection: 'row',
    gap: 8,
  },
  cell: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.borderCard,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 4,
  },
  cellLabel: {
    fontFamily: FONT_INTER,
    fontSize: 11,
    fontWeight: '500',
    color: C.textMuted,
  },
  cellValue: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 14,
    fontWeight: '700',
    color: C.inkBody,
  },

  // Accommodation rich card
  stayCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.borderCard,
    overflow: 'hidden',
    backgroundColor: C.surface,
  },
  stayImage: {
    width: '100%',
    height: 160,
    backgroundColor: C.surfaceMuted,
  },
  stayBody: {
    padding: 14,
    gap: 6,
  },
  stayName: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 16,
    fontWeight: '700',
    color: C.inkBody,
  },
  stayMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stayMeta: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    color: C.textMuted,
  },
});
