import { neighbourHeroUrls, neighbourAvatarUrls } from '../deckPrefetch';

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

describe('neighbourAvatarUrls', () => {
  const trips = [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }, { id: 't5' }];
  const meta = new Map([
    ['t1', { hostAvatar: 'h1', memberAvatars: ['h1', 'm1a'] }],
    ['t2', { hostAvatar: null, memberAvatars: ['m2a', 'm2b', 'm2c', 'm2d'] }],
    ['t3', { hostAvatar: 'h3', memberAvatars: [] }],
    ['t5', { hostAvatar: 'h5', memberAvatars: ['m5a'] }],
  ]);

  it('collects host + up-to-3 cluster avatars for focused-1 .. focused+2, deduped', () => {
    // focused=1 → window t1..t4 (t4 has no meta): t2's 4th member avatar is
    // dropped (cards render only 3), and t1's host doubling as a member dedupes.
    expect(neighbourAvatarUrls(trips, meta, 1)).toEqual([
      'h1', 'm1a', 'm2a', 'm2b', 'm2c', 'h3',
    ]);
  });

  it('clamps at the start and skips trips without meta', () => {
    expect(neighbourAvatarUrls(trips, meta, 0)).toEqual(['h1', 'm1a', 'm2a', 'm2b', 'm2c', 'h3']);
  });

  it('returns empty for an empty deck or empty meta', () => {
    expect(neighbourAvatarUrls([], meta, 0)).toEqual([]);
    expect(neighbourAvatarUrls(trips, new Map(), 1)).toEqual([]);
  });
});
