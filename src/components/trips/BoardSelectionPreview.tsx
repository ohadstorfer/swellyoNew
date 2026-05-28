// BoardSelectionPreview — layered visual of the host's board selection.
// Layout per Eyal's spec:
//   • Center, straight, front: shortboard if selected, else next priority.
//   • Right, tilted right: second-priority board (mid > soft).
//   • Left, tilted left: third-priority board.
//   • Longboard (if selected): standing tall BEHIND everything — largest.
// Source images live on Builder.io (same URLs as OnboardingStep1Screen).
// Bottom drop-shadow baked into each PNG is clipped via overflow:hidden on
// each board's wrapper.

import React from 'react';
import {
  View,
  Image,
  StyleSheet,
  TouchableOpacity,
  Text,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SurfStyle } from '../../services/trips/groupTripsService';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';

// Bundled board PNGs (tightly cropped, no padding/shadow). Use these in the
// Create-Trip Board Style card preview. Positioning math is unchanged from
// the URL-based version — only the image source swaps.
import { LayoutChangeEvent } from 'react-native';
import { Images } from '../../assets/images';
const BOARD_IMAGE: Partial<Record<SurfStyle, ReturnType<typeof require>>> = {
  shortboard: Images.boards.shortboard,
  midlength: Images.boards.midlength,
  softtop: Images.boards.softtop,
  longboard: Images.boards.longboard,
};

const BOARD_LABEL: Partial<Record<SurfStyle, string>> = {
  shortboard: 'Shortboard',
  midlength: 'Mid-length',
  longboard: 'Longboard',
  softtop: 'Soft-top',
};

// Front-layer priority order: shortboard always first (center/straight).
// Then midlength → right tilt, softtop → left tilt.
const FRONT_PRIORITY: SurfStyle[] = ['shortboard', 'midlength', 'softtop'];

const C = {
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  surface: '#FFFFFF',
  borderHairline: '#EEEEEE',
};

export interface BoardSelectionPreviewProps {
  selected: SurfStyle[];
  onPress?: () => void;
  /** Override the container height in pt. Default 220. */
  height?: number;
  /** When true: render only the board composition (no card chrome, no header,
   *  no border). Used inside InfoCard's right-side image slot. */
  embedded?: boolean;
}

interface BoardSpec {
  slug: SurfStyle;
  // % of container width to position the LEFT edge at (0 = flush left, 0.5 = center).
  centerX: number;
  // Translate-y offset in px (0 = anchored at container bottom).
  translateY: number;
  // Rotation in degrees.
  rotate: number;
  // Width in % of container (the board's drawn width).
  widthPct: number;
  // Height in % of stage — different per board type so longboards stand
  // taller than shortboards, while every slot's BOTTOM is anchored at stage
  // bottom (i.e. tails align vertically across all boards).
  heightPct: number;
  // zIndex layer
  zIndex: number;
}

// Physical "height" of each board, expressed as a % of the stage's full height.
// Drives visual size variety: longboard tallest, shortboard shortest.
const BOARD_HEIGHT_PCT: Record<string, number> = {
  shortboard: 0.62,
  softtop: 0.74,
  midlength: 0.82,
  longboard: 1.0,
};
const heightFor = (slug: string) => BOARD_HEIGHT_PCT[slug] ?? 0.8;

// Physical size ranking — used when 2 boards are selected to decide which
// goes front-left (smaller) vs back-right (bigger). Matches BOARD_HEIGHT_PCT
// ranking so the visual "bigger" board really is taller.
const BOARD_SIZE_ORDER: Record<string, number> = {
  shortboard: 1,
  softtop: 2,
  midlength: 3,
  longboard: 4,
};

/**
 * Compose the board layout based on selection.
 * - 1 board: center, straight.
 * - 2 boards: smaller front-left, bigger back-right. Both standing straight.
 * - 3 boards: layered scatter (center + side tilt, longboard back if selected).
 * - 4 boards: longboard back + 3 fronts (existing layered look).
 * - When embedded (narrow slot inside an InfoCard), boards scale up.
 */
