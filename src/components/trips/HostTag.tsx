// HostTag — small teal pill marking a host-only (admin) control or item.
// Used everywhere host powers appear so admin vs member reads instantly.

import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const FONT_BODY = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';

interface Props {
  label?: string;
  /** 'solid' = filled teal (on dark/primary actions); 'tint' = soft teal chip. */
  variant?: 'solid' | 'tint';
}

export const HostTag: React.FC<Props> = ({ label = 'Host', variant = 'tint' }) => {
  const solid = variant === 'solid';
  return (
    <View style={[styles.tag, solid ? styles.solid : styles.tint]}>
      <Ionicons
        name="shield-checkmark"
        size={11}
        color={solid ? '#FFFFFF' : '#0788B0'}
      />
      <Text style={[styles.text, solid ? styles.textSolid : styles.textTint]}>{label}</Text>
    </View>
  );
};

export default HostTag;

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  tint: { backgroundColor: '#E6F4F8' },
  solid: { backgroundColor: '#0788B0' },
  text: {
    fontFamily: FONT_BODY,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  textTint: { color: '#066b8c' },
  textSolid: { color: '#FFFFFF' },
});
