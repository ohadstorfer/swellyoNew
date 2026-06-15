// Mock the supabase client so importing the service doesn't init a real client
// (mirrors src/services/notifications/__tests__/notificationsService.test.ts).
jest.mock('../../../config/supabase', () => ({ supabase: {} }));

// groupTripsService also imports these — mock them to avoid native-module errors.
jest.mock('../../../services/analytics/eventLogger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../services/messaging/messagingService', () => ({ messagingService: {} }));

import { EXPLORE_TRIP_SELECT } from '../groupTripsService';

describe('EXPLORE_TRIP_SELECT', () => {
  it('includes every field ExploreTripCard reads', () => {
    const required = [
      'id', 'host_id', 'status', 'hosting_style', 'title', 'hero_image_url',
      'start_date', 'end_date', 'dates_set_in_stone', 'date_months',
      'cost_per_person', 'budget_min', 'budget_max',
      'max_participants', 'participant_count', 'created_at',
    ];
    for (const f of required) expect(EXPLORE_TRIP_SELECT).toContain(f);
    expect(EXPLORE_TRIP_SELECT).toContain('group_trip_destinations');
  });

  it('does not fall back to select-all', () => {
    expect(EXPLORE_TRIP_SELECT).not.toContain('*');
  });
});
