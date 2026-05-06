import type { ParticipantProfile } from '../services/trips/groupTripsService';

export type { ParticipantProfile };

export type SurftripRole = 'host' | 'admin' | 'member';
export type SurftripStatus = 'active' | 'archived';
export type SurftripRequestStatus = 'pending' | 'approved' | 'declined' | 'withdrawn';

export interface SurftripGroup {
  id: string;
  conversation_id: string;
  host_id: string;
  name: string;
  description: string | null;
  hero_image_url: string | null;
  status: SurftripStatus;
  max_members: number;
  created_at: string;
  updated_at: string;
}

export interface SurftripGroupForUser extends SurftripGroup {
  is_member: boolean;
  member_count: number;
  my_role: SurftripRole | null;
}

export interface SurftripGroupMember {
  id: string;
  group_id: string;
  user_id: string;
  role: SurftripRole;
  joined_at: string;
}

export interface EnrichedSurftripMember extends ParticipantProfile {
  role: SurftripRole;
  joined_at: string;
}

export interface SurftripJoinRequest {
  id: string;
  group_id: string;
  requester_id: string;
  status: SurftripRequestStatus;
  request_note: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

export interface EnrichedSurftripRequest extends SurftripJoinRequest {
  requester: ParticipantProfile;
}

export interface CreateSurftripInput {
  name: string;
  description?: string | null;
  heroImageUrl?: string | null;
  maxMembers?: number;
}
