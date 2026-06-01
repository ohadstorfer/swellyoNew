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
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  TRIP_VIBE_OPTIONS,
  TRIP_STRUCTURE_OPTIONS,
  type SurfStyle,
} from '../../services/trips/groupTripsService';
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
const InfoChip: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}> = ({ icon, label, value }) => (
  <View style={styles.infoChip}>
    <Ionicons name={icon} size={16} color={C.brandTeal} />
    <Text style={styles.infoChipLabel}>{label}</Text>
    <Text style={styles.infoChipValue} numberOfLines={1}>
      {value}
    </Text>
  </View>
);

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
}

export const TripDetailView: React.FC<TripDetailViewProps> = ({
  vm,
  onSeeAllParticipants,
}) => {
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

      {/* ---- Info chips ---- */}
      <View style={styles.chipsRow}>
        <InfoChip icon="ribbon-outline" label="Level" value={skillLabel} />
        <InfoChip icon="person-outline" label="Age range" value={ageLabel} />
        <InfoChip icon="people-outline" label="Participants" value={participantsLabel} />
      </View>

      {/* ---- About ---- */}
      {vm.description ? (
        <View style={styles.section}>
          <SectionTitle title="About this trip" />
          <Text style={styles.body}>{vm.description}</Text>
        </View>
      ) : null}

      {/* ---- Focus vibe ---- */}
      {vibeLabel ? (
        <View style={styles.section}>
          <SectionTitle title="Focus vibe" />
          <Text style={styles.body}>{vibeLabel}</Text>
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

      {/* ---- Who it's for ---- */}
      <View style={styles.section}>
        <SectionTitle title="Who it's for" />
        <TwoCell
          a={{ label: 'Age range', value: ageLabel }}
          b={{ label: 'Surf level', value: skillLabel }}
        />
      </View>

      {/* ---- Wave information ---- */}
      {waveSizeLabel || vm.waveShapeLabel ? (
        <View style={styles.section}>
          <SectionTitle title="Wave information" />
          <TwoCell
            a={{ label: 'Wave size', value: waveSizeLabel ?? '—' }}
            b={
              vm.waveShapeLabel
                ? { label: 'Wave shape', value: vm.waveShapeLabel }
                : undefined
            }
          />
        </View>
      ) : null}

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

  // Info chips
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  infoChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.borderCard,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 3,
  },
  infoChipLabel: {
    fontFamily: FONT_INTER,
    fontSize: 11,
    fontWeight: '500',
    color: C.textMuted,
  },
  infoChipValue: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 13,
    fontWeight: '700',
    color: C.inkBody,
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
