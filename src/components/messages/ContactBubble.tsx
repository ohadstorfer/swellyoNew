/**
 * ContactBubble — WhatsApp-style shared-contact card (type='contact'). Shows an
 * avatar placeholder, the name, and a phone subtitle, with a full-width "Save
 * contact" action that opens the native new-contact form prefilled (via
 * expo-contacts presentFormAsync) so the user saves it to their device — no
 * write permission needed, works on iOS and Android.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Message } from '../../services/messaging/messagingService';
import { ff, fs } from '../../theme/fonts';

interface ContactBubbleProps {
  message: Message;
  isOwn: boolean;
}

export function ContactBubble({ message, isOwn }: ContactBubbleProps) {
  const [saving, setSaving] = useState(false);
  const meta = message.contact_metadata;
  if (!meta) return null;

  const nameColor = isOwn ? '#FFFFFF' : '#1A1A1A';
  const subColor = isOwn ? 'rgba(255,255,255,0.85)' : '#6B7076';
  const avatarBg = isOwn ? 'rgba(255,255,255,0.20)' : '#E9F8FB';
  const avatarTint = isOwn ? '#FFFFFF' : '#05BCD3';
  const dividerColor = isOwn ? 'rgba(255,255,255,0.28)' : '#E4E7EA';
  const actionTint = isOwn ? '#FFFFFF' : '#05BCD3';

  const numbers = meta.phone_numbers ?? [];
  const subtitle =
    numbers.length === 0
      ? (meta.emails?.[0]?.email ?? 'No phone number')
      : numbers.length === 1
        ? numbers[0].number
        : `${numbers.length} phone numbers`;

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const Contacts = require('expo-contacts');
      if (!Contacts || typeof Contacts.presentFormAsync !== 'function') {
        throw new Error('ExpoContacts unavailable');
      }
      const parts = meta.display_name.trim().split(/\s+/);
      const firstName = parts.shift() || meta.display_name;
      const lastName = parts.join(' ');
      const contact: any = {
        name: meta.display_name,
        firstName,
        contactType: Contacts.ContactTypes?.Person,
        phoneNumbers: numbers.map(p => ({ label: p.label || 'mobile', number: p.number })),
      };
      if (lastName) contact.lastName = lastName;
      if (meta.emails?.length) {
        contact.emails = meta.emails.map(e => ({ label: e.label || 'home', email: e.email }));
      }
      // contactId=null + contact => native "new contact" form, user taps Save.
      await Contacts.presentFormAsync(null, contact);
    } catch {
      Alert.alert(
        'Update the app',
        'Saving a contact needs the latest build — it isn’t available in Expo Go or an older build. Rebuild the app to use it.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={[styles.avatar, { backgroundColor: avatarBg }]}>
          <Ionicons name="person" size={24} color={avatarTint} />
        </View>
        <View style={styles.headerText}>
          <Text numberOfLines={1} style={[styles.name, { color: nameColor }]}>
            {meta.display_name}
          </Text>
          <Text numberOfLines={1} style={[styles.subtitle, { color: subColor }]}>
            {subtitle}
          </Text>
        </View>
      </View>

      <Pressable
        onPress={handleSave}
        style={[styles.saveRow, { borderTopColor: dividerColor }]}
        android_ripple={{ color: 'rgba(0,0,0,0.06)' }}
      >
        {saving ? (
          <ActivityIndicator size="small" color={actionTint} />
        ) : (
          <Ionicons name="person-add-outline" size={16} color={actionTint} />
        )}
        <Text style={[styles.saveText, { color: actionTint }]}>Save contact</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minWidth: 200,
    maxWidth: 250,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 10,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  headerText: {
    flex: 1,
  },
  name: {
    fontFamily: ff('Inter', '600'),
    fontSize: fs(15),
    includeFontPadding: false,
  },
  subtitle: {
    fontFamily: ff('Inter', '400'),
    fontSize: fs(12),
    marginTop: 2,
    includeFontPadding: false,
  },
  saveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 9,
  },
  saveText: {
    fontFamily: ff('Inter', '600'),
    fontSize: fs(13),
    includeFontPadding: false,
  },
});
