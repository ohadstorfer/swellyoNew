import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { TutorialArrow } from './TutorialArrow';
import { TutorialTooltipCard } from './TutorialTooltipCard';

export interface AnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TutorialOverlayProps {
  visible: boolean;
  step: number;
  total: number;
  title: string;
  body: string;
  ctaLabel: string;
  onPressCta: () => void;
  anchorRect: AnchorRect | null;
  arrowDirection: 'up' | 'down';
  /** Gap in px between arrow tip and the cutout edge (i.e. anchor + cutoutPadding). */
  arrowGap?: number;
  /** Gap in px between arrow base and the card edge. */
  cardGap?: number;
  /** Extra padding around the anchor rect in the backdrop cutout. */
  cutoutPadding?: number;
  /** Corner radius for the rounded cutout hole. */
  cutoutRadius?: number;
  /** Delay before the overlay fades in on mount, in ms. */
  enterDelay?: number;
  /** Optional tap handler for the anchor (hole) region. If absent, hole blocks taps. */
  onAnchorPress?: () => void;
  /** Horizontal position of the arrow within the card. Defaults to 'center'. */
  arrowAlignment?: 'left' | 'center' | 'right';
  /** Optional extra content rendered above the dark backdrop, fades with the card. */
  extraContent?: React.ReactNode;
}

const CARD_WIDTH = 314;
const ARROW_SIZE = 16;
const SCREEN_MARGIN = 16;
const BACKDROP_COLOR = 'rgba(1, 0, 0, 0.7)';

// Step-transition timings (ms). Every "open" and "close" of a step runs these
// three phases in order:
//   A  tooltip fades out AND a dark rect fills the spotlight hole (simultaneously)
//   B  the dark backdrop fades away entirely (screen returns to normal)
//   C  the backdrop fades back in, then the tooltip fades in (no slide)
const PHASE_A_DURATION = 260;
const PHASE_B_DURATION = 220;
const PHASE_C_BACKDROP_DURATION = 340;
const PHASE_C_CONTENT_DELAY = 160;
const PHASE_C_CONTENT_DURATION = 320;

interface DisplayedProps {
  step: number;
  anchorRect: AnchorRect | null;
  title: string;
  body: string;
  ctaLabel: string;
  arrowDirection: 'up' | 'down';
  arrowAlignment: 'left' | 'center' | 'right';
}

