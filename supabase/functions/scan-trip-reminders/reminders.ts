// Pure milestone logic. Caller computes the day deltas (UTC date math).
//   daysToStart: start_date - today (>=0 before trip); gearUnclaimed: bool|null;
//   uncommitted: is THIS recipient uncommitted; daysSinceEnd: today - end_date (0 = ended today; omit to skip).
export function reminderStagesForTrip(
  daysToStart: number,
  gearUnclaimed: boolean | null,
  uncommitted: boolean,
  daysSinceEnd?: number,
): string[] {
  const s: string[] = [];
  if (daysToStart === 7) s.push('week');
  if (daysToStart === 1) s.push('tomorrow');
  if (daysToStart === 0) s.push('today');
  if (uncommitted && [30, 15, 10, 5].includes(daysToStart)) s.push(`commit_${daysToStart}`);
  if (gearUnclaimed === true && [10, 5, 3, 1].includes(daysToStart)) s.push(`gear_${daysToStart}`);
  if (daysSinceEnd === 0) s.push('ended');
  return s;
}
