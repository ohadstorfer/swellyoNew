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
  /** Delay before the overlay fades in, in ms. */
  enterDelay?: number;
  /** Fade duration, in ms. */
  fadeDuration?: number;
  /** Optional tap handler for the anchor (hole) region. If absent, hole blocks taps. */
  onAnchorPress?: () => void;
  /** Horizontal position of the arrow within the card. Defaults to 'center'. */
  arrowAlignment?: 'left' | 'center' | 'right';
}

const CARD_WIDTH = 314;
const ARROW_SIZE = 16;
const SCREEN_MARGIN = 16;
const BACKDROP_COLOR = 'rgba(1, 0, 0, 0.7)';

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
  fadeDuration = 280,
  onAnchorPress,
  arrowAlignment = 'center',
}) => {
  const { width: screenW, height: screenH } = Dimensions.get('window');
  const opacity = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const [measuredCardHeight, setMeasuredCardHeight] = useState(160);
  const [modalMounted, setModalMounted] = useState(false);

  // When step changes while the overlay is already mounted, do a quick content
  // crossfade so the arrow/card/hole don't snap harshly into the next position.
  const prevStepRef = useRef(step);
  useEffect(() => {
    if (prevStepRef.current !== step && modalMounted && visible) {
      Animated.sequence([
        Animated.timing(contentOpacity, {
          toValue: 0,
          duration: 150,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    }
    prevStepRef.current = step;
  }, [step, modalMounted, visible, contentOpacity]);

  // Mount → animate in (with delay). Unmount on hide.
  useEffect(() => {
    if (visible) {
      setModalMounted(true);
      opacity.setValue(0);
      const timer = setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 1,
          duration: fadeDuration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      }, enterDelay);
      return () => clearTimeout(timer);
    } else {
      Animated.timing(opacity, {
        toValue: 0,
        duration: fadeDuration,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setModalMounted(false);
      });
    }
  }, [visible, enterDelay, fadeDuration, opacity]);

  const positions = useMemo(() => {
    if (!anchorRect) return null;
    const anchorCenterX = anchorRect.x + anchorRect.width / 2;
    const anchorTop = anchorRect.y;
    const anchorBottom = anchorRect.y + anchorRect.height;

    let cardLeft = anchorCenterX - CARD_WIDTH / 2;
    cardLeft = Math.max(SCREEN_MARGIN, Math.min(cardLeft, screenW - CARD_WIDTH - SCREEN_MARGIN));

    const ARROW_EDGE_INSET = 40;
    let arrowLeft: number;
    if (arrowAlignment === 'right') {
      arrowLeft = cardLeft + CARD_WIDTH - ARROW_EDGE_INSET;
    } else if (arrowAlignment === 'left') {
      arrowLeft = cardLeft + ARROW_EDGE_INSET;
    } else {
      arrowLeft = anchorCenterX;
    }
    let arrowTop: number;
    let cardTop: number;

    if (arrowDirection === 'up') {
      arrowTop = anchorBottom + cutoutPadding + arrowGap;
      cardTop = arrowTop + ARROW_SIZE + cardGap;
    } else {
      arrowTop = anchorTop - cutoutPadding - arrowGap - ARROW_SIZE;
      cardTop = arrowTop - cardGap - measuredCardHeight;
    }

    return { cardLeft, cardTop, arrowLeft, arrowTop };
  }, [anchorRect, arrowDirection, arrowGap, cardGap, cutoutPadding, measuredCardHeight, screenW, arrowAlignment]);

  // Cutout backdrop: rounded-rect hole coordinates so the anchored element shows through.
  const cutout = useMemo(() => {
    if (!anchorRect) return null;
    const padding = cutoutPadding;
    const holeLeft = Math.max(0, anchorRect.x - padding);
    const holeRight = Math.min(screenW, anchorRect.x + anchorRect.width + padding);
    const holeTop = Math.max(0, anchorRect.y - padding);
    const holeBottom = Math.min(screenH, anchorRect.y + anchorRect.height + padding);
    return {
      hole: { left: holeLeft, top: holeTop, width: holeRight - holeLeft, height: holeBottom - holeTop },
    };
  }, [anchorRect, cutoutPadding, screenW, screenH]);

  if (!modalMounted || !anchorRect || !positions || !cutout) return null;

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
      <Animated.View style={[StyleSheet.absoluteFill, { opacity }]} pointerEvents="box-none">
        {/* Backdrop: single full-screen SVG with a rounded-rect cutout.
            Uses fill-rule="evenodd" with a combined path (outer screen rect + inner
            rounded-rect sub-path) — avoids the <Mask>/<Defs> crash in react-native-svg. */}
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

        {/* Hole: optional tap handler (step 2 uses this to tap Swelly card). Sits on top
            of the SVG so taps in this region reach the Pressable instead of the SVG. */}
        <Pressable
          style={[{ position: 'absolute' }, cutout.hole]}
          onPress={onAnchorPress}
        />

        {/* Arrow + tooltip card share an opacity so they crossfade on step swap */}
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: contentOpacity }]}
          pointerEvents="box-none"
        >
          <TutorialArrow
            direction={arrowDirection}
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
              step={step}
              total={total}
              title={title}
              body={body}
              ctaLabel={ctaLabel}
              onPressCta={onPressCta}
            />
          </View>
        </Animated.View>
      </Animated.View>
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
