import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Platform, Dimensions, Animated, Easing, BackHandler } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Text } from './Text';
import { colors, spacing } from '../styles/theme';
import { Ionicons } from '@expo/vector-icons';
import {
  MessageReactionsBar,
  REACTIONS_BAR_HEIGHT,
  REACTIONS_BAR_WIDTH_ESTIMATE,
} from './MessageReactionsBar';

export interface BubbleRadii {
  topLeft: number;
  topRight: number;
  bottomLeft: number;
  bottomRight: number;
}

export const DEFAULT_RADII: BubbleRadii = {
  topLeft: 16,
  topRight: 16,
  bottomLeft: 16,
  bottomRight: 16,
};

/**
 * Build SVG path data for a screen-sized rect with an inner rounded-rect
 * carved out (per-corner radii). Combined with `fill-rule="evenodd"` the
 * inner rect ends up as a transparent hole through which the selected bubble
 * shows.
 */
export function buildDimPathD(
  screenW: number,
  screenH: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  r: BubbleRadii,
): string {
  // Clamp radii so they never exceed half the bubble dimension.
  const maxR = Math.min(bw, bh) / 2;
  const tl = Math.max(0, Math.min(r.topLeft, maxR));
  const tr = Math.max(0, Math.min(r.topRight, maxR));
  const br = Math.max(0, Math.min(r.bottomRight, maxR));
  const bl = Math.max(0, Math.min(r.bottomLeft, maxR));

  const x0 = bx;
  const y0 = by;
  const x1 = bx + bw;
  const y1 = by + bh;

  const outer = `M0,0 H${screenW} V${screenH} H0 Z`;
  // True circular arcs (SVG A command) so the cutout matches CSS borderRadius
  // exactly. Q (quadratic Bezier) approximations leave a few pixels of dim
  // peeking past the corner.
  const inner =
    `M${x0},${y0 + tl} ` +
    `A${tl},${tl} 0 0 1 ${x0 + tl},${y0} ` +
    `H${x1 - tr} ` +
    `A${tr},${tr} 0 0 1 ${x1},${y0 + tr} ` +
    `V${y1 - br} ` +
    `A${br},${br} 0 0 1 ${x1 - br},${y1} ` +
    `H${x0 + bl} ` +
    `A${bl},${bl} 0 0 1 ${x0},${y1 - bl} Z`;
  return `${outer} ${inner}`;
}

interface MessageActionsMenuProps {
  visible: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopy?: () => void;
  onReply?: () => void;
  onReport?: () => void;
  canEdit: boolean; // Whether message is within edit window
  canDelete: boolean; // Whether message can be deleted
  canCopy?: boolean; // Whether message has text that can be copied
  canReply?: boolean; // Whether the message can be replied to
  canReport?: boolean; // Whether the message can be reported (other people's messages)
  messagePosition: { x: number; y: number }; // Touch point in page coords
  // Bubble bounds in page coords. When provided, the dim overlay carves a
  // tight rounded-rect hole around the bubble (WhatsApp-style "lift") and the
  // bar/menu position relative to its real top/bottom rather than the touch.
  // `radii` lets the cutout match the bubble's asymmetric corners (e.g.
  // pointy 2px tail corner on own / other messages).
  bubbleRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
    radii?: BubbleRadii;
  } | null;
  // True when the selected message is the current user's. Drives the
  // horizontal anchoring of the actions menu (own → right, other → left).
  // Passed explicitly by the parent screen at render time so it doesn't
  // depend on the async measureInWindow round-trip.
  isOwnSelected?: boolean;
  // Height of the open keyboard (0 when closed). The menu renders IN-TREE (not a
  // Modal) so opening it doesn't resign the composer's first responder — the
  // native keyboard stays up. With it up, the bar/menu must sit ABOVE it, so
  // placement treats `screenH - keyboardHeight` as the usable bottom.
  keyboardHeight?: number;
  // WhatsApp-style quick-reactions strip rendered above the menu.
  showReactionsBar?: boolean;
  currentReaction?: string;
  onReact?: (emoji: string) => void;
}

