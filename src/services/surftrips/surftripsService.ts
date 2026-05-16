import { supabase } from '../../config/supabase';
import { messagingService } from '../messaging/messagingService';
import type {
  CreateSurftripInput,
  EnrichedSurftripMember,
  EnrichedSurftripRequest,
  SurftripGroup,
  SurftripGroupForUser,
  SurftripGroupMember,
  SurftripJoinRequest,
} from '../../types/surftrips';
import type { ParticipantProfile } from '../trips/groupTripsService';

/**
 * Create a surftrip group via the security-definer RPC. The RPC creates the
 * conversation row, the surftrip group row, the host membership in
 * surftrip_group_members AND conversation_members, all in one transaction.
 */
export async function createSurftripGroup(
  input: CreateSurftripInput
): Promise<SurftripGroup> {
  const { data, error } = await supabase.rpc('create_surftrip_group', {
    p_name: input.name.trim(),
    p_description: input.description?.trim() || null,
    p_hero_image_url: input.heroImageUrl ?? null,
    p_max_members: input.maxMembers ?? 50,
  });

  if (error || !data) {
    console.error('[surftripsService] createSurftripGroup error:', error);
    throw new Error(error?.message || 'Failed to create surftrip');
  }
  return data as SurftripGroup;
}

export async function listSurftripsForUser(
  userId: string
): Promise<SurftripGroupForUser[]> {
  const { data, error } = await supabase.rpc('get_surftrips_for_user', {
    p_user: userId,
  });
  if (error) {
    console.error('[surftripsService] listSurftripsForUser error:', error);
    return [];
  }
  return (data || []) as SurftripGroupForUser[];
}

export async function getSurftripGroup(
  groupId: string
): Promise<SurftripGroup | null> {
  const { data, error } = await supabase
    .from('surftrip_groups')
    .select('*')
    .eq('id', groupId)
    .maybeSingle();
  if (error) {
    console.error('[surftripsService] getSurftripGroup error:', error);
    return null;
  }
  return (data ?? null) as SurftripGroup | null;
}

/**
 * Build a tokenized invite URL for a surftrip. The token encodes who shared
 * (and their role at creation time) so the accept-side RPC can decide whether
 * to auto-join (admin-shared) or open a pending request (member-shared).
 * One stable token per (group, sharer) — calling this repeatedly returns the
 * same URL.
 */
export async function getSurftripInviteUrl(groupId: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_surftrip_invite', {
    p_group_id: groupId,
  });
  if (error || !data) {
    console.error('[surftripsService] getSurftripInviteUrl error:', error);
    throw new Error(error?.message || 'Could not create invite link');
  }
  const token = String(data);
  const base = 'https://swellyo-invite.netlify.app';
  return `${base}/?surftrip=${encodeURIComponent(groupId)}&t=${encodeURIComponent(token)}`;
}

export type AcceptInviteOutcome =
  | { outcome: 'invalid' }
  | { outcome: 'group_full' }
  | { outcome: 'already_member'; group_id: string; conversation_id: string }
  | { outcome: 'joined'; group_id: string; conversation_id: string }
  | { outcome: 'open_detail'; group_id: string };

/**
 * Accept a surftrip invite via its token. The RPC decides between auto-join
 * (admin-shared, sharer still authoritative) and creating a pending request.
 * Caller must be authenticated.
 */
export async function acceptSurftripInvite(token: string): Promise<AcceptInviteOutcome> {
  const { data, error } = await supabase.rpc('accept_surftrip_invite', {
    p_token: token,
  });
  if (error) {
    console.error('[surftripsService] acceptSurftripInvite error:', error);
    throw new Error(error.message || 'Could not accept invite');
  }
  const outcome = data as AcceptInviteOutcome;
  return outcome;
}

export interface SurftripInvitePreview {
  group_name: string | null;
  hero_image_url: string | null;
  host_display_name: string | null;
  member_count: number | null;
  max_members: number | null;
}

/**
 * Anonymous-callable preview for the web "Get the app" landing page.
 * Returns null fields when token is invalid/revoked (don't leak existence).
 */
export async function getSurftripInvitePreview(
  token: string
): Promise<SurftripInvitePreview> {
  const { data, error } = await supabase.rpc('get_surftrip_invite_preview', {
    p_token: token,
  });
  if (error) {
    console.error('[surftripsService] getSurftripInvitePreview error:', error);
    return {
      group_name: null,
      hero_image_url: null,
      host_display_name: null,
      member_count: null,
      max_members: null,
    };
  }
  return data as SurftripInvitePreview;
}

export async function deleteSurftripGroup(groupId: string): Promise<void> {
  const { error } = await supabase
    .from('surftrip_groups')
    .delete()
    .eq('id', groupId);
  if (error) {
    console.error('[surftripsService] deleteSurftripGroup error:', error);
    throw new Error(error.message);
  }
}

