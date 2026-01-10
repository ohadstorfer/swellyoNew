/**
 * Loading timing constants
 * Used to control when skeletons appear to avoid flicker for fast loads
 */

// Delay before showing skeletons (ms)
// Prevents flicker for very fast API responses (< 200ms)
export const SKELETON_DELAY_MS = 200;

// Minimum loading time before showing skeletons (ms)
// Ensures skeletons don't flash for very quick operations
export const MIN_LOADING_TIME_MS = 150;

// Maximum skeleton display time (ms)
// Prevents skeletons from showing indefinitely
export const MAX_SKELETON_TIME_MS = 10000;

