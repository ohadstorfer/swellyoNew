import { reminderStagesForTrip } from '../reminders';

describe('reminderStagesForTrip', () => {
  it('week at 7, tomorrow at 1, today at 0', () => {
    expect(reminderStagesForTrip(7, null, true)).toContain('week');
    expect(reminderStagesForTrip(1, null, false)).toContain('tomorrow');
    expect(reminderStagesForTrip(0, null, false)).toContain('today');
  });
  it('commit nudge at 30/15/10/5 only when uncommitted', () => {
    expect(reminderStagesForTrip(15, null, true)).toContain('commit_15');
    expect(reminderStagesForTrip(15, null, false)).not.toContain('commit_15');
  });
  it('gear nudge at 10/5/3/1 only when unclaimed', () => {
    expect(reminderStagesForTrip(3, true, false)).toContain('gear_3');
    expect(reminderStagesForTrip(3, false, false)).not.toContain('gear_3');
  });
  it('ended when end was today', () => {
    expect(reminderStagesForTrip(99, null, false, 0)).toContain('ended');
  });
  it('[] on a non-milestone day', () => {
    expect(reminderStagesForTrip(9, true, true)).toEqual([]);
  });
});
