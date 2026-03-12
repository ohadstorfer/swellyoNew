import type { MapPickerPlace } from '../components/MapPickerModal';

/**
 * Normalized destination pieces derived from a Google / MapPicker place.
 * - country: ISO-like country name (e.g. "USA" or "Costa Rica")
 * - state: state for USA (e.g. "California", "Hawaii")
 * - area: all remaining textual components (excluding country/state)
 *
 * NOTE: Because MapPickerPlace currently only exposes name, formatted_address, lat, lng, placeId,
 * we approximate by splitting formatted_address into parts and stripping obvious country / state tokens.
 * This keeps behavior consistent with the plan without changing map picker wiring or backend contracts.
 */
export interface NormalizedGooglePlaceDestination {
  country: string | null;
  state: string | null;
  area: string[];
}

// Common aliases for United States that might appear in formatted_address.
const USA_ALIASES = ['usa', 'u.s.a', 'united states', 'united states of america', 'us', 'u.s.'];

/**
 * Best-effort extraction of country and state from a formatted address string.
 * This is intentionally conservative: it only rewrites obvious US cases and otherwise
 * treats the last segment as country and the previous one as region/state.
 */
function extractCountryAndStateFromAddress(address: string): {
  country: string | null;
  state: string | null;
  remainingParts: string[];
} {
  const parts = address
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (parts.length === 0) {
    return { country: null, state: null, remainingParts: [] };
  }

  const lowerLast = parts[parts.length - 1].toLowerCase();

  // Heuristic: detect USA-like countries and try to pull out state from previous segment.
  if (USA_ALIASES.some((alias) => lowerLast.includes(alias))) {
    const country = 'USA';
    let state: string | null = null;
    const remaining = [...parts];

    // Last part is some "USA" variant; drop it.
    remaining.pop();

    if (remaining.length > 0) {
      state = remaining[remaining.length - 1];
      remaining.pop();
    }

    return {
      country,
      state,
      remainingParts: remaining,
    };
  }

  // Fallback: treat last part as country, previous as region/city/etc.
  const country = parts[parts.length - 1];
  const remainingParts = parts.slice(0, -1);

  return {
    country,
    state: null,
    remainingParts,
  };
}

/**
 * Normalize a MapPickerPlace into { country, state, area[] } while keeping all
 * non-country / non-state text components in area[].
 */
export function normalizeMapPickerPlace(
  place: MapPickerPlace
): NormalizedGooglePlaceDestination {
  const name = (place.name || '').trim();
  const formatted = (place.formatted_address || '').trim();

  let country: string | null = null;
  let state: string | null = null;
  const areaParts: string[] = [];

  if (formatted) {
    const { country: c, state: s, remainingParts } = extractCountryAndStateFromAddress(formatted);
    country = c;
    state = s;
    areaParts.push(...remainingParts);
  }

  // Add the explicit name if it's not already one of the address segments.
  if (name && !areaParts.some((p) => p.toLowerCase() === name.toLowerCase())) {
    areaParts.unshift(name);
  }

  // Deduplicate while preserving order.
  const seen = new Set<string>();
  const dedupedArea = areaParts.filter((p) => {
    const key = p.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    country,
    state,
    area: dedupedArea,
  };
}

