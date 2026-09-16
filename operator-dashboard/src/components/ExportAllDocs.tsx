import { useState } from 'react';
import { downloadAll, safeFileName } from '../services/files';
import { isUploadRequirement } from '../domain/requirements';
import { plural } from '../lib/format';
import type { TripReview } from '../services/review';
import type { SurferProfile } from '../services/travelers';

/**
 * Every document on the trip, as one zip, one folder per traveler.
 *
 * Product Specs §"Manage trip", Always: "export all docs." The site already
 * exported one requirement across everyone (`RequirementPage`) and one
 * traveler's whole set (`TravelerPage`); "everything" was the gap, and it is
 * the shape an operator actually needs when a hotel asks for the paperwork.
 *
 * ── Folders, not a flat pile ───────────────────────────────────────────────
 * Sixty files in one directory is an archive nobody can use. JSZip builds
 * folders from a path, and `uniqueName` in files.ts dedupes on the whole path,
 * so two travelers called Ana Silva stay separate for free.
 *
 * ── Desktop only, deliberately ─────────────────────────────────────────────
 * Decision D4, 4 September 2026. The browser streams each file and zips it;
 * the phone would hold the whole archive in JavaScript memory. The app exports
 * one traveler or one requirement and points here for the rest.
 *
 * ── Confirm before starting ────────────────────────────────────────────────
 * Sixty signed URLs fetched in series is about a minute, and a button that
 * appears to do nothing for a minute gets pressed again. So the count is named
 * first, and the button then reports progress rather than going quiet.
 */
export function ExportAllDocs({
  tripTitle,
  review,
  profiles,
}: {
  tripTitle: string;
  review: TripReview | undefined;
  profiles: Map<string, SurferProfile> | undefined;
}) {
  const [state, setState] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  // Same rule as everywhere else — a kind 'medical' row never has a file to
  // export, whatever its req_type says, and a purged file has a row and no
  // object behind it.
  const items = (review?.travelers ?? []).flatMap(t => {
    const who = safeFileName(profiles?.get(t.userId)?.name ?? 'Traveler');
    return t.items
      .filter(i => isUploadRequirement(i) && i.storagePath && !i.fileDeleted)
      .map(i => ({
        storagePath: i.storagePath,
        fileName: `${who}/${safeFileName(i.title)}${extOf(i.storagePath)}`,
        fileDeleted: i.fileDeleted,
      }));
  });

  if (items.length === 0) return null;

  async function run() {
    setState('Preparing…');
    const result = await downloadAll(
      items,
      safeFileName(`${tripTitle} - documents`),
      (done, total) => setState(`Downloading ${done} of ${total}…`),
    );
    setState(
      result.failed > 0
        ? `Saved ${plural(result.saved, 'file')}, ${result.failed} could not be downloaded.`
        : `Saved ${plural(result.saved, 'file')}.`,
    );
    setArmed(false);
    setTimeout(() => setState(null), 8000);
  }

  return (
    <div className="card enter">
      <div className="card-head">
        <h2>Export</h2>
        <span className="muted small">{plural(items.length, 'file')}</span>
      </div>
      <div className="card-body row-between" style={{ gap: 12 }}>
        <span className="muted small">
          {state ??
            (armed
              ? `${plural(items.length, 'file')} in one zip, a folder per traveler. It downloads them one at a time, so give it a minute.`
              : 'Every document on this trip, in one zip — a folder per traveler.')}
        </span>
        {armed ? (
          <div className="row" style={{ gap: 8, flexShrink: 0 }}>
            <button className="btn btn-sm" disabled={!!state} onClick={() => setArmed(false)}>
              Not now
            </button>
            <button
              className="btn btn-sm btn-primary"
              disabled={!!state}
              onClick={() => void run()}
            >
              {state ? 'Working…' : 'Start the download'}
            </button>
          </div>
        ) : (
          <button
            className="btn btn-sm"
            style={{ flexShrink: 0 }}
            disabled={!!state}
            onClick={() => setArmed(true)}
          >
            Export everything
          </button>
        )}
      </div>
    </div>
  );
}

/** The extension off the storage key, which is the only place it is recorded. */
function extOf(storagePath: string | null): string {
  const m = /\.([a-z0-9]{2,5})$/i.exec(storagePath ?? '');
  return m ? `.${m[1].toLowerCase()}` : '';
}
