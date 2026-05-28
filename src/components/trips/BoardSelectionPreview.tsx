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

// Same URLs as OnboardingStep1Screen.tsx BOARD_TYPES — restored after the
// bundled-image switch broke horizontal alignment. We'll need to revisit
// the local images with their own positioning math separately.
import { LayoutChangeEvent } from 'react-native';
const BOARD_IMAGE: Partial<Record<SurfStyle, string>> = {
  shortboard:
    'https://api.builder.io/api/v1/image/assets/TEMP/9761796f6e2272f3cacf14c4fc9342525bb54ff8?width=371',
  midlength:
    'https://api.builder.io/api/v1/image/assets/TEMP/377f67727b21485479e873ed3d93c57611722f74?width=371',
  longboard:
    'https://api.builder.io/api/v1/image/assets/TEMP/4692a28e8ac444a82eec1f691f5f008c8a9bbc8e?width=371',
  softtop:
    'https://api.builder.io/api/v1/image/assets/TEMP/1d104557a7a5ea05c3b36931c1ee56fd01a6d426?width=371',
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
  // 2-board case — smaller front-left + bigger back-right, both upright.
  // -----------------------------------------------------------------------
  if (realSelected.length === 2) {
    const sorted = [...realSelected].sort(
      (a, b) => (BOARD_SIZE_ORDER[a] ?? 99) - (BOARD_SIZE_ORDER[b] ?? 99),
    );
    const [smaller, bigger] = sorted;
    out.push({
      slug: smaller,
      centerX: 0.38,
      translateY: 0,
      rotate: 0,
      widthPct: W.side,
      heightPct: heightFor(smaller),
      zIndex: 3, // front
    });
    out.push({
      slug: bigger,
      centerX: 0.62,
      translateY: 0,
      rotate: 0,
      widthPct: W.short,
      heightPct: heightFor(bigger),
      zIndex: 2, // behind smaller
    });
    return out;
  }

  // Back layer — longboard standing tall, biggest, anchored at slot bottom
  // (same as every other board) so every variation reads with consistent
  // nose-to-tail height = 90% of the slot.
  if (set.has('longboard')) {
    out.push({
      slug: 'longboard',
      centerX: 0.5,
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
      centerX: 0.5,
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
      centerX: embedded ? 0.66 : 0.585,
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
      centerX: embedded ? 0.34 : 0.415,
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
        ? boards.map((b, i) => {
            const url = BOARD_IMAGE[b.slug];
            if (!url) return null;
            const slotWidthPx = b.widthPct * stageWidth;
            const slotLeftPx = b.centerX * stageWidth - slotWidthPx / 2;
            return (
              <View
                key={`${b.slug}-${i}`}
                pointerEvents="none"
                style={[
                  styles.boardSlot,
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
                    source={{ uri: url }}
                    style={styles.boardImage}
                    resizeMode="contain"
                  />
                </View>
              </View>
            );
          })
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
                    source={{ uri: url }}
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
    // top:-40% pulls the image element up enough that the board content
    // (which sits in the middle ~60% of the source PNG, between top padding
    // and bottom drop shadow) ends up filling the slot vertically instead
    // of being clipped halfway below the card.
    top: '-40%',
    height: '150%',
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
