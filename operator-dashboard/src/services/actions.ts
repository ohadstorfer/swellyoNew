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

/**
 * Set one traveler's price.
 *
 * One of the two money edits this site does (the other is updateTripPrice
 * below). It is owner-only:
 * the RPC checks `group_trips.host_id = auth.uid()`, NOT "is a host", so a
 * promoted admin gets "not your trip". Callers must hide the button from
 * anyone who is not the operator of record — see OperatorTrip.hostId.
 *
 * The server also refuses: an empty total, anything negative, a deposit above
 * the total, and a deposit on a trip that has no deposit step to collect it
 * against. The dialog mirrors all four so the operator learns before
 * submitting rather than after.
 *
 * Pass `depositUsd: null` to clear the deposit and leave it to the trip
 * default. It must be null — not zero — on a trip with no deposit step.
 */
export async function setTravelerPrice(args: {
  tripId: string;
  userId: string;
  totalUsd: number;
  depositUsd: number | null;
}): Promise<void> {
  const { error } = await supabase.rpc('operator_set_traveler_price', {
    p_trip_id: args.tripId,
    p_user_id: args.userId,
    p_total_usd: args.totalUsd,
    p_deposit_usd: args.depositUsd,
  });
  if (error) throw error;
}

/**
 * Change the trip's own price — the default every future joiner is frozen at.
 *
 * Mirrors the app's updateOperatorTripPrice (operatorTripsService.ts), the only
 * other sanctioned writer of these two columns, and keeps its order exactly:
 *
 *   1. `operator_freeze_trip_prices` — pin everyone already on the trip to the
 *      price they have today. The join trigger already froze everyone who
 *      joined while the trip was 'managed'; the RPC covers the rows it
 *      deliberately left null (joined while still 'offline'). Without this,
 *      the write below would silently reprice all of them. If the freeze
 *      throws, the new price is NOT written — a half-done reprice is worse
 *      than none.
 *   2. Write `cost_per_person` / `deposit_amount` on the trip row.
 *   3. On a managed trip, bring the `pay` requirement rows in line with the
 *      deposit: adding a deposit must create or reactivate its row, and
 *      dropping the deposit must retire it — or operator_set_traveler_price
 *      rejects every per-traveler deposit with "no active deposit
 *      requirement". Offline trips have no active pay rows, so there is
 *      nothing to sync.
 *
 * Owner-only, like setTravelerPrice: the freeze RPC checks
 * `group_trips.host_id = auth.uid()`, so a promoted admin would fail step 1
 * with a raw "not your trip". Callers must hide the button from anyone who is
 * not the operator of record.
 */
export async function updateTripPrice(args: {
  tripId: string;
  costPerPerson: number;
  depositAmount: number | null;
  /** The trip's CURRENT payment mode. This function never changes it. */
  paymentMode: string | null;
}): Promise<void> {
  const { error: freezeErr } = await supabase.rpc('operator_freeze_trip_prices', {
    p_trip_id: args.tripId,
  });
  if (freezeErr) throw freezeErr;

  const { error } = await supabase
    .from('group_trips')
    .update({ cost_per_person: args.costPerPerson, deposit_amount: args.depositAmount })
    .eq('id', args.tripId);
  if (error) throw error;

  if (args.paymentMode === 'managed') {
    await syncPayRequirements(args.tripId, (args.depositAmount ?? 0) > 0);
  }
}

/**
 * The row shapes for the two `pay` requirements, copied from the app's
 * REQUIREMENT_CATALOG + DEFAULT_TIMING — copied, not imported, because this
 * site does not share the app's code. A row built with a different shape here
 * would drift from the one the wizard writes.
 *
 * `skip_at_onboarding` and the deadline are a DB CHECK pair
 * (group_trip_req_deadline_rule): must_have carries NO deadline and skippable
 * MUST carry one. Any other pairing is a 23514 at insert time.
 */
const PAY_ROWS = {
  deposit: {
    title: 'Deposit',
    help_text: 'Pay your deposit to confirm your place.',
    skip_at_onboarding: 'must_have',
    deadline_days_before: null,
    sort_order: 0,
  },
  balance: {
    title: 'Final payment',
    help_text: 'The rest of your trip cost.',
    skip_at_onboarding: 'skippable',
    deadline_days_before: 30,
    sort_order: 1,
  },
} as const;

/**
 * This site's copy of the app's syncPayRequirements (tripDocumentsService.ts),
 * cut down to the only rows it can ever touch. Same rules:
 *
 *  - Rows are REACTIVATED, never re-inserted: (trip_id, kind) is UNIQUE, and
 *    switching payments off leaves the old rows behind with is_active = false.
 *  - `is_active` only — never delete. The payment ledger's requirement_id
 *    points at these rows.
 *  - Inserting a `pay` row requires the trip to already read 'managed'
 *    (trg_pay_requires_managed_trip), which is why updateTripPrice checks the
 *    mode before calling. Flipping `is_active` alone never trips it.
 *
 * No migration behind any of this: `organized_trip_req_write` is a FOR ALL
 * policy on is_trip_host(trip_id), so the host could already write these rows.
 */
async function syncPayRequirements(tripId: string, hasDeposit: boolean): Promise<void> {
  const { data, error } = await supabase
    .from('organized_trip_requirements')
    .select('id, kind, is_active')
    .eq('trip_id', tripId)
    .eq('req_type', 'pay');
  if (error) throw error;

  type PayRow = { id: string; kind: string; is_active: boolean };
  const existing = new Map(((data ?? []) as PayRow[]).map(r => [r.kind, r]));
  const wanted: Array<keyof typeof PAY_ROWS> = hasDeposit ? ['deposit', 'balance'] : ['balance'];

  const toInsert = wanted
    .filter(k => !existing.has(k))
    .map(kind => ({ trip_id: tripId, kind, req_type: 'pay', is_active: true, ...PAY_ROWS[kind] }));
  if (toInsert.length > 0) {
    const { error: insErr } = await supabase.from('organized_trip_requirements').insert(toInsert);
    if (insErr) throw insErr;
  }

  // Reactivate a wanted row a previous switch-off deactivated, and retire a
  // deposit row the operator has since dropped.
  const flips = [
    ...wanted
      .map(k => existing.get(k))
      .filter((r): r is PayRow => !!r && !r.is_active)
      .map(r => ({ id: r.id, is_active: true })),
    ...[...existing.values()]
      .filter(r => !(wanted as string[]).includes(r.kind) && r.is_active)
      .map(r => ({ id: r.id, is_active: false })),
  ];
  for (const f of flips) {
    const { error: upErr } = await supabase
      .from('organized_trip_requirements')
      .update({ is_active: f.is_active })
      .eq('id', f.id);
    if (upErr) throw upErr;
  }
}