export async function updateSurftripGroup(
  groupId: string,
  input: {
    name?: string;
    description?: string | null;
    heroImageUrl?: string | null;
    maxMembers?: number;
  }
): Promise<SurftripGroup> {
  const patch: Record<string, any> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined) patch.description = input.description ?? null;
  if (input.heroImageUrl !== undefined) patch.hero_image_url = input.heroImageUrl ?? null;
  if (input.maxMembers !== undefined) {
    patch.max_members = Math.max(2, Math.min(200, Math.floor(input.maxMembers)));
  }

  const { data, error } = await supabase
    .from('surftrip_groups')
    .update(patch)
    .eq('id', groupId)
    .select()
    .single();

  if (error || !data) {
    console.error('[surftripsService] updateSurftripGroup error:', error);
    throw new Error(error?.message || 'Failed to update surftrip');
  }

  // Keep the linked conversation's title in sync with the group name.
  if (input.name !== undefined) {
    const { error: convError } = await supabase
      .from('conversations')
      .update({ title: patch.name })
      .eq('id', (data as SurftripGroup).conversation_id);
    if (convError) {
      console.warn('[surftripsService] updateSurftripGroup: conversation title sync failed:', convError);
    }
  }

  return data as SurftripGroup;
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export async function listMembers(
  groupId: string
): Promise<EnrichedSurftripMember[]> {
  const { data: rows, error } = await supabase
    .from('surftrip_group_members')
    .select('user_id, role, joined_at')
    .eq('group_id', groupId)
    .order('joined_at', { ascending: true });

  if (error) {
    console.error('[surftripsService] listMembers error:', error);
    return [];
  }
  if (!rows || rows.length === 0) return [];

  const userIds = Array.from(new Set(rows.map((r: any) => r.user_id)));
  const profiles = await fetchProfiles(userIds);

  return rows.map((r: any) => ({
    ...emptyProfile(r.user_id),
    ...(profiles.get(r.user_id) || {}),
    role: r.role,
    joined_at: r.joined_at,
  }));
}

