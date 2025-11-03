import React from 'react';
import { Text as RNText, TextProps as RNTextProps, StyleSheet } from 'react-native';
import { colors, typography } from '../styles/theme';

interface TextProps extends RNTextProps {
  variant?: 'headline' | 'title' | 'tagline' | 'body' | 'link';
  color?: string;
}

export const Text: React.FC<TextProps> = ({
  variant = 'body',
  color,
  style,
  children,
  ...props
}) => {
  return (
    <RNText
      style={[
        styles.base,
        styles[variant],
        color && { color },
        style,
      ]}
      {...props}
    >
      {children}
    </RNText>
  );
};

const styles = StyleSheet.create({
  base: {
    fontFamily: 'System',
  },
  headline: {
    ...typography.headline,
    color: colors.textMedium,
  },
  title: {
    ...typography.title,
    color: colors.textDark,
    textAlign: 'center',
  },
  tagline: {
    ...typography.tagline,
    color: colors.textMedium,
    textAlign: 'center',
  },
  body: {
    ...typography.body,
    color: colors.textDark,
  },
  link: {
    ...typography.link,
    color: colors.textLight,
    textDecorationLine: 'underline',
  },
}); 