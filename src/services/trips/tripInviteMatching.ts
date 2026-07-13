export interface TripInviteCriteria {
  destination_country?: string | null;
  surfboard_type?: string | null;
  surf_level_category?: string | null;
  age_min?: number | null;
  age_max?: number | null;
}

export interface CandidateProfile {
  user_id: string;
  country_from?: string | null;
  surfboard_type?: string | null;
  surf_level_category?: string | null;
  age?: number | null;
}

const WEIGHT_COUNTRY = 20;
const WEIGHT_BOARD = 30;
const WEIGHT_LEVEL = 30;
const WEIGHT_AGE = 20;

export function scoreCandidateForTrip(criteria: TripInviteCriteria, candidate: CandidateProfile): number {
  let score = 0;

  if (criteria.destination_country && candidate.country_from
    && criteria.destination_country.toLowerCase() === candidate.country_from.toLowerCase()) {
    score += WEIGHT_COUNTRY;
  }

  if (criteria.surfboard_type && candidate.surfboard_type
    && criteria.surfboard_type.toLowerCase() === candidate.surfboard_type.toLowerCase()) {
    score += WEIGHT_BOARD;
  }

  if (criteria.surf_level_category && candidate.surf_level_category
    && criteria.surf_level_category.toLowerCase() === candidate.surf_level_category.toLowerCase()) {
    score += WEIGHT_LEVEL;
  }

  if (
    typeof criteria.age_min === 'number' &&
    typeof criteria.age_max === 'number' &&
    typeof candidate.age === 'number' &&
    candidate.age >= criteria.age_min &&
    candidate.age <= criteria.age_max
  ) {
    score += WEIGHT_AGE;
  }

  return score;
}
