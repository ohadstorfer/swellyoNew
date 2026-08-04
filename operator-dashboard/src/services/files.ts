import { supabase, DOCUMENTS_BUCKET } from '../lib/supabase';

/** Short by design. Long enough to open a file, short enough to be useless if copied. */
const DEFAULT_TTL_SECONDS = 60;

/**
 * A temporary link to one private file.
 *
 * Minted fresh every time. There is no such thing as a public URL in this
 * bucket, and a stored link would outlive its usefulness within a minute.
 */
export async function signedUrl(
  storagePath: string,
  seconds = DEFAULT_TTL_SECONDS,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, seconds);

  if (error) throw error;
  if (!data?.signedUrl) throw new Error('object not found');
  return data.signedUrl;
}

/** Download a single file under a readable name. */
export async function downloadOne(storagePath: string, fileName: string): Promise<void> {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .download(storagePath);

  if (error) throw error;
  saveBlob(data, fileName);
}

export type ExportItem = {
  storagePath: string | null;
  /** What the file should be called inside the zip. */
  fileName: string;
  /** Purged files have a row but no file. Skipped, not failed. */
  fileDeleted?: boolean;
};

export type ExportResult = {
  saved: number;
  skipped: number;
  failed: number;
};

/**
 * Export many files as one zip.
 *
 * Sequential on purpose. Sixty parallel downloads of private files is a good
 * way to get rate-limited, and the operator would rather see steady progress
 * than a page that freezes and then finishes.
 *
 * Purged and missing files are skipped and counted, never thrown — one deleted
 * passport must not lose the operator the other fifty-nine.
 */
export async function downloadAll(
  items: ExportItem[],
  zipName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ExportResult> {
  const usable = items.filter(i => i.storagePath && !i.fileDeleted);
  const result: ExportResult = {
    saved: 0,
    skipped: items.length - usable.length,
    failed: 0,
  };

  if (usable.length === 0) {
    onProgress?.(0, 0);
    return result;
  }

  // Loaded on demand. Zipping is a rare, deliberate action — making every
  // page load carry the library would be paying for it constantly.
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const used = new Set<string>();

  for (let i = 0; i < usable.length; i++) {
    const item = usable[i];
    try {
      const { data, error } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .download(item.storagePath!);
      if (error) throw error;
      zip.file(uniqueName(item.fileName, used), data);
      result.saved++;
    } catch {
      // Keep going. A partial export beats no export.
      result.failed++;
    }
    onProgress?.(i + 1, usable.length);
  }

  if (result.saved > 0) {
    const blob = await zip.generateAsync({ type: 'blob' });
    saveBlob(blob, zipName.endsWith('.zip') ? zipName : `${zipName}.zip`);
  }

  return result;
}

/** Two travelers called Ana Silva must not overwrite each other inside the zip. */
function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 2;
  let candidate = `${stem} (${n})${ext}`;
  while (used.has(candidate)) {
    n++;
    candidate = `${stem} (${n})${ext}`;
  }
  used.add(candidate);
  return candidate;
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Strip characters that break file names on Windows and macOS. */
export function safeFileName(s: string): string {
  return s.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'file';
}
