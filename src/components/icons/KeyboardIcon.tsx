import React from 'react';
import Svg, { Rect } from 'react-native-svg';

interface KeyboardIconProps {
  size?: number;
  color?: string;
}

// Flat geometric keyboard glyph rebuilt as SVG rects (rounded-rect body,
// 4 keys on the top row, 4 on the middle row, a centered spacebar). Replaces
// MaterialCommunityIcons "keyboard-outline" on the chat composer's attach
// button so the "return to keyboard" affordance matches our own icon style.
export const KeyboardIcon: React.FC<KeyboardIconProps> = ({ size = 26, color = '#222B30' }) => {
  const key = (x: number, y: number, w: number, h = 2) => (
    <Rect x={x} y={y} width={w} height={h} rx={0.7} ry={0.7} fill={color} />
  );

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Body outline */}
      <Rect
        x={1.5}
        y={5}
        width={21}
        height={14}
        rx={3}
        ry={3}
        stroke={color}
        strokeWidth={1.5}
        fill="none"
      />
      {/* Top row — 4 keys */}
      {key(4, 7.7, 2.6)}
      {key(8.47, 7.7, 2.6)}
      {key(12.93, 7.7, 2.6)}
      {key(17.4, 7.7, 2.6)}
      {/* Middle row — 4 keys */}
      {key(4, 11, 2.6)}
      {key(8.47, 11, 2.6)}
      {key(12.93, 11, 2.6)}
      {key(17.4, 11, 2.6)}
      {/* Spacebar */}
      {key(6, 14.3, 12)}
    </Svg>
  );
};
