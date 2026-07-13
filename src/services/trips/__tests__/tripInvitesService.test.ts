jest.mock('../../../config/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));
import { supabase } from '../../../config/supabase';
import { inviteUserToTrip, respondToInvite, listInviteCandidates } from '../tripInvitesService';

describe('tripInvitesService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('inviteUserToTrip upserts a pending invite row keyed on trip_id+invited_user_id (re-invite safe)', async () => {
    const single = jest.fn().mockResolvedValue({ data: { id: 'inv1', trip_id: 't1', invited_user_id: 'u2', invited_by: 'u1', status: 'pending', created_at: 'now', responded_at: null }, error: null });
    const select = jest.fn(() => ({ single }));
    const upsert = jest.fn(() => ({ select }));
    (supabase.from as jest.Mock).mockReturnValue({ upsert });

    const result = await inviteUserToTrip('t1', 'u2', 'u1');

    expect(supabase.from).toHaveBeenCalledWith('trip_invites');
    expect(upsert).toHaveBeenCalledWith(
      { trip_id: 't1', invited_user_id: 'u2', invited_by: 'u1', status: 'pending', responded_at: null },
      { onConflict: 'trip_id,invited_user_id' },
    );
    expect(result.id).toBe('inv1');
  });

  it('re-inviting a previously declined/cancelled user resets status to pending rather than erroring on the unique constraint', async () => {
    // Simulates the DB already having a row for this trip+user in status
    // 'declined' — the upsert must succeed and come back pending, not error
    // with a duplicate-key violation the way a plain insert would.
    const single = jest.fn().mockResolvedValue({ data: { id: 'inv1', trip_id: 't1', invited_user_id: 'u2', invited_by: 'u1', status: 'pending', created_at: 'now', responded_at: null }, error: null });
    const select = jest.fn(() => ({ single }));
    const upsert = jest.fn(() => ({ select }));
    (supabase.from as jest.Mock).mockReturnValue({ upsert });

    const result = await inviteUserToTrip('t1', 'u2', 'u1');

    expect(result.status).toBe('pending');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', responded_at: null }),
      { onConflict: 'trip_id,invited_user_id' },
    );
  });

  it('respondToInvite updates status and responded_at, scoped to the responding user, and never touches group_trip_participants (declined)', async () => {
    const single = jest.fn().mockResolvedValue({ data: { trip_id: 't1' }, error: null });
    const select = jest.fn(() => ({ single }));
    const eq2 = jest.fn(() => ({ select }));
    const eq1 = jest.fn(() => ({ eq: eq2 }));
    const update = jest.fn(() => ({ eq: eq1 }));
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'trip_invites') return { update };
      throw new Error(`unexpected table ${table}`);
    });

    await respondToInvite('inv1', 'declined', 'u2');

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'declined' }));
    expect(eq1).toHaveBeenCalledWith('id', 'inv1');
    expect(eq2).toHaveBeenCalledWith('invited_user_id', 'u2');
    expect(supabase.from).not.toHaveBeenCalledWith('group_trip_participants');
  });

  it('respondToInvite on accept only updates the invite row — participant-add is a DB trigger effect, not a client insert', async () => {
    // The RLS INSERT policy on group_trip_participants requires an approved
    // join_request or host status, neither of which an invitee has, so this
    // write must NOT be attempted client-side (see tg_notify_trip_invite_decided
    // in 20260713000100_trip_invites.sql, which does it server-side instead).
    const single = jest.fn().mockResolvedValue({ data: { trip_id: 't1' }, error: null });
    const select = jest.fn(() => ({ single }));
    const eq2 = jest.fn(() => ({ select }));
    const eq1 = jest.fn(() => ({ eq: eq2 }));
    const update = jest.fn(() => ({ eq: eq1 }));
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'trip_invites') return { update };
      throw new Error(`unexpected table ${table}`);
    });

    await respondToInvite('inv1', 'accepted', 'u2');

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'accepted' }));
    expect(supabase.from).not.toHaveBeenCalledWith('group_trip_participants');
  });

  describe('listInviteCandidates', () => {
    const participantUserId = 'existing-participant';
    const pendingInvitedUserId = 'pending-invitee';
    const eligibleGoodMatchId = 'eligible-good-match';
    const eligiblePartialMatchId = 'eligible-partial-match';
    const eligibleZeroMatchId = 'eligible-zero-match';

    function mockSupabaseFrom() {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'group_trip_participants') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn().mockResolvedValue({
                data: [{ user_id: participantUserId }],
                error: null,
              }),
            })),
          };
        }
        if (table === 'trip_invites') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                in: jest.fn().mockResolvedValue({
                  data: [{ invited_user_id: pendingInvitedUserId }],
                  error: null,
                }),
              })),
            })),
          };
        }
        if (table === 'surfers') {
          return {
            select: jest.fn(() => ({
              limit: jest.fn().mockResolvedValue({
                data: [
                  { user_id: participantUserId, name: 'Participant', profile_image_url: null, country_from: 'France', surfboard_type: 'shortboard', surf_level_category: 'advanced', age: 30 },
                  { user_id: pendingInvitedUserId, name: 'Pending Invitee', profile_image_url: null, country_from: 'France', surfboard_type: 'shortboard', surf_level_category: 'advanced', age: 30 },
                  { user_id: eligibleGoodMatchId, name: 'Good Match', profile_image_url: null, country_from: 'France', surfboard_type: 'shortboard', surf_level_category: 'advanced', age: 30 },
                  // Matches on country only — nonzero score, should still surface (just ranked lower).
                  { user_id: eligiblePartialMatchId, name: 'Partial Match', profile_image_url: null, country_from: 'France', surfboard_type: 'longboard', surf_level_category: 'beginner', age: 50 },
                  // Matches on nothing — score 0, must be excluded entirely (finding #3).
                  { user_id: eligibleZeroMatchId, name: 'Zero Match', profile_image_url: null, country_from: 'Israel', surfboard_type: 'longboard', surf_level_category: 'beginner', age: 50 },
                ],
                error: null,
              }),
            })),
          };
        }
        throw new Error(`unexpected table ${table}`);
      });
    }

    it('excludes existing participants, pending/accepted invitees, and zero-score candidates; keeps and ranks eligible candidates by score desc', async () => {
      mockSupabaseFrom();

      const criteria = {
        destination_country: 'France',
        surfboard_type: 'shortboard',
        surf_level_category: 'advanced',
        age_min: 25,
        age_max: 35,
      };

      const candidates = await listInviteCandidates('t1', criteria);

      const candidateIds = candidates.map((c) => c.user_id);
      expect(candidateIds).not.toContain(participantUserId);
      expect(candidateIds).not.toContain(pendingInvitedUserId);
      expect(candidateIds).not.toContain(eligibleZeroMatchId);
      expect(candidateIds).toContain(eligibleGoodMatchId);
      expect(candidateIds).toContain(eligiblePartialMatchId);
      expect(candidates).toHaveLength(2);

      // Good match (all criteria aligned) should rank above the partial match.
      expect(candidates[0].user_id).toBe(eligibleGoodMatchId);
      expect(candidates[1].user_id).toBe(eligiblePartialMatchId);
      expect(candidates[0].score).toBeGreaterThan(candidates[1].score);
      expect(candidates.every(c => c.score > 0)).toBe(true);
    });
  });
});
