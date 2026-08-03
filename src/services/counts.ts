import { supabase } from '../lib/supabase';

export type CountRow = {
  requirementId: string;
  expected: number;
  received: number;
  approved: number;
};

export type MedicalFlags = {
  injuriesReported: number;
  allergiesReported: number;
  dietaryReported: number;
  medicationsReported: number;
  formsCompleted: number;
};

/**
 * Received and approved counts per upload requirement.
 *
 * NAME TRAP: this is `organized_trip_document_counts`. The old
 * `group_trip_document_counts` was DROPPED in the July rename — calling it
 * gives a "function does not exist" error, not a fallback.
 *
 * The function itself checks `is_trip_host`, so a non-host gets an error
 * rather than an empty list.
 */
export async function fetchCounts(tripId: string): Promise<CountRow[]> {
  const { data, error } = await supabase.rpc('organized_trip_document_counts', {
    p_trip_id: tripId,
  });
  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    requirementId: r.requirement_id,
    expected: r.expected ?? 0,
    received: r.received ?? 0,
    approved: r.approved ?? 0,
  }));
}

/**
 * Medical counts only — never names, never the answers themselves.
 *
 * The view is `security_invoker`, so the operator's own RLS still applies and
 * they can only ever count their own trips.
 */
export async function fetchMedicalFlags(tripId: string): Promise<MedicalFlags> {
  const { data, error } = await supabase
    .from('organized_trip_medical_flags')
    .select('injuries_reported, allergies_reported, dietary_reported, medications_reported, forms_completed')
    .eq('trip_id', tripId)
    .maybeSingle();

  if (error) throw error;

  return {
    injuriesReported: Number(data?.injuries_reported ?? 0),
    allergiesReported: Number(data?.allergies_reported ?? 0),
    dietaryReported: Number(data?.dietary_reported ?? 0),
    medicationsReported: Number(data?.medications_reported ?? 0),
    formsCompleted: Number(data?.forms_completed ?? 0),
  };
}
