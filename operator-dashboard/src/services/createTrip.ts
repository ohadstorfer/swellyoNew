import { supabase, DOCUMENTS_BUCKET } from '../lib/supabase';
import { uploadTripImage } from './images';
import { REQUIREMENT_CATALOG, REQUIREMENT_ORDER, DEFAULT_TIMING, resolveTiming, type EditableKind } from '../domain/catalog';
import { rulesToWire, type CancellationPolicy } from '../domain/cancellation';
import {
  STAY_GALLERY_MAX,
  buildTripInsert,
  cleanItinerary,
  destinationRow,
  isRemoteUrl,
  requirementKindsToCreate,
  uploadItineraryPhotos,
  type OperatorCurrency,
  type RequirementTiming,
  type WizardState,
} from '../domain/createTrip';
import type { DefaultWaiver } from './settings';

/**
 * Publish an operator trip — the app's `handleSubmit` (CreateTripFlowA.tsx,
 * create branch, Flow C), write for write and in the same order:
 *
 *   1. upload cover → itinerary photos → stay photo → stay gallery (S3)
 *   2. freeze today's exchange rate (non-USD only)
 *   3. INSERT group_trips                                 ← createGroupTrip
 *   4. INSERT group_trip_participants (host)              ← createGroupTrip
 *   5. INSERT conversations + conversation_members        ← createGroupConversation
 *   6. waiver PDF (upload or copy default) + operator doc ← publishWaiverPdf / FromDefault
 *   7. INSERT organized_trip_requirements                 ← createRequirements
 *   8. INSERT organized_trip_staff (operator)             ← ensureOperatorOnCrew
 *   9. UPSERT group_trip_destinations + geocode invoke    ← setTripDestination
 *
 * Steps 4-9 are best-effort exactly where the app's are: a failure there leaves
 * a published trip and is reported, not rolled back. SPEC rule 1: every table,
 * bucket and function here is one the app already writes.
 */

/** A file the operator picked, keyed by the `local:<id>` string in the state. */
export type LocalFiles = Map<string, File>;

export interface PublishInput {
  state: WizardState;
  hostId: string;
  currency: OperatorCurrency;
  policy: CancellationPolicy;
  files: LocalFiles;
  waiverFile: File | null;
  defaultWaiver: DefaultWaiver | null;
}

export interface PublishResult {
  tripId: string;
  /** Things that did not save, in the app's own words. The trip exists. */
  warnings: string[];
}

// ── Exchange rate (ratesService.rateForSave) ───────────────────────────────

const RATE_URL = 'https://open.er-api.com/v6/latest/USD';

/**
 * Units of `code` per 1 USD, fetched now. The app freezes a rate no older than
 * 48h from its cache; a fresh fetch is always inside that. Never invents a
 * rate: null when the provider fails, and the caller refuses to publish.
 */
export async function rateForSave(code: OperatorCurrency): Promise<number | null> {
  if (code === 'USD') return 1;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(RATE_URL, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const rate = (await res.json())?.rates?.[code];
    return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

// ── Waiver (tripDocumentsService.ts) ───────────────────────────────────────

export const MAX_WAIVER_BYTES = 10 * 1024 * 1024;

async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function recordWaiverDocument(tripId: string, storagePath: string, documentHash: string | null) {
  const discard = () => supabase.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);

  const { data: existing, error: existingErr } = await supabase
    .from('organized_trip_operator_documents')
    .select('id')
    .eq('trip_id', tripId)
    .eq('kind', 'waiver')
    .maybeSingle();
  if (existingErr) {
    await discard();
    throw new Error('Could not check this trip’s waiver. Try again in a moment.');
  }
  if (existing) {
    await discard();
    throw new Error('This trip already has a waiver.');
  }

  const { error } = await supabase.from('organized_trip_operator_documents').insert({
    trip_id: tripId,
    kind: 'waiver',
    version: 1,
    storage_path: storagePath,
    document_hash: documentHash,
  });
  if (error) {
    await discard();
    throw error;
  }

  // Promote the waiver requirement to must_have, as the app does. On a new
  // trip the requirement rows are written AFTER this, so it matches nothing —
  // kept so the two code paths stay identical.
  const { error: promoteErr } = await supabase
    .from('organized_trip_requirements')
    .update({ skip_at_onboarding: 'must_have', deadline_days_before: null, is_active: true })
    .eq('trip_id', tripId)
    .eq('kind', 'waiver')
    .eq('audience', 'traveler');
  if (promoteErr) console.warn('[createTrip] waiver promote failed:', promoteErr.message);
}

export async function publishWaiverPdf(tripId: string, file: File): Promise<void> {
  if (file.size > MAX_WAIVER_BYTES) {
    throw new Error('Waiver PDFs can be up to 10 MB. Please choose a smaller file.');
  }
  const storagePath = `${tripId}/operator/${crypto.randomUUID()}.pdf`;
  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, file, { contentType: 'application/pdf', upsert: false });
  if (error) throw error;
  await recordWaiverDocument(tripId, storagePath, await sha256Hex(file));
}

export async function publishWaiverFromDefault(tripId: string, waiver: { path: string; hash: string }) {
  const storagePath = `${tripId}/operator/${crypto.randomUUID()}.pdf`;
  const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).copy(waiver.path, storagePath);
  if (error) throw error;
  await recordWaiverDocument(tripId, storagePath, waiver.hash);
}