const composeLayout = (selected: SurfStyle[], embedded: boolean): BoardSpec[] => {
  const out: BoardSpec[] = [];
  const set = new Set(selected);
  const realSelected = selected.filter(s => s !== 'all');

  // Widths are % of the container — embedded mode uses larger pcts because
  // the container is much narrower (~131pt vs ~350pt for the standalone card).
  // Bumped per Eyal — boards should read clearly even at half-card width.
  const W = embedded
    ? { long: 0.88, short: 0.82, side: 0.7 }
    : { long: 0.5, short: 0.46, side: 0.38 };

  // -----------------------------------------------------------------------
  // Single non-longboard case — shortboard / midlength / softtop alone.
  // Use full stage height so the source contain-centers vertically (vs the
  // default per-board heightPct which would anchor it to the slot bottom).
  // centerX nudged right per Eyal's spec for single-board renders.
  // -----------------------------------------------------------------------
  if (
    realSelected.length === 1 &&
    (realSelected[0] === 'shortboard' ||
      realSelected[0] === 'midlength' ||
      realSelected[0] === 'softtop')
  ) {
    // Shortboard alone reads bulky at W.short — trim it down a touch.
    const aloneWidth =
      realSelected[0] === 'shortboard' ? W.short * 0.85 : W.short;
    out.push({
      slug: realSelected[0],
      centerX: 0.55,
      translateY: 0,
      rotate: 0,
      widthPct: aloneWidth,
      heightPct: 1.0, // full stage → contain centers source vertically
      zIndex: 4,
    });
    return out;
  }

  // -----------------------------------------------------------------------
  // Longboard alone — same right-of-center nudge as the other singles.
  // -----------------------------------------------------------------------
  if (realSelected.length === 1 && realSelected[0] === 'longboard') {
    out.push({
      slug: 'longboard',
      centerX: 0.62,
      translateY: 0,
      rotate: 0,
      widthPct: W.long,
      heightPct: heightFor('longboard'),
      zIndex: 1,
    });
    return out;
  }

  // -----------------------------------------------------------------------
  // 2-board case — smaller front-left + bigger back-right, both upright.
  // -----------------------------------------------------------------------
  if (realSelected.length === 2) {
    const sorted = [...realSelected].sort(
      (a, b) => (BOARD_SIZE_ORDER[a] ?? 99) - (BOARD_SIZE_ORDER[b] ?? 99),
    );
    const [smaller, bigger] = sorted;
    // When neither board is the longboard, scale both up — pairs without
    // the longboard read smaller naturally because nothing sets a tall anchor.
    // Bump mostly height (so boards stand taller in the card), with a small
    // width bump so they don't end up looking skinny.
    const noLongboard = !realSelected.includes('longboard');
    const HEIGHT_BUMP = 1.25; // tail stays at slot bottom; nose goes higher
    const WIDTH_BUMP = 1.08;
    const capH = (h: number) => Math.min(h * HEIGHT_BUMP, 1.0);
    const smallerWidth = noLongboard ? W.side * WIDTH_BUMP : W.side;
    const biggerWidth = noLongboard ? W.short * WIDTH_BUMP : W.short;
    const smallerHeight = noLongboard
      ? capH(heightFor(smaller))
      : heightFor(smaller);
    const biggerHeight = noLongboard
      ? capH(heightFor(bigger))
      : heightFor(bigger);
    out.push({
      slug: smaller,
      centerX: 0.43,
      translateY: 0,
      rotate: 0,
      widthPct: smallerWidth,
      heightPct: smallerHeight,
      zIndex: 3, // front
    });
    out.push({
      slug: bigger,
      centerX: 0.67,
      translateY: 0,
      rotate: 0,
      widthPct: biggerWidth,
      heightPct: biggerHeight,
      zIndex: 2, // behind smaller
    });
    return out;
  }

  // Horizontal offset for the layered scatter. 3-board layouts get a small
  // right-shift per Eyal's spec; 4-board stays centered so the composition
  // stays balanced around the longboard.
  const shiftRight = realSelected.length === 3 ? 0.05 : 0;

  // Back layer — longboard standing tall, biggest, anchored at slot bottom
  // (same as every other board) so every variation reads with consistent
  // nose-to-tail height = 90% of the slot.
  if (set.has('longboard')) {
    out.push({
      slug: 'longboard',
      centerX: 0.5 + shiftRight,
      translateY: 0,
      rotate: 0,
      widthPct: W.long,
      heightPct: heightFor('longboard'),
      zIndex: 1,
    });
  }

  const front = FRONT_PRIORITY.filter(s => set.has(s));

  if (front[0]) {
    out.push({
      slug: front[0],
      centerX: 0.5 + shiftRight,
      translateY: 0,
      rotate: 0,
      widthPct: W.short,
      heightPct: heightFor(front[0]),
      zIndex: 4,
    });
  }
  if (front[1]) {
    out.push({
      slug: front[1],
      centerX: (embedded ? 0.66 : 0.585) + shiftRight,
      translateY: 0,
      rotate: 14,
      widthPct: W.side,
      heightPct: heightFor(front[1]),
      zIndex: 3,
    });
  }
  if (front[2]) {
    out.push({
      slug: front[2],
      centerX: (embedded ? 0.34 : 0.415) + shiftRight,
      translateY: 0,
      rotate: -14,
      widthPct: W.side,
      heightPct: heightFor(front[2]),
      zIndex: 3,
    });
  }

  return out;
};

