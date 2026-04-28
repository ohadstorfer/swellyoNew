/** Matches `DestinationInputCardCopy` time units. */
export type DurationTimeUnit = 'days' | 'weeks' | 'months' | 'years';

/**
 * Same rules as `DestinationInputCardCopy`’s duration → days / display text.
 */
export function computeDurationParts(
  timeValue: string,
  timeUnit: DurationTimeUnit,
): { timeInDays: number; timeInText: string } | null {
  const numericValue = parseFloat(timeValue);
  if (isNaN(numericValue) || numericValue <= 0) return null;

  let timeInDays = 0;
  let timeInText = '';

  switch (timeUnit) {
    case 'days':
      timeInDays = Math.round(numericValue);
      timeInText = numericValue === 1 ? '1 day' : `${numericValue} days`;
      break;
    case 'weeks':
      timeInDays = Math.round(numericValue * 7);
      timeInText = numericValue === 1 ? '1 week' : `${numericValue} weeks`;
      break;
    case 'months':
      timeInDays = Math.round(numericValue * 30);
      timeInText =
        numericValue % 1 === 0.5
          ? `${Math.floor(numericValue)}.5 months`
          : numericValue === 1
            ? '1 month'
            : `${numericValue} months`;
      break;
    case 'years':
      timeInDays = Math.round(numericValue * 365);
      timeInText =
        numericValue % 1 === 0.5
          ? `${Math.floor(numericValue)}.5 years`
          : numericValue === 1
            ? '1 year'
            : `${numericValue} years`;
      break;
    default:
      return null;
  }

  return { timeInDays, timeInText };
}

/** Pick a sensible value + unit for editing `time_in_days` in the card-style input. */
export function decomposeDaysForDurationInput(days: number): {
  value: string;
  unit: DurationTimeUnit;
} {
  if (!days || days <= 0) return { value: '1', unit: 'weeks' };
  if (days >= 365 && days % 365 === 0) {
    return { value: String(days / 365), unit: 'years' };
  }
  if (days >= 30 && days % 30 === 0) {
    return { value: String(days / 30), unit: 'months' };
  }
  if (days >= 7 && days % 7 === 0) {
    return { value: String(days / 7), unit: 'weeks' };
  }
  return { value: String(days), unit: 'days' };
}
