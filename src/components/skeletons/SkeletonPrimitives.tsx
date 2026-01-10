import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { Shimmer } from './Shimmer';

/**
 * Base skeleton component - a simple rounded rectangle
 */
interface SkeletonBaseProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export const SkeletonBase: React.FC<SkeletonBaseProps> = ({
  width = '100%',
  height = 20,
  borderRadius = 4,
  style,
}) => {
  return (
    <Shimmer>
      <View
        style={[
          {
            width,
            height,
            borderRadius,
            backgroundColor: '#E4E4E4',
          },
          style,
        ]}
        accessibilityRole="none"
        importantForAccessibility="no"
      />
    </Shimmer>
  );
};

/**
 * Avatar skeleton - circular placeholder
 */
interface AvatarSkeletonProps {
  size?: number;
  style?: ViewStyle;
}

export const AvatarSkeleton: React.FC<AvatarSkeletonProps> = ({
  size = 52,
  style,
}) => {
  return (
    <SkeletonBase
      width={size}
      height={size}
      borderRadius={size / 2}
      style={style}
    />
  );
};

/**
 * Text skeleton - rectangular placeholder for text
 */
interface TextSkeletonProps {
  width?: number | string;
  height?: number;
  style?: ViewStyle;
}

export const TextSkeleton: React.FC<TextSkeletonProps> = ({
  width = '100%',
  height = 16,
  style,
}) => {
  return (
    <SkeletonBase
      width={width}
      height={height}
      borderRadius={4}
      style={style}
    />
  );
};

/**
 * Multi-line text skeleton
 */
interface MultiLineTextSkeletonProps {
  lines?: number;
  lineHeight?: number;
  lineSpacing?: number;
  width?: number | string;
  lastLineWidth?: number | string;
  style?: ViewStyle;
}

export const MultiLineTextSkeleton: React.FC<MultiLineTextSkeletonProps> = ({
  lines = 3,
  lineHeight = 16,
  lineSpacing = 8,
  width = '100%',
  lastLineWidth = '70%',
  style,
}) => {
  return (
    <View style={[{ gap: lineSpacing }, style]}>
      {Array.from({ length: lines }).map((_, index) => (
        <TextSkeleton
          key={index}
          width={index === lines - 1 ? lastLineWidth : width}
          height={lineHeight}
        />
      ))}
    </View>
  );
};

