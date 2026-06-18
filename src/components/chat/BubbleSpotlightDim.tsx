import React from 'react';
import { Pressable, StyleSheet, Dimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { buildDimPathD, DEFAULT_RADII, type BubbleRadii } from '../MessageActionsMenu';

export interface SpotlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
  radii?: BubbleRadii;
}

interface Props {
  /** Bubble bounds in window coords to keep "lit" (a hole in the dim). */
  rect: SpotlightRect;
  /** Tap anywhere on the dimmed area to dismiss (e.g. cancel edit). */
  onPress: () => void;
}

/**
 * Full-bleed dim with a rounded-rect hole over one message bubble — the exact
 * WhatsApp "lift" used by the long-press menu, reused for edit mode so the rest
 * of the chat darkens while the message being edited stays fully visible.
 * Rendered in-tree (NOT a Modal) so the composer/edit bar can sit on top of it.
 */
export function BubbleSpotlightDim({ rect, onPress }: Props) {
  const { width: screenW, height: screenH } = Dimensions.get('window');
  return (
    <Pressable style={StyleSheet.absoluteFill} onPress={onPress}>
      <Svg pointerEvents="none" width={screenW} height={screenH} style={StyleSheet.absoluteFill}>
        <Path
          d={buildDimPathD(screenW, screenH, rect.x, rect.y, rect.width, rect.height, rect.radii ?? DEFAULT_RADII)}
          fill="rgba(0, 0, 0, 0.3)"
          fillRule="evenodd"
        />
      </Svg>
    </Pressable>
  );
}
