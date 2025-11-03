import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Path, Circle, Rect, Defs, LinearGradient, Stop, G } from 'react-native-svg';
import { colors } from '../styles/theme';

interface SurfLevelIconProps {
  level: 'dipping' | 'cruising' | 'snapping' | 'charging';
  size?: number;
  selected?: boolean;
}

export const SurfLevelIcon: React.FC<SurfLevelIconProps> = ({
  level,
  size = 80,
  selected = false,
}) => {
  const renderIcon = () => {
    switch (level) {
      case 'dipping':
        return (
          <Svg width={size} height={size} viewBox="0 0 80 80">
            <Defs>
              <LinearGradient id="dippingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#87CEEB" />
                <Stop offset="100%" stopColor="#4682B4" />
              </LinearGradient>
              <LinearGradient id="sandGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#F4A460" />
                <Stop offset="100%" stopColor="#D2691E" />
              </LinearGradient>
            </Defs>
            
            {/* Water */}
            <Path
              d="M 10 50 Q 20 45 30 50 Q 40 55 50 50 Q 60 45 70 50 L 70 70 L 10 70 Z"
              fill="url(#dippingGradient)"
            />
            
            {/* Sand island */}
            <Path
              d="M 25 60 Q 35 55 45 60 Q 55 65 65 60 L 65 70 L 25 70 Z"
              fill="url(#sandGradient)"
            />
            
            {/* Small wave */}
            <Path
              d="M 15 45 Q 25 40 35 45 Q 45 50 55 45 Q 65 40 75 45"
              stroke="#FFFFFF"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />
            
            {/* Footprint */}
            <Circle cx="40" cy="65" r="3" fill="#8B4513" />
            <Circle cx="45" cy="63" r="2" fill="#8B4513" />
            <Circle cx="35" cy="63" r="2" fill="#8B4513" />
          </Svg>
        );

      case 'cruising':
        return (
          <Svg width={size} height={size} viewBox="0 0 80 80">
            <Defs>
              <LinearGradient id="cruisingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#00CED1" />
                <Stop offset="100%" stopColor="#20B2AA" />
              </LinearGradient>
              <LinearGradient id="boardGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#FF6B35" />
                <Stop offset="100%" stopColor="#E55A2B" />
              </LinearGradient>
            </Defs>
            
            {/* Gentle wave */}
            <Path
              d="M 5 55 Q 20 50 35 55 Q 50 60 65 55 Q 80 50 85 55 L 85 70 L 5 70 Z"
              fill="url(#cruisingGradient)"
            />
            
            {/* Surfboard */}
            <Path
              d="M 30 45 L 50 45 L 52 47 L 50 49 L 30 49 L 28 47 Z"
              fill="url(#boardGradient)"
            />
            
            {/* Surfer silhouette */}
            <Circle cx="40" cy="42" r="4" fill="#8B4513" />
            <Path
              d="M 40 38 L 40 45 M 36 40 L 44 40"
              stroke="#8B4513"
              strokeWidth="2"
              strokeLinecap="round"
            />
            
            {/* Palm tree */}
            <Path
              d="M 15 50 Q 15 40 20 35 Q 25 30 30 35 Q 35 40 35 50"
              stroke="#228B22"
              strokeWidth="3"
              fill="none"
            />
            <Circle cx="25" cy="32" r="3" fill="#32CD32" />
          </Svg>
        );

      case 'snapping':
        return (
          <Svg width={size} height={size} viewBox="0 0 80 80">
            <Defs>
              <LinearGradient id="snappingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#1E90FF" />
                <Stop offset="100%" stopColor="#0000CD" />
              </LinearGradient>
              <LinearGradient id="foamGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#FFFFFF" />
                <Stop offset="100%" stopColor="#F0F8FF" />
              </LinearGradient>
            </Defs>
            
            {/* Dynamic wave */}
            <Path
              d="M 5 50 Q 15 40 25 50 Q 35 60 45 50 Q 55 40 65 50 Q 75 60 85 50 L 85 70 L 5 70 Z"
              fill="url(#snappingGradient)"
            />
            
            {/* Breaking wave foam */}
            <Path
              d="M 20 45 Q 30 35 40 45 Q 50 55 60 45 Q 70 35 80 45"
              stroke="url(#foamGradient)"
              strokeWidth="4"
              fill="none"
              strokeLinecap="round"
            />
            
            {/* Surfer on wave */}
            <Path
              d="M 35 42 L 45 42 L 47 44 L 45 46 L 35 46 L 33 44 Z"
              fill="#FF6B35"
            />
            
            {/* Surfer silhouette */}
            <Circle cx="40" cy="39" r="3" fill="#8B4513" />
            <Path
              d="M 40 36 L 40 42 M 37 38 L 43 38"
              stroke="#8B4513"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            
            {/* Spray effects */}
            <Circle cx="25" cy="35" r="2" fill="#FFFFFF" opacity="0.8" />
            <Circle cx="55" cy="35" r="2" fill="#FFFFFF" opacity="0.8" />
            <Circle cx="40" cy="30" r="1.5" fill="#FFFFFF" opacity="0.6" />
          </Svg>
        );

      case 'charging':
        return (
          <Svg width={size} height={size} viewBox="0 0 80 80">
            <Defs>
              <LinearGradient id="chargingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#000080" />
                <Stop offset="100%" stopColor="#191970" />
              </LinearGradient>
              <LinearGradient id="barrelGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#4169E1" />
                <Stop offset="100%" stopColor="#1E90FF" />
              </LinearGradient>
            </Defs>
            
            {/* Massive wave */}
            <Path
              d="M 5 40 Q 15 20 25 40 Q 35 60 45 40 Q 55 20 65 40 Q 75 60 85 40 L 85 70 L 5 70 Z"
              fill="url(#chargingGradient)"
            />
            
            {/* Barrel/tube */}
            <Path
              d="M 30 35 Q 40 25 50 35 Q 60 45 70 35"
              stroke="url(#barrelGradient)"
              strokeWidth="6"
              fill="none"
              strokeLinecap="round"
            />
            
            {/* Surfer in barrel */}
            <Path
              d="M 40 38 L 50 38 L 52 40 L 50 42 L 40 42 L 38 40 Z"
              fill="#FF4500"
            />
            
            {/* Surfer silhouette */}
            <Circle cx="45" cy="35" r="2.5" fill="#8B4513" />
            <Path
              d="M 45 32.5 L 45 37.5 M 42.5 34.5 L 47.5 34.5"
              stroke="#8B4513"
              strokeWidth="1"
              strokeLinecap="round"
            />
            
            {/* Energy effects */}
            <Path
              d="M 20 25 Q 25 20 30 25 M 50 25 Q 55 20 60 25"
              stroke="#FFD700"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />
            <Circle cx="25" cy="20" r="1.5" fill="#FFD700" />
            <Circle cx="55" cy="20" r="1.5" fill="#FFD700" />
          </Svg>
        );

      default:
        return null;
    }
  };

  return (
    <View style={[
      styles.container,
      { width: size, height: size },
      selected && styles.selected
    ]}>
      {renderIcon()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: {
    transform: [{ scale: 1.05 }],
  },
}); 