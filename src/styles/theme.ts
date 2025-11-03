export const colors = {
  // Primary colors
  primary: '#8B4513', // Dark brown
  primaryLight: '#A0522D', // Reddish-brown
  
  // Background colors
  backgroundLight: '#FFF5F5', // Very light peachy-pink
  backgroundMedium: '#FFE4E1', // Light pink/peach
  
  // Text colors
  textDark: '#2F2F2F', // Almost black
  textMedium: '#8B4513', // Dark brown
  textLight: '#A0522D', // Reddish-brown
  
  // Button colors
  buttonBackground: '#FFE4E1', // Light pink/peach
  buttonText: '#8B4513', // Dark brown
  
  // Accent colors
  white: '#FFFFFF',
  black: '#000000',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
  xxxl: 60,
  xxxxl: 80,
};

export const typography = {
  headline: {
    fontSize: 28,
    fontWeight: '600' as const,
    lineHeight: 36,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold' as const,
    lineHeight: 40,
  },
  tagline: {
    fontSize: 18,
    fontWeight: '400' as const,
    lineHeight: 24,
  },
  body: {
    fontSize: 16,
    fontWeight: '400' as const,
    lineHeight: 22,
  },
  button: {
    fontSize: 18,
    fontWeight: 'bold' as const,
  },
  link: {
    fontSize: 16,
    fontWeight: '600' as const,
  },
};

export const borderRadius = {
  small: 8,
  medium: 16,
  large: 25,
  round: 50,
};

export const shadows = {
  small: {
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  medium: {
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
}; 