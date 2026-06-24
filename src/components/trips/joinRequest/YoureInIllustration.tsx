import React, { useEffect, useRef, useState } from 'react';
import { View, Animated, Easing, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';

// Animatable Path so we can drive strokeDashoffset from an Animated.Value.
const AnimatedPath = Animated.createAnimatedComponent(Path);

// "You're in!" doodle illustration, animated: the dashed line draws itself in
// from the left (cover-stroke + strokeDashoffset, same trick as the match
// screen) while the icons pop in ONE BY ONE along the line's path.
//
// The line lives in the Figma export's native 391×706 coord space; the icons
// are separate transparent PNGs positioned by their Figma frame coords (the
// frame is 393 wide; the illustration starts at top:84).
const LINE_PATH =
  'M-84.5 161C25 161 59.5 344.9 79.5 450.5C99.5 556.1 184.5 593.5 233 580C281.5 566.5 325.163 480.112 290.5 372.5C257 268.5 338.5 129.5 457 129.5';
const LINE_LEN_FALLBACK = 1500;
const FIGMA_W = 393;
const LINE_RATIO = 706 / 391; // SVG viewBox height / width

// Ordered the way the crawling line passes them: top-left → down → bottom →
// up to top-right. The stagger reveals them in this order.
const ICONS = [
  { key: 'sun', src: require('../../../assets/illustrations/icons/sun.png'), left: 62, top: 126, w: 63, h: 41 },
  { key: 'surfboard', src: require('../../../assets/illustrations/icons/surfboard.png'), left: 21, top: 224, w: 42, h: 42 },
  { key: 'wave', src: require('../../../assets/illustrations/icons/wave.png'), left: 55, top: 646, w: 50, h: 38 },
  { key: 'monstera', src: require('../../../assets/illustrations/icons/monstera.png'), left: 144, top: 703, w: 27, h: 27 },
  { key: 'cocktail', src: require('../../../assets/illustrations/icons/cocktail.png'), left: 204, top: 603, w: 32, h: 51 },
  { key: 'urchin', src: require('../../../assets/illustrations/icons/urchin.png'), left: 343, top: 651, w: 33, h: 32 },
  { key: 'palm', src: require('../../../assets/illustrations/icons/palm.png'), left: 325, top: 161, w: 39, h: 56 },
];

interface Props {
  /** Device width — the illustration scales from the 393-wide Figma frame. */
  screenW: number;
  /** Painted over the line to hide it before the reveal; must equal the bg. */
  coverColor?: string;
  /** Loop the whole sequence (line draw + icon stagger) — for previewing. */
  loop?: boolean;
}

export const YoureInIllustration: React.FC<Props> = ({ screenW, coverColor = '#FAFAFA', loop = false }) => {
  const k = screenW / FIGMA_W;
  const lineRef = useRef<any>(null);
  const [lineLen, setLineLen] = useState(LINE_LEN_FALLBACK);
  const offset = useRef(new Animated.Value(0)).current;
  const iconVals = useRef(ICONS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    // Line: cover retracts off the path (0 → -len) → line crawls in from the left.
    const lineDraw = Animated.timing(offset, {
      toValue: -lineLen,
      duration: 1800,
      delay: 350,
      easing: Easing.linear,
      useNativeDriver: false, // strokeDashoffset is an SVG attr
    });
    // Icons: fade + pop in, one after another, while the line draws past them.
    // Starts at the SAME 350ms as the line so they begin appearing together.
    const iconsIn = Animated.sequence([
      Animated.delay(350),
      Animated.stagger(
        190,
        iconVals.map(v =>
          Animated.timing(v, {
            toValue: 1,
            duration: 320,
            easing: Easing.out(Easing.back(1.6)),
            useNativeDriver: true,
          })
        )
      ),
    ]);

    let lineRunner: Animated.CompositeAnimation;
    let iconRunner: Animated.CompositeAnimation;
    if (loop) {
      // Real-duration "exits" (NOT duration:0) so Animated.loop re-iterates
      // reliably — a 0ms reset inside the loop left the icons stuck hidden.
      lineRunner = Animated.loop(
        Animated.sequence([
          lineDraw,
          Animated.delay(1500),
          Animated.timing(offset, { toValue: 0, duration: 500, easing: Easing.linear, useNativeDriver: false }),
          Animated.delay(150),
        ])
      );
      iconRunner = Animated.loop(
        Animated.sequence([
          iconsIn,
          Animated.delay(1450),
          Animated.parallel(iconVals.map(v => Animated.timing(v, { toValue: 0, duration: 350, useNativeDriver: true }))),
          Animated.delay(500),
        ])
      );
    } else {
      offset.setValue(0);
      iconVals.forEach(v => v.setValue(0));
      lineRunner = lineDraw;
      iconRunner = iconsIn;
    }
    lineRunner.start();
    iconRunner.start();
    return () => {
      lineRunner.stop();
      iconRunner.stop();
    };
  }, [lineLen, loop, offset, iconVals]);

  const lineRect = {
    position: 'absolute' as const,
    top: 84 * k,
    left: 0,
    width: screenW,
    height: screenW * LINE_RATIO,
  };

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* Dashed line + cover-stroke crawl. */}
      <Svg style={lineRect} viewBox="0 0 391 706" preserveAspectRatio="none">
        <Path
          d={LINE_PATH}
          stroke="#333333"
          strokeWidth={1}
          fill="none"
          strokeDasharray="6 6"
          strokeLinecap="round"
        />
        <AnimatedPath
          ref={lineRef}
          d={LINE_PATH}
          stroke={coverColor}
          strokeWidth={5}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={[lineLen, lineLen] as any}
          strokeDashoffset={offset as any}
          onLayout={() => {
            const n: any = lineRef.current;
            if (n && typeof n.getTotalLength === 'function') {
              try {
                const l = n.getTotalLength();
                if (l && l > 0) setLineLen(l);
              } catch {}
            }
          }}
        />
      </Svg>

      {/* Icons — staggered fade + pop. */}
      {ICONS.map((ic, i) => (
        <Animated.Image
          key={ic.key}
          source={ic.src}
          resizeMode="contain"
          style={{
            position: 'absolute',
            top: ic.top * k,
            left: ic.left * k,
            width: ic.w * k,
            height: ic.h * k,
            opacity: iconVals[i],
            transform: [{ scale: iconVals[i].interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
          }}
        />
      ))}
    </View>
  );
};

export default YoureInIllustration;
