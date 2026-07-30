import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { supabase } from '../../config/supabase';
import { compressImage } from '../../utils/imageCompression';

/**
 * Traveler documents on organized (operator) trips — v1: passport image only,
 * no text extraction.
 *
 * Spec: docs/specs/operator-trips/passport-upload-v1.md
 *
 * Three things about this file are load-bearing:
 *
 * 1. The bucket is PRIVATE. There is no public URL and never will be. Reads go
 *    through `getViewUrl()`, which mints a ~60 second signed URL per view. Do
 *    not cache what it returns — not in react-query, not in state that outlives
 *    the screen, not in AsyncStorage. A signed URL is a bearer token.
 * 2. Live table names are `organized_trip_*` (renamed 2026-07-24). The bucket is
 *    still `group-trip-documents` — that mismatch is deliberate, not a bug.
 * 3. Every image is re-encoded to JPEG on the device before upload. That is what
 *    converts HEIC, caps the size, and drops EXIF (including the GPS of wherever
 *    the passport was photographed — usually someone's home).
 */

const BUCKET = 'group-trip-documents';

/** Keeps the two MRZ lines legible. Also a v2 dependency: the scanner will read
 *  these same files, so compressing harder later breaks every passport already
 *  uploaded. See spec §5.5. */
const MAX_DIMENSION = 2200;
const JPEG_QUALITY = 0.85;

/** Signed URLs live about a minute. Every other bucket in this app signs for an
 *  hour; documents deliberately do not. */
const SIGNED_URL_TTL_SECONDS = 60;

export type RequirementState =
  | 'not_started'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'overdue';

export type TripRequirement = {
  requirementId: string;
  kind: string;
  reqType: string;
  title: string;
  helpText: string | null;
  dueDate: string | null;
  state: RequirementState;
  submittedAt: string | null;
  reviewedAt: string | null;
  /** The operator's note. On a rejection this is why. */
  note: string | null;
  documentId: string | null;
};

export type TravelerDocument = {
  id: string;
  userId: string;
  requirementId: string;
  storagePath: string;
  uploadedAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  note: string | null;
  fileDeletedAt: string | null;
};

// ---------------------------------------------------------------------------
// Traveler side
// ---------------------------------------------------------------------------

/**
 * Every requirement on this trip for the current user, with its derived state.
 * `operator_trip_my_requirements` does the work server-side — per-traveler state
 * is never stored, always derived from the evidence rows.
 */
export async function fetchMyRequirements(tripId: string): Promise<TripRequirement[]> {
  const { data, error } = await supabase.rpc('operator_trip_my_requirements', {
    p_trip_id: tripId,
  });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    requirementId: r.requirement_id,
    kind: r.kind,
    reqType: r.req_type,
    title: r.title,
    helpText: r.help_text ?? null,
    dueDate: r.due_date ?? null,
    state: (r.effective_state ?? 'not_started') as RequirementState,
    submittedAt: r.submitted_at ?? null,
    reviewedAt: r.reviewed_at ?? null,
    note: r.approbation_note ?? null,
    documentId: r.document_id ?? null,
  }));
}

/** Just the passport row, or null when this trip does not ask for one. Peer
 *  trips never do — a DB trigger refuses to create the requirement. */
export async function fetchMyPassportRequirement(
  tripId: string,
): Promise<TripRequirement | null> {
  const all = await fetchMyRequirements(tripId);
  return all.find(r => r.kind === 'passport') ?? null;
}

/** The current user's own document row for a requirement, if any. */
export async function fetchMyDocument(
  tripId: string,
  requirementId: string,
  userId: string,
): Promise<TravelerDocument | null> {
  const { data, error } = await supabase
    .from('organized_trip_travelers_documents')
    .select(
      'id, user_id, requirement_id, storage_path, uploaded_at, approved_at, rejected_at, approbation_note, file_deleted_at',
    )
    .eq('trip_id', tripId)
    .eq('requirement_id', requirementId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapDocument(data) : null;
}

/**
 * Upload (or replace) the traveler's document for a requirement.
 *
 * Order matters. The object goes up FIRST, then the row. A row pointing at a
 * file that never landed shows the traveler a broken "submitted" state, while a
 * file with no row is invisible and gets swept as an orphan — so if only one of
 * the two can exist, it must be the file.
 */
export async function uploadDocument(params: {
  tripId: string;
  requirementId: string;
  userId: string;
  /** Local file URI from the camera or the photo library. */
  localUri: string;
}): Promise<{ documentId: string; storagePath: string }> {
  const { tripId, requirementId, userId, localUri } = params;

  // Replacing? Clear the old file and row first — a unique index allows only
  // one live document per (trip, traveler, requirement).
  const existing = await fetchMyDocument(tripId, requirementId, userId);
  if (existing) {
    await deleteDocument(existing);
  }

  // One call converts HEIC to JPEG, caps the longest edge, and drops EXIF.
  const jpegUri = await compressImage(localUri, {
    maxDimension: MAX_DIMENSION,
    quality: JPEG_QUALITY,
  });

  // The key must match the storage policy's regex exactly:
  //   ^<uuid>/<uuid>/<uuid>\.(jpg|jpeg|png|heic|pdf)$
  const documentId = Crypto.randomUUID();
  const storagePath = `${tripId}/${userId}/${documentId}.jpg`;

  const body = await toUploadBody(jpegUri);
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, body, { contentType: 'image/jpeg', upsert: false });
  if (upErr) throw upErr;

  const byteSize = await byteSizeOf(jpegUri);

  const { error: rowErr } = await supabase
    .from('organized_trip_travelers_documents')
    .insert({
      id: documentId,
      trip_id: tripId,
      user_id: userId,
      requirement_id: requirementId,
      storage_path: storagePath,
      mime_type: 'image/jpeg',
      byte_size: byteSize,
    });

  if (rowErr) {
    // Do not leave an unreferenced object behind: nothing but the orphan sweep
    // would ever look at it again.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw rowErr;
  }

  return { documentId, storagePath };
}

