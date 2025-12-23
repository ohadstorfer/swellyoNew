import { useState, useEffect } from 'react';
import { Platform, Dimensions, ScaledSize } from 'react-native';

/**
 * Responsive Design Utilities
 * 
 * Best practices for cross-device compatibility:
 * 1. Use percentage-based widths with min/max constraints
 * 2. Use flexbox for layouts instead of fixed dimensions
 * 3. Test on actual devices, not just browser dev tools
 * 4. Use these utilities for consistent breakpoint detection
 */

// Breakpoints (matching common device sizes)
export const BREAKPOINTS = {
  xs: 320,   // Small phones
  sm: 375,   // iPhone SE, iPhone 8
  md: 414,   // iPhone 11 Pro Max, iPhone 12/13/14
  lg: 768,   // Tablets
  xl: 1024,  // Desktop
} as const;

/**
 * Get screen dimensions (works correctly on web and native)
 */
export const getScreenDimensions = (): { width: number; height: number } => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    // On web, use window.innerWidth/Height for accurate viewport size
    // This accounts for browser chrome and viewport scaling
    return {
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }
  // On native, use Dimensions API
  const { width, height } = Dimensions.get('window');
  return { width, height };
};

/**
 * Get screen width (responsive to viewport changes)
 */
export const getScreenWidth = (): number => {
  return getScreenDimensions().width;
};

/**
 * Get screen height (responsive to viewport changes)
 */
export const getScreenHeight = (): number => {
  return getScreenDimensions().height;
};

/**
 * Check if device is mobile (native or mobile web)
 */
export const isMobile = (): boolean => {
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    return true;
  }
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.innerWidth < BREAKPOINTS.lg;
  }
  return false;
};

/**
 * Check if device is desktop web
 */
export const isDesktopWeb = (): boolean => {
  if (Platform.OS !== 'web') return false;
  if (typeof window === 'undefined') return false;
  return window.innerWidth >= BREAKPOINTS.lg;
};

/**
 * Check if device is tablet
 */
export const isTablet = (): boolean => {
  const width = getScreenWidth();
  return width >= BREAKPOINTS.lg && width < BREAKPOINTS.xl;
};

/**
 * Get current breakpoint
 */
export const getBreakpoint = (): keyof typeof BREAKPOINTS => {
  const width = getScreenWidth();
  if (width < BREAKPOINTS.sm) return 'xs';
  if (width < BREAKPOINTS.md) return 'sm';
  if (width < BREAKPOINTS.lg) return 'md';
  if (width < BREAKPOINTS.xl) return 'lg';
  return 'xl';
};

/**
 * Calculate responsive width with constraints
 * @param percentage - Percentage of screen width (0-100)
 * @param minWidth - Minimum width in pixels
 * @param maxWidth - Maximum width in pixels
 * @param padding - Horizontal padding to subtract (default: 0)
 */
export const responsiveWidth = (
  percentage: number,
  minWidth?: number,
  maxWidth?: number,
  padding: number = 0
): number => {
  const screenWidth = getScreenWidth();
  const availableWidth = screenWidth - padding;
  let width = (availableWidth * percentage) / 100;
  
  if (minWidth !== undefined) {
    width = Math.max(width, minWidth);
  }
  if (maxWidth !== undefined) {
    width = Math.min(width, maxWidth);
  }
  
  return width;
};

/**
 * Calculate responsive font size
 * Scales between min and max based on screen width
 */
export const responsiveFontSize = (
  minSize: number,
  maxSize: number,
  minWidth: number = BREAKPOINTS.sm,
  maxWidth: number = BREAKPOINTS.xl
): number => {
  const screenWidth = getScreenWidth();
  
  if (screenWidth <= minWidth) return minSize;
  if (screenWidth >= maxWidth) return maxSize;
  
  // Linear interpolation
  const ratio = (screenWidth - minWidth) / (maxWidth - minWidth);
  return minSize + (maxSize - minSize) * ratio;
};

/**
 * Hook to get screen dimensions (updates on resize)
 */
export const useScreenDimensions = () => {
  const [dimensions, setDimensions] = useState(getScreenDimensions);

  useEffect(() => {
    // On web, listen to window resize for accurate viewport size
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const handleResize = () => {
        setDimensions({
          width: window.innerWidth,
          height: window.innerHeight,
        });
      };
      
      // Set initial dimensions
      handleResize();
      
      // Listen for resize events
      window.addEventListener('resize', handleResize);
      
      return () => {
        window.removeEventListener('resize', handleResize);
      };
    } else {
      // On native, use Dimensions API
      const subscription = Dimensions.addEventListener('change', ({ window }: { window: ScaledSize }) => {
        setDimensions({ width: window.width, height: window.height });
      });
      
      // Set initial dimensions
      const { width, height } = Dimensions.get('window');
      setDimensions({ width, height });
      
      return () => {
        subscription?.remove();
      };
    }
  }, []);

  return dimensions;
};

/**
 * Hook to check if device is mobile
 */
export const useIsMobile = (): boolean => {
  const { width } = useScreenDimensions();
  
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    return true;
  }
  
  return width < BREAKPOINTS.lg;
};

/**
 * Hook to check if device is desktop web
 */
export const useIsDesktopWeb = (): boolean => {
  const { width } = useScreenDimensions();
  
  if (Platform.OS !== 'web') return false;
  return width >= BREAKPOINTS.lg;
};

/**
 * Hook to get current breakpoint
 */
export const useBreakpoint = (): keyof typeof BREAKPOINTS => {
  const { width } = useScreenDimensions();
  
  if (width < BREAKPOINTS.sm) return 'xs';
  if (width < BREAKPOINTS.md) return 'sm';
  if (width < BREAKPOINTS.lg) return 'md';
  if (width < BREAKPOINTS.xl) return 'lg';
  return 'xl';
};

