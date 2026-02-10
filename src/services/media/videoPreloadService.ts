import { Platform } from 'react-native';
import { getSurfLevelVideoFromStorage } from './videoService';

const BOARD_VIDEO_DEFINITIONS: { [boardType: number]: Array<{ name: string; videoFileName: string; thumbnailFileName: string }> } = {
  0: [
    { name: 'Dipping My Toes', videoFileName: 'Dipping My Toes.mp4', thumbnailFileName: 'Dipping My Toes thumbnail.PNG' },
    { name: 'Cruising Around', videoFileName: 'Cruising Around.mp4', thumbnailFileName: 'Cruising Around thumbnail.PNG' },
    { name: 'Snapping', videoFileName: 'Snapping.mp4', thumbnailFileName: 'Snapping thumbnail.PNG' },
    { name: 'Charging', videoFileName: 'Charging.mp4', thumbnailFileName: 'Charging thumbnail.PNG' },
  ],
  1: [
    { name: 'Dipping My Toes', videoFileName: 'Dipping My Toes.mp4', thumbnailFileName: 'Dipping My Toes thumbnail.PNG' },
    { name: 'Cruising Around', videoFileName: 'Cruising Around.mp4', thumbnailFileName: 'Cruising Around thumbnail.PNG' },
    { name: 'Carving Turns', videoFileName: 'Carving Turns.mp4', thumbnailFileName: 'Carving Turns thumbnail.PNG' },
    { name: 'Charging', videoFileName: 'Charging.mp4', thumbnailFileName: 'Charging thumbnail.PNG' },
  ],
  2: [
    { name: 'Dipping My Toes', videoFileName: 'Dipping My Toes.mp4', thumbnailFileName: 'Dipping My Toes thumbnail.PNG' },
    { name: 'Cruising Around', videoFileName: 'Cruising Around.mp4', thumbnailFileName: 'Cruising Around thumbnail.PNG' },
    { name: 'Cross Stepping', videoFileName: 'CrossStepping.mp4', thumbnailFileName: 'CrossStepping thumbnail.PNG' },
    { name: 'Hanging Toes', videoFileName: 'Hanging Toes.mp4', thumbnailFileName: 'Hanging Toes thumbnail.PNG' },
  ],
};

const getBoardFolder = (boardType: number): string => {
  const folderMap: { [key: number]: string } = { 0: 'shortboard', 1: 'midlength', 2: 'longboard', 3: 'softtop' };
  return folderMap[boardType] || 'shortboard';
};

export interface VideoPreloadStatus {
  url: string;
  ready: boolean;
  error?: Error;
  readyState?: number;
}

export interface VideoPreloadResult {
  totalCount: number;
  readyCount: number;
  failedCount: number;
  videos: VideoPreloadStatus[];
}

const preloadStatusMap = new Map<string, VideoPreloadStatus>();
const hiddenVideoElements = new Map<string, HTMLVideoElement>();
const preloadLinks = new Map<string, HTMLLinkElement>(); // Track preload link elements
const HAVE_CURRENT_DATA = 2; // Less strict - video can play (Best Practice)
const HAVE_FUTURE_DATA = 3; // More strict - video can play through

const getVideoUrlsForBoardType = (boardType: number): string[] => {
  const boardVideos = BOARD_VIDEO_DEFINITIONS[boardType];
  if (!boardVideos) {
    if (__DEV__) console.warn(`[videoPreloadService] No videos defined for board type ${boardType}`);
    return [];
  }
  const boardFolder = getBoardFolder(boardType);
  return boardVideos.map(video => getSurfLevelVideoFromStorage(`${boardFolder}/${video.videoFileName}`));
};

// Add browser-level preload hint (Best Practice: Signal browser early)
const addPreloadLink = (url: string, priority: 'high' | 'normal' = 'normal'): void => {
  if (typeof document === 'undefined') return;
  if (preloadLinks.has(url)) return; // Already added
  
  try {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'video';
    link.href = url;
    if (priority === 'high') {
      link.setAttribute('fetchpriority', 'high'); // Best Practice: High priority for critical content
    }
    document.head.appendChild(link);
    preloadLinks.set(url, link);
    
    if (__DEV__) {
      console.log(`[videoPreloadService] Added browser preload hint for: ${url} (priority: ${priority})`);
    }
  } catch (error) {
    if (__DEV__) {
      console.warn('[videoPreloadService] Failed to add preload link:', error);
    }
  }
};

