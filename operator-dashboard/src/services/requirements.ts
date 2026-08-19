import { supabase } from '../lib/supabase';
import {
  DEFAULT_TIMING,
  REQUIREMENT_CATALOG,
  REQUIREMENT_ORDER,
  isEditableKind,
  isPayKind,
  type EditableKind,
} from '../domain/catalog';
import type { RequirementTiming } from '../domain/requirements';

/**
 * Editing what a published trip asks for, and when.
 *
 * Spec: docs/specs/operator-trips/deadline-editing.md
 *
 * ⚠️ TWIN of `fetchTripRequirements` / `saveRequirementChanges` /
 * `removeRequirement` in the app's
 * `src/services/trips/tripDocumentsService.ts`. The two projects share no
 * code, so the same diff runs twice. Keep them in step: an operator who edits
 * the same trip on their phone and here must get the same result.
 *
 * No migration was needed for any of this. `organized_trip_req_write` is
 * already `for all to authenticated` with using and with check
 * `trip_staff_can(trip_id, 'trip.edit')`
 * (`20260807000100_operator_trip_staff_gates.sql`), which is the exact
 * capability this site's `access.can('trip.edit')` reads. The button and the
 * database agree by construction.
 */

export type EditableRequirement = {
  id: string;
  kind: string;
  reqType: string;
  title: string;
  skippable: boolean;
  daysBefore: number;
  isActive: boolean;
};

/**
 * Every TRAVELER requirement row on the trip, active or not.
 *
 * A separate read from `fetchTripReview`, which cannot serve this: it drops
 * `pay` rows (no ledger UI here) and filters to `is_active`. An editor needs
 * both — pay rows because their deadline is the trip's full-payment date, and
 * inactive rows because reviving one is what restores the passports travelers
 * had already sent.
 *
 * ⚠️ `audience` is load-bearing, not tidiness. `saveRequirementChanges` treats
 * anything it does not find in the editor's wanted set as switched off, so an
 * unfiltered read would let this call `removeRequirement()` on the CREW's
 * passport row the first time an operator saved with passports off for
 * travelers. Crew paperwork is managed on the crew page.
 */
export async function fetchEditableRequirements(
  tripId: string,
): Promise<EditableRequirement[]> {
  const { data, error } = await supabase
    .from('organized_trip_requirements')
    .select('id, kind, req_type, title, skip_at_onboarding, deadline_days_before, is_active')
    .eq('trip_id', tripId)
    .eq('audience', 'traveler')
    .order('sort_order', { ascending: true });
  if (error) throw error;

  return (data ?? []).map(r => ({
    id: r.id as string,
    kind: r.kind as string,
    reqType: r.req_type as string,
    title: r.title as string,
    skippable: r.skip_at_onboarding === 'skippable',
    // A must_have row stores no deadline. Show the catalog default so the
    // stepper starts somewhere sensible the moment the operator switches to
    // "They can skip" — a stepper opening on 0 reads as "due today".
    daysBefore:
      (r.deadline_days_before as number | null) ??
      DEFAULT_TIMING[r.kind as EditableKind]?.daysBefore ??
      30,
    isActive: r.is_active as boolean,
  }));
}

/** How the timing pair must be written. `organized_trip_req_deadline_rule`
 *  requires exactly this pairing — skippable MUST carry a deadline, must_have
 *  MUST NOT — so the two columns always move together. Writing one without the
 *  other is a 23514. */
function timingColumns(t: RequirementTiming) {
  return {
    skip_at_onboarding: t.skippable ? 'skippable' : 'must_have',
    deadline_days_before: t.skippable ? Math.max(0, Math.round(t.daysBefore)) : null,
  };
}

/**
 * Switch one requirement off.
 *
 * Hard-deleted only when nothing points at it. Once a traveler has uploaded or
 * agreed, `is_active = false` IS the delete: the resolved view, the traveler
 * RPC and every screen here filter on it, so the row disappears while the
 * evidence and its purge clock survive.
 *
 * ⚠️ Pay rows are NEVER hard-deleted, whatever the counts say. The ledger's
 * `requirement_id` is ON DELETE SET NULL — deliberately, so deleting a
 * requirement can never erase the record that someone paid — but a NULLed
 * `requirement_id` is exactly what the pay-state lookup keys on. The payment
 * would survive while becoming invisible, and the traveler would be asked to
 * pay a second time for something they already paid. A pay row also has zero
 * documents and zero acknowledgements, so counting alone would send every one
 * of them down the delete branch.
 */
