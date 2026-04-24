import React from 'react';
import Svg, { Path } from 'react-native-svg';

interface TutorialArrowProps {
  direction: 'up' | 'down';
  left: number;
  top: number;
  color?: string;
}

const WIDTH = 27;
const HEIGHT = 16;

export const TutorialArrow: React.FC<TutorialArrowProps> = ({
  direction,
  left,
  top,
  color = '#F7F7F7',
}) => {
  return (
    <Svg
      width={WIDTH}
      height={HEIGHT}
      viewBox="0 0 27 16"
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: left - WIDTH / 2,
        top,
        ...(direction === 'down' ? { transform: [{ rotate: '180deg' }] } : null),
      }}
    >
      <Path
        d="M10.3686 2.08447C11.7179 0.694828 12.3926 5.54323e-06 13.2383 5.54323e-06C14.084 5.54323e-06 14.7587 0.694829 16.108 2.08448L22.6701 8.84252C25.4823 11.7388 26.8885 13.1869 26.3721 14.408C25.8558 15.629 23.8373 15.629 19.8003 15.629L6.67623 15.629C2.63926 15.629 0.620781 15.629 0.104445 14.408C-0.411891 13.1869 0.994239 11.7388 3.8065 8.84252L10.3686 2.08447Z"
        fill={color}
      />
    </Svg>
  );
};
