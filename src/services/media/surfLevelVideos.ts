import { Images } from '../../assets/images';
import { VideoLevel } from '../../components/VideoCarousel';
import { getSurfLevelVideoFromStorage } from './videoService';
import { getPlaybackUrl } from './videoPreloadService';

// Board-specific video definitions. Each board type has 4 ordered videos.
const BOARD_VIDEO_DEFINITIONS: {
  [boardType: number]: Array<{ name: string; videoFileName: string; thumbnailFileName: string }>;
} = {
  // Shortboard (id: 0)
  0: [
    { name: 'Dipping My Toes', videoFileName: 'Dipping My Toes.mp4', thumbnailFileName: 'Dipping My Toes thumbnail.PNG' },
    { name: 'Cruising Around', videoFileName: 'Cruising Around.mp4', thumbnailFileName: 'Cruising Around thumbnail.PNG' },
    { name: 'Snapping', videoFileName: 'Snapping.mp4', thumbnailFileName: 'Snapping thumbnail.PNG' },
    { name: 'Charging', videoFileName: 'Charging.mp4', thumbnailFileName: 'Charging thumbnail.PNG' },
  ],
  // Midlength (id: 1)
  1: [
    { name: 'Dipping My Toes', videoFileName: 'Dipping My Toes.mp4', thumbnailFileName: 'Dipping My Toes thumbnail.PNG' },
    { name: 'Cruising Around', videoFileName: 'Cruising Around.mp4', thumbnailFileName: 'Cruising Around thumbnail.PNG' },
    { name: 'Carving Turns', videoFileName: 'Carving Turns.mp4', thumbnailFileName: 'Carving Turns thumbnail.PNG' },
    { name: 'Charging', videoFileName: 'Charging.mp4', thumbnailFileName: 'Charging thumbnail.PNG' },
  ],
  // Longboard (id: 2)
  2: [
    { name: 'Dipping My Toes', videoFileName: 'Dipping My Toes.mp4', thumbnailFileName: 'Dipping My Toes thumbnail.PNG' },
    { name: 'Cruising Around', videoFileName: 'Cruising Around.mp4', thumbnailFileName: 'Cruising Around thumbnail.PNG' },
    { name: 'Cross Stepping', videoFileName: 'CrossStepping.mp4', thumbnailFileName: 'CrossStepping thumbnail.PNG' },
    { name: 'Hanging Toes', videoFileName: 'Hanging Toes.mp4', thumbnailFileName: 'Hanging Toes thumbnail.PNG' },
  ],
  // Softtop (id: 3) — no videos
};

export const getBoardFolder = (boardType: number): string => {
  const folderMap: { [key: number]: string } = {
    0: 'shortboard',
    1: 'midlength',
    2: 'longboard',
    3: 'softtop',
  };
  return folderMap[boardType] || 'shortboard';
};

const THUMBNAIL_MAP: Record<string, Record<string, any>> = {
  shortboard: {
    'Dipping My Toes thumbnail.PNG': Images.surfLevel.shortboard.dippingMyToes,
    'Cruising Around thumbnail.PNG': Images.surfLevel.shortboard.cruisingAround,
    'Snapping thumbnail.PNG': Images.surfLevel.shortboard.snapping,
    'Charging thumbnail.PNG': Images.surfLevel.shortboard.charging,
  },
  midlength: {
    'Dipping My Toes thumbnail.PNG': Images.surfLevel.midlength.dippingMyToes,
    'Cruising Around thumbnail.PNG': Images.surfLevel.midlength.cruisingAround,
    'Carving Turns thumbnail.PNG': Images.surfLevel.midlength.carvingTurns,
    'Charging thumbnail.PNG': Images.surfLevel.midlength.chargingOrCarving,
    'Charging thumbnail.png': Images.surfLevel.midlength.chargingOrCarving,
  },
  longboard: {
    'Dipping My Toes thumbnail.PNG': Images.surfLevel.longboard.dippingMyToes,
    'Cruising Around thumbnail.PNG': Images.surfLevel.longboard.cruisingAround,
    'CrossStepping thumbnail.PNG': Images.surfLevel.longboard.crossStepping,
    'Hanging Toes thumbnail.PNG': Images.surfLevel.longboard.hangingToes,
  },
};

const videoUrlCache = new Map<string, string>();

/**
 * Storage URL of the demo clip for one board + level (app level, 0-based).
 *
 * This is the ONLY place that turns (board, level) into a file name. The
 * onboarding "Surf Skill" card used to carry its own copy of the table, and
 * that copy drifted: on longboard it asked for "Trimming Lines.mp4" and
 * "Carving Turns.mp4", files that never existed in the bucket, so anyone past
 * level 2 on a longboard saw a black card (since 2026-03-18). The names here
 * are checked against surfLevelMapping (the label source) and against the
 * real bucket listing by surfLevelVideos.test.ts.
 *
 * Softtop skips the level picker (AppContent forces surfLevel 0) and the bucket
 * holds exactly one softtop clip, so every softtop level maps to it. It stays
 * out of BOARD_VIDEO_DEFINITIONS on purpose: getSurfLevelVideos(3) falling back
 * to the four shortboard clips is what the Edit Surf Skill carousel relies on.
 *
 * Returns the plain storage URL, not the preload cache — same as the screen
 * always did. Callers that want the cached file:// go through getSurfLevelVideos.
 */
export const getSurfLevelVideoUrl = (boardType: number, surfLevel: number): string => {
  if (boardType === 3) {
    return getSurfLevelVideoFromStorage('softtop/Dipping My Toes.mp4');
  }
  const knownBoard = boardType in BOARD_VIDEO_DEFINITIONS ? boardType : 0;
  const boardVideos = BOARD_VIDEO_DEFINITIONS[knownBoard];
  const level = Number.isFinite(surfLevel) ? surfLevel : 0;
  const index = Math.max(0, Math.min(level, boardVideos.length - 1));
  return getSurfLevelVideoFromStorage(`${getBoardFolder(knownBoard)}/${boardVideos[index].videoFileName}`);
};


export const getSurfLevelVideos = (boardType: number): VideoLevel[] => {
  const boardVideos = BOARD_VIDEO_DEFINITIONS[boardType];
  if (!boardVideos) {
    console.warn(`No videos defined for board type ${boardType}, using shortboard as fallback`);
    return getSurfLevelVideos(0);
  }

  const boardFolder = getBoardFolder(boardType);

  return boardVideos.map((video, index) => {
    const storagePath = `${boardFolder}/${video.videoFileName}`;
    const thumbnailSource = THUMBNAIL_MAP[boardFolder]?.[video.thumbnailFileName];

    let videoUrl: string;
    if (videoUrlCache.has(storagePath)) {
      videoUrl = videoUrlCache.get(storagePath)!;
    } else {
      const originalUrl = getSurfLevelVideoFromStorage(storagePath);
      videoUrl = getPlaybackUrl(originalUrl);
      videoUrlCache.set(storagePath, videoUrl);
    }

    return {
      id: index,
      name: video.name,
      thumbnailSource,
      videoUrl,
    };
  });
};
