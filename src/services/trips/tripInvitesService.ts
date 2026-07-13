import { supabase } from '../../config/supabase';
import { scoreCandidateForTrip, type CandidateProfile, type TripInviteCriteria } from './tripInviteMatching';

export type TripInviteStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface TripInvite {
  id: string;
  trip_id: string;
  invited_user_id: string;
  invited_by: string;
  status: TripInviteStatus;
  created_at: string;
  responded_at: string | null;
}

export interface InviteCandidate extends CandidateProfile {
  name: string;
  profile_image_url: string | null;
  score: number;
}

export async function inviteUserToTrip(tripId: string, invitedUserId: string, invitedBy: string): Promise<TripInvite> {
  const { data, error } = await supabase
    .from('trip_invites')
    .insert({ trip_id: tripId, invited_user_id: invitedUserId, invited_by: invitedBy, status: 'pending' })
    .select()
    .single();
  if (error) throw error;
  return data as TripInvite;
}

export async function listPendingInvites(tripId: string): Promise<TripInvite[]> {
  const { data, error } = await supabase
    .from('trip_invites')
    .select('*')
    .eq('trip_id', tripId)
    .eq('status', 'pending');
  if (error) throw error;
  return (data ?? []) as TripInvite[];
}

export async function respondToInvite(inviteId: string, response: 'accepted' | 'declined', respondingUserId: string): Promise<void> {
  const { error } = await supabase
    .from('trip_invites')
    .update({ status: response, responded_at: new Date().toISOString() })
    .eq('id', inviteId)
    .eq('invited_user_id', respondingUserId);
  if (error) throw error;
}

// Profile fields (name, country_from, surfboard_type, surf_level_category, age,
// profile_image_url) live on the `surfers` table, keyed by `user_id` — not on the
// `users` table (which is auth/account data keyed by `id`). See ParticipantProfile /
// PARTICIPANT_PROFILE_FIELDS in groupTripsService.ts for the authoritative shape.
const CANDIDATE_PROFILE_FIELDS =
  'user_id, name, age, country_from, surfboard_type, surf_level_category, profile_image_url';

export async function listInviteCandidates(
  tripId: string,
  criteria: TripInviteCriteria = {},
): Promise<InviteCandidate[]> {
  const [{ data: participants, error: pErr }, { data: invites, error: iErr }] = await Promise.all([
    supabase.from('group_trip_participants').select('user_id').eq('trip_id', tripId),
    supabase.from('trip_invites').select('invited_user_id').eq('trip_id', tripId).in('status', ['pending', 'accepted']),
  ]);
  if (pErr) throw pErr;
  if (iErr) throw iErr;

  const excluded = new Set([
    ...(participants ?? []).map((p: { user_id: string }) => p.user_id),
    ...(invites ?? []).map((i: { invited_user_id: string }) => i.invited_user_id),
  ]);

  const { data: surfers, error: sErr } = await supabase
    .from('surfers')
    .select(CANDIDATE_PROFILE_FIELDS)
    .limit(200);
  if (sErr) throw sErr;

  return (surfers ?? [])
    .filter((s: { user_id: string }) => !excluded.has(s.user_id))
    .map((s: {
      user_id: string;
      name: string | null;
      profile_image_url: string | null;
      country_from: string | null;
      surfboard_type: string | null;
      surf_level_category: string | null;
      age: number | null;
    }) => ({
      user_id: s.user_id,
      name: s.name ?? '',
      profile_image_url: s.profile_image_url,
      country_from: s.country_from,
      surfboard_type: s.surfboard_type,
      surf_level_category: s.surf_level_category,
      age: s.age,
      score: scoreCandidateForTrip(criteria, {
        user_id: s.user_id,
        country_from: s.country_from,
        surfboard_type: s.surfboard_type,
        surf_level_category: s.surf_level_category,
        age: s.age,
      }),
    }))
    .sort((a, b) => b.score - a.score);
}
