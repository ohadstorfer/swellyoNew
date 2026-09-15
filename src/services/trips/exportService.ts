/**
 * Getting things OUT of Swellyo on a phone: a spreadsheet, or a folder of
 * documents as one zip.
 *
 * Product Specs §"Trip dashboard space" asks for export beside every document
 * list, and §"Trip operator view" asks for it on the payments page. The
 * operator dashboard has had both since August (`downloadAll`, JSZip in the
 * browser). This is the app's half.
 *
 * ── Why a zip, and not the share sheet several times ───────────────────────
 * `Sharing.shareAsync` takes ONE file. Fourteen passports would be fourteen
 * share sheets, each waiting on the last, and any one of them cancelled leaves
 * the operator with no idea which. One archive is one gesture and one thing to
 * attach to the email they were always going to send.
 *
 * ── The limits are real and are enforced here ──────────────────────────────
 * JSZip builds the whole archive in JavaScript memory, so a trip-wide export —
 * sixty files, some of them phone photos — is how you get killed by the OS on a
 * mid-range Android. Decision D4, 4 September 2026: the app exports ONE
 * TRAVELER or ONE REQUIREMENT, and the whole trip stays on the desktop, which
 * streams to disk. `MAX_FILES` and `MAX_BYTES` below are that decision written
 * down where it cannot be forgotten.
 *
 * ── Every file is fetched through a signed URL ─────────────────────────────
 * Same path DocumentViewer uses. Nothing here reads storage directly, and
 * nothing here caches: the zip is written to the cache directory, handed to
 * the OS, and deleted by `cleanup()` when the caller is done with it.
 */
import { Platform } from 'react-native';
import { getViewUrl } from './tripDocumentsService';

/** Beyond this the archive is a desktop job — see the header. */
const MAX_FILES = 40;
/** ~80MB of source files. JSZip holds all of it before it writes anything. */
const MAX_BYTES = 80 * 1024 * 1024;

export type ExportFile = {
  storagePath: string;
  /** What it should be called inside the zip, WITHOUT an extension. */
  name: string;
  /** True for a PDF, false for a photo — decides the extension. */
  isPdf: boolean;
  /** Optional folder inside the archive, e.g. the traveler's name. */
  folder?: string;
};

export type ExportResult = {
  saved: number;
  /** Files that could not be fetched. The export still ships the rest — an
   *  archive missing one photo beats no archive at all. */
  failed: number;
  /** True when the caller asked for more than MAX_FILES and it was trimmed. */
  trimmed: boolean;
};

