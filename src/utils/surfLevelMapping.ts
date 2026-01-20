/**
 * Surf Level Mapping Utility
 * 
 * Maps board type + numeric surf level to description and category
 * Handles board-specific level descriptions and general categories
 */

export type SurfLevelCategory = 'beginner' | 'intermediate' | 'advanced' | 'pro';
export type BoardTypeEnum = 'shortboard' | 'mid_length' | 'longboard' | 'soft_top';

export interface SurfLevelMapping {
  description: string | null;
  category: SurfLevelCategory;
}

/**
 * Map board type number (0-3) to enum string
 */
export function mapBoardTypeNumberToEnum(boardType: number): BoardTypeEnum | null {
  const boardTypeMap: { [key: number]: BoardTypeEnum } = {
    0: 'shortboard',
    1: 'mid_length',
    2: 'longboard',
    3: 'soft_top',
  };
  return boardTypeMap[boardType] || null;
}

/**
 * Map board type enum string to number (0-3)
 */
export function mapBoardTypeEnumToNumber(boardTypeEnum: BoardTypeEnum): number {
  const enumToNumberMap: { [key in BoardTypeEnum]: number } = {
    shortboard: 0,
    mid_length: 1,
    longboard: 2,
    soft_top: 3,
  };
  return enumToNumberMap[boardTypeEnum];
}

/**
 * Surf level mapping: boardType + numericLevel (0-4) → {description, category}
 * 
 * Note: App uses 0-4, database uses 1-5
 * - App level 0 = Database level 1 = beginner
 * - App level 1 = Database level 2 = intermediate  
 * - App level 2 = Database level 3 = advanced
 * - App level 3 = Database level 4 = pro
 */
const SURF_LEVEL_MAP: Record<BoardTypeEnum, Record<number, SurfLevelMapping>> = {
  soft_top: {
    0: { description: null, category: 'beginner' }, // Softtop skips level - always beginner
  },
  shortboard: {
    0: { description: 'Dipping My Toes', category: 'beginner' },
    1: { description: 'Cruising Around', category: 'intermediate' },
    2: { description: 'Snapping', category: 'advanced' },
    3: { description: 'Charging', category: 'pro' },
  },
  longboard: {
    0: { description: 'Dipping My Toes', category: 'beginner' },
    1: { description: 'Cruising Around', category: 'intermediate' },
    2: { description: 'Cross Stepping', category: 'advanced' },
    3: { description: 'Hanging Toes', category: 'pro' },
  },
  mid_length: {
    0: { description: 'Dipping My Toes', category: 'beginner' },
    1: { description: 'Cruising Around', category: 'intermediate' },
    2: { description: 'Carving Turns', category: 'advanced' },
    3: { description: 'Charging', category: 'pro' },
  },
};

/**
 * Get surf level mapping from board type number and numeric level (app format: 0-4)
 */
export function getSurfLevelMapping(
  boardType: number,
  surfLevel: number
): SurfLevelMapping | null {
  const boardTypeEnum = mapBoardTypeNumberToEnum(boardType);
  if (!boardTypeEnum) {
    console.warn(`Invalid board type: ${boardType}`);
    return null;
  }

  // For soft_top, only level 0 is valid
  if (boardTypeEnum === 'soft_top' && surfLevel !== 0) {
    console.warn(`Soft top only supports level 0, got: ${surfLevel}`);
    return SURF_LEVEL_MAP.soft_top[0];
  }

  const levelMap = SURF_LEVEL_MAP[boardTypeEnum];
  if (!levelMap || !levelMap[surfLevel]) {
    console.warn(`Invalid surf level ${surfLevel} for board type ${boardTypeEnum}`);
    return null;
  }

  return levelMap[surfLevel];
}

/**
 * Get surf level mapping from board type enum and numeric level (database format: 1-5)
 */
export function getSurfLevelMappingFromEnum(
  boardTypeEnum: BoardTypeEnum,
  surfLevel: number // Database format: 1-5
): SurfLevelMapping | null {
  // Convert database level (1-5) to app level (0-4)
  const appLevel = surfLevel - 1;

  // For soft_top, only level 1 (app level 0) is valid
  if (boardTypeEnum === 'soft_top' && surfLevel !== 1) {
    console.warn(`Soft top only supports level 1 (database), got: ${surfLevel}`);
    return SURF_LEVEL_MAP.soft_top[0];
  }

  const levelMap = SURF_LEVEL_MAP[boardTypeEnum];
  if (!levelMap || !levelMap[appLevel]) {
    console.warn(`Invalid surf level ${surfLevel} (app level ${appLevel}) for board type ${boardTypeEnum}`);
    return null;
  }

  return levelMap[appLevel];
}

/**
 * Get all valid surf levels for a board type
 */
export function getSurfLevelsForBoardType(boardType: number): Array<{ level: number; mapping: SurfLevelMapping }> {
  const boardTypeEnum = mapBoardTypeNumberToEnum(boardType);
  if (!boardTypeEnum) {
    return [];
  }

  const levelMap = SURF_LEVEL_MAP[boardTypeEnum];
  return Object.entries(levelMap).map(([levelStr, mapping]) => ({
    level: parseInt(levelStr, 10),
    mapping,
  }));
}

/**
 * Convert category string to numeric range (for backward compatibility)
 * Returns [min, max] in database format (1-5)
 */
export function categoryToNumericRange(category: SurfLevelCategory): [number, number] {
  const categoryRanges: Record<SurfLevelCategory, [number, number]> = {
    beginner: [1, 1],      // Database level 1
    intermediate: [2, 2],  // Database level 2
    advanced: [3, 3],      // Database level 3
    pro: [4, 4],           // Database level 4
  };
  return categoryRanges[category];
}

