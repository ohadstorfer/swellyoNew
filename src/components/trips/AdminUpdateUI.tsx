// Shared UI for admin-update rows, used by BOTH the Plan-tab preview
// (PlanSections) and the full Updates page (TripUpdatesScreen) so the two stay
// visually and behaviourally identical (Figma node 12933-38204):
//   • AnnouncementIcon — the exact "announcement-02" bullhorn vector.
//   • AdminUpdateRow   — a single-line update card. In the Plan-tab preview a
//     card with a body becomes tappable and expands inline (accordion): the body
//     slides open on a Reanimated height/opacity timing and the chevron rotates
//     forward → up. No overlay.
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import { ff } from '../../theme/fonts';
import type { AdminUpdate } from '../../services/trips/groupTripsService';

// iOS-drawer easing (Ionic curve): fast, then a soft settle — reads as smooth
// for an open/close reveal. Single duration; close just runs the same in
// reverse so an interrupted tap retargets cleanly.
const ACCORDION_EASE = Easing.bezier(0.32, 0.72, 0, 1);
const ACCORDION_MS = 260;

// Tokens mirror the Figma frame (white card, #EEEEEE border, #F7F7F7 icon box).
const C = {
  surface: '#FFFFFF',
  cardBorder: '#EEEEEE',
  iconBg: '#F7F7F7',
  ink: '#222B30',
  title: '#333333',
  time: '#6A7282',
  muted: '#7B7B7B',
} as const;

