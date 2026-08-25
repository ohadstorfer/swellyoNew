/**
 * The demo-clip table is the only thing that turns (board, level) into a file
 * name, and those names must match what is actually in the surf-level-videos
 * bucket. The onboarding "Surf Skill" card kept its own copy of the table for
 * five months and drifted to files that did not exist — a black card for every
 * longboarder past level 2. These pin the shared table to the real bucket
 * listing and to the labels users see, so the next drift fails here first.
 */
jest.mock('../videoPreloadService', () => ({ getPlaybackUrl: (url: string) => url }));
jest.mock('../../../config/supabase', () => ({ supabase: {}, isSupabaseConfigured: () => false }));

import { getSurfLevelVideos, getSurfLevelVideoUrl } from '../surfLevelVideos';
import { getSurfLevelsForBoardType } from '../../../utils/surfLevelMapping';

/**
 * storage.objects for bucket `surf-level-videos`, listed 2026-08-25. Every file
 * the app can ask for must be in here. Renaming a clip in the bucket means
 * updating both the bucket and this list — that is the point.
 */
const BUCKET = new Set([
  'shortboard/Dipping My Toes.mp4',
  'shortboard/Cruising Around.mp4',
  'shortboard/Snapping.mp4',
  'shortboard/Charging.mp4',
  'midlength/Dipping My Toes.mp4',
  'midlength/Cruising Around.mp4',
  'midlength/Carving Turns.mp4',
  'midlength/Charging.mp4',
  'longboard/Dipping My Toes.mp4',
  'longboard/Cruising Around.mp4',
  'longboard/CrossStepping.mp4',
  'longboard/Hanging Toes.mp4',
  'softtop/Dipping My Toes.mp4',
]);

/** "<folder>/<file>" out of a storage URL, decoded. */
const pathOf = (url: string): string => decodeURIComponent(url.split('/surf-level-videos/')[1] ?? '');

describe('getSurfLevelVideoUrl — the onboarding Surf Skill card', () => {
  it.each([0, 1, 2])('board %i: every level the picker offers points at a file that exists', board => {
    for (const { level } of getSurfLevelsForBoardType(board)) {
      const path = pathOf(getSurfLevelVideoUrl(board, level));
      expect(BUCKET.has(path)).toBe(true);
    }
  });

  it('softtop: every level maps to the one softtop clip (the picker is skipped)', () => {
    for (const level of [0, 1, 2, 3]) {
      expect(pathOf(getSurfLevelVideoUrl(3, level))).toBe('softtop/Dipping My Toes.mp4');
    }
  });

  it('the 2026-03-18 regression: upper levels on longboard and midlength', () => {
    // These four were "Trimming Lines.mp4" / "Carving Turns.mp4" in the stale copy.
    expect(pathOf(getSurfLevelVideoUrl(2, 2))).toBe('longboard/CrossStepping.mp4');
    expect(pathOf(getSurfLevelVideoUrl(2, 3))).toBe('longboard/Hanging Toes.mp4');
    expect(pathOf(getSurfLevelVideoUrl(1, 2))).toBe('midlength/Carving Turns.mp4');
    expect(pathOf(getSurfLevelVideoUrl(1, 3))).toBe('midlength/Charging.mp4');
  });

  it('clamps out-of-range and non-numeric levels instead of crashing', () => {
    expect(pathOf(getSurfLevelVideoUrl(0, 99))).toBe('shortboard/Charging.mp4');
    expect(pathOf(getSurfLevelVideoUrl(0, -1))).toBe('shortboard/Dipping My Toes.mp4');
    expect(pathOf(getSurfLevelVideoUrl(0, NaN))).toBe('shortboard/Dipping My Toes.mp4');
    // Unknown board falls back to shortboard, like getSurfLevelVideos does.
    expect(pathOf(getSurfLevelVideoUrl(7, 1))).toBe('shortboard/Cruising Around.mp4');
  });
});

describe('getSurfLevelVideos — the level picker', () => {
  it.each([0, 1, 2])('board %i: clip names match the level labels users see, and the files exist', board => {
    const videos = getSurfLevelVideos(board);
    for (const { level, mapping } of getSurfLevelsForBoardType(board)) {
      expect(videos[level]?.name).toBe(mapping.description);
      expect(BUCKET.has(pathOf(videos[level]?.videoUrl ?? ''))).toBe(true);
    }
  });
});
