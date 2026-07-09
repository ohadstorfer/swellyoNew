/**
 * contactPicker — presents the native contact picker and maps the chosen
 * contact into ContactMetadata. Returns null on cancel / denied permission /
 * unsupported platform. Display-only in v1: we capture name + phone numbers
 * (+ emails when present); we never write anything back to the address book.
 */

import { Platform, Alert, Linking } from 'react-native';
import type { ContactMetadata } from './messagingService';

export async function pickContact(): Promise<ContactMetadata | null> {
  if (Platform.OS === 'web') {
    Alert.alert('Not available', 'Sharing a contact is only supported on the mobile app.');
    return null;
  }

  // Load the module. NOTE: `require('expo-contacts')` returns a LAZY proxy and
  // does NOT throw when the native module is absent — the "Cannot find native
  // module 'ExpoContacts'" error only fires when we ACCESS a method. So every
  // native touch below lives inside a try that degrades to a friendly message
  // (covers Expo Go and any build made before the native dep was added).
  let Contacts: any;
  try {
    Contacts = require('expo-contacts');
    if (!Contacts || typeof Contacts.presentContactPickerAsync !== 'function') {
      throw new Error('ExpoContacts unavailable');
    }
  } catch {
    Alert.alert(
      'Update the app',
      'Sharing a contact needs the latest build — it isn’t available in Expo Go or an older build. Rebuild the app to use it.',
    );
    return null;
  }

  try {
    // Permission — on iOS the system contact picker returns only the chosen
    // contact and needs no permission, so we skip the prompt there. Android's
    // picker reads the address book and requires READ_CONTACTS.
    if (Platform.OS === 'android') {
      const { status, canAskAgain } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        if (canAskAgain === false) {
          Alert.alert(
            'Permission needed',
            'Swellyo needs access to your contacts to share one. Enable it in Settings.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ],
          );
        } else {
          Alert.alert('Permission needed', 'Swellyo needs access to your contacts to share one.');
        }
        return null;
      }
    }

    const contact = await Contacts.presentContactPickerAsync();
    if (!contact) return null; // user cancelled
    return toContactMetadata(contact);
  } catch (e) {
    Alert.alert(
      'Update the app',
      'Sharing a contact needs the latest build — it isn’t available in Expo Go or an older build. Rebuild the app to use it.',
    );
    return null;
  }
}

function toContactMetadata(contact: any): ContactMetadata | null {
  const display_name: string =
    (contact.name && String(contact.name).trim()) ||
    [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() ||
    'Contact';

  const phone_numbers = Array.isArray(contact.phoneNumbers)
    ? contact.phoneNumbers
        .map((p: any) => ({
          label: p?.label ? String(p.label) : undefined,
          number: String(p?.number ?? '').trim(),
        }))
        .filter((p: { number: string }) => p.number.length > 0)
    : [];

  const emails = Array.isArray(contact.emails)
    ? contact.emails
        .map((e: any) => ({
          label: e?.label ? String(e.label) : undefined,
          email: String(e?.email ?? '').trim(),
        }))
        .filter((e: { email: string }) => e.email.length > 0)
    : [];

  if (phone_numbers.length === 0 && emails.length === 0) {
    Alert.alert('No phone number', 'That contact has no phone number to share.');
    return null;
  }

  return { display_name, phone_numbers, ...(emails.length ? { emails } : {}) };
}
