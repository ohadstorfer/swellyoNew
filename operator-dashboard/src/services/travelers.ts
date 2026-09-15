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
  /**
   * The person, not the surfer. Product Specs §"Trip dashboard space":
   * "clicking members opens the personal full profile, not the surf-travel
   * one". The four fields above are the surf-travel card; these are what make
   * a traveler page read as a person.
   *
   * Every one of these is a column that EXISTS on `surfers` — checked against
   * the live schema, not the repo. PostgREST answers a select naming a missing
   * column with a 400, which would take out every page that reads a profile.
   */
  bio: string | null;
  pronoun: string | null;
  /** Where they surf at home. The closest thing this product has to "where are
   *  you from" beyond a country code. */
  homeBreak: string | null;
  lifestyle: string[] | null;
};

export type MedicalForm = {
  userId: string;
  /** Who to call about this traveler. Part of the medical record, so it is read
   *  under `medical.view` like everything else on this row — the operator of
   *  record alone (20260824000000, decision D1). */
  emergencyName: string | null;
  emergencyPhone: string | null;
  emergencyRelation: string | null;
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

  // `profile_image_url`, NOT `profile_photo_url`. Both columns exist on
  // `surfers` and only the first one is ever written — the app writes it
  // everywhere and never mentions the other. Reading the wrong one showed a
  // letter instead of a face for 684 of 685 people on production.
  const { data, error } = await supabase
    .from('surfers')
    .select(
      'user_id, name, profile_image_url, age, country_from, surf_level_category, surfboard_type, travel_experience, bio, pronoun, home_break_short, lifestyle_keywords',
    )
    .in('user_id', userIds);

  if (error) throw error;

  const map = new Map<string, SurferProfile>();
  for (const r of data ?? []) {
    map.set(r.user_id, {
      userId: r.user_id,
      name: r.name ?? 'Unnamed traveler',
      photoUrl: r.profile_image_url ?? null,
      age: r.age ?? null,
      countryFrom: r.country_from ?? null,
      surfLevel: r.surf_level_category ?? null,
      boardType: r.surfboard_type ?? null,
      bio: (r.bio as string | null) ?? null,
      pronoun: (r.pronoun as string | null) ?? null,
      homeBreak: (r.home_break_short as string | null) ?? null,
      lifestyle: Array.isArray(r.lifestyle_keywords) ? (r.lifestyle_keywords as string[]) : null,
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
      'user_id, allergies, allergies_none, dietary, dietary_none, injuries, injuries_none, medications, medications_none, emergency_name, emergency_phone, emergency_relation, completed_at',
    )
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    userId: data.user_id,
    emergencyName: (data.emergency_name as string | null) ?? null,
    emergencyPhone: (data.emergency_phone as string | null) ?? null,
    emergencyRelation: (data.emergency_relation as string | null) ?? null,
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
      'user_id, allergies, allergies_none, dietary, dietary_none, injuries, injuries_none, medications, medications_none, emergency_name, emergency_phone, emergency_relation, completed_at',
    )
    .eq('trip_id', tripId);

  if (error) throw error;
  return (data ?? []).map((d: any) => ({
    userId: d.user_id,
    emergencyName: (d.emergency_name as string | null) ?? null,
    emergencyPhone: (d.emergency_phone as string | null) ?? null,
    emergencyRelation: (d.emergency_relation as string | null) ?? null,
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
