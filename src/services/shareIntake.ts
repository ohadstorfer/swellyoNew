/**
 * shareIntake — the app-side half of "Share to Swellyo".
 *
 * A share can arrive three ways:
 *  - Android ACTION_SEND (expo-share-intent hands us text/files in-process)
 *  - iOS extension fallback: swellyo://share?staged=<uuid> + a JSON payload the
 *    extension wrote into the App Group container
 *  - (inline iOS sends never reach this module — the extension already sent)
 *
 * All of them normalize into PendingShare, held in a module-level store until
 * the user is authenticated + onboarded and the picker screen consumes it.
 * Staged payloads older than 24h are discarded.
 *
 * The store is module-level rather than navigation params because a share can
 * arrive before the navigator exists (cold start) and must survive the login +
 * onboarding gate.
 */

import { Platform } from 'react-native';
import type { ContactMetadata } from './messaging/messagingService';
import { parseVCard } from './messaging/vcardParser';

export type PendingShare =
  | { kind: 'contact'; contact: ContactMetadata }
  | { kind: 'text'; text: string }
  | { kind: 'url'; url: string }
  | { kind: 'media'; files: { uri: string; mimeType: string }[] };

const MAX_AGE_MS = 24 * 3600_000;
const APP_GROUP = 'group.com.swellyo.app';
const URL_ONLY = /^https?:\/\/\S+$/i;

let pending: PendingShare | null = null;
const listeners = new Set<() => void>();

export function setPendingShare(share: PendingShare): void {
  pending = share;
  listeners.forEach(cb => cb());
}

export function consumePendingShare(): PendingShare | null {
  const p = pending;
  pending = null;
  return p;
}

export function hasPendingShare(): boolean {
  return pending !== null;
}

