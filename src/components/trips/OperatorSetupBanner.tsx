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
 * ── Looks (Figma 14980-65807) ────────────────────────────────────────────────
 * A white card lifted off the page by a soft shadow, a person-with-a-tick icon
 * carrying a small red dot, and one continuous progress bar. It was a quiet grey
 * row before; the redesign gives it the same weight as the page's other cards
 * and spends its one alarm colour on the dot — "something is unfinished" — not
 * on the whole surface. It still has no dismiss button (below).
 *
 * ── It disappears by being finished ─────────────────────────────────────────
 * No dismiss button. It is not an advert: while it is showing, the operator
 * cannot create the trips they were promoted to create. A dismissable version
 * would let someone bury the only explanation for why the Create tab refuses
 * them.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { TripIcon } from './tripIcons';
import { ff } from '../../theme/fonts';

const C = {
  ink: '#333333',
  faint: '#A0A0A0',
  page: '#FFFFFF',
  card: '#FFFFFF',
  iconBg: '#F7F7F7',
  accent: '#05BCD3',
  track: '#E4E4E4',
  dot: '#FF5367',
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
      <View style={styles.iconWrap}>
        <View style={styles.icon}>
          {/* 18-unit glyph drawn at 26: strokeWidth scaled to keep Figma's 1px. */}
          <TripIcon name="user-check-01" size={26} color="#222B30" strokeWidth={0.7} />
        </View>
        <View style={styles.dot} />
      </View>

      <View style={styles.text}>
        <Text style={styles.title}>Finish your setup</Text>
        {/* The Figma line (Ohad, 14 Sep). The next step is on the checklist
            this opens; `summary` still feeds the accessibility label. */}
        <Text style={styles.sub} numberOfLines={1}>
          Complete your account details
        </Text>
        <View style={styles.progress}>
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                { width: `${total > 0 ? Math.round((done / total) * 100) : 0}%` },
              ]}
            />
          </View>
          <Text style={styles.count}>{`${done} of ${total}`}</Text>
        </View>
      </View>

      <TripIcon name="chevron-right" size={24} color={C.ink} strokeWidth={1.125} />
    </Pressable>
  </View>
);

// Figma 14980-65807, sizes read with get_variable_defs per node: title
// Size/lg 16/24 and count Size/xxs 9/14 (the code export prints these as bare
// 20 and 12 — wrong); sub Size/s 12/18; shadow "Box Shadow 01".
const styles = StyleSheet.create({
  // The page colour, not the card's. See the header note — without this the
  // card sits on TripsScreen's dark root.
  page: { backgroundColor: C.page, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 12 },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 16,
    backgroundColor: C.card,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 12,
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  // No scale: the card is nearly full-width, and shrinking something that wide
  // reads as the page flexing rather than a button answering. A tint change is
  // the honest feedback at this size.
  pressed: { backgroundColor: '#F7F7F7' },

  iconWrap: { alignSelf: 'flex-start', paddingTop: 4 },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.iconBg,
  },
  dot: {
    position: 'absolute',
    left: 30,
    top: 1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.dot,
  },
  text: { flex: 1, gap: 3 },
  title: {
    fontFamily: ff('Inter', '700'),
    fontWeight: '700',
    fontSize: 16,
    lineHeight: 24,
    color: C.ink,
  },
  sub: {
    marginTop: -3,
    fontFamily: ff('Inter', '400'),
    fontWeight: '400',
    fontSize: 12,
    lineHeight: 18,
    color: C.faint,
  },

  progress: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  track: { flex: 1, height: 6, borderRadius: 8, backgroundColor: C.track, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 8, backgroundColor: C.accent },
  count: {
    fontFamily: ff('Inter', '400'),
    fontWeight: '400',
    fontSize: 9,
    lineHeight: 14,
    color: C.ink,
    // Fixed width so the bar does not shift as "0 of 4" becomes "3 of 4".
    minWidth: 28,
    textAlign: 'right',
  },
});

export default OperatorSetupBanner;