const preloadVideoWeb = async (url: string, priority: 'high' | 'normal' = 'normal'): Promise<VideoPreloadStatus> => {
  if (typeof document === 'undefined') return { url, ready: false, error: new Error('Document not available') };
  const existingStatus = preloadStatusMap.get(url);
  if (existingStatus?.ready) {
    if (__DEV__) {
      console.log(`[videoPreloadService] Video already preloaded: ${url}`);
    }
    return existingStatus;
  }
  
  // Check if preload is already in progress (prevent duplicates)
  const inProgressStatus = preloadStatusMap.get(url);
  if (inProgressStatus && !inProgressStatus.ready && !inProgressStatus.error) {
    if (__DEV__) {
      console.log(`[videoPreloadService] Preload already in progress for: ${url}`);
    }
    // Wait for existing preload to complete
    return new Promise<VideoPreloadStatus>((resolve) => {
      const checkInterval = setInterval(() => {
        const status = preloadStatusMap.get(url);
        if (status?.ready || status?.error) {
          clearInterval(checkInterval);
          resolve(status!);
        }
      }, 100);
      setTimeout(() => {
        clearInterval(checkInterval);
        const finalStatus = preloadStatusMap.get(url);
        resolve(finalStatus || { url, ready: false, error: new Error('Preload timeout') });
      }, 5000);
    });
  }
  
  try {
    // Add browser-level preload hint (Best Practice: Signal browser early)
    addPreloadLink(url, priority);
    
    // Mark as in progress
    preloadStatusMap.set(url, { url, ready: false });
    
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    
    // Use fetchpriority for high priority videos (Best Practice)
    if (priority === 'high' && 'fetchPriority' in video) {
      (video as any).fetchPriority = 'high';
    }
    
    video.style.position = 'absolute';
    video.style.left = '-9999px';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';
    hiddenVideoElements.set(url, video);
    document.body.appendChild(video);
    
    const readyPromise = new Promise<VideoPreloadStatus>((resolve) => {
      let isResolved = false;
      
      const checkReady = () => {
        if (isResolved) return;
        // Best Practice: Use HAVE_CURRENT_DATA (2) for faster readiness
        if (video.readyState >= HAVE_CURRENT_DATA) {
          isResolved = true;
          const status: VideoPreloadStatus = { url, ready: true, readyState: video.readyState };
          preloadStatusMap.set(url, status);
          if (__DEV__) {
            console.log(`[videoPreloadService] Video preloaded successfully: ${url} (readyState: ${video.readyState})`);
          }
          resolve(status);
        }
      };
      
      // Best Practice: Multiple event listeners with canplay as primary
      video.addEventListener('canplay', () => {
        if (__DEV__) {
          console.log(`[videoPreloadService] canplay event fired for: ${url} (readyState: ${video.readyState})`);
        }
        checkReady();
      }, { once: true });
      
      video.addEventListener('canplaythrough', () => {
        if (__DEV__) {
          console.log(`[videoPreloadService] canplaythrough event fired for: ${url}`);
        }
        checkReady();
      }, { once: true });
      
      video.addEventListener('loadeddata', () => {
        if (__DEV__) {
          console.log(`[videoPreloadService] loadeddata event fired for: ${url} (readyState: ${video.readyState})`);
        }
        checkReady();
      }, { once: true });
      
      // Error handling (Best Practice: Comprehensive error logging)
      const handleError = (e: Event) => {
        if (isResolved) return;
        isResolved = true;
        const error = video.error;
        const errorMessage = error 
          ? `Video error: code ${error.code}, message: ${error.message}`
          : 'Unknown video error';
        const status: VideoPreloadStatus = { 
          url, 
          ready: false, 
          error: new Error(errorMessage),
          readyState: video.readyState 
        };
        preloadStatusMap.set(url, status);
        if (__DEV__) {
          console.error(`[videoPreloadService] Video preload error for ${url}:`, errorMessage, 'readyState:', video.readyState);
        }
        resolve(status);
      };
      
      video.addEventListener('error', handleError, { once: true });
      
      // Initial check (video might already be ready)
      checkReady();
      
      // Timeout fallback
      setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          const status: VideoPreloadStatus = { 
            url, 
            ready: false, 
            error: new Error('Preload timeout'),
            readyState: video.readyState 
          };
          preloadStatusMap.set(url, status);
          if (__DEV__) {
            console.warn(`[videoPreloadService] Video preload timeout for: ${url} (readyState: ${video.readyState})`);
          }
          resolve(status);
        }
      }, 5000);
    });
    
    // Best Practice: Also use fetch for high priority videos
    if (priority === 'high') {
      fetch(url, { cache: 'force-cache' }).catch((err) => {
        if (__DEV__) {
          console.warn(`[videoPreloadService] High priority fetch failed for ${url}:`, err);
        }
      });
    }
    
    return await readyPromise;
  } catch (error) {
    const status: VideoPreloadStatus = { 
      url, 
      ready: false, 
      error: error instanceof Error ? error : new Error(String(error)) 
    };
    preloadStatusMap.set(url, status);
    if (__DEV__) {
      console.error(`[videoPreloadService] Video preload exception for ${url}:`, error);
    }
    return status;
  }
};

