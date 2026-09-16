/**
 * CrewSection — the trip's crew, and the sheet behind each face.
 *
 * Two shapes of the same data: `CrewSection` (a list) and `CrewCards` (a row of
 * cards, the operator-trip Overview and Dashboard). The list renders in:
 *   - Overview, for people who have NOT joined (TripDetailViewRedesigned) —
 *     part of the sales page.
 *   - Plan, for everyone who HAS (TripDetailScreen) — the same people, now as
 *     "who is running your trip".
 *
 * The list card cuts a bio at three lines so one chatty guide cannot bury the
 * next person. Tapping a row opens the full card in a bottom sheet — photo,
 * role, the whole bio. Crew are not trip members, so there is no profile
 * screen to push; the sheet IS the profile (staff rows carry `user_id` for a
 * later "open their real profile", but the RPC deliberately does not expose
 * it yet).
 *
 * Data is `useTripCrew`'s rows verbatim: already filtered server-side to
 * accepted people whose tier carries `profile.shown_to_travelers`.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image as CachedImage } from 'expo-image';
import { BottomSheetShell } from '../BottomSheetShell';
import { Images } from '../../assets/images';
import { ff } from '../../theme/fonts';
import { getStorageThumbUrl } from '../../services/media/imageService';
import { getCountryFlagEmoji } from '../../utils/countryFlags';
import { SwellyoBadgeIcon } from '../icons/BrandIcons';
import { PressableScale } from './PressableScale';
import { TripIcon } from './tripIcons';

export type CrewMember = {
  id: string;
  name: string | null;
  title: string | null;
  bio: string | null;
  avatarUrl: string | null;
  /** Tier. Only `operator` is read, to ring the person running the trip. */
  roleKey?: string;
  /** From their surfer profile; null for a Listed credit. */
  countryFrom?: string | null;
  /** A real Swellyo account, not a Listed name-and-photo credit. */
  hasAccount?: boolean;
};

const C = {
  ink: '#333333',
  textMuted: '#7B7B7B',
  border: '#EEEEEE',
  surface: '#FFFFFF',
  avatarBg: '#9CB6C0',
  grabber: '#D9D9D9',
};

const Avatar: React.FC<{ url: string | null; size: number }> = ({ url, size }) => {
  const style = { width: size, height: size, borderRadius: size / 2, backgroundColor: C.avatarBg };
  return url ? (
    <CachedImage
      source={{ uri: getStorageThumbUrl(url, Math.min(size * 3, 288)) ?? url }}
      style={style}
      contentFit="cover"
      cachePolicy="memory-disk"
    />
  ) : (
    <CachedImage source={Images.defaultAvatar} style={style} contentFit="cover" />
  );
};

export const CrewSection: React.FC<{
  crew: CrewMember[];
  /** The section heading. Overview says "Crew"; Plan can say the same. */
  title?: string;
  style?: any;
}> = ({ crew, title = 'Crew', style }) => {
  const [open, setOpen] = useState<CrewMember | null>(null);

  if (crew.length === 0) return null;

  return (
    <View style={style}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.list}>
        {crew.map(c => (
          <Pressable
            key={c.id}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => setOpen(c)}
            accessibilityRole="button"
            accessibilityLabel={`About ${c.name ?? 'crew member'}`}
          >
            <Avatar url={c.avatarUrl} size={44} />
            <View style={styles.rowText}>
              <Text style={styles.name} numberOfLines={1}>{c.name}</Text>
              {!!c.title && (
                <Text style={styles.role} numberOfLines={1}>{c.title}</Text>
              )}
              {/* Three lines, then it stops — the sheet has the rest. */}
              {!!c.bio && (
                <Text style={styles.bio} numberOfLines={3}>{c.bio}</Text>
              )}
            </View>
          </Pressable>
        ))}
      </View>

      <CrewSheet member={open} onClose={() => setOpen(null)} />
    </View>
  );
};

/** The full card behind a crew face: photo, role, the whole bio. Crew are not
 *  trip members, so there is no profile screen to push — the sheet IS the
 *  profile. */
