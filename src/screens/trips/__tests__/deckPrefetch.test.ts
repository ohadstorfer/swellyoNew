import { neighbourHeroUrls } from '../deckPrefetch';

describe('neighbourHeroUrls', () => {
  const trips = [
    { hero_image_url: 'a' },
    { hero_image_url: 'b' },
    { hero_image_url: null },
    { hero_image_url: 'd' },
    { hero_image_url: 'e' },
  ];

  it('returns focused-1 .. focused+2 urls, skipping missing, deduped', () => {
    expect(neighbourHeroUrls(trips, 1)).toEqual(['a', 'b', 'd']);
  });

  it('clamps at the start', () => {
    expect(neighbourHeroUrls(trips, 0)).toEqual(['a', 'b']);
  });

  it('returns empty for an empty deck', () => {
    expect(neighbourHeroUrls([], 0)).toEqual([]);
  });
});
