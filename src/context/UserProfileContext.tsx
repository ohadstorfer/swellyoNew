import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  supabaseDatabaseService,
  SupabaseSurfer,
} from '../services/database/supabaseDatabaseService';
import {
  loadCachedFullProfile,
  saveCachedFullProfile,
} from '../utils/userProfileCache';
import { avatarCacheService } from '../services/media/avatarCacheService';
import { useOnboarding } from './OnboardingContext';

type UserProfileContextValue = {
  profile: SupabaseSurfer | null;
  isLoading: boolean;
  refresh: () => Promise<SupabaseSurfer | null>;
  updateProfile: (next: SupabaseSurfer) => void;
};

const UserProfileContext = createContext<UserProfileContextValue | undefined>(undefined);

export const UserProfileProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useOnboarding();
  const userId = user?.id?.toString() ?? null;

  const [profile, setProfile] = useState<SupabaseSurfer | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const inflightRef = useRef<Promise<SupabaseSurfer | null> | null>(null);
  const loadedForUserIdRef = useRef<string | null>(null);

  const fetchFromServer = useCallback(
    async (targetUserId: string): Promise<SupabaseSurfer | null> => {
      if (inflightRef.current) return inflightRef.current;
      const promise = (async () => {
        try {
          const surfer = await supabaseDatabaseService.getSurferByUserId(targetUserId);
          if (surfer) {
            setProfile(surfer);
            await saveCachedFullProfile(surfer);
          }
          return surfer;
        } catch (error) {
          console.error('[UserProfileContext] Error fetching surfer:', error);
          return null;
        } finally {
          inflightRef.current = null;
        }
      })();
      inflightRef.current = promise;
      return promise;
    },
    [],
  );

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      loadedForUserIdRef.current = null;
      return;
    }

    let cancelled = false;
    (async () => {
      const cached = await loadCachedFullProfile();
      if (cancelled) return;

      if (cached && cached.userId === userId) {
        // Render instantly from cache; skip loading flag to avoid skeleton flicker.
        setProfile(cached.surfer);
      } else {
        setIsLoading(true);
      }

      const fresh = await fetchFromServer(userId);
      if (cancelled) return;
      if (fresh) setProfile(fresh);
      loadedForUserIdRef.current = userId;
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, fetchFromServer]);

  // Warm the expo-image cache with the logged-in user's avatar as soon as we
  // know the URL. The header in ConversationsScreen / DMs renders it first
  // thing after login, so prefetching here makes that render instant.
  useEffect(() => {
    const url = profile?.profile_image_url;
    if (url) {
      avatarCacheService.prefetchAvatar(url).catch(() => {
        // prefetchAvatar already logs; swallow to keep context cheap
      });
    }
  }, [profile?.profile_image_url]);

  const refresh = useCallback(async () => {
    if (!userId) return null;
    return fetchFromServer(userId);
  }, [userId, fetchFromServer]);

  const updateProfile = useCallback((next: SupabaseSurfer) => {
    setProfile(next);
    saveCachedFullProfile(next).catch(err => {
      console.warn('[UserProfileContext] Error persisting updated profile:', err);
    });
  }, []);

  const value: UserProfileContextValue = { profile, isLoading, refresh, updateProfile };

  return <UserProfileContext.Provider value={value}>{children}</UserProfileContext.Provider>;
};

export const useUserProfile = (): UserProfileContextValue => {
  const ctx = useContext(UserProfileContext);
  if (!ctx) {
    throw new Error('useUserProfile must be used within a UserProfileProvider');
  }
  return ctx;
};
