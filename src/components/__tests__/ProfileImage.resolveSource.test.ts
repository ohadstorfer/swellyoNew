import { resolveAvatarSource } from '../ProfileImage';

const PRIMARY = 'https://p.supabase.co/storage/v1/object/public/image-thumbnails/trip-images/x.jpg__320.jpg?v=2';
const ORIGINAL = 'https://p.supabase.co/storage/v1/object/public/trip-images/x.jpg';

describe('resolveAvatarSource', () => {
  it('uses the primary (thumbnail) while nothing has failed', () => {
    expect(resolveAvatarSource(PRIMARY, ORIGINAL, false, false)).toEqual({
      url: PRIMARY,
      stage: 'primary',
    });
  });

  it('falls back to the original when the primary thumbnail fails', () => {
    expect(resolveAvatarSource(PRIMARY, ORIGINAL, true, false)).toEqual({
      url: ORIGINAL,
      stage: 'fallback',
    });
  });

  it('shows the placeholder when both primary and fallback fail', () => {
    expect(resolveAvatarSource(PRIMARY, ORIGINAL, true, true)).toEqual({
      url: null,
      stage: 'placeholder',
    });
  });

  it('shows the placeholder when the primary fails and there is no fallback', () => {
    expect(resolveAvatarSource(PRIMARY, null, true, false)).toEqual({
      url: null,
      stage: 'placeholder',
    });
  });

  it('does not retry a fallback identical to the primary (it would just fail again)', () => {
    expect(resolveAvatarSource(PRIMARY, PRIMARY, true, false)).toEqual({
      url: null,
      stage: 'placeholder',
    });
  });

  it('shows the placeholder when neither primary nor fallback is usable', () => {
    expect(resolveAvatarSource('', null, false, false).stage).toBe('placeholder');
    expect(resolveAvatarSource('   ', undefined, false, false).stage).toBe('placeholder');
    expect(resolveAvatarSource(null, null, false, false)).toEqual({
      url: null,
      stage: 'placeholder',
    });
  });

  it('uses the fallback when the primary is empty/whitespace but a fallback exists', () => {
    expect(resolveAvatarSource('', ORIGINAL, false, false)).toEqual({
      url: ORIGINAL,
      stage: 'fallback',
    });
    expect(resolveAvatarSource('   ', ORIGINAL, false, false).stage).toBe('fallback');
  });

  it('ignores empty/whitespace fallback', () => {
    expect(resolveAvatarSource(PRIMARY, '   ', true, false)).toEqual({
      url: null,
      stage: 'placeholder',
    });
  });
});
