import React from 'react';
import { View, StyleProp, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

// Single tick for the "sent, not confirmed yet" read-receipt state.
//
// The geometry is traced from src/assets/images/double-tick.png (294x163) so
// the single tick is pixel-identical to that image's LEFT check: same stroke
// width, same 45° arms, same round caps/joins. Measured centres:
//   start (16.5, 74.5) → elbow (79.5, 145.5) → tip (208, 16.5), stroke 33.
// With round caps the stroked bounds are exactly 0..224.5 x 0..162 — hence the
// viewBox below.
const VB_W = 224.5;
const VB_H = 162;

// The double tick renders as <Image size x size, resizeMode="contain">, i.e.
// scaled by size/294. Reusing that same scale here keeps both ticks the same
// height, so swapping one for the other never shifts the bubble's layout.
const PNG_W = 294;

interface SingleTickIconProps {
  /** Box size — matches the double tick's Image width/height. */
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}

export const SingleTickIcon: React.FC<SingleTickIconProps> = ({
  size = 16,
  color = '#C2C2C2',
  style,
}) => {
  const scale = size / PNG_W;
  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Svg width={VB_W * scale} height={VB_H * scale} viewBox={`0 0 ${VB_W} ${VB_H}`} fill="none">
        <Path
          d="M16.5 74.5L79.5 145.5L208 16.5"
          stroke={color}
          strokeWidth={33}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
};