const summaryLabel = (selected: SurfStyle[]): string => {
  if (selected.length === 0) return 'Tap to add';
  const labels = selected
    .map(s => BOARD_LABEL[s])
    .filter((l): l is string => !!l);
  if (labels.length <= 2) return labels.join(', ');
  return `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`;
};

// Embedded stage — measures its own width on layout, then positions every
// board with explicit pixel values. Percentage positioning was being
// quietly truncated to the parent text's width in some flex configurations,
// so we sidestep that by computing pixels from the measured width.
const EmbeddedStage: React.FC<{ height: number; boards: BoardSpec[] }> = ({
  height,
  boards,
}) => {
  const [stageWidth, setStageWidth] = React.useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w !== stageWidth) setStageWidth(w);
  };

  return (
    <View
      style={[styles.stage, { height, width: '100%', alignSelf: 'stretch' }]}
      onLayout={onLayout}
    >
      {stageWidth > 0
        ? (() => {
            // Front-most (highest zIndex) gets the full floating shadow.
            // In the 3-board case, the second-most board(s) get a lighter
            // shadow so the depth layering reads naturally.
            const maxZ = boards.reduce(
              (m, b) => (b.zIndex > m ? b.zIndex : m),
              -Infinity,
            );
            const secondMaxZ = boards.reduce(
              (m, b) => (b.zIndex < maxZ && b.zIndex > m ? b.zIndex : m),
              -Infinity,
            );
            const isThreeBoard = boards.length === 3;
            return boards.map((b, i) => {
              const url = BOARD_IMAGE[b.slug];
              if (!url) return null;
              const slotWidthPx = b.widthPct * stageWidth;
              const slotLeftPx = b.centerX * stageWidth - slotWidthPx / 2;
              const isFrontMost =
                b.zIndex === maxZ && boards.length > 1;
              const isSecondMost =
                isThreeBoard && !isFrontMost && b.zIndex === secondMaxZ;
              return (
                <View
                  key={`${b.slug}-${i}`}
                  pointerEvents="none"
                  style={[
                    styles.boardSlot,
                    isSecondMost && styles.boardSlotFloatingLight,
                    isFrontMost && styles.boardSlotFloating,
                    {
                      width: slotWidthPx,
                      height: `${b.heightPct * 100}%`,
                      left: slotLeftPx,
                      zIndex: b.zIndex,
                      transform: [
                        { translateY: b.translateY },
                        { rotate: `${b.rotate}deg` },
                      ],
                    },
                  ]}
                >
                  <View style={styles.boardClip}>
                    <Image
                      source={url}
                      style={styles.boardImage}
                      resizeMode="contain"
                    />
                  </View>
                </View>
              );
            });
          })()
        : null}
    </View>
  );
};

