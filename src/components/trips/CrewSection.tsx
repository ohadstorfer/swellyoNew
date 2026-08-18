/**
 * CrewSection — the trip's crew, and the sheet behind each face.
 *
 * One component, rendered in two places:
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
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Image as CachedImage } from 'expo-image';
import { BottomSheetShell } from '../BottomSheetShell';
import { Images } from '../../assets/images';
import { ff } from '../../theme/fonts';
import { getStorageThumbUrl } from '../../services/media/imageService';

export type CrewMember = {
  id: string;
  name: string | null;
  title: string | null;
  bio: string | null;
  avatarUrl: string | null;
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

      {/* The full card. `open` keeps the last member through the close
          animation so the sheet never blanks mid-dismiss. */}
      <BottomSheetShell visible={!!open} onClose={() => setOpen(null)}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          {open && (
            <View style={styles.sheetBody}>
              <Avatar url={open.avatarUrl} size={72} />
              <Text style={styles.sheetName}>{open.name}</Text>
              {!!open.title && <Text style={styles.sheetRole}>{open.title}</Text>}
              {!!open.bio && <Text style={styles.sheetBio}>{open.bio}</Text>}
            </View>
          )}
        </View>
      </BottomSheetShell>
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

  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingHorizontal: 24,
    // Bio length decides the height; the shell caps and rounds it.
    paddingBottom: Platform.OS === 'ios' ? 40 : 28,
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