export async function promoteToAdmin(
  groupId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('surftrip_group_members')
    .update({ role: 'admin' })
    .eq('group_id', groupId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}

export async function demoteToMember(
  groupId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('surftrip_group_members')
    .update({ role: 'member' })
    .eq('group_id', groupId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}

async function deleteMembership(groupId: string, userId: string): Promise<void> {
  const group = await getSurftripGroup(groupId);
  const { error } = await supabase
    .from('surftrip_group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);

  if (group?.conversation_id) {
    try {
      await messagingService.removeConversationMember(
        group.conversation_id,
        userId
      );
    } catch (e) {
      console.warn('[surftripsService] deleteMembership chat removal failed:', e);
    }
  }
}

/**
 * Host or admin removes another member. Fires the removal push notification.
 * The "<X> left the group" banner is emitted server-side by the
 * trg_surftrip_member_left_banner trigger on surftrip_group_members, so this
 * function just deletes the membership and triggers the push.
 */
export async function removeMember(
  groupId: string,
  userId: string
): Promise<void> {
  await deleteMembership(groupId, userId);
  try {
    await supabase.functions.invoke('send-surftrip-removed-notification', {
      body: { group_id: groupId, removed_user_id: userId },
    });
  } catch (e) {
    console.warn('[surftripsService] removeMember notification failed:', e);
  }
}

/**
 * User self-leaves. Does NOT send the removal push (they did it themselves).
 * The "<X> left the group" banner is emitted server-side by the
 * trg_surftrip_member_left_banner trigger.
 */
export async function leaveGroup(
  groupId: string,
  userId: string
): Promise<void> {
  await deleteMembership(groupId, userId);
}

// ---------------------------------------------------------------------------
// Admin: add members directly from existing DMs (no join request)
// ---------------------------------------------------------------------------

export interface AddableDmPartner extends ParticipantProfile {
  last_dm_at: string | null;
}

/**
 * Host/admin: list users the caller has 1-1 DMs with, excluding anyone
 * already in the group. Sorted by most recent DM activity.
 */
export async function listAddableDmPartners(
  groupId: string
): Promise<AddableDmPartner[]> {
  const { data, error } = await supabase.rpc('list_addable_dm_partners', {
    p_group_id: groupId,
  });
  if (error) {
    console.error('[surftripsService] listAddableDmPartners error:', error);
    throw new Error(error.message || 'Could not load chat partners');
  }
  const rows = (data || []) as { user_id: string; last_dm_at: string | null }[];
  if (rows.length === 0) return [];

  const userIds = rows.map(r => r.user_id);
  const profiles = await fetchProfiles(userIds);

  return rows.map(r => ({
    ...emptyProfile(r.user_id),
    ...(profiles.get(r.user_id) || {}),
    last_dm_at: r.last_dm_at,
  }));
}

/**
 * List the caller's 1-1 DM partners. Used at surftrip-creation time so the
 * host can pick people to add immediately, before the group exists.
 */
export async function listMyDmPartners(): Promise<AddableDmPartner[]> {
  const { data, error } = await supabase.rpc('list_my_dm_partners');
  if (error) {
    console.error('[surftripsService] listMyDmPartners error:', error);
    throw new Error(error.message || 'Could not load chat partners');
  }
  const rows = (data || []) as { user_id: string; last_dm_at: string | null }[];
  if (rows.length === 0) return [];

  const userIds = rows.map(r => r.user_id);
  const profiles = await fetchProfiles(userIds);

  return rows.map(r => ({
    ...emptyProfile(r.user_id),
    ...(profiles.get(r.user_id) || {}),
    last_dm_at: r.last_dm_at,
  }));
}

/**
 * Host/admin: bulk-add picked DM partners to the group. Caps to the group's
 * remaining slots; returns the ids actually added so the caller can show a
 * partial-success toast when the group fills up.
 */
export async function addMembersFromDms(
  groupId: string,
  userIds: string[]
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await supabase.rpc('add_surftrip_members_from_dms', {
    p_group_id: groupId,
    p_user_ids: userIds,
  });
  if (error) {
    console.error('[surftripsService] addMembersFromDms error:', error);
    throw new Error(error.message || 'Could not add members');
  }
  // "<X> joined the group" banners are emitted server-side by the
  // trg_surftrip_member_joined_banner trigger on surftrip_group_members.
  return (data || []) as string[];
}

// ---------------------------------------------------------------------------
// Join requests
// ---------------------------------------------------------------------------

export async function listPendingRequests(
  groupId: string
): Promise<EnrichedSurftripRequest[]> {
  const { data, error } = await supabase
    .from('surftrip_join_requests')
    .select('*')
    .eq('group_id', groupId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[surftripsService] listPendingRequests error:', error);
    return [];
  }
  const rows = (data || []) as SurftripJoinRequest[];
  if (rows.length === 0) return [];

  const userIds = Array.from(new Set(rows.map(r => r.requester_id)));
  const profiles = await fetchProfiles(userIds);

  return rows.map(r => ({
    ...r,
    requester: profiles.get(r.requester_id) || emptyProfile(r.requester_id),
  }));
}

export async function getMyRequest(
  groupId: string,
  userId: string
): Promise<SurftripJoinRequest | null> {
  const { data, error } = await supabase
    .from('surftrip_join_requests')
    .select('*')
    .eq('group_id', groupId)
    .eq('requester_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[surftripsService] getMyRequest error:', error);
    return null;
  }
  return (data ?? null) as SurftripJoinRequest | null;
}

export async function requestToJoin(
  groupId: string,
  userId: string,
  note?: string
): Promise<SurftripJoinRequest> {
  const { data, error } = await supabase
    .from('surftrip_join_requests')
    .insert({
      group_id: groupId,
      requester_id: userId,
      request_note: note?.trim() || null,
    })
    .select()
    .single();
  if (error || !data) {
    console.error('[surftripsService] requestToJoin error:', error);
    throw new Error(error?.message || 'Could not submit request');
  }
  return data as SurftripJoinRequest;
}

export async function withdrawRequest(requestId: string): Promise<void> {
  const { error } = await supabase
    .from('surftrip_join_requests')
    .update({ status: 'withdrawn' })
    .eq('id', requestId);
  if (error) throw new Error(error.message);
}

export async function approveRequest(requestId: string): Promise<void> {
  const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
  const { error } = await supabase
    .from('surftrip_join_requests')
    .update({
      status: 'approved',
      reviewed_at: new Date().toISOString(),
      reviewed_by: userId,
    })
    .eq('id', requestId);
  if (error) throw new Error(error.message);
  // The approval UPDATE fires handle_surftrip_join_request_approval, which
  // inserts the new surftrip_group_members row, which fires
  // trg_surftrip_member_joined_banner — the "<X> joined the group" banner
  // lands server-side regardless of whether the approving admin's client
  // stays online.
}

export async function declineRequest(requestId: string): Promise<void> {
  const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
  const { error } = await supabase
    .from('surftrip_join_requests')
    .update({
      status: 'declined',
      reviewed_at: new Date().toISOString(),
      reviewed_by: userId,
    })
    .eq('id', requestId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function fetchProfiles(
  userIds: string[]
): Promise<Map<string, ParticipantProfile>> {
  if (userIds.length === 0) return new Map();
  const { data: surfers } = await supabase
    .from('surfers')
    .select(
      'user_id, name, age, surfboard_type, surf_level_category, profile_image_url, lifestyle_keywords'
    )
    .in('user_id', userIds);

  const m = new Map<string, ParticipantProfile>();
  (surfers || []).forEach((s: any) => {
    m.set(s.user_id, {
      user_id: s.user_id,
      name: s.name ?? null,
      age: s.age ?? null,
      surfboard_type: s.surfboard_type ?? null,
      surf_level_category: s.surf_level_category ?? null,
      profile_image_url: s.profile_image_url ?? null,
      lifestyle_keywords: s.lifestyle_keywords ?? null,
    });
  });
  return m;
}

function emptyProfile(userId: string): ParticipantProfile {
  return {
    user_id: userId,
    name: null,
    age: null,
    surfboard_type: null,
    surf_level_category: null,
    profile_image_url: null,
    lifestyle_keywords: null,
  };
}
