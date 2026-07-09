/**
 * File attachment policy — the single source of truth for what may be attached
 * to a chat message. Pure, dependency-free, and unit-tested so the same rules
 * can be mirrored verbatim in the edge function (the real gate).
 *
 * Security posture (validation only, no scanning):
 *  - Extension allowlist; executables/scripts explicitly blocked.
 *  - 25 MB size cap.
 *  - Display name sanitized (path separators / control chars stripped) — the
 *    raw filename is NEVER used to build the storage key.
 */

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

// Extensions we accept. Keep in sync with FILE_ALLOWED in
// supabase/functions/image-upload-s3/index.ts.
export const ALLOWED_EXTS: Set<string> = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'csv', 'txt', 'rtf', 'zip',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic',
  'mp3', 'm4a', 'wav', 'mp4', 'mov',
]);

// Extensions we explicitly refuse even if somehow allow-listed. Executables,
// scripts, and browser-renderable active content (html/svg) that could run in a
// WebView or be socially engineered into execution.
export const BLOCKED_EXTS: Set<string> = new Set([
  'exe', 'app', 'sh', 'bash', 'apk', 'bat', 'cmd', 'com', 'msi',
  'js', 'mjs', 'cjs', 'html', 'htm', 'svg', 'xhtml', 'jar', 'scr',
  'dll', 'so', 'dylib', 'ps1', 'vbs',
]);

const EXT_CONTENT_TYPE: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  txt: 'text/plain',
  rtf: 'application/rtf',
  zip: 'application/zip',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

/** Lowercased extension without the dot; '' when there is none. */
export function extOf(name: string): string {
  const base = String(name ?? '').split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Strip ASCII control characters (0x00–0x1F and 0x7F) without a control-char literal. */
function stripControlChars(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 31 && c !== 127) out += s[i];
  }
  return out;
}

/**
 * Sanitize a filename for DISPLAY only. Strips path separators and control
 * characters, collapses whitespace, and caps length. Never used to build the
 * storage key (that is always the message UUID).
 */
export function sanitizeDisplayName(name: string): string {
  let n = stripControlChars(String(name ?? '').replace(/[\\/]/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  if (!n) n = 'file';
  if (n.length > 120) {
    const ext = extOf(n);
    const stem = n.slice(0, 100);
    n = ext ? `${stem}….${ext}` : `${stem}…`;
  }
  return n;
}

export function isAllowedExt(ext: string): boolean {
  const e = String(ext ?? '').toLowerCase();
  return ALLOWED_EXTS.has(e) && !BLOCKED_EXTS.has(e);
}

export function contentTypeFor(ext: string): string {
  return EXT_CONTENT_TYPE[String(ext ?? '').toLowerCase()] ?? 'application/octet-stream';
}

/** Human-readable size, e.g. 1536 → "1.5 KB". */
export function formatBytes(n: number): string {
  const bytes = Number(n) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let val = bytes / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  const rounded = val >= 100 ? Math.round(val) : Math.round(val * 10) / 10;
  return `${rounded} ${units[i]}`;
}

/**
 * How a picked file should be shown in the pre-send review screen.
 * 'none' means "show the file card" — it is the fallback AND the error state,
 * so a preview can never degrade into a blank pane.
 */
export type FilePreviewKind = 'image' | 'pdf' | 'text' | 'none';

/** Text previews read the whole file, so cap what we are willing to read. */
export const MAX_TEXT_PREVIEW_BYTES = 256 * 1024; // 256 KB

const IMAGE_PREVIEW_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic']);
const TEXT_PREVIEW_EXTS = new Set(['txt', 'csv']);

export function previewKindForExt(ext: string): FilePreviewKind {
  const e = String(ext ?? '').toLowerCase();
  // A blocked extension must never be rendered, even if some caller asks.
  if (!isAllowedExt(e)) return 'none';
  if (IMAGE_PREVIEW_EXTS.has(e)) return 'image';
  if (e === 'pdf') return 'pdf';
  if (TEXT_PREVIEW_EXTS.has(e)) return 'text';
  return 'none';
}

export type FileValidationResult =
  | { ok: true; ext: string; displayName: string; contentType: string }
  | { ok: false; reason: string };

/** Validate a picked file by name + size. The edge function re-checks the ext. */
export function validateFile(name: string, sizeBytes: number): FileValidationResult {
  const displayName = sanitizeDisplayName(name);
  const ext = extOf(name);
  if (!ext) return { ok: false, reason: 'This file has no recognizable type and can’t be sent.' };
  if (!isAllowedExt(ext)) return { ok: false, reason: `“.${ext}” files can’t be sent for security reasons.` };
  if (!(Number(sizeBytes) > 0)) return { ok: false, reason: 'This file appears to be empty.' };
  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    return { ok: false, reason: `Files must be under ${formatBytes(MAX_FILE_SIZE_BYTES)}.` };
  }
  return { ok: true, ext, displayName, contentType: contentTypeFor(ext) };
}
