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