// Exact "announcement-02" glyph from Figma (node 12933:38205 / 2007:2108).
export const AnnouncementIcon: React.FC<{ size?: number; color?: string }> = ({
  size = 18,
  color = C.ink,
}) => (
  <Svg width={size} height={size} viewBox="0 0 16 15.3366" fill="none">
    <Path
      d="M2 8.83664L3.18099 13.5606C3.2142 13.6934 3.23081 13.7599 3.25045 13.8179C3.44238 14.3845 3.95264 14.7829 4.54889 14.8316C4.60993 14.8366 4.6784 14.8366 4.81534 14.8366C4.98683 14.8366 5.07257 14.8366 5.14481 14.8296C5.85875 14.7604 6.42375 14.1954 6.493 13.4814C6.5 13.4092 6.5 13.3235 6.5 13.152V2.46164M12.875 8.46164C14.3247 8.46164 15.5 7.28639 15.5 5.83664C15.5 4.38689 14.3247 3.21164 12.875 3.21164M6.6875 2.46164H3.875C2.01104 2.46164 0.499999 3.97268 0.5 5.83664C0.500001 7.7006 2.01104 9.21164 3.875 9.21164H6.6875C8.01232 9.21164 9.63294 9.92181 10.8832 10.6034C11.6126 11.001 11.9773 11.1998 12.2162 11.1705C12.4377 11.1434 12.6052 11.044 12.735 10.8625C12.875 10.6668 12.875 10.2751 12.875 9.49192V2.18135C12.875 1.39814 12.875 1.00653 12.735 0.810807C12.6052 0.629316 12.4377 0.529865 12.2162 0.502737C11.9773 0.473482 11.6126 0.67229 10.8832 1.06991C9.63293 1.75147 8.01232 2.46164 6.6875 2.46164Z"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

// The collapsible body. The text is measured once (absolutely positioned so its
// natural height is independent of the clip), then the clip's real height is
// driven from `progress` — animating actual layout height means the rows below
// slide down with it instead of being overlapped.
const AccordionBody: React.FC<{ text: string; progress: SharedValue<number> }> = ({
  text,
  progress,
}) => {
  const [height, setHeight] = useState(0);
  const style = useAnimatedStyle(
    () => ({ height: progress.value * height, opacity: progress.value }),
    [height],
  );
  return (
    <Animated.View style={[styles.bodyClip, style]}>
      <View
        style={styles.bodyMeasure}
        onLayout={e => {
          const next = e.nativeEvent.layout.height;
          if (next && Math.abs(next - height) > 0.5) setHeight(next);
        }}
      >
        <Text style={styles.bodyText}>{text}</Text>
      </View>
    </Animated.View>
  );
};

export const AdminUpdateRow: React.FC<{
  update: AdminUpdate;
  formatTime: (iso: string) => string;
  /** Host long-press → Edit/Delete menu (Plan tab only). */
  onLongPress?: () => void;
  /** Trailing slot, e.g. the host "Edit" link (Plan tab only). */
  right?: React.ReactNode;
  /** Connected-list mode (Plan card, Figma 12716:6935): no own border/radius,
   *  larger type, hairline divider instead of a gap — the parent wraps the rows
   *  in one rounded card. A row with a body becomes a tappable accordion. */
  connected?: boolean;
  /** Connected mode only — draw a bottom hairline (between consecutive rows). */
  showDivider?: boolean;
  /** Connected mode only — this row is expanded inline (accordion open). */
  open?: boolean;
  /** Connected mode only — toggle the inline expansion. */
  onToggle?: () => void;
  /** Full Updates page (Figma 13179:8792): render the whole body inline — no
   *  one-line clamp, no chevron. The icon top-aligns to the first line so tall
   *  cards read like the Figma frame. */
  expanded?: boolean;
}> = ({ update, formatTime, onLongPress, right, connected, showDivider, open, onToggle, expanded }) => {
  const hasDescription = !!update.body?.trim();
  // Three modes:
  //   • expanded (full Updates page)  → body always inline, not tappable.
  //   • connected (Plan preview)      → accordion: tap a card with a body to
  //     slide it open inline; chevron rotates forward → up.
  //   • default card                  → unused legacy path, kept for safety.
  const isAccordion = !!connected && !expanded;
  const titleStyle = expanded ? styles.titleExpanded : connected ? styles.titleLg : styles.title;

  // One timing value drives both the body height and the chevron rotation so
  // they stay perfectly in sync (and retarget together if tapped mid-animation).
  const progress = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, {
      duration: ACCORDION_MS,
      easing: ACCORDION_EASE,
    });
  }, [open, progress]);
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-90 * progress.value}deg` }],
  }));

  const handlePress = isAccordion && hasDescription ? onToggle : undefined;

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={onLongPress}
      style={[
        connected ? styles.row : styles.card,
        // Top-align the icon whenever a body can appear. In accordion mode the
        // collapsed row is ~icon-height so this also looks right closed — and
        // keeping it constant avoids an icon jump when toggling.
        expanded || isAccordion ? styles.cardExpanded : null,
        connected && showDivider ? styles.rowDivider : null,
      ]}
    >
      <View style={styles.iconBox}>
        <AnnouncementIcon size={18} color={C.ink} />
      </View>
      <View style={styles.textCol}>
        <Text style={titleStyle} numberOfLines={expanded || (isAccordion && open) ? undefined : 1}>
          {update.title}
        </Text>
        {expanded && hasDescription ? (
          <Text style={styles.bodyText}>{update.body}</Text>
        ) : isAccordion && hasDescription ? (
          <AccordionBody text={update.body!} progress={progress} />
        ) : null}
        <Text style={connected ? styles.timeLg : styles.time}>{formatTime(update.created_at)}</Text>
      </View>
      {right}
      {isAccordion && hasDescription ? (
        <Animated.View style={chevronStyle}>
          <Ionicons name="chevron-forward" size={16} color={C.muted} />
        </Animated.View>
      ) : !connected && !expanded ? (
        <Ionicons name="chevron-forward" size={16} color={C.muted} />
      ) : null}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 8,
    paddingRight: 16,
    paddingVertical: 18,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderRadius: 20,
  },
  // Full Updates page: body wraps over many lines, so top-align the icon to the
  // first line instead of vertically centering it against the whole block.
  cardExpanded: { alignItems: 'flex-start' },
  iconBox: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: C.iconBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: { flex: 1 },
  title: { fontFamily: ff('Inter', '700'), fontSize: 12, lineHeight: 18, fontWeight: '700', color: C.title },
  // Full Updates page (expanded): bold title above the description (Figma 13179:8792).
  titleExpanded: { fontFamily: ff('Inter', '700'), fontSize: 14, lineHeight: 20, fontWeight: '700', color: C.title },
  bodyText: { fontFamily: ff('Inter', '400'), fontSize: 14, lineHeight: 20, color: C.ink, marginTop: 2, marginBottom: 2 },
  // Accordion: the clip's height is animated; the measure view is absolute so
  // its natural height is read regardless of the clip's current height.
  bodyClip: { overflow: 'hidden', width: '100%' },
  bodyMeasure: { position: 'absolute', top: 0, left: 0, right: 0 },
  time: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: C.time, marginTop: 2 },

  // Connected-list mode (Plan card) — rows share one rounded card with hairline
  // dividers; larger Figma type (title 16/18, time 14/20).
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 8,
    paddingRight: 16,
    paddingVertical: 16,
    backgroundColor: C.surface,
  },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: C.cardBorder },
  // Sizes from get_variable_defs (per text node): title Body/B-3 = Size/s 12 /
  // lineHeight 18 (bold); time Body/B-4 = Size/xs 10 / lineHeight 20.
  titleLg: { fontFamily: ff('Inter', '700'), fontSize: 14, lineHeight: 20, fontWeight: '700', color: C.title, marginBottom: -2 },
  timeLg: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: C.time },
});
