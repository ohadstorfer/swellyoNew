import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
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
import { calculateAgeFromDOB } from '../utils/ageCalculation';
import { ageGateService } from '../services/ageGate/ageGateService';

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

  const ageSyncedForUserIdRef = useRef<string | null>(null);

  const syncAgeFromDOBIfNeeded = useCallback(async (surfer: SupabaseSurfer) => {
    if (ageSyncedForUserIdRef.current === surfer.user_id) return;

    let dob: string | null | undefined = surfer.date_of_birth;
    let dobSource: 'db' | 'asyncstorage' = 'db';
    if (!dob) {
      try {
        dob = await ageGateService.getDOB();
        dobSource = 'asyncstorage';
      } catch {
        dob = null;
      }
    }
    console.log('[ageSync] dob:', dob, 'source:', dobSource, 'storedAge:', surfer.age);
    if (!dob) {
      console.log('[ageSync] skip — no dob anywhere');
      return;
    }

    const calculatedAge = calculateAgeFromDOB(dob);
    console.log('[ageSync] calculatedAge:', calculatedAge);
    if (calculatedAge === null || calculatedAge === surfer.age) {
      console.log('[ageSync] skip — age matches or invalid');
      ageSyncedForUserIdRef.current = surfer.user_id;
      return;
    }
    ageSyncedForUserIdRef.current = surfer.user_id;
    console.log('[ageSync] WRITING age to DB:', calculatedAge);
    const ok = await supabaseDatabaseService.updateSurferAge(calculatedAge);
    console.log('[ageSync] write result:', ok);
    if (!ok) return;
    setProfile(prev => (prev && prev.user_id === surfer.user_id ? { ...prev, age: calculatedAge } : prev));
  }, []);

  const fetchFromServer = useCallback(
    async (targetUserId: string): Promise<SupabaseSurfer | null> => {
      if (inflightRef.current) return inflightRef.current;
      const promise = (async () => {
        try {
          const surfer = await supabaseDatabaseService.getSurferByUserId(targetUserId);
          if (surfer) {
            setProfile(surfer);
            await saveCachedFullProfile(surfer);
            syncAgeFromDOBIfNeeded(surfer).catch(err =>
              console.warn('[UserProfileContext] age sync failed:', err),
            );
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
    [syncAgeFromDOBIfNeeded],
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

  // Re-check age when the app returns to foreground — covers the case where
  // the JS bundle stays alive across the user's birthday (no cold start).
  useEffect(() => {
    if (!profile) return;
    const handleAppStateChange = (next: AppStateStatus) => {
      if (next !== 'active') return;
      ageSyncedForUserIdRef.current = null;
      syncAgeFromDOBIfNeeded(profile).catch(err =>
        console.warn('[UserProfileContext] age sync failed:', err),
      );
    };
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, [profile, syncAgeFromDOBIfNeeded]);

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