const CrewSheet: React.FC<{ member: CrewMember | null; onClose: () => void }> = ({
  member,
  onClose,
}) => {
  const insets = useSafeAreaInsets();
  return (
    <BottomSheetShell visible={!!member} onClose={onClose}>
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 40 : 28) }]}>
        <View style={styles.grabber} />
        {member && (
          <View style={styles.sheetBody}>
            <Avatar url={member.avatarUrl} size={72} />
            <Text style={styles.sheetName}>{member.name}</Text>
            {!!member.title && <Text style={styles.sheetRole}>{member.title}</Text>}
            {!!member.bio && <Text style={styles.sheetBio}>{member.bio}</Text>}
          </View>
        )}
      </View>
    </BottomSheetShell>
  );
};

/**
 * The crew as a row of cards — "Staff" on the Overview, "My staff" on the
 * operator's Dashboard (Figma 14980-66208 / 14980-65921).
 *
 * Same people and same sheet as CrewSection; only the shape differs. The
 * operator's card wears the accent border, because on a page of faces the one
 * person accountable for the trip should be findable at a glance.
 *
 * `onAddStaff` adds the dashed "+ Add staff" card — pass it only to someone who
 * may manage the crew. `onViewAll` likewise: there is no read-only crew screen,
 * so the link exists only where it opens the manager.
 *
 * Renders nothing with no crew and no add card: an empty heading on a sales
 * page reads as "nobody runs this trip".
 */
