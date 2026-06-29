import {
  snapSquareSize,
  toThumbUrl,
  toWidthThumbUrl,
  THUMBNAILS_BUCKET,
  THUMB_CACHE_VERSION,
} from '../thumbnails';

const BASE = 'https://proj.supabase.co';
const OBJ = `${BASE}/storage/v1/object/public/profile-images/u1/avatar-9.jpg`;

describe('snapSquareSize', () => {
  it('snaps up to the smallest ladder size >= the requested px', () => {
    expect(snapSquareSize(24)).toBe(48);
    expect(snapSquareSize(48)).toBe(48);
    expect(snapSquareSize(96)).toBe(320);
    expect(snapSquareSize(144)).toBe(320);
    expect(snapSquareSize(300)).toBe(320);
    expect(snapSquareSize(320)).toBe(320);
    expect(snapSquareSize(321)).toBe(320); // caps at the largest ladder size
    expect(snapSquareSize(5000)).toBe(320);
  });
});

describe('toThumbUrl', () => {
  it('rewrites a public object URL to the static square thumb', () => {
    expect(toThumbUrl(OBJ, 96, BASE)).toBe(
      `${BASE}/storage/v1/object/public/${THUMBNAILS_BUCKET}/profile-images/u1/avatar-9.jpg__320.jpg?v=${THUMB_CACHE_VERSION}`,
    );
  });
  it('returns non-Supabase URLs unchanged', () => {
    expect(toThumbUrl('https://lh3.googleusercontent.com/a/x', 96, BASE)).toBe(
      'https://lh3.googleusercontent.com/a/x',
    );
  });
  it('returns null for empty input', () => {
    expect(toThumbUrl(null, 96, BASE)).toBeNull();
    expect(toThumbUrl(undefined, 96, BASE)).toBeNull();
    expect(toThumbUrl('', 96, BASE)).toBeNull();
  });
  it('does not double-rewrite an already-thumb URL', () => {
    const t = `${BASE}/storage/v1/object/public/${THUMBNAILS_BUCKET}/profile-images/u1/avatar-9.jpg__320.jpg`;
    expect(toThumbUrl(t, 96, BASE)).toBe(t);
  });
});

describe('toWidthThumbUrl', () => {
  it('produces the width-bound variant', () => {
    expect(toWidthThumbUrl(OBJ, 1280, BASE)).toBe(
      `${BASE}/storage/v1/object/public/${THUMBNAILS_BUCKET}/profile-images/u1/avatar-9.jpg__1280w.jpg?v=${THUMB_CACHE_VERSION}`,
    );
  });
  it('returns non-Supabase URLs unchanged', () => {
    expect(toWidthThumbUrl('https://example.com/x.jpg', 1280, BASE)).toBe(
      'https://example.com/x.jpg',
    );
  });
});
