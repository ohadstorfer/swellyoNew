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
/** Guards the staged-id path segment against traversal (`../`) before we touch the FS. */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

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
 * iOS only: read + delete the staged payload the share extension wrote.
 * Deleting before returning makes the read idempotent — a cold start's
 * getInitialURL and a warm 'url' event can both fire for one share.
 */
export async function loadStagedShare(stagedId: string): Promise<PendingShare | null> {
  if (Platform.OS !== 'ios') return null;
  if (!UUID_RE.test(stagedId)) return null;
  try {
    const { Paths, File } = require('expo-file-system');
    const container = Paths.appleSharedContainers?.[APP_GROUP];
    if (!container) return null;

    const file = new File(container, 'share', 'pending', `${stagedId}.json`);
    if (!file.exists) return null;
    const raw = file.textSync();
    try {
      file.delete();
    } catch {
      // A payload we can read but not delete would replay on next launch; the
      // 24h expiry bounds that, and the picker's consume() bounds it per-run.
    }
    return normalizeStagedPayload(JSON.parse(raw), Date.now());
  } catch (e) {
    console.warn('[shareIntake] loadStagedShare failed:', e);
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
