/**
 * passportScanService — read a traveler's passport on the operator's phone.
 *
 * The operator books flights, so they need what is printed in the passport, not
 * the picture of it. Today they read it off the screen and retype it. This does
 * the reading for them.
 *
 * ── The rule that shapes everything here ─────────────────────────────────────
 *
 * NOTHING IS SAVED. Not to the database, not to react-query, not to a log, not
 * to a file that outlives the call. The details are produced on demand, held in
 * one screen's state, copied to the clipboard, and forgotten when the screen
 * closes. Ohad, 3 August: "sin guardarlos en la base de datos. solo lo copia."
 *
 * That is not only a preference. The passport-number column exists (v2 of the
 * upload spec) and is deliberately unapplied; storing the number would mean an
 * encryption key, a purge obligation and a data-protection clause. Reading it
 * live means none of those, because there is nothing to protect at rest.
 *
 * ── Why the image goes to disk at all ────────────────────────────────────────
 *
 * DocumentViewer's rule 2 keeps passports out of the image cache. Text
 * recognition needs actual bytes, so this writes the file to the cache
 * directory and deletes it in a `finally`. That is the same trade the PDF
 * branch of DocumentViewer already makes (its rule 3), and the delete is the
 * only thing keeping a plain copy of someone's passport out of the cache
 * directory indefinitely. Do not remove it.
 *
 * ── Where the reading happens ────────────────────────────────────────────────
 *
 * On the phone. Apple Vision on iOS, ML Kit on Android — both offline, both
 * free, both already on the device. The photo is never uploaded to an OCR
 * service, so no third party ever sees a passport.
 *
 * Spec: docs/specs/operator-trips/passport-copy-details.md
 */
import { requireOptionalNativeModule } from 'expo';
import { isExpoGo } from '../../utils/keyboardAvoidingView';
import { getViewUrl } from './tripDocumentsService';
import { readPassportText, type MrzReadResult } from './passportMrz';

type OcrNativeModule = {
  recognizeText(uri: string): Promise<{ text: string }>;
};

/**
 * Bound directly rather than imported from `expo-ocr-kit`.
 *
 * That package's index re-exports a native VIEW, and `requireNativeView` runs
 * at module scope — so importing the index throws on Expo Go before any of our
 * guards get a chance to run. `requireOptionalNativeModule` returns null
 * instead, which is exactly the shape a capability probe wants.
 */
const OcrModule = requireOptionalNativeModule<OcrNativeModule>('ExpoOcrKit');

/**
 * Can this build read a passport?
 *
 * False on Expo Go, which has no custom native modules — Ohad's usual testing
 * environment, so the screen has to say something better than nothing happening.
 */
export function isPassportScanAvailable(): boolean {
  if (isExpoGo) return false;
  return OcrModule != null;
}

export const SCAN_UNAVAILABLE_MESSAGE =
  'Reading passports needs the newest build of the app. It does not work in Expo Go.';

/**
 * Read one passport and return its fields.
 *
 * Never throws for an unreadable passport — a bad photo comes back as blank
 * fields with a `problem` set, because the screen lets the operator type the
 * details in by hand. It DOES throw when the file itself cannot be fetched,
 * which is a different failure and deserves a different message.
 */
export async function scanPassport(storagePath: string): Promise<MrzReadResult> {
  if (!isPassportScanAvailable()) {
    return {
      fields: {
        surname: '',
        givenNames: '',
        passportNumber: '',
        nationality: '',
        dateOfBirth: '',
        sex: '',
        expiryDate: '',
      },
      trusted: false,
      suspect: [],
      problem: SCAN_UNAVAILABLE_MESSAGE,
    };
  }

  const FileSystem = require('expo-file-system/legacy');
  const signed = await getViewUrl(storagePath);

  // Named after the storage key's basename — never after the person. The same
  // rule DocumentViewer follows for the PDF it downloads.
  const basename = storagePath.split('/').pop() ?? 'document';
  const target = `${FileSystem.cacheDirectory}scan-${basename}`;

  let downloadedPath: string | null = null;
  try {
    const res = await FileSystem.downloadAsync(signed, target);
    if (!res?.uri) throw new Error('could not open this document');
    downloadedPath = res.uri;

    const result = await OcrModule!.recognizeText(res.uri);
    // The recognised text is the passport. It is never logged, and it does not
    // leave this function except as parsed fields.
    return readPassportText(result?.text ?? '');
  } finally {
    if (downloadedPath) {
      await FileSystem.deleteAsync(downloadedPath, { idempotent: true }).catch(() => {
        // Best effort. A failure leaves one file in the OS-managed cache
        // directory; surfacing it to the operator helps nobody.
      });
    }
  }
}
