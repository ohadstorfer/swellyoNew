import React from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, Platform, Dimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Text } from './Text';
import { colors, spacing } from '../styles/theme';
import { Ionicons } from '@expo/vector-icons';
import {
  MessageReactionsBar,
  REACTIONS_BAR_HEIGHT,
  REACTIONS_BAR_WIDTH_ESTIMATE,
} from './MessageReactionsBar';

interface BubbleRadii {
  topLeft: number;
  topRight: number;
  bottomLeft: number;
  bottomRight: number;
}

const DEFAULT_RADII: BubbleRadii = {
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
function buildDimPathD(
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
  // WhatsApp-style quick-reactions strip rendered above the menu.
  showReactionsBar?: boolean;
  currentReaction?: string;
  onReact?: (emoji: string) => void;
}

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
  showReactionsBar = false,
  currentReaction,
  onReact,
}) => {
  // Only log when visible to reduce noise
  if (visible) {
    console.log('[MessageActionsMenu] Render (visible)', { visible, canEdit, canDelete, canCopy, canReply });
  }

  const handleReply = () => {
    console.log('[MessageActionsMenu] handleReply called');
    if (onReply) onReply();
    onClose();
  };

  const handleEdit = () => {
    console.log('[MessageActionsMenu] handleEdit called');
    onEdit();
    onClose();
  };

  const handleCopy = () => {
    console.log('[MessageActionsMenu] handleCopy called');
    if (onCopy) onCopy();
    onClose();
  };

  const handleReport = () => {
    console.log('[MessageActionsMenu] handleReport called');
    if (onReport) onReport();
    onClose();
  };

  const handleDelete = () => {
    console.log('[MessageActionsMenu] handleDelete called', { canDelete });
    // Don't close menu immediately - let the delete handler manage it
    // The menu will close after user confirms/cancels the delete dialog
    try {
      console.log('[MessageActionsMenu] Calling onDelete callback');
      onDelete();
      console.log('[MessageActionsMenu] onDelete callback executed');
    } catch (error) {
      console.error('[MessageActionsMenu] Error in onDelete callback:', error);
    }
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
  const spaceBelow = screenH - bubbleBottom - SAFE_BOTTOM;

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
    Math.min(screenH - SAFE_BOTTOM - REACTIONS_BAR_HEIGHT, barTopRaw),
  );
  const menuTop = Math.max(
    SAFE_TOP,
    Math.min(screenH - SAFE_BOTTOM - MENU_H_EST, menuTopRaw),
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
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        {/* Dim layer with a rounded-rect hole over the selected bubble.
            Built as a single SVG path: outer screen rect + inner rounded-rect
            sub-path with fill-rule=evenodd → the inside of the inner rect is
            the only un-filled region, so the bubble stays fully visible while
            everything around it is dimmed. Falls back to two horizontal
            strips while measureInWindow hasn't returned bubbleRect yet. */}
        {bubbleRect ? (
          <Svg
            pointerEvents="none"
            width={screenW}
            height={screenH}
            style={StyleSheet.absoluteFill}
          >
            <Path
              d={buildDimPathD(
                screenW,
                screenH,
                bubbleRect.x,
                bubbleRect.y,
                bubbleRect.width,
                bubbleRect.height,
                bubbleRect.radii ?? DEFAULT_RADII,
              )}
              fill="rgba(0, 0, 0, 0.3)"
              fillRule="evenodd"
            />
          </Svg>
        ) : (
          <>
            <View
              pointerEvents="none"
              style={[
                styles.dimStrip,
                { top: 0, left: 0, right: 0, height: Math.max(0, bubbleTop) },
              ]}
            />
            <View
              pointerEvents="none"
              style={[
                styles.dimStrip,
                { top: bubbleBottom, left: 0, right: 0, bottom: 0 },
              ]}
            />
          </>
        )}
        {showReactionsBar && onReact ? (
          <MessageReactionsBar
            top={barTop}
            left={barLeft}
            currentReaction={currentReaction}
            onReact={(emoji) => {
              onReact(emoji);
              onClose();
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
              <Ionicons name="arrow-undo-outline" size={20} color={colors.text} />
            </TouchableOpacity>
          )}

          {canEdit && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleEdit}
              activeOpacity={0.7}
            >
              <Text style={styles.menuItemText}>Edit</Text>
              <Ionicons name="create-outline" size={20} color={colors.text} />
            </TouchableOpacity>
          )}

          {canCopy && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleCopy}
              activeOpacity={0.7}
            >
              <Text style={styles.menuItemText}>Copy</Text>
              <Ionicons name="copy-outline" size={20} color={colors.text} />
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
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
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
    color: colors.text,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
  deleteText: {
    color: '#FF3B30',
  },
  reportText: {
    color: '#FF3B30',
  },
});