export async function removeRequirement(
  requirementId: string,
): Promise<'deleted' | 'deactivated'> {
  const [row, docs, acks] = await Promise.all([
    supabase
      .from('organized_trip_requirements')
      .select('kind, req_type')
      .eq('id', requirementId)
      .maybeSingle(),
    supabase
      .from('organized_trip_travelers_documents')
      .select('id', { count: 'exact', head: true })
      .eq('requirement_id', requirementId),
    supabase
      .from('group_trip_acknowledgements')
      .select('user_id', { count: 'exact', head: true })
      .eq('requirement_id', requirementId),
  ]);
  if (row.error) throw row.error;
  if (docs.error) throw docs.error;
  if (acks.error) throw acks.error;

  // `req_type` first: it is what the database itself constrains a pay row on,
  // and it stays correct for a kind this build's catalog does not know about.
  const isPayRow = row.data?.req_type === 'pay' || isPayKind(row.data?.kind ?? '');

  // A failed count reads as null. Treat "we don't know" as "there is
  // evidence" — deactivating something empty is recoverable, cascading a real
  // passport away is not.
  const untouched = !isPayRow && docs.count === 0 && acks.count === 0;

  if (untouched) {
    const { error } = await supabase
      .from('organized_trip_requirements')
      .delete()
      .eq('id', requirementId);
    if (error) throw error;
    return 'deleted';
  }

  const { error } = await supabase
    .from('organized_trip_requirements')
    .update({ is_active: false })
    .eq('id', requirementId);
  if (error) throw error;
  return 'deactivated';
}

/** What the editor wants the trip to ask for. One entry per kind switched on;
 *  anything absent is off. */
export type RequirementDraft = {
  kind: EditableKind;
  timing: RequirementTiming;
};

/**
 * Apply an edited requirement list to a published trip.
 *
 * DIFFED against `existing`, never rewritten. A requirement's id is what every
 * document, acknowledgement and notification points at; deleting and
 * re-inserting the same six kinds would silently detach every passport already
 * uploaded.
 *
 * Four cases:
 *   - on, no row yet   -> insert
 *   - on, row exists   -> update timing, and revive it if it was off
 *   - off, row exists  -> removeRequirement
 *   - a PAY row        -> timing only, always an UPDATE, never inserted or
 *                         removed. They are created once at publish.
 *
 * Reviving an inactive row rather than inserting a fresh one is what makes
 * "remove it, change your mind, add it back" restore the passports travelers
 * had already sent, instead of asking eight people to upload them again.
 *
 * Kinds outside the catalog — an operator's own hand-written item — are left
 * completely alone. This editor cannot show them, so it must not delete them.
 */
export async function saveRequirementChanges(
  tripId: string,
  existing: EditableRequirement[],
  draft: RequirementDraft[],
): Promise<void> {
  const byKind = new Map<string, EditableRequirement>();
  for (const r of existing) {
    // Pay rows never appear in the draft's on/off list. Without this
    // `continue` the diff below reads them as "turned off" and deletes them on
    // every save.
    if (isPayKind(r.kind)) continue;
    if (!isEditableKind(r.kind)) continue;
    // Two rows of one kind should not exist; if one ever does, the active one
    // is what the travelers are looking at.
    const prev = byKind.get(r.kind);
    if (!prev || (r.isActive && !prev.isActive)) byKind.set(r.kind, r);
  }

  const wanted = new Map(draft.map(d => [d.kind as string, d.timing]));
  const inserts: Record<string, unknown>[] = [];

  for (const kind of REQUIREMENT_ORDER) {
    if (isPayKind(kind)) {
      const timing = wanted.get(kind);
      const row = existing.find(r => r.kind === kind);
      if (!timing || !row) continue;
      // Every save round-trips every visible kind's current timing, so without
      // this an edit to ONE document would still fire an UPDATE for both
      // `deposit` and `balance`.
      const unchanged =
        row.skippable === timing.skippable &&
        (!timing.skippable || row.daysBefore === Math.max(0, Math.round(timing.daysBefore)));
      if (unchanged) continue;
      const { error } = await supabase
        .from('organized_trip_requirements')
        .update(timingColumns(timing))
        .eq('id', row.id);
      if (error) throw error;
      continue;
    }

    const row = byKind.get(kind);
    const timing = wanted.get(kind);

    if (timing && !row) {
      const c = REQUIREMENT_CATALOG[kind];
      inserts.push({
        trip_id: tripId,
        kind,
        req_type: c.reqType,
        ...timingColumns(timing),
        title: c.title,
        help_text: c.helpText,
        sort_order: REQUIREMENT_ORDER.indexOf(kind),
        is_active: true,
      });
      continue;
    }

    if (timing && row) {
      const unchanged =
        row.isActive &&
        row.skippable === timing.skippable &&
        (!timing.skippable || row.daysBefore === Math.max(0, Math.round(timing.daysBefore)));
      if (unchanged) continue;
      const { error } = await supabase
        .from('organized_trip_requirements')
        .update({ ...timingColumns(timing), is_active: true })
        .eq('id', row.id);
      if (error) throw error;
      continue;
    }

    if (!timing && row && row.isActive) {
      await removeRequirement(row.id);
    }
  }

  if (inserts.length > 0) {
    const { error } = await supabase.from('organized_trip_requirements').insert(inserts);
    if (error) throw error;
  }
}