const preloadVideoNative = async (url: string): Promise<VideoPreloadStatus> => {
  const existingStatus = preloadStatusMap.get(url);
  if (existingStatus?.ready) return existingStatus;
  try {
    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`Failed to fetch video: ${response.statusText}`);
    await response.blob();
    const status: VideoPreloadStatus = { url, ready: true };
    preloadStatusMap.set(url, status);
    return status;
  } catch (error) {
    const status: VideoPreloadStatus = { url, ready: false, error: error instanceof Error ? error : new Error(String(error)) };
    preloadStatusMap.set(url, status);
    return status;
  }
};

export const preloadVideo = async (url: string, priority: 'high' | 'normal' = 'normal'): Promise<VideoPreloadStatus> => {
  return Platform.OS === 'web' ? preloadVideoWeb(url, priority) : preloadVideoNative(url);
};

export const preloadVideosForBoardType = async (boardType: number, priority: 'high' | 'normal' = 'normal'): Promise<VideoPreloadResult> => {
  if (boardType === 3) return { totalCount: 0, readyCount: 0, failedCount: 0, videos: [] };
  const videoUrls = getVideoUrlsForBoardType(boardType);
  if (videoUrls.length === 0) return { totalCount: 0, readyCount: 0, failedCount: 0, videos: [] };
  const firstVideoUrl = videoUrls[0];
  const remainingUrls = videoUrls.slice(1);
  const results: VideoPreloadStatus[] = [];
  const firstVideoPromise = preloadVideo(firstVideoUrl, 'high');
  results.push(await firstVideoPromise);
  const concurrentLimit = 2;
  const remainingPromises: Promise<VideoPreloadStatus>[] = [];
  for (let i = 0; i < remainingUrls.length; i += concurrentLimit) {
    const batch = remainingUrls.slice(i, i + concurrentLimit);
    const batchPromises = batch.map(url => preloadVideo(url, priority));
    remainingPromises.push(...batchPromises);
    if (i + concurrentLimit < remainingUrls.length) await Promise.allSettled(batchPromises);
  }
  const remainingResults = await Promise.allSettled(remainingPromises);
  remainingResults.forEach(result => {
    if (result.status === 'fulfilled') results.push(result.value);
    else results.push({ url: '', ready: false, error: result.reason });
  });
  const readyCount = results.filter(r => r.ready).length;
  const failedCount = results.filter(r => !r.ready).length;
  return { totalCount: results.length, readyCount, failedCount, videos: results };
};

export const isVideoPreloaded = (url: string): boolean => {
  const status = preloadStatusMap.get(url);
  return status?.ready === true;
};

export const getVideoPreloadStatus = (url: string): VideoPreloadStatus | null => {
  return preloadStatusMap.get(url) || null;
};

// Check if preload is currently in progress for a URL
export const isPreloadInProgress = (url: string): boolean => {
  const status = preloadStatusMap.get(url);
  return status !== undefined && !status.ready && !status.error;
};

export const waitForVideoReady = async (url: string, timeout: number = 5000): Promise<boolean> => {
  if (isVideoPreloaded(url)) return true;
  return new Promise((resolve) => {
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (isVideoPreloaded(url)) { clearInterval(checkInterval); resolve(true); return; }
      if (Date.now() - startTime >= timeout) { clearInterval(checkInterval); resolve(false); }
    }, 100);
  });
};

