import type { DestinationGeo } from '../domain/createTrip';
import { destinationFromPlace, type DestinationGeo as EditDestinationGeo } from '../domain/editTrip';
import { SayError } from './sayError';

/**
 * Google Places (New) — the destination search, as the app's
 * `HomeBreakSearchSheet` does it: `places:autocomplete` while typing, then one
 * place-details call on pick, both carrying the same session token so the
 * keystrokes bill as one session.
 *
 * ⚠️ The key is a browser key here (`VITE_GOOGLE_PLACES_API_KEY`). If Google
 * answers 403 with "API_KEY_HTTP_REFERRER_BLOCKED" or "requests from this
 * referer are blocked", the key's application restrictions do not include this
 * site's origin — add it in Google Cloud, this code cannot fix that.
 */
const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const DETAILS_URL = 'https://places.googleapis.com/v1/places';

export const PLACES_KEY = (import.meta.env.VITE_GOOGLE_PLACES_API_KEY as string | undefined)?.trim() || '';

export type PlaceSuggestion = { placeId: string; mainText: string; secondaryText: string };

export function newSessionToken(): string {
  return crypto.randomUUID();
}

async function explain(res: Response): Promise<Error> {
  const body = await res.text().catch(() => '');
  if (res.status === 403 && /REFERRER|referer/i.test(body)) {
    return new Error(
      'Google refused this website for place search (the API key does not allow this site). ' +
        'Add this site to the key’s allowed referrers in Google Cloud.',
    );
  }
  return new Error(`Place search failed (${res.status}).`);
}

export async function autocomplete(
  input: string,
  sessionToken: string,
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  if (!PLACES_KEY) throw new Error('Place search is not set up (VITE_GOOGLE_PLACES_API_KEY is missing).');
  const res = await fetch(AUTOCOMPLETE_URL, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': PLACES_KEY,
      'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat',
    },
    body: JSON.stringify({ input, sessionToken, includeQueryPredictions: false }),
  });
  if (!res.ok) throw await explain(res);
  const data = await res.json();
  const out: PlaceSuggestion[] = [];
  for (const s of data.suggestions ?? []) {
    const pred = s.placePrediction;
    const sf = pred?.structuredFormat;
    if (pred?.placeId && sf?.mainText?.text) {
      out.push({ placeId: pred.placeId, mainText: sf.mainText.text, secondaryText: sf.secondaryText?.text || '' });
    }
  }
  return out;
}

type AddressComponent = { types?: string[]; longText?: string; shortText?: string };

/** locality → sublocality → postal_town → admin_level_2, and the ISO-2 country. */
export function extractCityAndCountry(components: AddressComponent[]): {
  locality: string | null;
  country: string | null;
} {
  let locality: string | null = null;
  let sublocality: string | null = null;
  let postalTown: string | null = null;
  let adminL2: string | null = null;
  let country: string | null = null;
  for (const comp of components ?? []) {
    const types = comp.types ?? [];
    const longText = comp.longText;
    const shortText = comp.shortText;
    if (!longText && !shortText) continue;
    if (types.includes('locality')) locality = longText || null;
    else if (types.includes('sublocality_level_1') || types.includes('sublocality')) sublocality = longText || null;
    else if (types.includes('postal_town')) postalTown = longText || null;
    else if (types.includes('administrative_area_level_2')) adminL2 = longText || null;
    if (types.includes('country')) country = shortText || null;
  }
  return { locality: locality || sublocality || postalTown || adminL2, country };
}

export async function placeDetails(s: PlaceSuggestion, sessionToken: string): Promise<DestinationGeo> {
  // The app sends the session token as an `X-Goog-Places-Session-Token`
  // header. A browser cannot: Google's CORS preflight does not allow that
  // header (checked 18 Nov 2026 — 403 with it, 200 without), so it goes as the
  // documented `sessionToken` query parameter instead. Same billing session.
  const url = `${DETAILS_URL}/${encodeURIComponent(s.placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`;
  const res = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': PLACES_KEY,
      'X-Goog-FieldMask': 'id,formattedAddress,location,addressComponents,displayName',
    },
  });
  if (!res.ok) throw await explain(res);
  const data = await res.json();
  const { locality, country } = extractCityAndCountry(data.addressComponents ?? []);
  const name: string = data.displayName?.text || s.mainText;
  return {
    placeId: data.id || s.placeId,
    full: data.formattedAddress || `${s.mainText}${s.secondaryText ? ', ' + s.secondaryText : ''}`,
    short: locality && locality !== name ? `${name}, ${locality}` : name,
    name,
    locality,
    country,
    lat: typeof data.location?.latitude === 'number' ? data.location.latitude : null,
    lng: typeof data.location?.longitude === 'number' ? data.location.longitude : null,
  };
}

// ── Edit trip's entry points ─────────────────────────────────────────────────
// Create trip and Edit trip each wrote a Places client in parallel; merged
// 18 Nov 2026 into this one. Edit trip keeps its names and its row shape
// (`destinationFromPlace`), but goes through the same requests as above — in
// particular the session token as a query parameter, since the header the app
// uses is refused by Google's CORS preflight in a browser.

export const PLACES_API_KEY: string | undefined = PLACES_KEY || undefined;

export async function autocompletePlaces(
  input: string,
  sessionToken: string,
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  if (!PLACES_API_KEY) throw new SayError('Place search is not set up on this site.');
  try {
    return await autocomplete(input, sessionToken, signal);
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new SayError('Search failed. Please try again.');
  }
}

export async function resolvePlace(s: PlaceSuggestion, sessionToken: string): Promise<EditDestinationGeo> {
  if (!PLACES_API_KEY) throw new SayError('Place search is not set up on this site.');
  const url = `${DETAILS_URL}/${encodeURIComponent(s.placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`;
  const res = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': PLACES_API_KEY,
      'X-Goog-FieldMask': 'id,formattedAddress,location,addressComponents,displayName',
    },
  });
  if (!res.ok) throw new SayError('Could not open that place. Pick another one.');
  return destinationFromPlace(await res.json(), s);
}
