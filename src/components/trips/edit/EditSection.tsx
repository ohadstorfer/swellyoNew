import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ff } from '../../../theme/fonts';

export const EditSection: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <View style={styles.section}>
    <Text style={styles.title}>{title}</Text>
    <View style={styles.rows}>{children}</View>
  </View>
);

const styles = StyleSheet.create({
  section: { marginTop: 28 },
  title: {
    fontFamily: ff('Inter', '700'),
    fontSize: 13,
    letterSpacing: 0.6,
    color: '#7B7B7B',
    textTransform: 'uppercase',
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  rows: { backgroundColor: '#FFFFFF' },
});
