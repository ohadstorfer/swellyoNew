import { User } from './databaseService';

export const formatUserDisplayName = (user: User | null): string => {
  if (!user) return 'Guest';
  return user.nickname || user.email || 'User';
};

export const getUserInitials = (user: User | null): string => {
  if (!user) return 'G';
  
  const name = user.nickname || user.email || 'User';
  const words = name.split(' ');
  
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  
  return name[0].toUpperCase();
};

export const isUserSignedIn = (user: User | null): boolean => {
  return user !== null && user.googleId !== '';
};
