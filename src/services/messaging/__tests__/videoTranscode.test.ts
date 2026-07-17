import {
  shouldTranscode,
  TRANSCODE_MIN_BYTES,
  TRANSCODE_MIN_DIMENSION,
} from '../videoTranscode';

const MB = 1024 * 1024;

describe('shouldTranscode', () => {
  it('transcodes a big clip — this is the 4K-HEVC case the whole thing exists for', () => {
    expect(shouldTranscode({ width: 3840, height: 2160, fileSize: 180 * MB })).toBe(true);
  });

  it('skips a small clip: the export would cost more than the upload it saves', () => {
    expect(shouldTranscode({ width: 1280, height: 720, fileSize: 2 * MB })).toBe(false);
  });

  it('trusts fileSize over dimensions — a LONG 720p clip is still worth shrinking', () => {
    expect(shouldTranscode({ width: 1280, height: 720, fileSize: 30 * MB })).toBe(true);
  });

  it('trusts fileSize over dimensions — a SHORT 4K clip is left alone', () => {
    expect(shouldTranscode({ width: 3840, height: 2160, fileSize: 1 * MB })).toBe(false);
  });

  it('falls back to dimensions when the picker reported no size', () => {
    expect(shouldTranscode({ width: 3840, height: 2160 })).toBe(true);
    expect(shouldTranscode({ width: 640, height: 480 })).toBe(false);
  });

  it('uses the LARGEST dimension, so a portrait 4K clip still qualifies', () => {
    expect(shouldTranscode({ width: 1080, height: 3840 })).toBe(true);
  });

  it('skips when nothing is known rather than burning CPU on a guess', () => {
    expect(shouldTranscode({})).toBe(false);
    expect(shouldTranscode(undefined)).toBe(false);
  });

  it('does not fire exactly at the thresholds', () => {
    expect(shouldTranscode({ fileSize: TRANSCODE_MIN_BYTES })).toBe(false);
    expect(shouldTranscode({ fileSize: TRANSCODE_MIN_BYTES + 1 })).toBe(true);
    expect(shouldTranscode({ width: TRANSCODE_MIN_DIMENSION, height: 720 })).toBe(false);
    expect(shouldTranscode({ width: TRANSCODE_MIN_DIMENSION + 1, height: 720 })).toBe(true);
  });
});
