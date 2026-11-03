import React, { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

/**
 * Explore card stack (Figma 17779:50970).
 *
 * The front card can be thrown up or down, never sideways. A thrown card goes
 * to the back of the list, so the stack never runs out — it loops.
 *
 * ── Why the top index lives on the UI thread ────────────────────────────────
 * A throw has two halves, so you can SEE where the card went:
 *   1. out — the card leaves in the direction it was thrown, just far enough
 *      to clear the pile, while the cards behind step forward;
 *   2. back — it drops behind the pile and slides home into the last slot,
 *      shrinking as it goes. With more than three trips that slot is already
 *      taken, so it fades as it arrives.
 *
 * ── Why the top index lives on the UI thread ────────────────────────────────
 * `topIndex` is a shared value, not React state. Between the two halves, one
 * worklet (a) advances `topIndex`, (b) zeroes the drag progress and (c) starts
 * the card's trip back. All three land in ONE frame. Doing the advance in
 * React state instead leaves a frame where the stack has not moved on yet — a
 * visible flash on every swipe. React state (`top`) only decides which cards
 * are mounted, and it is allowed to lag a frame.
 */

/** How many cards are mounted ahead of the front one. Three are visible; the
 *  fourth is the one fading in at the back while the front card is dragged.
 *  The card just thrown stays mounted too, so it can finish its trip back. */
const MOUNTED = 4;
/** Each card behind the front one is this much smaller… */
const BACK_SCALE_STEP = 0.1;
/** …and shows this many px below the card in front of it. */
export const DECK_PEEK = 10;
/** Drag this far and the card is thrown on release. */
const THROW_DISTANCE = 110;
/** A flick this fast (px/s) throws it too, however short the drag was. */
const THROW_VELOCITY = 800;
/** A flick only counts if it is at most this many times faster sideways than
 *  vertically (about 63° off vertical). Stops a sideways flick that drifted
 *  just enough to start the pan from throwing the card. */
const MAX_FLICK_SIDEWAYS_RATIO = 2;
/** Vertical travel that starts the drag… */
const ACTIVATE_Y = 8;
/** …unless the finger has gone this far sideways first. With 8 it accepts
 *  anything up to about 74° off vertical, so a thumb swipe that starts out
 *  curved still counts. */
const FAIL_X = 28;
/** A finger that travels further than this is a swipe, not a tap. */
const TAP_MAX_DISTANCE = 10;
const EXIT_MS = 200;
const EXIT_EASING = Easing.out(Easing.cubic);
/** The trip back behind the pile. Slower than the exit: this is the half the
 *  eye is meant to follow. */
const RETURN_MS = 320;
const RETURN_EASING = Easing.out(Easing.cubic);
/** How far out the card goes, as a share of the distance that would fully
 *  clear the pile. Under 1, so it tucks back under an edge rather than
 *  vanishing and reappearing. */
const EXIT_CLEARANCE = 0.9;
/**
 * TEMPORARY switch, for recording the two side by side (Ohad, 9 Oct).
 * true  = a thrown card slides back behind the pile (the two halves above).
 * false = the old feel: it flies off screen and is simply gone.
 * Set it back to true and delete the `false` branches once the choice is made.
 */
const RETURN_TO_PILE = true;
/** The last slot you can see — where a thrown card comes home to. */
const LAST_VISIBLE_SLOT = 2;
const SPRING_BACK = { damping: 20, stiffness: 240, mass: 0.8 };
/** Degrees of tilt when the card is dragged one full card-width sideways. */
const MAX_TILT = 10;

interface DeckCardProps {
  index: number;
  count: number;
  width: number;
  height: number;
  topIndex: SharedValue<number>;
  drag: SharedValue<number>;
  interactive: boolean;
  accessibilityLabel?: string;
  onOpen: () => void;
  onThrown: (nextTop: number) => void;
  children: React.ReactNode;
}

const DeckCard: React.FC<DeckCardProps> = ({
  index,
  count,
  width,
  height,
  topIndex,
  drag,
  interactive,
  accessibilityLabel,
  onOpen,
  onThrown,
  children,
}) => {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  // 1 the moment a thrown card turns round, easing to 0 as it settles into
  // the back of the pile. 0 the rest of the time.
  const settle = useSharedValue(0);
  // True for the gesture that started on the front card. Read once at the
  // start so a card promoted mid-gesture does not jump to the finger.
  const active = useSharedValue(false);
  const exiting = useSharedValue(false);

  // Up and down only: a mostly-sideways drag fails the pan, and the card
  // never moves on X. The fail offset only applies before the pan starts, so
  // once a drag is going the finger can wander sideways freely.
  const pan = Gesture.Pan()
    .activeOffsetY([-ACTIVATE_Y, ACTIVATE_Y])
    .failOffsetX([-FAIL_X, FAIL_X])
    .onStart(() => {
      const rel = (((index - topIndex.value) % count) + count) % count;
      active.value = rel === 0 && !exiting.value;
    })
    .onUpdate(e => {
      if (!active.value) return;
      y.value = e.translationY;
      drag.value = Math.min(1, Math.abs(e.translationY) / THROW_DISTANCE);
    })
    .onEnd(e => {
      if (!active.value) return;
      active.value = false;
      const distance = Math.abs(e.translationY);
      const speed = Math.abs(e.velocityY);
      const flicked = speed > THROW_VELOCITY && Math.abs(e.velocityX) <= speed * MAX_FLICK_SIDEWAYS_RATIO;
      // A single card has nowhere to go — it always springs back.
      const thrown = count > 1 && (distance > THROW_DISTANCE || flicked);
      if (!thrown) {
        x.value = withSpring(0, SPRING_BACK);
        y.value = withSpring(0, SPRING_BACK);
        drag.value = withSpring(0, SPRING_BACK);
        return;
      }
      // Leave up or down, the way the finger was heading: mostly the drag
      // itself, nudged by the release velocity.
      const dx = 0;
      const dy = e.translationY + e.velocityY * 0.15;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      // Distance along this direction until the card no longer covers the pile.
      const clear = Math.min(width / Math.max(Math.abs(ux), 0.001), height / Math.max(Math.abs(uy), 0.001));
      const out = RETURN_TO_PILE ? clear * EXIT_CLEARANCE : Math.max(width, height) * 1.6;
      exiting.value = true;
      drag.value = withTiming(1, { duration: EXIT_MS, easing: EXIT_EASING });
      y.value = withTiming(uy * out, { duration: EXIT_MS, easing: EXIT_EASING });
      x.value = withTiming(
        ux * out,
        { duration: EXIT_MS, easing: EXIT_EASING },
        finished => {
          exiting.value = false;
          if (!finished) return;
          // One frame: advance the stack, clear the drag, and turn round. The
          // card is now last in the order, so it draws BEHIND the pile from
          // here on — the slide home reads as going to the back of it.
          const next = (topIndex.value + 1) % count;
          topIndex.value = next;
          drag.value = 0;
          if (RETURN_TO_PILE) {
            settle.value = 1;
            settle.value = withTiming(0, { duration: RETURN_MS, easing: RETURN_EASING });
            x.value = withTiming(0, { duration: RETURN_MS, easing: RETURN_EASING });
            y.value = withTiming(0, { duration: RETURN_MS, easing: RETURN_EASING });
          } else {
            x.value = 0;
            y.value = 0;
          }
          runOnJS(onThrown)(next);
        },
      );
    });

  // Without maxDistance a tap has no movement limit: a quick sideways swipe
  // fails the pan, then still counts as a tap and opens the trip.
  const tap = Gesture.Tap()
    .maxDuration(300)
    .maxDistance(TAP_MAX_DISTANCE)
    .onEnd((_e, success) => {
      if (!success) return;
      const rel = (((index - topIndex.value) % count) + count) % count;
      if (rel === 0 && !exiting.value) runOnJS(onOpen)();
    });

  const gesture = Gesture.Exclusive(pan, tap);

  const style = useAnimatedStyle(() => {
    const rel = (((index - topIndex.value) % count) + count) % count;
    // Cards behind move one step forward as the front card is dragged away.
    // Capped: past the hidden slot there is nothing to draw, and the scale
    // below would otherwise go negative on a long list.
    const resting = rel === 0 ? 0 : Math.min(rel - drag.value, LAST_VISIBLE_SLOT + 1);
    const returning = settle.value > 0;
    // On its way home a thrown card shrinks from full size into the last slot.
    const depth = returning
      ? interpolate(settle.value, [1, 0], [0, Math.min(rel, LAST_VISIBLE_SLOT)])
      : resting;
    // If that slot is taken (more than three trips) it fades out on arrival,
    // ending exactly where the resting rule leaves a card that deep: hidden.
    const opacity = returning
      ? rel > LAST_VISIBLE_SLOT
        ? interpolate(settle.value, [0.45, 0], [1, 0], Extrapolation.CLAMP)
        : 1
      : interpolate(resting, [LAST_VISIBLE_SLOT, LAST_VISIBLE_SLOT + 1], [1, 0], Extrapolation.CLAMP);
    return {
      zIndex: 100 - rel,
      ...(Platform.OS === 'android' && { elevation: Math.max(0, 8 - rel * 2) }),
      opacity,
      transform: [
        { translateX: x.value },
        // Scaling shrinks a card around its centre, lifting its bottom edge by
        // half the height it lost — push it back down, then add the peek.
        { translateY: y.value + depth * (height * (BACK_SCALE_STEP / 2) + DECK_PEEK) },
        { rotate: `${(x.value / width) * MAX_TILT}deg` },
        { scale: 1 - BACK_SCALE_STEP * depth },
      ],
    };
  });

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[styles.card, { width, height }, style]}
        pointerEvents={interactive ? 'auto' : 'none'}
        accessible={interactive}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onAccessibilityTap={onOpen}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
};

