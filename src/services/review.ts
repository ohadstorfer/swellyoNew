import { supabase } from '../lib/supabase';
import {
  compareRequirements,
  deriveState,
  todayISO,
  type Requirement,
  type RequirementState,
} from '../domain/requirements';

export type ReviewItem = {
  requirementId: string;
  kind: string;
  reqType: string;
  title: string;
  dueDate: string | null;
  state: RequirementState;
  /** Upload kinds only — null for a waiver or the medical form. */
  documentId: string | null;
  storagePath: string | null;
  submittedAt: string | null;
  note: string | null;
  /** Past the 30-day purge the row outlives the file. */
  fileDeleted: boolean;
  /** Passport typed fields survive the purge. */
  fullName: string | null;
  nationality: string | null;
  expiryDate: string | null;
};

export type TravelerReview = {
  userId: string;
  items: ReviewItem[];
  /** Uploads sitting at `submitted` — the number the operator must act on. */
  toReview: number;
  done: number;
  total: number;
};

export type TripReview = {
  requirements: Requirement[];
  travelers: TravelerReview[];
  totalToReview: number;
  currentWaiverId: string | null;
};

/**
 * Everything needed to review one trip, in one round trip.
 *
 * Five parallel reads against tables the operator can already SELECT. There is
 * no RPC for this — `operator_trip_requirement_matrix` was specced but never
 * applied — so the composition happens here, exactly as the mobile app does it
 * in `fetchTripReview()`.
 *
 * `userIds` comes from the caller's member list rather than a join, because the
 * pages that need this already hold the roster.
 */
export async function fetchTripReview(
  tripId: string,
  userIds: string[],
): Promise<TripReview> {
  const [reqRes, docRes, ackRes, medRes, waiver] = await Promise.all([
    supabase
      .from('organized_trip_requirements_resolved')
      .select('id, kind, req_type, title, due_date, sort_order, skip_at_onboarding')
      .eq('trip_id', tripId)
      .eq('is_active', true),
    supabase
      .from('organized_trip_travelers_documents')
      .select(
        'id, user_id, requirement_id, storage_path, uploaded_at, approved_at, rejected_at, approbation_note, file_deleted_at, full_name, nationality, expiry_date',
      )
      .eq('trip_id', tripId),
    supabase
      .from('group_trip_acknowledgements')
      .select('user_id, requirement_id, agreed_at, operator_document_id')
      .eq('trip_id', tripId),
    supabase
      .from('organized_trip_medical_forms')
      .select('user_id, completed_at')
      .eq('trip_id', tripId),
    fetchCurrentWaiver(tripId),
  ]);

  if (reqRes.error) throw reqRes.error;
  if (docRes.error) throw docRes.error;
  if (ackRes.error) throw ackRes.error;
  if (medRes.error) throw medRes.error;

  const requirements: Requirement[] = (reqRes.data ?? [])
    // `pay` has no UI here — there is no ledger yet.
    .filter((r: any) => r.req_type !== 'pay')
    .map((r: any) => ({
      id: r.id,
      kind: r.kind,
      reqType: r.req_type,
      title: r.title,
      dueDate: r.due_date ?? null,
      sortOrder: r.sort_order ?? 0,
      skipAtOnboarding: r.skip_at_onboarding ?? null,
    }))
    .sort(compareRequirements);

  const docs = docRes.data ?? [];
  const acks = ackRes.data ?? [];
  const medical = medRes.data ?? [];
  const today = todayISO();
  const currentWaiverId = waiver?.id ?? null;

  const travelers: TravelerReview[] = userIds.map(userId => {
    const items = requirements.map((r): ReviewItem => {
      const d = docs.find((x: any) => x.requirement_id === r.id && x.user_id === userId);
      const ack = acks.find(
        (a: any) => a.requirement_id === r.id && a.user_id === userId,
      );
      const med = medical.find((x: any) => x.user_id === userId);

      const state = deriveState(
        r,
        {
          doc: d
            ? {
                id: d.id,
                userId: d.user_id,
                requirementId: d.requirement_id,
                storagePath: d.storage_path ?? null,
                uploadedAt: d.uploaded_at ?? null,
                approvedAt: d.approved_at ?? null,
                rejectedAt: d.rejected_at ?? null,
                note: d.approbation_note ?? null,
                fileDeletedAt: d.file_deleted_at ?? null,
              }
            : null,
          ack: ack
            ? {
                userId: ack.user_id,
                requirementId: ack.requirement_id,
                agreedAt: ack.agreed_at ?? null,
                operatorDocumentId: ack.operator_document_id ?? null,
              }
            : null,
          medical: med ? { userId: med.user_id, completedAt: med.completed_at ?? null } : null,
          currentWaiverId,
        },
        today,
      );

      // What "submitted at" means depends on which kind of evidence there is.
      const submittedAt =
        r.reqType === 'acknowledge'
          ? (ack?.agreed_at ?? null)
          : r.kind === 'medical'
            ? (med?.completed_at ?? null)
            : (d?.uploaded_at ?? null);

      const isUpload = r.reqType !== 'acknowledge' && r.kind !== 'medical';

      return {
        requirementId: r.id,
        kind: r.kind,
        reqType: r.reqType,
        title: r.title,
        dueDate: r.dueDate,
        state,
        documentId: isUpload ? (d?.id ?? null) : null,
        storagePath: isUpload ? (d?.storage_path ?? null) : null,
        submittedAt,
        note: isUpload ? (d?.approbation_note ?? null) : null,
        fileDeleted: isUpload ? !!d?.file_deleted_at : false,
        fullName: isUpload ? (d?.full_name ?? null) : null,
        nationality: isUpload ? (d?.nationality ?? null) : null,
        expiryDate: isUpload ? (d?.expiry_date ?? null) : null,
      };
    });

    return {
      userId,
      items,
      toReview: items.filter(i => i.state === 'submitted').length,
      done: items.filter(i => i.state === 'approved').length,
      total: items.length,
    };
  });

  return {
    requirements,
    travelers,
    totalToReview: travelers.reduce((n, t) => n + t.toReview, 0),
    currentWaiverId,
  };
}

/** The trip's current waiver version. Older agreements do not count against it. */
export async function fetchCurrentWaiver(
  tripId: string,
): Promise<{ id: string; version: number } | null> {
  const { data, error } = await supabase
    .from('organized_trip_operator_documents')
    .select('id, version')
    .eq('trip_id', tripId)
    .eq('kind', 'waiver')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? { id: data.id, version: data.version } : null;
}