/**
 * A short-lived signed URL for one view.
 *
 * NEVER persist the result. Mint a new one if the viewer outlives it.
 */
export async function getViewUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('could not open this document');
  return data.signedUrl;
}

/** Remove the object and its row. Used by the traveler ("remove") and when
 *  replacing an existing upload. */
export async function deleteDocument(doc: {
  id: string;
  storagePath: string;
}): Promise<void> {
  if (doc.storagePath) {
    const { error } = await supabase.storage.from(BUCKET).remove([doc.storagePath]);
    // A missing object is fine — the row still has to go.
    if (error) console.warn('[tripDocuments] object remove failed, deleting row anyway');
  }
  const { error: rowErr } = await supabase
    .from('organized_trip_travelers_documents')
    .delete()
    .eq('id', doc.id);
  if (rowErr) throw rowErr;
}

// ---------------------------------------------------------------------------
// Host side
// ---------------------------------------------------------------------------

/** Every traveler's document for one requirement on this trip. RLS returns
 *  nothing useful unless the caller is a host. */
export async function fetchDocumentsForReview(
  tripId: string,
  requirementId: string,
): Promise<TravelerDocument[]> {
  const { data, error } = await supabase
    .from('organized_trip_travelers_documents')
    .select(
      'id, user_id, requirement_id, storage_path, uploaded_at, approved_at, rejected_at, approbation_note, file_deleted_at',
    )
    .eq('trip_id', tripId)
    .eq('requirement_id', requirementId)
    .order('uploaded_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapDocument);
}

export async function approveDocuments(
  documentIds: string[],
  note?: string,
): Promise<number> {
  const { data, error } = await supabase.rpc('operator_approve_documents', {
    p_document_ids: documentIds,
    p_note: note ?? null,
  });
  if (error) throw error;
  return (data as number) ?? 0;
}

/**
 * Reject: mark the row, then delete the file.
 *
 * The RPC keeps the row (carrying the note) and the host has the storage DELETE
 * policy, so the client removes the object. If that second step fails the row is
 * left rejected with `file_deleted_at` still null — which is exactly the
 * condition the nightly purge sweeps. So a failure here leaks nothing; it just
 * delays the delete. Never block the UI on it.
 */
export async function rejectDocument(
  doc: { id: string; storagePath: string },
  note?: string,
): Promise<void> {
  const { error } = await supabase.rpc('operator_reject_document', {
    p_document_id: doc.id,
    p_note: note ?? null,
  });
  if (error) throw error;

  if (doc.storagePath) {
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove([doc.storagePath]);
    if (rmErr) {
      console.warn('[tripDocuments] reject: file delete failed; the purge job will sweep it');
    }
  }
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function mapDocument(row: any): TravelerDocument {
  return {
    id: row.id,
    userId: row.user_id,
    requirementId: row.requirement_id,
    storagePath: row.storage_path,
    uploadedAt: row.uploaded_at,
    approvedAt: row.approved_at ?? null,
    rejectedAt: row.rejected_at ?? null,
    note: row.approbation_note ?? null,
    fileDeletedAt: row.file_deleted_at ?? null,
  };
}

/**
 * Same shape as storageService: React Native's networking layer reads a file://
 * URI straight out of FormData, which avoids materialising the whole image in
 * JS memory. Web falls back to a Blob.
 */
async function toUploadBody(uri: string): Promise<Blob | FormData> {
  const isNativeFile =
    Platform.OS !== 'web' &&
    (uri.startsWith('file://') || uri.startsWith('content://') || uri.startsWith('ph://'));

  if (isNativeFile) {
    const formData = new FormData();
    formData.append('', { uri, name: 'upload.jpg', type: 'image/jpeg' } as any);
    return formData;
  }

  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    return res.blob();
  }

  return new Promise<Blob>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => resolve(xhr.response);
    xhr.onerror = () => reject(new Error('could not read the selected image'));
    xhr.responseType = 'blob';
    xhr.open('GET', uri, true);
    xhr.send(null);
  });
}

/** Best-effort size for the metadata row. Never worth failing an upload over. */
async function byteSizeOf(uri: string): Promise<number> {
  try {
    if (Platform.OS === 'web') {
      const res = await fetch(uri);
      return (await res.blob()).size;
    }
    // `getInfoAsync` lives on the legacy entry point in expo-file-system v19
    // (SDK 54). Same import the rest of this repo uses.
    const FileSystem = require('expo-file-system/legacy');
    const info = await FileSystem.getInfoAsync(uri);
    return info?.exists && 'size' in info ? info.size : 0;
  } catch {
    return 0;
  }
}