interface ExploreSwipeDeckProps<T extends { id: string }> {
  items: T[];
  cardWidth: number;
  cardHeight: number;
  renderCard: (item: T) => React.ReactNode;
  onOpen: (item: T) => void;
  /** Fires with the new front card's index in `items` after each throw. */
  onTopChange?: (index: number) => void;
  getAccessibilityLabel?: (item: T) => string;
  /** Change it to send the stack back to the first card (e.g. new filters). */
  resetKey?: string;
}

export function ExploreSwipeDeck<T extends { id: string }>({
  items,
  cardWidth,
  cardHeight,
  renderCard,
  onOpen,
  onTopChange,
  getAccessibilityLabel,
  resetKey,
}: ExploreSwipeDeckProps<T>) {
  const count = items.length;
  const [top, setTop] = useState(0);
  const topIndex = useSharedValue(0);
  const drag = useSharedValue(0);

  useEffect(() => {
    setTop(0);
    topIndex.value = 0;
    drag.value = 0;
  }, [resetKey, topIndex, drag]);

  // The list can shrink under us (a trip is cancelled, a realtime reload).
  useEffect(() => {
    if (count > 0 && topIndex.value >= count) {
      topIndex.value = 0;
      setTop(0);
    }
  }, [count, topIndex]);

  const handleThrown = useCallback((next: number) => {
    setTop(next);
    onTopChange?.(next);
  }, [onTopChange]);

  if (count === 0) return null;
  const safeTop = top % count;
  const indices = Array.from({ length: Math.min(count, MOUNTED) }, (_, k) => (safeTop + k) % count);
  // The card just thrown, still sliding home. On a short list it is already
  // one of the cards above.
  if (count > MOUNTED) indices.push((safeTop - 1 + count) % count);

  return (
    <View style={{ width: cardWidth, height: cardHeight + DECK_PEEK * 2 }}>
      {indices.map(index => {
        const item = items[index];
        return (
          <DeckCard
            key={item.id}
            index={index}
            count={count}
            width={cardWidth}
            height={cardHeight}
            topIndex={topIndex}
            drag={drag}
            interactive={index === safeTop}
            accessibilityLabel={getAccessibilityLabel?.(item)}
            onOpen={() => onOpen(item)}
            onThrown={handleThrown}
          >
            {renderCard(item)}
          </DeckCard>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', top: 0, left: 0 },
});
