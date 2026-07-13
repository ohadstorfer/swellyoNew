jest.mock('../../../config/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));
import { supabase } from '../../../config/supabase';
import { inviteUserToTrip, respondToInvite } from '../tripInvitesService';

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
});
