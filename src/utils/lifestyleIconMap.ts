// Lifestyle keyword → Ionicon name. Shared by ProfileScreen (read-only display)
// and ProfileEditPanel (edit flow) so both use identical fallback icons.
export const LIFESTYLE_ICON_MAP: { [key: string]: string } = {
  'yoga': 'fitness-outline',
  'hiking': 'walk-outline',
  'cycling': 'bicycle-outline',
  'gaming': 'game-controller-outline',
  'music': 'musical-notes-outline',
  'volleyball': 'football-outline',
  'climbing': 'trail-sign-outline',
  'diving': 'water-outline',
  'fishing': 'fish-outline',
  'spearfishing': 'flash-outline',
  'remote-work': 'laptop-outline',
  'party': 'wine-outline',
  'nightlife': 'moon-outline',
  'culture': 'library-outline',
  'local culture': 'people-outline',
  'nature': 'leaf-outline',
  'sustainability': 'reload-outline',
  'art': 'color-palette-outline',
  'food': 'restaurant-outline',
  'exploring': 'map-outline',
  'adventure': 'compass-outline',
  'mobility': 'barbell-outline',
};

// Keywords excluded from match-scoring in the find_and_connect_matches SQL
// function (supabase/migrations/20260325000000_filter_lifestyle_matching.sql).
// These remain in LIFESTYLE_ICON_MAP so existing user data still renders with
// proper icons, but they should NOT be offered as choices in the edit screen
// or extracted by the onboarding AI — picking them contributes nothing to
// matching scores.
export const EXCLUDED_FROM_SCORING_KEYWORDS: ReadonlySet<string> = new Set([
  'adventure',
  'exploring',
  'food',
  'culture',
  'local culture',
  'nature',
]);

// The keywords that actually count for match scoring — use this for the chip
// picker and the swelly-chat extraction vocabulary.
export const SCORING_LIFESTYLE_KEYWORDS: string[] = Object.keys(LIFESTYLE_ICON_MAP)
  .filter(k => !EXCLUDED_FROM_SCORING_KEYWORDS.has(k));

export const isKnownLifestyleKeyword = (keyword: string): boolean =>
  Object.prototype.hasOwnProperty.call(LIFESTYLE_ICON_MAP, keyword.toLowerCase());
