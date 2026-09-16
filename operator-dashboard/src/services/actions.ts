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
/**
 * Rewrite ONE trip's frozen refund terms.
 *
 * Product Specs §"Manage trip", "Only before any traveler joined". This is the
 * one crack in the freeze-at-publish rule, and the database is what decides
 * whether it opens: `trg_guard_operator_trip_cancellation_policy`
 * (20260904000100) refuses unless the caller is `group_trips.host_id`, nobody
 * else has joined, and — the test no client can make — nobody has agreed to
 * these terms yet.
 *
 * ⚠️ `rules` is written EMPTY for a preset, matching what the app's create flow
 * writes. PRESET_RULES is the source of truth for the two ready-made policies,
 * and storing a copy beside the preset name is how a trip ends up with terms
 * that disagree with what they are called.
 *
 * Rule 1: no new table, no new function. `group_trips` UPDATE is `trip.edit`,
 * and the trigger narrows it from there.
 */
export async function setTripCancellationPolicy(
  tripId: string,
  policy: { preset: string; rules: unknown[]; notes: string | null },
): Promise<void> {
  const { error } = await supabase
    .from('group_trips')
    .update({
      cancellation_preset: policy.preset,
      cancellation_rules: policy.preset === 'custom' ? policy.rules : [],
      cancellation_notes: policy.notes?.trim() || null,
    })
    .eq('id', tripId);
  if (error) throw error;
}

/**
 * Swap the waiver PDF on a trip nobody has joined yet.
 *
 * Product Specs §"Manage trip", "Only before any traveler joined: Replace
 * waiver (for this trip specifically)". Mirrors the app's `replaceWaiverPdf`
 * exactly, and the order of the three writes is load-bearing:
 *
 *   1. UPLOAD the new object.
 *   2. UPDATE the row to point at it — this is where the database can refuse.
 *   3. REMOVE the old object, best-effort.
 *
 * An UPDATE of the row that is already there, not a new version: the unique
 * index allows exactly one waiver row per trip, and updating in place means
 * there is never a moment where the trip has a waiver requirement and no
 * document behind it. The row keeps its id and its version, which is safe
 * precisely BECAUSE `guard_waiver_replacement` refuses this unless there are
 * zero signatures — with nothing pointing at the old document there is no stale
 * reference to leave behind. `document_hash` moves, and that is the real record
 * of which bytes were shown.
 *
 * ⚠️ SPEC.md §2 USED TO FORBID THIS. The rule read "upload only to
 * `defaults/<user_id>/` — never into `<trip_id>/`, which is where every
 * sensitive file lives". That was a project convention, not the boundary: the
 * storage policy on `<trip_id>/operator/` gates on `is_trip_host(trip_id)`, so
 * the browser was always allowed and the operator's own waiver is not a
 * traveler's document. Amended in SPEC.md alongside this function; the rule
 * about TRAVELER documents is unchanged and still absolute.
 *
 * Throws if the trip is no longer empty. Somebody joining between the button
 * appearing and the file being picked is exactly the race the trigger exists
 * for, and it must be the server that notices.
 */
export async function replaceTripWaiver(tripId: string, file: File): Promise<void> {
  if (file.type !== 'application/pdf') {
    throw new Error('The waiver has to be a PDF.');
  }

  const { data: current, error: readErr } = await supabase
    .from('organized_trip_operator_documents')
    .select('id, storage_path')
    .eq('trip_id', tripId)
    .eq('kind', 'waiver')
    .maybeSingle();
  if (readErr) throw readErr;
  if (!current) {
    // Nothing to replace. Publishing a FIRST waiver also writes a requirement
    // row and a version, which is the wizard's job — this site does not
    // reimplement it.
    throw new Error('This trip has no waiver yet. Publish one from the app first.');
  }

  // Same cap the database enforces (20260915000100_waiver_pdf_10mb_limit.sql).
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Waiver PDFs can be up to 10 MB. Please choose a smaller file.');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const documentHash = Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const storagePath = `${tripId}/operator/${crypto.randomUUID()}.pdf`;

  const { error: upErr } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, file, { contentType: 'application/pdf', upsert: false });
  if (upErr) throw upErr;

  const { error: updErr } = await supabase
    .from('organized_trip_operator_documents')
    .update({ storage_path: storagePath, document_hash: documentHash })
    .eq('id', current.id);

  if (updErr) {
    // Refused (trip no longer empty) or failed. Either way the new object is
    // unreferenced — take it back out.
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
    throw updErr;
  }

  // The old PDF is referenced by nothing now. Best-effort: the swap is already
  // committed and must not be reported as failed over a leftover file.
  if (current.storage_path) {
    const { error: rmErr } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .remove([current.storage_path as string]);
    if (rmErr) console.warn('[actions] old waiver file not removed:', rmErr.message);
  }
}

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