export function subscribePendingShare(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function toFileUri(p: string): string {
  return p.startsWith('file://') ? p : `file://${p}`;
}

function classifyText(text: string): PendingShare | null {
  const t = text.trim();
  if (!t) return null;
  return URL_ONLY.test(t) ? { kind: 'url', url: t } : { kind: 'text', text: t };
}

/** Pure — the shape the iOS extension writes (SharedStore.stage) → PendingShare. */
export function normalizeStagedPayload(json: unknown, nowMs: number): PendingShare | null {
  if (!json || typeof json !== 'object') return null;
  const p = json as Record<string, unknown>;

  const createdAt = Date.parse(String(p.createdAt ?? ''));
  if (!Number.isFinite(createdAt) || nowMs - createdAt > MAX_AGE_MS) return null;

  switch (p.kind) {
    case 'contact': {
      const contact = parseVCard(String(p.vcardRaw ?? ''));
      return contact ? { kind: 'contact', contact } : null;
    }
    case 'url': {
      const url = String(p.url ?? '').trim();
      return url ? { kind: 'url', url } : null;
    }
    case 'text':
      return classifyText(String(p.text ?? ''));
    case 'media': {
      const files = Array.isArray(p.files)
        ? (p.files as any[])
            .map(f => ({
              uri: toFileUri(String(f?.path ?? '')),
              mimeType: String(f?.mimeType ?? 'application/octet-stream'),
            }))
            .filter(f => f.uri !== 'file://')
        : [];
      return files.length ? { kind: 'media', files } : null;
    }
    default:
      return null;
  }
}

/**
 * Pure: from the raw staged JSONs found in the pending dir, return the newest
 * one that still normalizes (valid, unexpired). The extension stages one
 * payload per share, so multiples mean earlier shares never got delivered —
 * the user's intent is the most recent one.
 */
export function pickNewestStaged(raws: unknown[], nowMs: number): PendingShare | null {
  const byNewest = [...raws].sort(
    (a: any, b: any) =>
      (Date.parse(String(b?.createdAt ?? '')) || 0) - (Date.parse(String(a?.createdAt ?? '')) || 0),
  );
  for (const raw of byNewest) {
    const p = normalizeStagedPayload(raw, nowMs);
    if (p) return p;
  }
  return null;
}

/**
 * iOS only: sweep the App Group pending dir for anything the share extension
 * staged, and clear it.
 *
 * This is deliberately id-agnostic. The deep link (swellyo://share) is only a
 * wake-up signal — delivery must not depend on it, because the extension's way
 * of opening the app (the responder-chain openURL workaround) is unsanctioned
 * and allowed to fail. AppContent calls this on every launch too, so a share
 * whose app-open failed is delivered the next time the user opens Swellyo.
 *
 * Media files are copied OUT of the shared container into the app's own cache
 * before the pending dir is wiped, so a composer holding one can never lose it
 * to a later sweep, and the shared container never accumulates.
 */
export async function sweepStagedShare(): Promise<PendingShare | null> {
  if (Platform.OS !== 'ios') return null;
  try {
    const { Paths, File, Directory } = require('expo-file-system');
    const container = Paths.appleSharedContainers?.[APP_GROUP];
    if (!container) return null;

    const pendingDir = new Directory(container, 'share', 'pending');
    if (!pendingDir.exists) return null;

    const entries = pendingDir.list();

    // Read then delete every staged JSON — the read is the handoff.
    const raws: unknown[] = [];
    for (const entry of entries) {
      if (!(entry instanceof File) || !entry.name.endsWith('.json')) continue;
      try {
        raws.push(JSON.parse(entry.textSync()));
      } catch {
        // unreadable json: discard below with the delete
      }
      try {
        entry.delete();
      } catch {}
    }

    let share = pickNewestStaged(raws, Date.now());

    // Rescue the winning payload's media into app-private cache.
    if (share?.kind === 'media') {
      const cacheDir = new Directory(Paths.cache, 'incoming-share');
      if (!cacheDir.exists) cacheDir.create({ intermediates: true });
      const rescued: { uri: string; mimeType: string }[] = [];
      for (const f of share.files) {
        try {
          const src = new File(f.uri);
          if (!src.exists) continue;
          const dst = new File(cacheDir, src.name);
          if (dst.exists) dst.delete();
          src.copy(dst);
          rescued.push({ uri: dst.uri, mimeType: f.mimeType });
        } catch (e) {
          console.warn('[shareIntake] media rescue failed:', e);
        }
      }
      share = rescued.length ? { kind: 'media', files: rescued } : null;
    }

    // Everything left in pending/ is consumed or expired — wipe it.
    for (const entry of entries) {
      if (entry instanceof Directory) {
        try {
          entry.delete();
        } catch {}
      }
    }

    return share;
  } catch (e) {
    console.warn('[shareIntake] sweepStagedShare failed:', e);
    return null;
  }
}

/**
 * Android: map expo-share-intent's ShareIntent to PendingShare. The Contacts
 * app shares a .vcf as a file stream typed text/x-vcard | text/vcard |
 * text/directory, so a vCard arrives as a file, never as `text`.
 */
export async function normalizeAndroidShareIntent(si: {
  text?: string | null;
  webUrl?: string | null;
  files?: { path: string; mimeType: string }[] | null;
} | null): Promise<PendingShare | null> {
  if (!si) return null;
  try {
    const files = si.files ?? [];

    const vcf = files.find(
      f => /vcard|directory/i.test(f?.mimeType ?? '') || (f?.path ?? '').toLowerCase().endsWith('.vcf'),
    );
    if (vcf) {
      const { File } = require('expo-file-system');
      const raw = await new File(toFileUri(vcf.path)).text();
      const contact = parseVCard(raw);
      return contact ? { kind: 'contact', contact } : null;
    }

    if (files.length) {
      const mapped = files
        .map(f => ({
          uri: toFileUri(String(f?.path ?? '')),
          mimeType: f?.mimeType || 'application/octet-stream',
        }))
        .filter(f => f.uri !== 'file://');
      if (mapped.length) return { kind: 'media', files: mapped };
    }

    if (si.webUrl) return { kind: 'url', url: si.webUrl };
    if (si.text) return classifyText(si.text);
    return null;
  } catch (e) {
    console.warn('[shareIntake] normalizeAndroidShareIntent failed:', e);
    return null;
  }
}
