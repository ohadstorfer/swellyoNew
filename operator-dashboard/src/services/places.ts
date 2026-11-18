import { destinationFromPlace, type DestinationGeo } from '../domain/editTrip';
import { SayError } from './sayError';

/**
 * Google Places (New) from the browser — the same two REST calls the app's
 * `HomeBreakSearchSheet` makes: `places:autocomplete`, then one place details
 * read on pick, sharing a session token so the pair is billed as one session.
 *
 * Key: `VITE_GOOGLE_PLACES_API_KEY`. It is a browser key by nature, so Google
 * Cloud's HTTP-referrer restriction is what protects it — the dashboard's
 * origin (and localhost:5175 for development) has to be on that list.
 */

const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const DETAILS_URL = 'https://places.googleapis.com/v1/places';

export const PLACES_API_KEY: string | undefined = import.meta.env.VITE_GOOGLE_PLACES_API_KEY?.trim() || undefined;

export type PlaceSuggestion = { placeId: string; mainText: string; secondaryText: string };

export function newSessionToken(): string {
  return crypto.randomUUID();
}

export async function autocompletePlaces(
  input: string,
  sessionToken: string,
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  if (!PLACES_API_KEY) throw new SayError('Place search is not set up on this site.');
  const res = await fetch(AUTOCOMPLETE_URL, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': PLACES_API_KEY,
      'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat',
    },
    body: JSON.stringify({ input, sessionToken, includeQueryPredictions: false }),
  });
  if (!res.ok) throw new SayError('Search failed. Please try again.');
  const data = (await res.json()) as {
    suggestions?: Array<{
      placePrediction?: {
        placeId?: string;
        structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
      };
    }>;
  };
  const out: PlaceSuggestion[] = [];
  for (const s of data.suggestions ?? []) {
    const p = s.placePrediction;
    const main = p?.structuredFormat?.mainText?.text;
    if (p?.placeId && main) {
      out.push({ placeId: p.placeId, mainText: main, secondaryText: p.structuredFormat?.secondaryText?.text ?? '' });
    }
  }
  return out;
}

export async function resolvePlace(s: PlaceSuggestion, sessionToken: string): Promise<DestinationGeo> {
  if (!PLACES_API_KEY) throw new SayError('Place search is not set up on this site.');
  const res = await fetch(`${DETAILS_URL}/${encodeURIComponent(s.placeId)}`, {
    headers: {
      'X-Goog-Api-Key': PLACES_API_KEY,
      'X-Goog-FieldMask': 'id,formattedAddress,location,addressComponents,displayName',
      'X-Goog-Places-Session-Token': sessionToken,
    },
  });
  if (!res.ok) throw new SayError('Could not open that place. Pick another one.');
  return destinationFromPlace(await res.json(), s);
}
