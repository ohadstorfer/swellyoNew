import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Rect, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';

interface TutorialTooltipCardProps {
  step: number;
  total: number;
  title: string;
  body: string;
  ctaLabel: string;
  onPressCta: () => void;
  style?: ViewStyle;
}

const CARD_WIDTH = 314;
const BORDER_WIDTH = 2;
const RADIUS = 24;

export const TutorialTooltipCard: React.FC<TutorialTooltipCardProps> = ({
  step,
  total,
  title,
  body,
  ctaLabel,
  onPressCta,
  style,
}) => {
  // Height is content-driven. Start with a reasonable default to avoid a flash
  // of un-bordered content before the first onLayout measurement.
  const [height, setHeight] = useState(0);

  return (
    <View
      style={[styles.wrap, style]}
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        if (h && Math.abs(h - height) > 0.5) setHeight(h);
      }}
    >
      <View style={styles.inner}>
        <View style={styles.row}>
          <View style={styles.iconBadge}>
            <Ionicons name="information-circle-outline" size={18} color="#333" />
          </View>
          <View style={styles.textCol}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.body}>{body}</Text>
          </View>
        </View>
        <View style={styles.footer}>
          <Text style={styles.progress}>{`${step}/${total}`}</Text>
          <Pressable onPress={onPressCta} hitSlop={12}>
            <Text style={styles.cta}>{ctaLabel}</Text>
          </Pressable>
        </View>
      </View>

      {/* SVG gradient border — wrapped in a pointer-events-none View so the
          SVG doesn't swallow taps on the Pressable below (react-native-svg
          doesn't always forward `pointerEvents` to the rendered element). */}
      {height > 0 && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg width={CARD_WIDTH} height={height}>
            <Defs>
              <SvgLinearGradient id="tutorial-border-grad" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#B72DF2" stopOpacity="1" />
                <Stop offset="1" stopColor="#FF5367" stopOpacity="1" />
              </SvgLinearGradient>
            </Defs>
            <Rect
              x={BORDER_WIDTH / 2}
              y={BORDER_WIDTH / 2}
              width={CARD_WIDTH - BORDER_WIDTH}
              height={height - BORDER_WIDTH}
              rx={RADIUS - BORDER_WIDTH / 2}
              ry={RADIUS - BORDER_WIDTH / 2}
              fill="none"
              stroke="url(#tutorial-border-grad)"
              strokeWidth={BORDER_WIDTH}
            />
          </Svg>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    width: CARD_WIDTH,
    borderRadius: RADIUS,
    backgroundColor: 'transparent',
    ...Platform.select({
      ios: {
        shadowColor: '#B72DF2',
        shadowOpacity: 0.24,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 10 },
      web: {
        // @ts-ignore web-only
        boxShadow: '0px 2px 14px 0px rgba(183, 45, 242, 0.24)',
      },
    }),
  },
  inner: {
    backgroundColor: '#F7F7F7',
    borderRadius: RADIUS,
    padding: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  iconBadge: {
    width: 34,
    height: 34,
    borderRadius: 28,
    backgroundColor: '#DADADA',
    borderWidth: 4,
    borderColor: '#EEEEEE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: {
    flex: 1,
    gap: 8,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: '#333333',
  },
  body: {
    fontSize: 14,
    lineHeight: 18,
    color: '#333333',
  },
  footer: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progress: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    color: '#A0A0A0',
  },
  cta: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    color: '#333333',
  },
});
