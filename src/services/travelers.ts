import { supabase } from '../lib/supabase';

export type SurferProfile = {
  userId: string;
  name: string;
  photoUrl: string | null;
  age: number | null;
  countryFrom: string | null;
  surfLevel: string | null;
  boardType: string | null;
  travelExperience: string | null;
};

export type MedicalForm = {
  userId: string;
  allergies: string | null;
  allergiesNone: boolean;
  dietary: string | null;
  dietaryNone: boolean;
  injuries: string | null;
  injuriesNone: boolean;
  medications: string | null;
  medicationsNone: boolean;
  completedAt: string | null;
};

export async function fetchProfiles(userIds: string[]): Promise<Map<string, SurferProfile>> {
  if (userIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('surfers')
    .select(
      'user_id, name, profile_photo_url, age, country_from, surf_level_category, surfboard_type, travel_experience',
    )
    .in('user_id', userIds);

  if (error) throw error;

  const map = new Map<string, SurferProfile>();
  for (const r of data ?? []) {
    map.set(r.user_id, {
      userId: r.user_id,
      name: r.name ?? 'Unnamed traveler',
      photoUrl: r.profile_photo_url ?? null,
      age: r.age ?? null,
      countryFrom: r.country_from ?? null,
      surfLevel: r.surf_level_category ?? null,
      boardType: r.surfboard_type ?? null,
      travelExperience: r.travel_experience ?? null,
    });
  }
  return map;
}

/**
 * One traveler's medical answers.
 *
 * The operator has SELECT here and nothing else — there is no insert, update
 * or delete policy for them, by design. Reading this is allowed; changing it
 * never is.
 */
export async function fetchMedicalForm(
  tripId: string,
  userId: string,
): Promise<MedicalForm | null> {
  const { data, error } = await supabase
    .from('organized_trip_medical_forms')
    .select(
      'user_id, allergies, allergies_none, dietary, dietary_none, injuries, injuries_none, medications, medications_none, completed_at',
    )
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    userId: data.user_id,
    allergies: data.allergies ?? null,
    allergiesNone: !!data.allergies_none,
    dietary: data.dietary ?? null,
    dietaryNone: !!data.dietary_none,
    injuries: data.injuries ?? null,
    injuriesNone: !!data.injuries_none,
    medications: data.medications ?? null,
    medicationsNone: !!data.medications_none,
    completedAt: data.completed_at ?? null,
  };
}

/** Every completed medical form on the trip — for the medical view-all page. */
export async function fetchMedicalForms(tripId: string): Promise<MedicalForm[]> {
  const { data, error } = await supabase
    .from('organized_trip_medical_forms')
    .select(
      'user_id, allergies, allergies_none, dietary, dietary_none, injuries, injuries_none, medications, medications_none, completed_at',
    )
    .eq('trip_id', tripId);

  if (error) throw error;
  return (data ?? []).map((d: any) => ({
    userId: d.user_id,
    allergies: d.allergies ?? null,
    allergiesNone: !!d.allergies_none,
    dietary: d.dietary ?? null,
    dietaryNone: !!d.dietary_none,
    injuries: d.injuries ?? null,
    injuriesNone: !!d.injuries_none,
    medications: d.medications ?? null,
    medicationsNone: !!d.medications_none,
    completedAt: d.completed_at ?? null,
  }));
}