/** Filesystem-safe, and readable by whoever opens the zip. */
export function safeFileName(input: string): string {
  return (
    input
      .replace(/[/\\?%*:|"<>]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'document'
  );
}

/**
 * Write text to a file in the cache and hand it to the OS share sheet.
 *
 * Used for CSV. The file is left in the cache deliberately: iOS copies out of
 * it asynchronously after `shareAsync` resolves, so deleting immediately is how
 * the receiving app gets an empty attachment. The cache is the OS's to reclaim.
 */
export async function shareTextAsFile(
  text: string,
  fileName: string,
  mimeType: string,
): Promise<void> {
  const Sharing = require('expo-sharing');
  const FileSystem = require('expo-file-system/legacy');
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  const target = `${FileSystem.cacheDirectory}${safeFileName(fileName)}`;
  await FileSystem.writeAsStringAsync(target, text, { encoding: 'utf8' });
  await Sharing.shareAsync(target, {
    mimeType,
    UTI: mimeType === 'text/csv' ? 'public.comma-separated-values-text' : 'public.plain-text',
    dialogTitle: fileName,
  });
}

/**
 * Download a list of documents, zip them, and hand the archive to the OS.
 *
 * Sequential on purpose, exactly as the browser version is: forty parallel
 * downloads of private files is a good way to be rate-limited, and the progress
 * callback is only honest if one thing happens at a time.
 *
 * Never throws for a single file that would not come down — that is one missing
 * page in an archive, and the operator would rather have the other thirty-nine.
 * It throws only when the whole export cannot happen.
 */
export async function exportDocumentsAsZip(
  files: ExportFile[],
  zipName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ExportResult> {
  const Sharing = require('expo-sharing');
  const FileSystem = require('expo-file-system/legacy');
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }

  const trimmed = files.length > MAX_FILES;
  const list = files.slice(0, MAX_FILES);
  if (list.length === 0) throw new Error('There is nothing to export.');

  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const used = new Set<string>();
  let saved = 0;
  let failed = 0;
  let bytes = 0;
  const temp: string[] = [];

  try {
    for (let i = 0; i < list.length; i += 1) {
      const f = list[i];
      onProgress?.(i, list.length);
      try {
        const signed = await getViewUrl(f.storagePath);
        const ext = f.isPdf ? 'pdf' : 'jpg';
        const target = `${FileSystem.cacheDirectory}exp-${i}.${ext}`;
        const res = await FileSystem.downloadAsync(signed, target);
        if (!res?.uri) throw new Error('download failed');
        temp.push(res.uri);

        const info = await FileSystem.getInfoAsync(res.uri, { size: true });
        bytes += (info?.size as number) ?? 0;
        if (bytes > MAX_BYTES) {
          throw new Error(
            'These files are too large to package on a phone. Use the operator dashboard on a computer.',
          );
        }

        const base64 = await FileSystem.readAsStringAsync(res.uri, { encoding: 'base64' });
        zip.file(uniqueName(`${safeFileName(f.name)}.${ext}`, f.folder, used), base64, {
          base64: true,
        });
        saved += 1;
      } catch (e) {
        // A size refusal is the whole export failing, not one file failing.
        if (e instanceof Error && e.message.startsWith('These files are too large')) throw e;
        failed += 1;
      }
    }

    if (saved === 0) throw new Error('None of those documents could be downloaded.');

    onProgress?.(list.length, list.length);
    const content: string = await zip.generateAsync({ type: 'base64' });
    const zipPath = `${FileSystem.cacheDirectory}${safeFileName(zipName)}.zip`;
    await FileSystem.writeAsStringAsync(zipPath, content, { encoding: 'base64' });

    await Sharing.shareAsync(zipPath, {
      mimeType: 'application/zip',
      // iOS picks the destination app off the UTI, not the extension.
      UTI: 'public.zip-archive',
      dialogTitle: zipName,
    });

    return { saved, failed, trimmed };
  } finally {
    // The single files are ours and can go straight away — unlike the zip, which
    // the receiving app is still reading. Best-effort: a leftover temp file in
    // the cache is the OS's to reclaim, and must never fail an export that
    // already succeeded.
    for (const uri of temp) {
      try {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Hand ONE document to the OS share sheet — "Download file" / "Export file" on
 * the document screen.
 *
 * Same path DocumentViewer's export takes: its own signed URL, its own download,
 * named after the person and the document, never after the storage key.
 *
 * Returns the local copy's path. The CALLER deletes it when its screen closes —
 * not here, because on iOS `shareAsync` settles when the sheet dismisses, while
 * the receiving app may still be reading the file.
 */
export async function shareSingleDocument(file: ExportFile): Promise<string> {
  const Sharing = require('expo-sharing');
  const FileSystem = require('expo-file-system/legacy');
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  const signed = await getViewUrl(file.storagePath);
  const ext = file.isPdf ? 'pdf' : 'jpg';
  const name = safeFileName(file.name);
  const res = await FileSystem.downloadAsync(signed, `${FileSystem.cacheDirectory}${name}.${ext}`);
  if (!res?.uri) throw new Error('download failed');
  await Sharing.shareAsync(res.uri, {
    mimeType: file.isPdf ? 'application/pdf' : 'image/jpeg',
    // iOS picks the destination app off the UTI, not the extension.
    UTI: file.isPdf ? 'com.adobe.pdf' : 'public.jpeg',
    dialogTitle: name,
  });
  return res.uri;
}

/** Two travelers called Ana Silva must not overwrite each other in the zip. */
function uniqueName(fileName: string, folder: string | undefined, used: Set<string>): string {
  const prefix = folder ? `${safeFileName(folder)}/` : '';
  let candidate = `${prefix}${fileName}`;
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : '';
  let n = 2;
  do {
    candidate = `${prefix}${stem} (${n})${ext}`;
    n += 1;
  } while (used.has(candidate));
  used.add(candidate);
  return candidate;
}

/** Whether this build can export at all. Web has no share sheet and no cache
 *  directory; the operator dashboard is the export surface there. */
export const CAN_EXPORT = Platform.OS !== 'web';

/** The cap, so a screen can say it rather than discovering it. */
export const EXPORT_MAX_FILES = MAX_FILES;
