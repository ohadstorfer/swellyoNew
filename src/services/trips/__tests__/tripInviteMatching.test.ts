import { scoreCandidateForTrip } from '../tripInviteMatching';

describe('scoreCandidateForTrip', () => {
  it('scores a perfect match highest', () => {
    const criteria = { destination_country: 'Portugal', surfboard_type: 'shortboard', surf_level_category: 'intermediate', age_min: 20, age_max: 35 };
    const perfect = { user_id: '1', country_from: 'Portugal', surfboard_type: 'shortboard', surf_level_category: 'intermediate', age: 28 };
    const noMatch = { user_id: '2', country_from: 'Norway', surfboard_type: 'longboard', surf_level_category: 'beginner', age: 55 };
    expect(scoreCandidateForTrip(criteria, perfect)).toBeGreaterThan(scoreCandidateForTrip(criteria, noMatch));
  });

  it('returns 0 for a candidate matching nothing', () => {
    const criteria = { destination_country: 'Portugal', surfboard_type: 'shortboard', surf_level_category: 'intermediate', age_min: 20, age_max: 35 };
    const noMatch = { user_id: '2', country_from: 'Norway', surfboard_type: 'longboard', surf_level_category: 'beginner', age: 55 };
    expect(scoreCandidateForTrip(criteria, noMatch)).toBe(0);
  });

  it('handles missing criteria/candidate fields without throwing', () => {
    expect(() => scoreCandidateForTrip({}, { user_id: '3' })).not.toThrow();
    expect(scoreCandidateForTrip({}, { user_id: '3' })).toBe(0);
  });
});