export async function createRequirements(
  tripId: string,
  kinds: EditableKind[],
  timing: Record<string, RequirementTiming>,
): Promise<void> {
  if (kinds.length === 0) return;
  const rows = kinds.map(kind => {
    const c = REQUIREMENT_CATALOG[kind];
    const t = resolveTiming(kind, timing[kind] ?? DEFAULT_TIMING[kind]);
    return {
      trip_id: tripId,
      kind,
      req_type: c.reqType,
      skip_at_onboarding: t.skippable ? 'skippable' : 'must_have',
      deadline_days_before: t.skippable ? Math.max(0, Math.round(t.daysBefore)) : null,
      title: c.title,
      help_text: c.helpText,
      sort_order: REQUIREMENT_ORDER.indexOf(kind),
      is_active: true,
    };
  });
  const { error } = await supabase.from('organized_trip_requirements').insert(rows);
  if (error) throw error;
}

// ── Publish ────────────────────────────────────────────────────────────────

export async function publishTrip(input: PublishInput): Promise<PublishResult> {
  const { state, hostId, currency, policy, files } = input;
  const warnings: string[] = [];

  const upload = async (ref: string, kind: 'hero' | 'accommodation'): Promise<string> => {
    if (isRemoteUrl(ref)) return ref;
    const file = files.get(ref);
    if (!file) throw new Error('A photo was lost when the page reloaded. Pick it again.');
    return uploadTripImage(file, hostId, kind);
  };

  // 1. Media — same order as the app.
  const heroUrl = await upload(state.heroImage!, 'hero');
  const itinerary = await uploadItineraryPhotos(cleanItinerary(state.itinerary), uri => upload(uri, 'hero'));
  const accommodationImageUrl = state.accommodationImage
    ? await upload(state.accommodationImage, 'accommodation')
    : null;
  const galleryUrls = accommodationImageUrl
    ? await Promise.all(
        state.accommodationGallery.slice(0, STAY_GALLERY_MAX).map(u => upload(u, 'accommodation')),
      )
    : [];

  // 2. Rate.
  const rate = await rateForSave(currency);
  if (rate == null) {
    throw new Error("We couldn't get today's exchange rate. Try again in a moment, or set the price in USD.");
  }

  // 3. The trip.
  const row = buildTripInsert(state, {
    currency,
    rate,
    policy,
    rulesWire: rulesToWire(policy.rules),
    media: { heroUrl, accommodationImageUrl, galleryUrls, itinerary },
  });
  const { data: trip, error } = await supabase
    .from('group_trips')
    .insert({ ...row, host_id: hostId })
    .select('id, title')
    .single();
  if (error || !trip) throw new Error(error?.message || 'Failed to create trip');
  const tripId = trip.id as string;

  // 4. Host participant row.
  const { error: partErr } = await supabase
    .from('group_trip_participants')
    .insert({ trip_id: tripId, user_id: hostId, role: 'host' });
  if (partErr) console.warn('[createTrip] host participant insert failed:', partErr.message);

  // 5. Group chat — messagingService.createGroupConversation(title, [], { trip_id }).
  try {
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .insert({
        is_direct: false,
        title: ((trip.title as string | null) || 'Surftrip').trim(),
        created_by: hostId,
        metadata: { trip_id: tripId },
      })
      .select('id')
      .single();
    if (convErr) throw convErr;
    const { error: memErr } = await supabase
      .from('conversation_members')
      .insert({ conversation_id: conv.id, user_id: hostId, role: 'owner' });
    if (memErr) throw memErr;
  } catch (e) {
    console.warn('[createTrip] trip group chat creation failed:', e);
  }

  // 6 + 7. Waiver document, then the requirement rows.
  const kinds = requirementKindsToCreate(state);
  try {
    if (kinds.includes('waiver')) {
      if (input.waiverFile) await publishWaiverPdf(tripId, input.waiverFile);
      else if (input.defaultWaiver) await publishWaiverFromDefault(tripId, input.defaultWaiver);
    }
    await createRequirements(tripId, kinds, state.requirementTiming);
  } catch (e) {
    console.warn('[createTrip] requirement insert failed:', e);
    warnings.push(
      'Your trip published, but the traveler requirements — including payment collection, if you turned it on — could not be saved. Open the trip and add them from Edit.',
    );
  }

  // 8. Operator on the crew.
  const { error: crewErr } = await supabase.from('organized_trip_staff').insert({
    trip_id: tripId,
    operator_id: hostId,
    user_id: hostId,
    role_key: 'operator',
    title: 'Operator',
    bio: state.hostLeadNote.trim() || null,
    accepted_at: new Date().toISOString(),
  });
  if (crewErr && (crewErr as { code?: string }).code !== '23505') {
    console.warn('[createTrip] ensureOperatorOnCrew failed:', crewErr.message);
  }

  // 9. Destination + background geocode enrich.
  if (state.destinationGeo) {
    const { error: geoErr } = await supabase
      .from('group_trip_destinations')
      .upsert({ trip_id: tripId, ...destinationRow(state.destinationGeo) }, { onConflict: 'trip_id' });
    if (geoErr) {
      console.warn('[createTrip] setTripDestination failed:', geoErr.message);
    } else {
      supabase.functions
        .invoke('geocode-group-trip-destinations', { body: { trip_id: tripId } })
        .catch(e => console.warn('[createTrip] geocode enrich failed:', e));
    }
  }

  return { tripId, warnings };
}
