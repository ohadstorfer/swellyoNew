import { supabase } from '../../config/supabase';

export type HostingStyle = 'A' | 'B' | 'C';
export type SurfLevel = 'beginner' | 'intermediate' | 'advanced' | 'pro' | 'all';
export type SurfStyle = 'shortboard' | 'midlength' | 'longboard' | 'softtop' | 'all';

export interface TripVibe {
  morning?: string[];
  afternoon?: string[];
  evening?: string[];
  night?: string[];
}

export interface SurfSpot {
  name: string;
  country?: string;
}

export interface GroupTrip {
  id: string;
  host_id: string;
  hosting_style: HostingStyle;

  title: string | null;
  description: string;
  hero_image_url: string;

  start_date: string | null;
  end_date: string | null;
  dates_set_in_stone: boolean | null;
  date_months: string[] | null;

  destination_country: string | null;
  destination_area: string | null;
  destination_spot: string[] | null;

  accommodation_type: string[] | null;
  accommodation_name: string | null;
  accommodation_url: string | null;
  accommodation_image_url: string | null;

  vibe: TripVibe | null;
  surf_spots: SurfSpot[] | null;

  age_min: number;
  age_max: number;
  target_surf_levels: SurfLevel[];
  target_surf_styles: SurfStyle[];
  wave_fat_to_barreling: number | null;
  wave_size_min: number | null;
  wave_size_max: number | null;

  created_at: string;
  updated_at: string;
}

export interface GroupTripParticipant {
  id: string;
  trip_id: string;
  user_id: string;
  role: 'host' | 'member';
  joined_at: string;
}

export type CreateGroupTripInput = Omit<
  GroupTrip,
  'id' | 'host_id' | 'created_at' | 'updated_at'
>;

/**
 * Insert a new group trip and add the host as a participant with role='host'.
 * Returns the created trip row.
 */
export async function createGroupTrip(
  hostId: string,
  input: CreateGroupTripInput
): Promise<GroupTrip> {
  const { data, error } = await supabase
    .from('group_trips')
    .insert({ ...input, host_id: hostId })
    .select()
    .single();

  if (error || !data) {
    console.error('[groupTripsService] createGroupTrip error:', error);
    throw new Error(error?.message || 'Failed to create trip');
  }

  const trip = data as GroupTrip;

  // Best-effort: add host as participant. Do not fail the whole create if this errors.
  const { error: participantError } = await supabase
    .from('group_trip_participants')
    .insert({ trip_id: trip.id, user_id: hostId, role: 'host' });

  if (participantError) {
    console.warn('[groupTripsService] host participant insert failed:', participantError);
  }

  return trip;
}

export async function listExploreTrips(limit = 50, offset = 0): Promise<GroupTrip[]> {
  const { data, error } = await supabase
    .from('group_trips')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('[groupTripsService] listExploreTrips error:', error);
    return [];
  }
  return (data || []) as GroupTrip[];
}

export async function listMyTrips(hostId: string): Promise<GroupTrip[]> {
  const { data, error } = await supabase
    .from('group_trips')
    .select('*')
    .eq('host_id', hostId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[groupTripsService] listMyTrips error:', error);
    return [];
  }
  return (data || []) as GroupTrip[];
}

export async function deleteGroupTrip(tripId: string): Promise<boolean> {
  const { error } = await supabase.from('group_trips').delete().eq('id', tripId);
  if (error) {
    console.error('[groupTripsService] deleteGroupTrip error:', error);
    return false;
  }
  return true;
}
