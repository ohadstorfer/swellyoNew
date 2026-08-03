import { supabase, DOCUMENTS_BUCKET } from '../lib/supabase';

/**
 * Approve one or more documents.
 *
 * Bulk is the default shape on purpose: 15 travelers × 4 documents is 60
 * approvals per trip, and sixty one-by-one clicks is the difference between
 * review happening and not happening.
 *
 * Returns how many rows were actually approved.
 */
export async function approveDocuments(
  documentIds: string[],
  note?: string,
): Promise<number> {
  if (documentIds.length === 0) return 0;

  const { data, error } = await supabase.rpc('operator_approve_documents', {
    p_document_ids: documentIds,
    p_note: note ?? null,
  });
  if (error) throw error;
  return (data as number) ?? 0;
}

/**
 * Reject a document: mark the row, then delete the file.
 *
 * Rejecting and "delete + reclaim" are the same single action. The RPC keeps
 * the row carrying `rejected_at` and the note, and re-opens the requirement for
 * the traveler with a notification. The file itself is removed by this client,
 * because the host holds the storage DELETE policy.
 *
 * If that second step fails we do NOT fail the action. The row is left rejected
 * with `file_deleted_at` still null, which is exactly what the nightly purge
 * sweeps. So a failure here leaks nothing — it only delays the delete.
 */
export async function rejectDocument(
  doc: { id: string; storagePath: string | null },
  note?: string,
): Promise<void> {
  const { error } = await supabase.rpc('operator_reject_document', {
    p_document_id: doc.id,
    p_note: note ?? null,
  });
  if (error) throw error;

  if (doc.storagePath) {
    const { error: rmErr } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .remove([doc.storagePath]);
    if (rmErr) {
      console.warn('[actions] reject: file delete failed; the purge job will sweep it', rmErr);
    }
  }
}
