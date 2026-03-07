/**
 * Shared logic for destination card display: when country is USA and state is
 * Hawaii or California, show state flag and state name only (not "USA").
 */

const USA_INDICATORS = [
  'usa',
  'united states',
  'united states of america',
  'us',
  'america',
  'u.s.a',
  'u.s.',
];

/**
 * For USA + California/Hawaii, return state-only label and flag key so we show state flag and name.
 * Otherwise returns destination as-is.
 */
export function getDisplayLabelAndFlagKey(
  destination: string
): { displayLabel: string; flagKey: string } {
  const trimmed = destination.trim();
  const normalized = trimmed.toLowerCase();
  const isUSA =
    USA_INDICATORS.some((ind) => normalized.includes(ind)) || normalized === 'us';
  if (isUSA && normalized.includes('california')) {
    return { displayLabel: 'California', flagKey: 'California' };
  }
  if (isUSA && normalized.includes('hawaii')) {
    return { displayLabel: 'Hawaii', flagKey: 'Hawaii' };
  }
  if (normalized === 'california') {
    return { displayLabel: 'California', flagKey: 'California' };
  }
  if (normalized === 'hawaii') {
    return { displayLabel: 'Hawaii', flagKey: 'Hawaii' };
  }
  return { displayLabel: trimmed, flagKey: trimmed };
}