export const CrewCards: React.FC<{
  crew: CrewMember[];
  title: string;
  /** 'overview' = the Overview's 20px headings; 'dashboard' = Plan's 16px. */
  variant: 'overview' | 'dashboard';
  onViewAll?: () => void;
  onAddStaff?: () => void;
  style?: any;
}> = ({ crew, title, variant, onViewAll, onAddStaff, style }) => {
  const [open, setOpen] = useState<CrewMember | null>(null);

  if (crew.length === 0 && !onAddStaff) return null;

  return (
    <View style={style}>
      <View style={[styles.cardsHeader, variant === 'overview' && styles.cardsHeaderOverview]}>
        <Text style={variant === 'overview' ? styles.cardsTitleOverview : styles.cardsTitle}>
          {title}
        </Text>
        {onViewAll && crew.length > 0 ? (
          <Pressable onPress={onViewAll} hitSlop={8}>
            <Text style={styles.cardsLink}>View all ({crew.length})</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.cardsScroll}
        contentContainerStyle={styles.cardsScrollContent}
      >
        {crew.map(c => {
          const flag = getCountryFlagEmoji(c.countryFrom);
          return (
            <PressableScale
              key={c.id}
              onPress={() => setOpen(c)}
              style={[styles.card, c.roleKey === 'operator' && styles.cardLead]}
              accessibilityLabel={`About ${c.name ?? 'crew member'}`}
            >
              <View>
                <Avatar url={c.avatarUrl} size={56} />
                {c.hasAccount ? (
                  <View style={styles.cardBadge}>
                    <SwellyoBadgeIcon size={16} />
                  </View>
                ) : null}
              </View>
              <View style={styles.cardText}>
                <Text style={styles.cardName} numberOfLines={1}>
                  {c.name}
                </Text>
                {!!c.title && (
                  <Text style={styles.cardMeta} numberOfLines={1}>
                    {c.title}
                  </Text>
                )}
                {c.countryFrom ? (
                  <View style={styles.cardCountryRow}>
                    {flag ? <Text style={styles.cardFlag}>{flag}</Text> : null}
                    <Text style={styles.cardMeta} numberOfLines={1}>
                      {c.countryFrom}
                    </Text>
                  </View>
                ) : null}
              </View>
            </PressableScale>
          );
        })}

        {onAddStaff ? (
          <PressableScale
            onPress={onAddStaff}
            style={[styles.card, styles.cardAdd]}
            accessibilityLabel="Add staff"
          >
            <View style={styles.cardAddIcon}>
              <TripIcon name="plus" size={28} color="#222B30" strokeWidth={1.5} />
            </View>
            <Text style={styles.cardAddText}>+ Add staff</Text>
          </PressableScale>
        ) : null}
      </ScrollView>

      <CrewSheet member={open} onClose={() => setOpen(null)} />
    </View>
  );
};

const styles = StyleSheet.create({
  sectionTitle: {
    fontFamily: ff('Montserrat', '600'),
    fontSize: 16,
    lineHeight: 22,
    color: C.ink,
    includeFontPadding: false,
    marginBottom: 12,
  },
  list: { gap: 12 },
  // flex-start, not centre: a row with a three-line blurb would otherwise
  // float its avatar to the middle of the paragraph.
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  rowPressed: { opacity: 0.7 },
  rowText: { flex: 1 },
  name: {
    fontFamily: ff('Montserrat', '600'),
    fontSize: 14,
    lineHeight: 20,
    color: C.ink,
    includeFontPadding: false,
  },
  role: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 17,
    color: C.textMuted,
    marginTop: 2,
    includeFontPadding: false,
  },
  bio: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 17,
    color: C.textMuted,
    marginTop: 3,
    includeFontPadding: false,
  },

  // ── CrewCards (Figma 14980-66234) ──
  cardsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  // The Overview's own SectionTitle spacing, so it lines up with its neighbours.
  cardsHeaderOverview: { marginBottom: 22 },
  cardsTitle: {
    fontFamily: ff('Inter', '700'),
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '700',
    color: C.ink,
  },
  cardsTitleOverview: {
    fontFamily: ff('Inter', '700'),
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
    color: C.ink,
  },
  cardsLink: { fontFamily: ff('Inter', '400'), fontSize: 14, lineHeight: 18, color: '#05BCD3' },
  // Bleeds to the screen edge like every other horizontal row on the trip page.
  cardsScroll: { marginHorizontal: -16 },
  cardsScrollContent: { paddingHorizontal: 16, gap: 8, alignItems: 'stretch' },
  card: {
    width: 118,
    // Every card as tall as the tallest one. The row stretches each Pressable
    // (contentContainer `alignItems: 'stretch'`), but PressableScale puts this
    // style on an inner view, which keeps its own content height — so the
    // stretch stopped at the Pressable and cards with fewer lines came up
    // short. `flex: 1` fills that stretched height.
    flex: 1,
    padding: 16,
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  cardLead: { borderColor: '#05BCD3' },
  // Figma: 16px mark at (39.5, 40) of the 56px avatar.
  cardBadge: { position: 'absolute', left: 40, top: 40 },
  cardText: { alignSelf: 'stretch', alignItems: 'center' },
  // Size/s 12/18 (get_variable_defs on 14980:66042; the export says 16).
  cardName: {
    fontFamily: ff('Inter', '700'),
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
    color: C.ink,
    textAlign: 'center',
  },
  cardMeta: {
    fontFamily: ff('Inter', '400'),
    fontSize: 10,
    lineHeight: 17,
    color: C.textMuted,
    textAlign: 'center',
    flexShrink: 1,
  },
  cardCountryRow: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%' },
  cardFlag: { fontSize: 14, lineHeight: 17 },
  cardAdd: { borderWidth: 1.5, borderStyle: 'dashed' },
  cardAddIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F7F7F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardAddText: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 18,
    color: C.ink,
    textAlign: 'center',
  },

  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingHorizontal: 24,
    // Bio length decides the height; the shell caps and rounds it. paddingBottom is
    // applied INLINE from the safe-area inset — the fixed 28 on Android sat under the
    // navigation bar.
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.grabber,
    marginBottom: 18,
  },
  sheetBody: { alignItems: 'center' },
  sheetName: {
    fontFamily: ff('Montserrat', '600'),
    fontSize: 18,
    lineHeight: 25,
    color: C.ink,
    marginTop: 14,
    textAlign: 'center',
    includeFontPadding: false,
  },
  sheetRole: {
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    lineHeight: 18,
    color: C.textMuted,
    marginTop: 3,
    textAlign: 'center',
    includeFontPadding: false,
  },
  sheetBio: {
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    lineHeight: 21,
    color: C.ink,
    marginTop: 16,
    alignSelf: 'stretch',
    includeFontPadding: false,
  },
});

export default CrewSection;
