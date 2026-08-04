// The service module imports the supabase client at module scope, so it has to
// be mocked before the import — same shape as
// src/services/trips/__tests__/tripPaymentsService.test.ts.
const mockRpc = jest.fn();

jest.mock('../../../config/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

const mockUpdateGroupTrip = jest.fn();
jest.mock('../../trips/groupTripsService', () => ({
  updateGroupTrip: (...args: unknown[]) => mockUpdateGroupTrip(...args),
  setTripDestination: jest.fn(),
}));

import { freezeTripPrices, updateOperatorTripPrice } from '../operatorTripsService';

beforeEach(() => {
  mockRpc.mockReset();
  mockUpdateGroupTrip.mockReset();
});

describe('freezeTripPrices', () => {
  it('returns the number of rows the RPC froze', async () => {
    mockRpc.mockResolvedValue({ data: 3, error: null });
    await expect(freezeTripPrices('trip-1')).resolves.toBe(3);
    expect(mockRpc).toHaveBeenCalledWith('operator_freeze_trip_prices', { p_trip_id: 'trip-1' });
  });

  it('throws when the RPC errors', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'not the host of this trip' } });
    await expect(freezeTripPrices('trip-1')).rejects.toThrow('not the host of this trip');
  });

  // The RPC returns 0 for an offline trip and for a trip with no price. That is
  // a real answer, not a missing one, so it must not become null.
  it('returns 0 rather than null when nothing was frozen', async () => {
    mockRpc.mockResolvedValue({ data: 0, error: null });
    await expect(freezeTripPrices('trip-1')).resolves.toBe(0);
  });
});

describe('updateOperatorTripPrice', () => {
  it('freezes before it writes', async () => {
    const order: string[] = [];
    mockRpc.mockImplementation(async () => { order.push('freeze'); return { data: 2, error: null }; });
    mockUpdateGroupTrip.mockImplementation(async () => { order.push('update'); });

    await updateOperatorTripPrice('trip-1', { cost_per_person: 1500 });

    expect(order).toEqual(['freeze', 'update']);
  });

  // If the freeze fails, writing the new price would be exactly the silent
  // repricing this whole function exists to stop.
  it('does not write the price when the freeze fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(updateOperatorTripPrice('trip-1', { cost_per_person: 1500 })).rejects.toThrow('boom');
    expect(mockUpdateGroupTrip).not.toHaveBeenCalled();
  });

  it('passes the patch straight through to updateGroupTrip', async () => {
    mockRpc.mockResolvedValue({ data: 0, error: null });
    mockUpdateGroupTrip.mockResolvedValue(undefined);
    await updateOperatorTripPrice('trip-1', { cost_per_person: 1500, deposit_amount: 300 });
    expect(mockUpdateGroupTrip).toHaveBeenCalledWith('trip-1', {
      cost_per_person: 1500,
      deposit_amount: 300,
    });
  });
});
