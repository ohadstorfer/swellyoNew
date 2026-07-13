jest.mock('../../../config/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));
import { supabase } from '../../../config/supabase';
import { inviteUserToTrip, respondToInvite, listInviteCandidates } from '../tripInvitesService';

describe('tripInvitesService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('inviteUserToTrip inserts a pending invite row', async () => {
    const single = jest.fn().mockResolvedValue({ data: { id: 'inv1', trip_id: 't1', invited_user_id: 'u2', invited_by: 'u1', status: 'pending', created_at: 'now', responded_at: null }, error: null });
    const select = jest.fn(() => ({ single }));
    const insert = jest.fn(() => ({ select }));
    (supabase.from as jest.Mock).mockReturnValue({ insert });

    const result = await inviteUserToTrip('t1', 'u2', 'u1');

    expect(supabase.from).toHaveBeenCalledWith('trip_invites');
    expect(insert).toHaveBeenCalledWith({ trip_id: 't1', invited_user_id: 'u2', invited_by: 'u1', status: 'pending' });
    expect(result.id).toBe('inv1');
  });

  it('respondToInvite updates status and responded_at, scoped to the responding user (declined, no participant insert)', async () => {
    const single = jest.fn().mockResolvedValue({ data: { trip_id: 't1' }, error: null });
    const select = jest.fn(() => ({ single }));
    const eq2 = jest.fn(() => ({ select }));
    const eq1 = jest.fn(() => ({ eq: eq2 }));
    const update = jest.fn(() => ({ eq: eq1 }));
    const insert = jest.fn();
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'trip_invites') return { update };
      if (table === 'group_trip_participants') return { insert };
      throw new Error(`unexpected table ${table}`);
    });

    await respondToInvite('inv1', 'declined', 'u2');

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'declined' }));
    expect(eq1).toHaveBeenCalledWith('id', 'inv1');
    expect(eq2).toHaveBeenCalledWith('invited_user_id', 'u2');
    expect(insert).not.toHaveBeenCalled();
  });

  it('respondToInvite inserts a group_trip_participants row with role member when accepted', async () => {
    const single = jest.fn().mockResolvedValue({ data: { trip_id: 't1' }, error: null });
    const select = jest.fn(() => ({ single }));
    const eq2 = jest.fn(() => ({ select }));
    const eq1 = jest.fn(() => ({ eq: eq2 }));
    const update = jest.fn(() => ({ eq: eq1 }));
    const insert = jest.fn().mockResolvedValue({ error: null });
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'trip_invites') return { update };
      if (table === 'group_trip_participants') return { insert };
      throw new Error(`unexpected table ${table}`);
    });

    await respondToInvite('inv1', 'accepted', 'u2');

    expect(supabase.from).toHaveBeenCalledWith('group_trip_participants');
    expect(insert).toHaveBeenCalledWith({ trip_id: 't1', user_id: 'u2', role: 'member' });
  });

  describe('listInviteCandidates', () => {
    const participantUserId = 'existing-participant';
    const pendingInvitedUserId = 'pending-invitee';
    const eligibleGoodMatchId = 'eligible-good-match';
    const eligiblePoorMatchId = 'eligible-poor-match';

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
                  { user_id: eligiblePoorMatchId, name: 'Poor Match', profile_image_url: null, country_from: 'Israel', surfboard_type: 'longboard', surf_level_category: 'beginner', age: 50 },
                ],
                error: null,
              }),
            })),
          };
        }
        throw new Error(`unexpected table ${table}`);
      });
    }

    it('excludes existing participants and pending/accepted invitees, keeps eligible candidates, sorted by score desc', async () => {
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
      expect(candidateIds).toContain(eligibleGoodMatchId);
      expect(candidateIds).toContain(eligiblePoorMatchId);
      expect(candidates).toHaveLength(2);

      // Good match (all criteria aligned) should rank above the poor match.
      expect(candidates[0].user_id).toBe(eligibleGoodMatchId);
      expect(candidates[1].user_id).toBe(eligiblePoorMatchId);
      expect(candidates[0].score).toBeGreaterThan(candidates[1].score);
    });
  });
});
