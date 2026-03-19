import React from 'react';
import { View, StyleSheet, Image, Platform } from 'react-native';
import { Text } from './Text';
import { getImageUrl } from '../services/media/imageService';

const WELCOME_INTRO_TEXT =
  "Yo shredders! You two align!  I bet if you met out in the water you would have an epic chat, maybe grab some tasty burritos after a session! Wanted to make the intro! Take it from here!";

/**
 * Welcome message shown when a DM conversation is new or has no messages.
 * Matches Figma: Message Container (node 4673-7479) — light purple bubble, border, avatar on right.
 */
export const WelcomeIntroMessage: React.FC = () => {
  return (
    <View style={styles.outer}>
      <View style={styles.bubble}>
        <View style={styles.textRow}>
          <Text style={styles.text}>{WELCOME_INTRO_TEXT}</Text>
        </View>
        <View style={styles.avatarContainer}>
          <Image
            source={{ uri: getImageUrl('/Swelly welcome message.png') }}
            style={styles.avatarImage}
            resizeMode="cover"
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  outer: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  bubble: {
    maxWidth: 361,
    width: '100%',
    backgroundColor: 'rgba(202, 162, 223, 0.1)',
    borderWidth: 1,
    borderColor: '#E4E4E4',
    borderRadius: 32,
    paddingLeft: 24,
    paddingRight: 8,
    overflow: 'visible',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
  },
  textRow: {
    flex: 1,
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  text: {
    fontSize: 16,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    lineHeight: 22,
    color: '#000000',
  },
  avatarContainer: {
    alignSelf: 'flex-end',
    width: 86,
    height: 75,
    flexShrink: 0,
    overflow: 'hidden',
    borderRadius: 8,
  },
  avatarImage: {
    width: 86,
    height: 75,
    ...(Platform.OS === 'web' && {
      objectFit: 'cover' as any,
    }),
  },
});