// Edit action icon — pencil from Figma (14×14 viewBox, scaled to match the
// Ionicons in the other rows). Stroke colour comes from the design.
const EditPencilIcon: React.FC<{ size?: number; color?: string }> = ({
  size = 20,
  color = '#7B7B7B',
}) => (
  <Svg width={size} height={size} viewBox="0 0 14 14" fill="none">
    <Path
      d="M10.5007 5.83319L8.16733 3.49985M1.45898 12.5415L3.4332 12.3222C3.6744 12.2954 3.795 12.282 3.90773 12.2455C4.00774 12.2131 4.10291 12.1673 4.19067 12.1095C4.28958 12.0443 4.37539 11.9585 4.54699 11.7868L12.2507 4.08319C12.895 3.43885 12.895 2.39418 12.2507 1.74985C11.6063 1.10552 10.5617 1.10552 9.91733 1.74985L2.21366 9.45351C2.04205 9.62512 1.95625 9.71092 1.89102 9.80983C1.83315 9.89759 1.78741 9.99277 1.75503 10.0928C1.71854 10.2055 1.70514 10.3261 1.67834 10.5673L1.45898 12.5415Z"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const MessageActionsMenu: React.FC<MessageActionsMenuProps> = ({
  visible,
  onClose,
  onEdit,
  onDelete,
  onCopy,
  onReply,
  onReport,
  canEdit,
  canDelete,
  canCopy,
  canReply,
  canReport,
  messagePosition,
  bubbleRect,
  isOwnSelected,
  keyboardHeight = 0,
  showReactionsBar = false,
  currentReaction,
  onReact,
}) => {
  // The overlay renders in-tree, so its (0,0) is NOT window (0,0) — it sits below
  // the SafeAreaView's top inset and inside react-native-screen-transitions'
  // transformed ContentLayer. Rather than guess that offset, we MEASURE the
  // overlay's real window origin and shift the content up/left by it, so all the
  // measureInWindow-based math below (which is in window coords) lines up exactly.
  const rootRef = useRef<View>(null);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const measureRoot = () => {
    rootRef.current?.measureInWindow((x: number, y: number) => {
      if (typeof x === 'number' && typeof y === 'number') {
        setOrigin((prev) => (prev.x === x && prev.y === y ? prev : { x, y }));
      }
    });
  };

  // Enter/exit animation (Emil: enter ease-out ~150ms; exit faster ~110ms;
  // transform+opacity only → native driver). The popover also scales for a subtle
  // "pop". On EXIT we animate first and only THEN call the parent callbacks, so
  // the menu's data stays alive during the fade-out (no position jump).
  const fade = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.96)).current;
  const closingRef = useRef(false);
  useEffect(() => {
    if (visible) {
      closingRef.current = false;
      fade.setValue(0);
      scale.setValue(0.96);
      Animated.parallel([
        Animated.timing(fade, { toValue: 1, duration: 150, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 150, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    }
  }, [visible, fade, scale]);

  // Play the exit animation, then run the parent callback(s). Guarded so a double
  // tap doesn't fire twice.
  const requestClose = (after?: () => void) => {
    if (closingRef.current) return;
    closingRef.current = true;
    Animated.parallel([
      Animated.timing(fade, { toValue: 0, duration: 110, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(scale, { toValue: 0.96, duration: 110, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) {
        after?.();
        onClose();
      }
    });
  };

  // The old Modal intercepted the Android hardware back button (onRequestClose).
  // In-tree we restore that so back closes the menu instead of popping the chat.
  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      requestClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  // Only log when visible to reduce noise
  if (visible) {
    console.log('[MessageActionsMenu] Render (visible)', { visible, canEdit, canDelete, canCopy, canReply });
  }

  const handleReply = () => {
    requestClose(() => { if (onReply) onReply(); });
  };

  const handleEdit = () => {
    // Fire onEdit NOW so the edit bar opens while the menu fades out (the in-tree
    // dim is shared, so it stays put). The menu's own close is animated.
    onEdit();
    requestClose();
  };

  const handleCopy = () => {
    requestClose(() => { if (onCopy) onCopy(); });
  };

  const handleReport = () => {
    requestClose(() => { if (onReport) onReport(); });
  };

  const handleDelete = () => {
    requestClose(() => {
      try {
        onDelete();
      } catch (error) {
        console.error('[MessageActionsMenu] Error in onDelete callback:', error);
      }
    });
  };

  if (!visible) return null;

  // ----- WhatsApp-style placement -----
  // Default layout: reactions bar hugs the top of the bubble, actions menu
  // sits just below the bubble. When the bubble is too close to either screen
  // edge we flip the whole stack: near top → both below, near bottom → both
  // above.
  //
  // When `bubbleRect` is provided we use the bubble's real top/bottom for
  // both the dim cutout and the bar/menu anchoring. Without it (fallback
  // before measureInWindow callback fires) we estimate from the touch Y.
  const screenH = Dimensions.get('window').height;
  const screenW = Dimensions.get('window').width;
  // With the keyboard staying open the menu must sit above it, so the bottom
  // boundary for placement is the keyboard's top, not the physical screen bottom.
  const usableBottom = screenH - Math.max(0, keyboardHeight);

  // Menu height varies with which actions are visible. Each row is
  // ~36px (16px line height + 8px padding × 2); menu has 4px vertical
  // padding on each side. A fixed estimate of 280 over-budgeted the space
  // needed below the bubble and pushed the menu far above when the bubble
  // sat near the bottom of the screen.
  const visibleItemCount =
    (canReply ? 1 : 0) + (canEdit ? 1 : 0) + (canCopy ? 1 : 0) + (canDelete ? 1 : 0) + (canReport ? 1 : 0);
  const MENU_ITEM_H = 36;
  const MENU_PADDING_V = 8;
  const MENU_H_EST = Math.max(1, visibleItemCount) * MENU_ITEM_H + MENU_PADDING_V;
  const GAP = 8;
  const BUBBLE_HALF_EST = 28;
  const SAFE_TOP = 60;
  const SAFE_BOTTOM = 80;

  const bubbleTop = bubbleRect
    ? bubbleRect.y
    : messagePosition.y - BUBBLE_HALF_EST;
  const bubbleBottom = bubbleRect
    ? bubbleRect.y + bubbleRect.height
    : messagePosition.y + BUBBLE_HALF_EST;
  const bubbleLeft = bubbleRect ? bubbleRect.x : 0;
  const bubbleRight = bubbleRect ? bubbleRect.x + bubbleRect.width : screenW;

  const spaceAbove = bubbleTop - SAFE_TOP;
  const spaceBelow = usableBottom - bubbleBottom - SAFE_BOTTOM;

  // Only budget vertical space for the reactions bar when it will actually
  // render — own messages don't get one, so the bar's height shouldn't be
  // considered when deciding above/below placement.
  const barHeightBudget = showReactionsBar ? REACTIONS_BAR_HEIGHT + GAP : 0;
  const canBarAbove = !showReactionsBar || spaceAbove >= REACTIONS_BAR_HEIGHT + GAP;
  const canMenuBelow = spaceBelow >= MENU_H_EST + GAP;

  let barTopRaw: number;
  let menuTopRaw: number;
  if (canBarAbove && canMenuBelow) {
    // Default: bar above the bubble, menu below.
    barTopRaw = bubbleTop - GAP - REACTIONS_BAR_HEIGHT;
    menuTopRaw = bubbleBottom + GAP;
  } else if (!canBarAbove) {
    // Bubble near top → flip both below.
    barTopRaw = bubbleBottom + GAP;
    menuTopRaw = barTopRaw + barHeightBudget;
  } else {
    // Bubble near bottom → flip menu above.
    menuTopRaw = bubbleTop - GAP - MENU_H_EST;
    barTopRaw = menuTopRaw - GAP - REACTIONS_BAR_HEIGHT;
  }

  const barTop = Math.max(
    SAFE_TOP,
    Math.min(usableBottom - SAFE_BOTTOM - REACTIONS_BAR_HEIGHT, barTopRaw),
  );
  const menuTop = Math.max(
    SAFE_TOP,
    Math.min(usableBottom - SAFE_BOTTOM - MENU_H_EST, menuTopRaw),
  );

  // Side detection: own bubbles are right-aligned, other bubbles left-aligned.
  // The screen passes `isOwnSelected` based on selectedMessage at render time,
  // so this is correct from the very first frame regardless of whether the
  // measureInWindow callback has populated bubbleRect yet.
  const isRightAligned =
    typeof isOwnSelected === 'boolean'
      ? isOwnSelected
      : bubbleRect
        ? bubbleRect.x + bubbleRect.width / 2 > screenW / 2
        : messagePosition.x > screenW / 2;

  // Reactions bar: only ever shown on incoming (left-aligned) messages, so
  // anchor its left edge ~2px right of the bubble's left edge.
  const barLeftIdeal = bubbleRect
    ? bubbleRect.x + 2
    : messagePosition.x - REACTIONS_BAR_WIDTH_ESTIMATE / 2;
  const barLeft = Math.max(
    8,
    Math.min(screenW - REACTIONS_BAR_WIDTH_ESTIMATE - 8, barLeftIdeal),
  );

  // Actions menu: align with the bubble like WhatsApp.
  // - Other (left-aligned bubble): menu left edge = bubble left edge.
  // - Own (right-aligned bubble): menu right edge = bubble right edge.
  // For own bubbles we anchor by `right` instead of computing `left` from a
  // width estimate — the menu's intrinsic width varies with which actions are
  // shown (Reply/Edit/Copy/Delete), so estimating leaves a visible gap.
  const MENU_W_EST = 220;
  let menuLeft: number | undefined;
  let menuRight: number | undefined;
  if (bubbleRect) {
    if (isRightAligned) {
      menuRight = Math.max(8, screenW - (bubbleRect.x + bubbleRect.width));
    } else {
      menuLeft = Math.max(8, Math.min(screenW - MENU_W_EST - 8, bubbleRect.x));
    }
  } else {
    menuLeft =
      messagePosition.x > 200 ? messagePosition.x - 150 : messagePosition.x;
  }

  return (
    // Rendered IN-TREE (not a Modal) so presenting it does not resign the
    // composer's first responder — the native keyboard stays up. The root fills
    // the host; we measure its window origin and offset the inner (window-sized)
    // layer by -origin so all the window-coord math below maps to the screen
    // exactly, regardless of safe-area padding or the screen-transition transform.
    // The OUTER view is the one we measure for `origin` — it must carry NO
    // transform. The scale "pop" lives on the INNER layer instead: measuring a
    // scaled view returns its shrunk, transformed window position (e.g. a
    // full-screen view at scale 0.96 reports top-left ≈ (8,17)), which would make
    // `origin` a scale artifact rather than the real host offset and shift the
    // whole menu up by that amount. Opacity is transform-free, so it's safe here.
    <Animated.View
      ref={rootRef}
      onLayout={measureRoot}
      pointerEvents="box-none"
      style={[styles.root, { opacity: fade }]}
    >
      <Animated.View
        pointerEvents="box-none"
        style={{ position: 'absolute', left: -origin.x, top: -origin.y, width: screenW, height: screenH, transform: [{ scale }] }}
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={() => requestClose()}
        />
        {/* The dim layer is no longer drawn here — the screen renders ONE in-tree
            BubbleSpotlightDim (below the composer) shared by the menu AND edit
            mode, so tapping Edit only removes these items while the dim stays put
            (no close/redraw). This overlay is just the transparent tap-catcher +
            the reactions bar + the actions list. */}
        {showReactionsBar && onReact ? (
          <MessageReactionsBar
            top={barTop}
            left={barLeft}
            currentReaction={currentReaction}
            onReact={(emoji) => {
              requestClose(() => onReact(emoji));
            }}
          />
        ) : null}
        <TouchableOpacity
          activeOpacity={1}
          onPress={(e) => {
            // Prevent overlay from closing when clicking inside menu
            // On web, stopPropagation prevents the event from bubbling to the overlay
            if (Platform.OS === 'web' && e && typeof e.stopPropagation === 'function') {
              e.stopPropagation();
            }
          }}
          style={[
            styles.menu,
            {
              top: menuTop,
              ...(menuRight !== undefined ? { right: menuRight } : { left: menuLeft }),
            },
          ]}
        >
          {canReply && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleReply}
              activeOpacity={0.7}
            >
              <Text style={styles.menuItemText}>Reply</Text>
              <Ionicons name="arrow-undo-outline" size={20} color={colors.textDark} />
            </TouchableOpacity>
          )}

          {canEdit && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleEdit}
              activeOpacity={0.7}
            >
              <Text style={styles.menuItemText}>Edit</Text>
              <EditPencilIcon size={20} color={colors.textDark} />
            </TouchableOpacity>
          )}

          {canCopy && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleCopy}
              activeOpacity={0.7}
            >
              <Text style={styles.menuItemText}>Copy</Text>
              <Ionicons name="copy-outline" size={20} color={colors.textDark} />
            </TouchableOpacity>
          )}

          {canDelete && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                console.log('[MessageActionsMenu] Delete button onPress triggered - START');
                console.log('[MessageActionsMenu] About to call handleDelete');
                handleDelete();
                console.log('[MessageActionsMenu] Delete button onPress - END');
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.menuItemText, styles.deleteText]}>Delete</Text>
              <Ionicons name="trash-outline" size={20} color="#FF3B30" />
            </TouchableOpacity>
          )}

          {canReport && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleReport}
              activeOpacity={0.7}
            >
              <Text style={[styles.menuItemText, styles.reportText]}>Report</Text>
              <Ionicons name="flag-outline" size={20} color="#FF3B30" />
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    zIndex: 1000,
    elevation: 1000,
  },
  dimStrip: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  menu: {
    position: 'absolute',
    backgroundColor: colors.white,
    borderRadius: 12,
    paddingVertical: spacing.xs,
    minWidth: 150,
    ...(Platform.OS === 'web' && {
      boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.15)',
    }),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  menuItemText: {
    fontSize: 16,
    color: colors.textDark,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
  deleteText: {
    color: '#FF3B30',
  },
  reportText: {
    color: '#FF3B30',
  },
});


