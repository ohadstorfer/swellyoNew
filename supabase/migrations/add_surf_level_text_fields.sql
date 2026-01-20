-- Add surf_level_description and surf_level_category columns to surfers table
-- These fields store board-specific surf level descriptions and general categories

ALTER TABLE surfers 
ADD COLUMN IF NOT EXISTS surf_level_description TEXT,
ADD COLUMN IF NOT EXISTS surf_level_category TEXT CHECK (surf_level_category IN ('beginner', 'intermediate', 'advanced', 'pro'));

-- Add index for category-based queries
CREATE INDEX IF NOT EXISTS idx_surfers_surf_level_category 
ON public.surfers(surf_level_category) 
WHERE surf_level_category IS NOT NULL;

-- Add composite index for category + board type queries (common filtering pattern)
CREATE INDEX IF NOT EXISTS idx_surfers_surf_level_category_board_type 
ON public.surfers(surf_level_category, surfboard_type) 
WHERE surf_level_category IS NOT NULL AND surfboard_type IS NOT NULL;

COMMENT ON COLUMN surfers.surf_level_description IS 'Board-specific surf level description (e.g., "Snapping", "Cross Stepping", "Carving Turns")';
COMMENT ON COLUMN surfers.surf_level_category IS 'General surf level category: beginner, intermediate, advanced, or pro';

