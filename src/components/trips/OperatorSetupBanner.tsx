/**
 * "Finish your setup" — the standing prompt on the Trips tab.
 *
 * ── Why a banner and not just the push ──────────────────────────────────────
 * The notification fires exactly once, on the false→true edge of
 * `surfers.operator`, and deliberately never repeats — a cron that re-nudges is
 * the one thing here that could spam a real person. So the push is the
 * announcement and this is the memory. An operator who swiped the notification
 * away on a bus still finds their way back.
 *
 * ── Shown on all three tabs, on purpose ─────────────────────────────────────
 * It sits above the pager rather than inside the Create pane. Putting it only
 * on Create would hide it from the operator who never opens Create *because*
 * they do not know why their trips cannot be sold.
 *
 * ── IT CARRIES ITS OWN PAGE BACKGROUND ──────────────────────────────────────
 * The outer view is white, and that is load-bearing, not decoration. This
 * renders between `MainHeader` (#212121) and the trips body (#FFFFFF), so its
 * backdrop is TripsScreen's `root` — the dark header colour. Without the white
 * wrapper the card floats on a black strip and reads as a toast that landed on
 * the page by accident. With it, the white simply starts a few pixels higher
 * and the card belongs to the page.
 *
 * ── Quiet, because it is permanent ──────────────────────────────────────────
 * The first version was a cyan card with a cyan border — alert styling. This
 * thing has no dismiss button and can sit there for days, and something that
 * shouts every single session gets tuned out. It is now the same neutral
 * surface the rest of the app uses for a settled row, with colour spent only
 * where it means something: the progress bar.
 *
 * ── It disappears by being finished ─────────────────────────────────────────
 * No dismiss button. It is not an advert: while it is showing, the operator
 * cannot create the trips they were promoted to create. A dismissable version
 * would let someone bury the only explanation for why the Create tab refuses
 * them.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ff } from '../../theme/fonts';

const C = {
  ink: '#222B30',
  muted: '#6C7378',
  faint: '#9AA0A6',
  page: '#FFFFFF',
  card: '#F6F8F9',
  line: '#E9EDEF',
  accent: '#05BCD3',
  accentSoft: '#E3F7FA',
  track: '#DFE4E7',
};

export const OperatorSetupBanner: React.FC<{
  /** One line from `setupSummary` — always names the NEXT step to do. */
  summary: string;
  /** Total steps, and how many are finished. Drives the progress bar. */
  total: number;
  done: number;
  onPress: () => void;
}> = ({ summary, total, done, onPress }) => (
  <View style={styles.page}>
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Finish your setup. ${done} of ${total} done. ${summary}`}
    >
      <View style={styles.row}>
        <View style={styles.icon}>
          <Ionicons name="rocket-outline" size={17} color={C.accent} />
        </View>

        <View style={styles.text}>
          <Text style={styles.title}>Finish your setup</Text>
          {/* Names the next step rather than counting what is left — the bar
              below already answers "how many". One line, clipped: the card is a
              pointer to the checklist, not the checklist. */}
          <Text style={styles.sub} numberOfLines={1}>
            {summary}
          </Text>
        </View>

        <Ionicons name="chevron-forward" size={17} color={C.faint} />
      </View>

      {/* Segments, not a continuous bar. There are exactly four steps and they
          are discrete — a smooth bar would imply a percentage of something
          measurable, and four ticks let an operator see at a glance that this
          is nearly over. */}
      <View style={styles.progress}>
        <View style={styles.track}>
          {Array.from({ length: total }, (_, i) => (
            <View key={i} style={[styles.seg, i < done && styles.segDone]} />
          ))}
        </View>
        <Text style={styles.count}>{`${done} of ${total}`}</Text>
      </View>
    </Pressable>
  </View>
);

const styles = StyleSheet.create({
  // The page colour, not the card's. See the header note — without this the
  // card sits on TripsScreen's dark root.
  page: { backgroundColor: C.page, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 2 },

  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.card,
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 10,
  },
  // No scale: the card is nearly full-width, and shrinking something that wide
  // reads as the page flexing rather than a button answering. A tint change is
  // the honest feedback at this size.
  pressed: { backgroundColor: '#EDF1F3' },

  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accentSoft,
  },
  text: { flex: 1 },
  title: {
    fontFamily: ff('Inter', '600'),
    fontWeight: '600',
    fontSize: 14.5,
    lineHeight: 19,
    color: C.ink,
  },
  sub: {
    marginTop: 1,
    fontFamily: ff('Inter', '400'),
    fontWeight: '400',
    fontSize: 12.5,
    lineHeight: 17,
    color: C.muted,
  },

  progress: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { flex: 1, flexDirection: 'row', gap: 4 },
  seg: { flex: 1, height: 3, borderRadius: 99, backgroundColor: C.track },
  segDone: { backgroundColor: C.accent },
  count: {
    fontFamily: ff('Inter', '500'),
    fontWeight: '500',
    fontSize: 11,
    lineHeight: 14,
    color: C.faint,
    // Fixed width so the row does not shift as "0 of 4" becomes "3 of 4".
    minWidth: 34,
    textAlign: 'right',
  },
});

export default OperatorSetupBanner;