export const clearPreloadCache = (): void => {
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    hiddenVideoElements.forEach((video) => { if (video.parentNode) video.parentNode.removeChild(video); });
    hiddenVideoElements.clear();
    
    // Remove preload link elements
    preloadLinks.forEach((link) => { if (link.parentNode) link.parentNode.removeChild(link); });
    preloadLinks.clear();
  }
  preloadStatusMap.clear();
};

/**
 * Get the URL for the loading screen video
 * Returns the URL for '/Loading 4 to 5.mp4' using the videoService
 */
export const getLoadingVideoUrl = (): string => {
  const { getVideoUrl } = require('./videoService');
  return getVideoUrl('/Loading 4 to 5.mp4');
};

/**
 * Preload the loading screen video
 * Convenience function that preloads the loading video with specified priority
 */
export const preloadLoadingVideo = async (priority: 'high' | 'normal' = 'high'): Promise<VideoPreloadStatus> => {
  const url = getLoadingVideoUrl();
  return preloadVideo(url, priority);
};

// Helper function to map board type string to number (same as ProfileScreen)
const mapBoardTypeToNumber = (boardType: string): number => {
  const boardTypeLower = boardType.toLowerCase();
  if (boardTypeLower === 'shortboard') return 0;
  if (boardTypeLower === 'midlength' || boardTypeLower === 'mid_length') return 1;
  if (boardTypeLower === 'longboard') return 2;
  return 0; // Default to shortboard
};

/**
 * Get profile video URL for a user
 * Returns custom video URL if available, otherwise calculates default surf level video URL
 */
export const getProfileVideoUrl = async (userId: string): Promise<string | null> => {
  try {
    const { supabaseDatabaseService } = await import('../database/supabaseDatabaseService');
    const surferData = await supabaseDatabaseService.getSurferByUserId(userId);
    
    if (!surferData) {
      if (__DEV__) {
        console.log(`[videoPreloadService] No profile data found for user ${userId}`);
      }
      return null;
    }
    
    // Use custom video if available
    if (surferData.profile_video_url) {
      if (__DEV__) {
        console.log(`[videoPreloadService] Found custom profile video for user ${userId}`);
      }
      return surferData.profile_video_url;
    }
    
    // Otherwise calculate default surf level video
    if (surferData.surfboard_type && surferData.surf_level) {
      const boardTypeNum = mapBoardTypeToNumber(surferData.surfboard_type);
      const boardVideos = BOARD_VIDEO_DEFINITIONS[boardTypeNum];
      
      if (boardVideos && boardVideos.length > 0) {
        // Convert database surf level (1-5) to app level (0-4)
        const appLevel = surferData.surf_level - 1;
        
        // Clamp to valid range
        const videoIndex = Math.max(0, Math.min(appLevel, boardVideos.length - 1));
        const video = boardVideos[videoIndex];
        
        if (video) {
          const boardFolder = getBoardFolder(boardTypeNum);
          const storagePath = `${boardFolder}/${video.videoFileName}`;
          const defaultVideoUrl = getSurfLevelVideoFromStorage(storagePath);
          
          if (__DEV__) {
            console.log(`[videoPreloadService] Calculated default surf level video for user ${userId}: ${defaultVideoUrl}`);
          }
          return defaultVideoUrl;
        }
      }
    }
    
    if (__DEV__) {
      console.log(`[videoPreloadService] No video URL available for user ${userId}`);
    }
    return null;
  } catch (error) {
    console.error('[videoPreloadService] Error getting profile video URL:', error);
    return null;
  }
};

/**
 * Preload profile video for a user
 * Fetches profile data and preloads the appropriate video (custom or default)
 */
export const preloadProfileVideo = async (userId: string, priority: 'high' | 'normal' = 'high'): Promise<VideoPreloadStatus | null> => {
  try {
    const videoUrl = await getProfileVideoUrl(userId);
    if (!videoUrl) {
      if (__DEV__) {
        console.log(`[videoPreloadService] No video URL to preload for user ${userId}`);
      }
      return null;
    }
    
    if (__DEV__) {
      console.log(`[videoPreloadService] Preloading profile video for user ${userId}: ${videoUrl}`);
    }
    
    return preloadVideo(videoUrl, priority);
  } catch (error) {
    console.error('[videoPreloadService] Error preloading profile video:', error);
    return null;
  }
};

