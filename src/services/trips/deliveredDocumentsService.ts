/**
 * Documents the operator DELIVERS to travelers — tickets, itineraries,
 * confirmations, a packing list.
 *
 * Spec: docs/staff-requirements-and-wallet-delivery-spec-and-plan.html, Part B.
 * Schema: supabase/migrations/20260812000300_delivered_documents.sql
 *
 * ── The rule, which is the whole reason this file is separate ───────────────
 * Delivery is ONE-DIRECTIONAL. The operator hands the traveler a document the
 * operator issued. The operator can never provide a document the traveler owes
 * — their passport, their signed waiver, their medical form.
 *
 * That is not squeamishness, it is what makes the records worth keeping. A
 * requirement row answers "did this person provide this, and when". An
 * operator-signed waiver is not a waiver, it is a liability with a signature on
 * it; a passport somebody else uploaded proves nothing about who chose to hand
 * it over.
 *
 * So there is no `requirementId` anywhere in this file, the table has no such
 * column, and travelers hold no insert policy on it. The rule is held in three
 * places and the database is the one that counts.
 */
import * as Crypto from 'expo-crypto';
import { supabase } from '../../config/supabase';
import { byteSizeOf, toUploadBody } from './tripDocumentsService';

const BUCKET = 'group-trip-documents';
/** Matches the storage policy in the migration: delivered/<trip_id>/<file>. */
const PREFIX = 'delivered';
const SIGNED_URL_TTL_SECONDS = 60;

export interface DeliveredDocument {
  id: string;
  tripId: string;
  /** null = delivered to everyone on the trip. */
  recipientId: string | null;
  uploadedBy: string;
  title: string;
  note: string | null;
  storagePath: string;
  sizeBytes: number | null;
  deliveredAt: string;
  withdrawnAt: string | null;
}

const rowToDoc = (r: Record<string, unknown>): DeliveredDocument => ({
  id: r.id as string,
  tripId: r.trip_id as string,
  recipientId: (r.recipient_id as string | null) ?? null,
  uploadedBy: r.uploaded_by as string,
  title: r.title as string,
  note: (r.note as string | null) ?? null,
  storagePath: r.storage_path as string,
  sizeBytes: (r.size_bytes as number | null) ?? null,
  deliveredAt: r.delivered_at as string,
  withdrawnAt: (r.withdrawn_at as string | null) ?? null,
});

const COLUMNS =
  'id, trip_id, recipient_id, uploaded_by, title, note, storage_path, size_bytes, delivered_at, withdrawn_at';

/**
 * What the signed-in traveler has been given on this trip.
 *
 * No recipient filter here on purpose. RLS already answers "may I see this
 * row", and repeating the predicate in the query would create a second place
 * where the rule lives — the place that gets edited when somebody adds a
 * feature and forgets the first one.
 */
export async function fetchMyDeliveredDocuments(tripId: string): Promise<DeliveredDocument[]> {
  const { data, error } = await supabase
    .from('organized_trip_delivered_documents')
    .select(COLUMNS)
    .eq('trip_id', tripId)
    .is('withdrawn_at', null)
    .order('delivered_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToDoc);
}

/**
 * Everything delivered on this trip, withdrawn rows included. Operator view —
 * RLS returns the full set only to staff with `roster.view`.
 */
export async function fetchTripDeliveredDocuments(tripId: string): Promise<DeliveredDocument[]> {
  const { data, error } = await supabase
    .from('organized_trip_delivered_documents')
    .select(COLUMNS)
    .eq('trip_id', tripId)
    .order('delivered_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToDoc);
}

/**
 * Hand a document to the whole trip, or to one traveler.
 *
 * Uploads the file first and writes the row second. If the row fails the file
 * is removed again: an orphan in the bucket is unreachable (every read path
 * joins through this table) but it is still somebody's itinerary sitting in
 * storage with no record of why.
 */
export async function deliverDocument(params: {
  tripId: string;
  /** null = everybody on the trip. */
  recipientId: string | null;
  uploadedBy: string;
  title: string;
  note?: string | null;
  localUri: string;
  /** Defaults to PDF, which is what confirmations and itineraries arrive as. */
  contentType?: string;
}): Promise<DeliveredDocument> {
  const title = params.title.trim();
  if (!title) throw new Error('Give the document a name so the traveler knows what it is.');

  const contentType = params.contentType ?? 'application/pdf';
  const ext = contentType === 'application/pdf' ? 'pdf' : 'jpg';
  const storagePath = `${PREFIX}/${params.tripId}/${Crypto.randomUUID()}.${ext}`;

  const body = await toUploadBody(params.localUri, contentType);
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, body, { contentType, upsert: false });
  if (upErr) throw upErr;

  const { data, error } = await supabase
    .from('organized_trip_delivered_documents')
    .insert({
      trip_id: params.tripId,
      recipient_id: params.recipientId,
      uploaded_by: params.uploadedBy,
      title,
      note: params.note?.trim() || null,
      storage_path: storagePath,
      size_bytes: await byteSizeOf(params.localUri),
    })
    .select(COLUMNS)
    .single();

  if (error) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw error;
  }
  return rowToDoc(data);
}

/**
 * Take a document back.
 *
 * An update, never a delete. "They were given this and it was withdrawn" and
 * "they were never given anything" are different facts, and only the first
 * survives if the row stays — the same reasoning that keeps a blocked refund's
 * row in `organized_trip_refunds`.
 *
 * The file is left in the bucket: the row still points at it, and staff can
 * still open it while reviewing what happened.
 */
export async function withdrawDeliveredDocument(id: string): Promise<void> {
  const { error } = await supabase
    .from('organized_trip_delivered_documents')
    .update({ withdrawn_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/**
 * A short-lived URL to open one. The bucket is private, so this is the only way
 * to read a file, and the TTL matches the rest of the documents code.
 */
export async function signedUrlForDelivered(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('Could not open the document');
  return data.signedUrl;
}
