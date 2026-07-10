/**
 * shareRecentsCache — writes the 12 most recent conversations into the App
 * Group container so the iOS share extension can render its picker without a
 * network round trip. Order = conversationRecency, the same comparator the
 * inbox uses, so the sheet matches what the user just saw.
 *
 * Sends are keyed on conversation id, which never changes, so a stale title or
 * avatar is cosmetic. A deleted conversation yields an FK error in the
 * extension → it falls back to opening the app.
 *
 * supabaseUrl/anonKey ride along so the Swift extension needs no build-time
 * config. The anon key is public by design (RLS is the boundary, not secrecy).
 *
 * iOS only; no-ops everywhere else and in Expo Go (no shared container there).
 */

import { Platform } from 'react-native';
import type { Conversation } from './messaging/messagingService';
import { conversationRecency } from '../context/conversationReducer';
import { getStorageThumbUrl } from './media/imageService';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config/supabase';

const APP_GROUP = 'group.com.swellyo.app';
const MAX_RECENTS = 12;

interface SharedFs {
  container: any;
  File: any;
  Directory: any;
}

function sharedFs(): SharedFs | null {
  if (Platform.OS !== 'ios') return null;
  try {
    const { Paths, File, Directory } = require('expo-file-system');
    const container = Paths.appleSharedContainers?.[APP_GROUP];
    return container ? { container, File, Directory } : null;
  } catch {
    return null;
  }
}

function titleOf(c: Conversation): string {
  if (c.is_direct) return c.other_user?.name || 'Chat';
  return c.title || c.metadata?.title || 'Group';
}

function avatarOf(c: Conversation): string | null {
  const raw = c.is_direct ? c.other_user?.profile_image_url : c.metadata?.image_url;
  return getStorageThumbUrl(raw, 96);
}

export function writeShareRecents(conversations: Conversation[], userId: string): void {
  const fsys = sharedFs();
  if (!fsys || !SUPABASE_URL || !SUPABASE_ANON_KEY) return;

  try {
    const top = [...conversations]
      .sort((a, b) => conversationRecency(b) - conversationRecency(a))
      .slice(0, MAX_RECENTS)
      .map(c => ({
        id: c.id,
        title: titleOf(c),
        avatarUrl: avatarOf(c),
        isDirect: !!c.is_direct,
      }));

    const dir = new fsys.Directory(fsys.container, 'share');
    if (!dir.exists) dir.create({ intermediates: true });

    const file = new fsys.File(dir, 'recents.json');
    file.write(
      JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        supabaseUrl: SUPABASE_URL,
        anonKey: SUPABASE_ANON_KEY,
        userId,
        conversations: top,
      }),
    );
  } catch (e) {
    if (__DEV__) console.warn('[shareRecentsCache] write failed:', e);
  }
}

/** Logout: the next person to open the share sheet must not see the last user's chats. */
export function clearShareRecents(): void {
  const fsys = sharedFs();
  if (!fsys) return;
  try {
    const file = new fsys.File(fsys.container, 'share', 'recents.json');
    if (file.exists) file.delete();
  } catch {
    // best effort
  }
  // Any payload staged but never consumed belongs to the previous session too.
  try {
    const pending = new fsys.Directory(fsys.container, 'share', 'pending');
    if (pending.exists) pending.delete();
  } catch {
    // best effort
  }
}
