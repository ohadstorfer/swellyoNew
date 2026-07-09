/**
 * documentPicker — presents the native file picker, validates the choice
 * against the attachment policy, and returns a normalized descriptor ready for
 * upload. Returns null on cancel / invalid file / unavailable native module.
 *
 * Like expo-contacts, `require('expo-document-picker')` returns a LAZY proxy
 * that only throws "Cannot find native module 'ExpoDocumentPicker'" when a
 * method is ACCESSED — so every native touch lives inside a guarded try that
 * degrades to a friendly message (covers Expo Go / builds predating the dep).
 */

import { Platform, Alert } from 'react-native';
import { validateFile } from './fileAttachmentPolicy';

export interface PickedDocument {
  uri: string;
  display_name: string;
  ext: string;
  mime_type: string;
  size_bytes: number;
}

export async function pickDocument(): Promise<PickedDocument | null> {
  if (Platform.OS === 'web') {
    // Web uses a hidden <input type=file> elsewhere; not wired for docs in v1.
    Alert.alert('Not available', 'File attachments are only supported on the mobile app.');
    return null;
  }

  let DocumentPicker: any;
  try {
    DocumentPicker = require('expo-document-picker');
    if (!DocumentPicker || typeof DocumentPicker.getDocumentAsync !== 'function') {
      throw new Error('ExpoDocumentPicker unavailable');
    }
  } catch {
    Alert.alert(
      'Update the app',
      'Sending a file needs the latest build — it isn’t available in Expo Go or an older build. Rebuild the app to use it.',
    );
    return null;
  }

  let result: any;
  try {
    result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: '*/*',
    });
  } catch {
    Alert.alert(
      'Update the app',
      'Sending a file needs the latest build — it isn’t available in Expo Go or an older build. Rebuild the app to use it.',
    );
    return null;
  }

  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset?.uri) return null;

  const v = validateFile(asset.name ?? 'file', asset.size ?? 0);
  if (!v.ok) {
    Alert.alert('Can’t send this file', v.reason);
    return null;
  }

  return {
    uri: asset.uri,
    display_name: v.displayName,
    ext: v.ext,
    mime_type: asset.mimeType || v.contentType,
    size_bytes: asset.size ?? 0,
  };
}