export const TutorialOverlay: React.FC<TutorialOverlayProps> = ({
  visible,
  step,
  total,
  title,
  body,
  ctaLabel,
  onPressCta,
  anchorRect,
  arrowDirection,
  arrowGap = 4,
  cardGap = 2,
  cutoutPadding = 11,
  cutoutRadius = 20,
  enterDelay = 800,
  onAnchorPress,
  arrowAlignment = 'center',
  extraContent,
}) => {
  const { width: screenW, height: screenH } = Dimensions.get('window');
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const holeCoverOpacity = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const [measuredCardHeight, setMeasuredCardHeight] = useState(160);
  const [modalMounted, setModalMounted] = useState(false);
  // `displayedHeld` = we're actively holding `displayed` at a stale value
  // because a close/swap animation needs the OLD content to stay put. When
  // held: sync effect skips and taps are blocked. Crucially, we do NOT set
  // this during the mount fade-in — otherwise late anchor measurements from
  // the parent would be blocked until fade-in completes, and the tooltip
  // would snap into place after a second of sitting in the wrong spot.
  const [displayedHeld, setDisplayedHeld] = useState(false);

  // `displayed` lags incoming props during close/swap animations so Phase A/B
  // render the OLD step's content/anchor and Phase C renders the NEW one.
  // This also prevents the "step 1 flash" when the overlay is hiding: the
  // parent may flip `step` back to 1 in the same render that sets visible=
  // false, but we keep rendering the last stable step throughout the close.
  const [displayed, setDisplayed] = useState<DisplayedProps>({
    step, anchorRect, title, body, ctaLabel, arrowDirection, arrowAlignment,
  });

  // Keep `displayed` in sync with incoming props unless we're actively holding
  // them stale for a close/swap animation. At steady state AND during the
  // mount fade-in, non-step prop updates flow through — e.g. the parent
  // re-measures `anchorRect` after a layout shift and the tooltip follows.
  const prevStepRef = useRef(step);
  useEffect(() => {
    if (displayedHeld) return;
    if (prevStepRef.current !== step) return; // step-change effect handles this
    setDisplayed(prev => {
      if (
        prev.anchorRect === anchorRect &&
        prev.title === title &&
        prev.body === body &&
        prev.ctaLabel === ctaLabel &&
        prev.arrowDirection === arrowDirection &&
        prev.arrowAlignment === arrowAlignment
      ) return prev;
      return { step, anchorRect, title, body, ctaLabel, arrowDirection, arrowAlignment };
    });
  }, [displayedHeld, step, anchorRect, title, body, ctaLabel, arrowDirection, arrowAlignment]);

  // Mount / unmount. Mount runs Phase C only. Unmount runs Phase A → Phase B,
  // then unmounts the Modal.
  useEffect(() => {
    if (visible) {
      setModalMounted(true);
      backdropOpacity.setValue(0);
      holeCoverOpacity.setValue(0);
      contentOpacity.setValue(0);
      // Mount fade-in does NOT hold `displayed` — we want late anchor updates
      // from the parent (e.g. async measurement after layout settles) to
      // flow through while the overlay is still invisible / fading in.
      const timer = setTimeout(() => {
        Animated.parallel([
          Animated.timing(backdropOpacity, {
            toValue: 1,
            duration: PHASE_C_BACKDROP_DURATION,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.delay(PHASE_C_CONTENT_DELAY),
            Animated.timing(contentOpacity, {
              toValue: 1,
              duration: PHASE_C_CONTENT_DURATION,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
        ]).start();
      }, enterDelay);
      return () => clearTimeout(timer);
    }
    if (!modalMounted) return;
    // Unmount: hold displayed at the closing step so Phase A/B render the
    // step the user just dismissed, even if the parent has already flipped
    // `step` / `anchorRect` to stale values.
    setDisplayedHeld(true);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(contentOpacity, {
          toValue: 0,
          duration: PHASE_A_DURATION,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(holeCoverOpacity, {
          toValue: 1,
          duration: PHASE_A_DURATION,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: PHASE_B_DURATION,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      setDisplayedHeld(false);
      if (finished) setModalMounted(false);
    });
    // modalMounted is read via closure; re-running this effect on its change
    // would re-trigger the close animation mid-unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Step change within a mounted, visible overlay: Phase A → Phase B → silent
  // swap of displayed props → Phase C.
  useEffect(() => {
    if (prevStepRef.current === step) return;
    prevStepRef.current = step;
    if (!modalMounted || !visible) return;

    setDisplayedHeld(true);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(contentOpacity, {
          toValue: 0,
          duration: PHASE_A_DURATION,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(holeCoverOpacity, {
          toValue: 1,
          duration: PHASE_A_DURATION,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: PHASE_B_DURATION,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (!finished) {
        setDisplayedHeld(false);
        return;
      }
      // Silent swap: overlay is invisible (backdropOpacity=0) so the anchor /
      // content jump is not seen by the user. Reset hole cover for the new step.
      setDisplayed({ step, anchorRect, title, body, ctaLabel, arrowDirection, arrowAlignment });
      holeCoverOpacity.setValue(0);
      // Unblock sync BEFORE Phase C so any late prop updates during fade-in
      // (e.g. the parent re-measuring the next anchor) can flow through.
      setDisplayedHeld(false);
      requestAnimationFrame(() => {
        Animated.parallel([
          Animated.timing(backdropOpacity, {
            toValue: 1,
            duration: PHASE_C_BACKDROP_DURATION,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.delay(PHASE_C_CONTENT_DELAY),
            Animated.timing(contentOpacity, {
              toValue: 1,
              duration: PHASE_C_CONTENT_DURATION,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
        ]).start();
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const positions = useMemo(() => {
    if (!displayed.anchorRect) return null;
    const anchorCenterX = displayed.anchorRect.x + displayed.anchorRect.width / 2;
    const anchorTop = displayed.anchorRect.y;
    const anchorBottom = displayed.anchorRect.y + displayed.anchorRect.height;

    let cardLeft = anchorCenterX - CARD_WIDTH / 2;
    cardLeft = Math.max(SCREEN_MARGIN, Math.min(cardLeft, screenW - CARD_WIDTH - SCREEN_MARGIN));

    const ARROW_EDGE_INSET = 40;
    let arrowLeft: number;
    if (displayed.arrowAlignment === 'right') {
      arrowLeft = cardLeft + CARD_WIDTH - ARROW_EDGE_INSET;
    } else if (displayed.arrowAlignment === 'left') {
      arrowLeft = cardLeft + ARROW_EDGE_INSET;
    } else {
      arrowLeft = anchorCenterX;
    }
    let arrowTop: number;
    let cardTop: number;

    if (displayed.arrowDirection === 'up') {
      arrowTop = anchorBottom + cutoutPadding + arrowGap;
      cardTop = arrowTop + ARROW_SIZE + cardGap;
    } else {
      arrowTop = anchorTop - cutoutPadding - arrowGap - ARROW_SIZE;
      cardTop = arrowTop - cardGap - measuredCardHeight;
    }

    return { cardLeft, cardTop, arrowLeft, arrowTop };
  }, [displayed, arrowGap, cardGap, cutoutPadding, measuredCardHeight, screenW]);

  // Cutout backdrop: rounded-rect hole coordinates so the anchored element shows through.
  const cutout = useMemo(() => {
    if (!displayed.anchorRect) return null;
    const padding = cutoutPadding;
    const holeLeft = Math.max(0, displayed.anchorRect.x - padding);
    const holeRight = Math.min(screenW, displayed.anchorRect.x + displayed.anchorRect.width + padding);
    const holeTop = Math.max(0, displayed.anchorRect.y - padding);
    const holeBottom = Math.min(screenH, displayed.anchorRect.y + displayed.anchorRect.height + padding);
    return {
      hole: { left: holeLeft, top: holeTop, width: holeRight - holeLeft, height: holeBottom - holeTop },
    };
  }, [displayed, cutoutPadding, screenW, screenH]);

  if (!modalMounted || !displayed.anchorRect || !positions || !cutout) return null;

  return (
    <Modal
      visible={modalMounted}
      transparent
      animationType="none"
      statusBarTranslucent={Platform.OS === 'android'}
      onRequestClose={() => {
        // No back-button dismiss — Next/Done only.
      }}
    >
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {/* Backdrop: SVG with cutout + a dark rect that fills the hole during
            Phase A. The whole wrapper fades via backdropOpacity in Phase B/C. */}
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]}
          pointerEvents="box-none"
        >
          <Svg
            width={screenW}
            height={screenH}
            style={StyleSheet.absoluteFill as any}
            pointerEvents="auto"
          >
            <Path
              d={buildCutoutPath(screenW, screenH, cutout.hole, cutoutRadius)}
              fill={BACKDROP_COLOR}
              fillRule="evenodd"
            />
          </Svg>
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: cutout.hole.left,
              top: cutout.hole.top,
              width: cutout.hole.width,
              height: cutout.hole.height,
              backgroundColor: BACKDROP_COLOR,
              borderRadius: cutoutRadius,
              opacity: holeCoverOpacity,
            }}
          />
        </Animated.View>

        {/* Hole tap target — only active when not mid-transition so a late
            double-tap doesn't trigger the next step's handler. */}
        <Pressable
          style={[{ position: 'absolute' }, cutout.hole]}
          onPress={displayedHeld ? undefined : onAnchorPress}
        />

        {/* Tooltip card + arrow — opacity only, no slide. */}
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: contentOpacity }]}
          pointerEvents={displayedHeld ? 'none' : 'box-none'}
        >
          {extraContent}
          <TutorialArrow
            direction={displayed.arrowDirection}
            left={positions.arrowLeft}
            top={positions.arrowTop}
            color="#F7F7F7"
          />
          <View
            style={{ position: 'absolute', left: positions.cardLeft, top: positions.cardTop }}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              if (h && Math.abs(h - measuredCardHeight) > 1) setMeasuredCardHeight(h);
            }}
          >
            <TutorialTooltipCard
              step={displayed.step}
              total={total}
              title={displayed.title}
              body={displayed.body}
              ctaLabel={displayed.ctaLabel}
              onPressCta={onPressCta}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

function buildCutoutPath(
  screenW: number,
  screenH: number,
  hole: { left: number; top: number; width: number; height: number },
  radius: number,
): string {
  const outer = `M0 0 H${screenW} V${screenH} H0 Z`;
  const x = hole.left;
  const y = hole.top;
  const w = hole.width;
  const h = hole.height;
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  // Rounded-rect sub-path traced counter-clockwise so evenodd creates a hole.
  const inner =
    `M${x + r} ${y} ` +
    `H${x + w - r} ` +
    `Q${x + w} ${y} ${x + w} ${y + r} ` +
    `V${y + h - r} ` +
    `Q${x + w} ${y + h} ${x + w - r} ${y + h} ` +
    `H${x + r} ` +
    `Q${x} ${y + h} ${x} ${y + h - r} ` +
    `V${y + r} ` +
    `Q${x} ${y} ${x + r} ${y} ` +
    `Z`;
  return `${outer} ${inner}`;
}
