// src/screens/trips/deckPrefetch.ts
// Hero URLs to warm around the focused deck card: the focused card, its left
// neighbour, and the next two to the right (the swipe direction). Deduped and
// missing-url-safe. expo-image caches by URL, so prefetching a warm URL no-ops.
export function neighbourHeroUrls(
  trips: { hero_image_url?: string | null }[],
  focused: number,
): string[] {
  const urls: string[] = [];
  for (let i = focused - 1; i <= focused + 2; i++) {
    const u = trips[i]?.hero_image_url;
    if (u) urls.push(u);
  }
  return Array.from(new Set(urls));
}
