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
  type PriceInclusions,
} from '../../services/trips/priceInclusions';
import { WizardBottomSheet } from './WizardBottomSheet';
import { Images } from '../../assets/images';

// Upright (standing) board PNGs for the Surf style section.
const BOARD_IMAGE: Partial<Record<SurfStyle, ReturnType<typeof require>>> = {
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
  inkDark: '#212121',
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  borderCard: '#E0E0E0',
  borderHairline: '#EEEEEE',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF2F4',
  avatarBg: '#D6E2E8',
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
function formatSkillLevel(levels: string[]): string {
  const real = levels.filter(l => l !== 'all' && SKILL_LABEL[l]);
  if (real.length === 0) return 'All levels';
  const sorted = [...real].sort((a, b) => SKILL_ORDER.indexOf(a) - SKILL_ORDER.indexOf(b));
  const lowest = sorted[0];
  const hasHigher = sorted.length > 1;
  return `${SKILL_LABEL[lowest]}${hasHigher ? '+' : ''}`;
}

function formatAge(min: number | null, max: number | null): string {
  if (min == null && max == null) return 'Any';
  if (min != null && max != null) return `${min}–${max}`;
  return String(min ?? max);
}

// "Trip type" overview card — friendly label per hosting style.
const TRIP_TYPE_LABEL: Record<HostingStyle, string> = {
  A: 'Planned together',
  B: 'Leader-led',
  C: 'Fully planned',
};

/** "1500–2000$" / "1500$+" / "up to 2000$" from a min/max range. */
function formatBudgetRange(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) return `${min}–${max}$`;
  if (min != null) return `${min}$+`;
  return `up to ${max}$`;
}

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** "Jun 15–22, 2026 · 7 days" (exact) or "Aug – Sep 2026" (months). */
function formatDateRange(vm: TripDetailVM): string {
  if (vm.startDateISO) {
    const [y, m, d] = vm.startDateISO.split('-').map(Number);
    const startLabel = `${MONTH_SHORT[m - 1]} ${d}`;
    let main = startLabel;
    if (vm.endDateISO) {
      const [ey, em, ed] = vm.endDateISO.split('-').map(Number);
      main =
        em === m
          ? `${MONTH_SHORT[m - 1]} ${d}–${ed}, ${ey}`
          : `${startLabel} – ${MONTH_SHORT[em - 1]} ${ed}, ${ey}`;
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
    return `${a} – ${b}`;
  }
  return 'Dates TBD';
}

/** Live-countdown target in the device's local timezone (midnight). */
function computeCountdownTarget(vm: TripDetailVM): Date | null {
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
const STRUCTURE_DISPLAY: Record<
  string,
  { icon: keyof typeof Ionicons.glyphMap; title: string; desc: string }
> = {
  shared_decisions: {
    icon: 'people-outline',
    title: 'Shared decisions',
    desc: 'Everyone votes on activities and the schedule',
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
    title: 'Book your own stay',
    desc: 'Accommodation booked individually',
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
  const totalDays = Math.floor(diffMs / MS_DAY);

  let blocks: { value: string; label: string }[];

  if (totalDays >= 31) {
    // ≥ 31 days out → Months / Days / Hours / Minutes (no seconds).
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
    // < 31 days out → Days / Hours / Minutes / Seconds.
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
  /** Optional handler for the Participants "See all" link. */
  onSeeAllParticipants?: () => void;
  /** Optional — tap the leader card to open their full profile. */
  onLeaderPress?: () => void;
}

export const TripDetailView: React.FC<TripDetailViewProps> = ({
  vm,
  onSeeAllParticipants,
  onLeaderPress,
}) => {
  const [showIncludes, setShowIncludes] = useState(false);
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
        : `${vm.waveSizeMin}–${vm.waveSizeMax} ft`
      : null;

  const showAccommodation =
    !!vm.accommodationName || !!vm.accommodationKindLabel || vm.specificStaySelected != null;

  const priceLabel =
    vm.costPerPerson != null ? `$${vm.costPerPerson.toLocaleString('en-US')}` : null;
  const includeSections = priceInclusionSections(vm.priceInclusions);

  // Horizontal overview cards below the countdown — fixed order, each shown only
  // when it has data. (Spec: screenshot 2026-06-01 154101.)
  const budgetLabel = formatBudgetRange(vm.budgetMin ?? null, vm.budgetMax ?? null);
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
      footer: includeSections.length > 0 ? 'See what’s included' : undefined,
      onPress: includeSections.length > 0 ? () => setShowIncludes(true) : undefined,
    });
  } else if (budgetLabel) {
    overviewCards.push({ icon: 'cash-outline', label: 'Budget', value: budgetLabel });
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
                  <Text style={styles.ovFooter} numberOfLines={1}>
                    {c.footer}
                  </Text>
                  <Ionicons name="chevron-forward" size={12} color="#FFFFFF" />
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
              accessibilityLabel={`${c.label} ${c.value}. See what's included.`}
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
                value: vm.accommodationKindLabel ?? '—',
              }}
              b={{
                label: 'Specific stay',
                value:
                  vm.specificStaySelected == null
                    ? '—'
                    : vm.specificStaySelected
                      ? 'Selected'
                      : 'Not yet',
              }}
            />
          )}
        </View>
      ) : null}

      {/* ---- "What's included" sheet (Flow C — opened from the Price card) ---- */}
      <WizardBottomSheet
        visible={showIncludes}
        title="What's included"
        onClose={() => setShowIncludes(false)}
        heightMode="full"
      >
        {priceLabel ? (
          <View style={styles.includesSheetPrice}>
            <Text style={styles.priceValue}>{priceLabel}</Text>
            <Text style={styles.pricePer}>per person</Text>
          </View>
        ) : null}
        <View style={styles.includesCard}>
          {includeSections.map((sec, i) => (
            <View
              key={sec.title}
              style={[styles.includeRow, i > 0 && styles.includeRowDivider]}
            >
              <View style={styles.includeBullet}>
                <Ionicons name="checkmark" size={14} color={C.brandTeal} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.includeTitle}>{sec.title}</Text>
                {sec.items.map((it, j) => (
                  <Text key={j} style={styles.includeItem}>
                    {it}
                  </Text>
                ))}
              </View>
            </View>
          ))}
        </View>
      </WizardBottomSheet>
    </View>
  );
};

const BOARD_SHORT: Partial<Record<SurfStyle, string>> = {
  shortboard: 'Short',
  midlength: 'Mid',
  softtop: 'Soft-top',
  longboard: 'Long',
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

  // Price header inside the "What's included" sheet (Flow C).
  includesSheetPrice: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.borderCard,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  priceValue: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 26,
    fontWeight: '800',
    color: C.inkDark,
  },
  pricePer: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '500',
    color: C.textMuted,
  },

  // What's included (Flow C)
  includesCard: {
    borderWidth: 1,
    borderColor: C.borderCard,
    borderRadius: 16,
    paddingHorizontal: 14,
  },
  includeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
  },
  includeRowDivider: {
    borderTopWidth: 1,
    borderTopColor: C.borderHairline,
  },
  includeBullet: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.brandTealTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  includeTitle: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 14,
    fontWeight: '700',
    color: C.inkBody,
  },
  includeItem: {
    marginTop: 2,
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
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