export const BoardSelectionPreview: React.FC<BoardSelectionPreviewProps> = ({
  selected,
  onPress,
  height = 220,
  embedded = false,
}) => {
  const boards = composeLayout(selected, embedded);

  // Embedded mode: just the stage, no card chrome / header. Used when the
  // parent (e.g. InfoCard) already provides its own surface + label.
  if (embedded) {
    return (
      <EmbeddedStage height={height} boards={boards} />
    );
  }

  const Wrap: React.ComponentType<any> = onPress ? TouchableOpacity : View;

  return (
    <Wrap
      activeOpacity={onPress ? 0.85 : 1}
      onPress={onPress}
      style={styles.outer}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel="Boards welcome on this trip"
    >
      <View style={styles.headerRow}>
        <Text style={styles.label}>Boards (optional)</Text>
        <View style={styles.headerRight}>
          <Text style={styles.value} numberOfLines={1}>
            {summaryLabel(selected)}
          </Text>
          {onPress ? (
            <Ionicons name="chevron-forward" size={18} color={C.textMuted} />
          ) : null}
        </View>
      </View>

      <View style={[styles.stage, { height }]}>
        {boards.length === 0 ? (
          <View style={styles.emptyHint}>
            <Ionicons name="add-circle-outline" size={28} color={C.textMuted} />
            <Text style={styles.emptyHintText}>
              Add boards welcome on the trip
            </Text>
          </View>
        ) : (
          boards.map((b, i) => {
            const url = BOARD_IMAGE[b.slug];
            if (!url) return null;
            return (
              <View
                key={`${b.slug}-${i}`}
                pointerEvents="none"
                style={[
                  styles.boardSlot,
                  {
                    width: `${b.widthPct * 100}%`,
                    height: '100%',
                    left: `${(b.centerX - b.widthPct / 2) * 100}%`,
                    zIndex: b.zIndex,
                    transform: [
                      { translateY: b.translateY },
                      { rotate: `${b.rotate}deg` },
                    ],
                  },
                ]}
              >
                <View style={styles.boardClip}>
                  <Image
                    source={url}
                    style={styles.boardImage}
                    resizeMode="contain"
                  />
                </View>
              </View>
            );
          })
        )}
      </View>
    </Wrap>
  );
};

const styles = StyleSheet.create({
  outer: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.borderHairline,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '600',
    color: C.inkBody,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  value: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '400',
    color: C.textMuted,
  },
  stage: {
    width: '100%',
    marginTop: 4,
    position: 'relative',
  },
  // Each board sits in an absolutely-positioned wrapper sized by widthPct.
  boardSlot: {
    position: 'absolute',
    bottom: 0,
  },
  // Applied to the front-most board only — even soft shadow so it floats
  // above the others. shadowOffset is 0/0 for an aura-style shadow that
  // bleeds equally on all sides.
  boardSlotFloating: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 10,
  },
  // Lighter variant — applied to the second-most board in 3-board layouts.
  boardSlotFloatingLight: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 7,
    elevation: 5,
  },
  // Clip fills the slot exactly; the image overflows top and bottom modestly
  // so the PNG's top whitespace + bottom drop shadow get trimmed without
  // chopping the actual board content (e.g. longboard's tail tip).
  boardClip: {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    position: 'relative',
  },
  boardImage: {
    position: 'absolute',
    left: 0,
    right: 0,
    // The bundled board PNGs are tightly cropped (the image IS the board
    // content — no top padding or bottom shadow). So the image element
    // matches the slot exactly: bottom-anchored, full slot height. With
    // resizeMode:contain on tall narrow boards in a wider slot, the source
    // height-fits → source bottom at slot bottom → tails align across all
    // boards.
    bottom: 0,
    height: '100%',
  },
  emptyHint: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  emptyHintText: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    fontWeight: '500',
    color: C.textMuted,
  },
});

export default BoardSelectionPreview;
