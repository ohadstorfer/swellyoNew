import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { OnboardingData } from '../screens/OnboardingStep1Screen';
import { User, databaseService } from '../services/database/databaseService';
import { onboardingService } from '../services/onboarding/onboardingService';
import { supabaseDatabaseService } from '../services/database/supabaseDatabaseService';
import { isSupabaseConfigured, supabase } from '../config/supabase';
import { Platform } from 'react-native';

interface OnboardingContextType {
  currentStep: number;
  formData: Partial<OnboardingData>;
  user: User | null;
  setCurrentStep: (step: number) => void;
  updateFormData: (data: Partial<OnboardingData>) => void;
  setUser: (user: User | null) => void;
  resetOnboarding: () => void;
  isComplete: boolean;
  saveStepToSupabase: (stepData: Partial<OnboardingData>) => Promise<void>;
  markOnboardingComplete: () => void;
  checkOnboardingStatus: () => Promise<boolean>;
  isDemoUser: boolean;
  setIsDemoUser: (isDemo: boolean) => void;
  isRestoringSession: boolean;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

const STORAGE_KEY = '@swellyo_onboarding';

export const OnboardingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Check if we're on the swelly_chat route
  const getInitialStep = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
      const path = window.location.pathname || '';
      const hash = window.location.hash || '';
      if (path.includes('swelly_chat') || hash.includes('swelly_chat')) {
        return 5; // Go directly to chat screen
      }
    }
    return -1; // Default to -1 (WelcomeScreen), not 0 (OnboardingWelcomeScreen)
  };

  const [currentStep, setCurrentStep] = useState(getInitialStep());
  const [formData, setFormData] = useState<Partial<OnboardingData>>({});
  const [user, setUser] = useState<User | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [isDemoUser, setIsDemoUser] = useState(false);
  const [isRestoringSession, setIsRestoringSession] = useState(true);

  // Restore session on mount - this runs FIRST before any other logic
  useEffect(() => {
    restoreSession();
  }, []);

  // Load saved data on mount - runs after session restoration
  useEffect(() => {
    if (!isRestoringSession) {
      loadOnboardingData();
      initializeDatabase();
    }
  }, [isRestoringSession]);

  // Reset formData if it has invalid boardType when starting demo
  useEffect(() => {
    // If boardType is 3 (Soft Top) and we're on step 1, reset it to -1 for fresh start
    if (currentStep === 1 && formData.boardType === 3 && isDemoUser) {
      console.log('[OnboardingContext] Resetting boardType from 3 to -1 for demo user');
      updateFormData({ boardType: -1 });
    }
  }, [currentStep, formData.boardType, isDemoUser]);

  // Save to local storage whenever step, formData, or isComplete changes (for step tracking and recovery)
  // Note: Supabase saving happens only when user presses "Next" button
  useEffect(() => {
    if (isLoaded) {
      saveToLocalStorage();
    }
  }, [currentStep, formData, isLoaded, isComplete]);

  // Reset formData if it has invalid boardType when starting demo
  useEffect(() => {
    // If boardType is 3 (Soft Top) and we're on step 1 as a demo user, reset it to -1 for fresh start
    if (currentStep === 1 && formData.boardType === 3 && isDemoUser) {
      console.log('[OnboardingContext] Resetting boardType from 3 to -1 for demo user');
      setFormData(prev => ({ ...prev, boardType: -1 }));
    }
  }, [currentStep, formData.boardType, isDemoUser]);

  // Restore session from Supabase on mount
  // This runs FIRST to check if user has a valid session before any other logic
  const restoreSession = async () => {
    console.log('[OnboardingContext] Starting session restoration...');
    
    if (!isSupabaseConfigured()) {
      console.log('[OnboardingContext] Supabase not configured, skipping session restoration');
      setIsRestoringSession(false);
      return;
    }
    
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError) {
        console.log('[OnboardingContext] Error getting session:', sessionError.message);
        setIsRestoringSession(false);
        return;
      }
      
      if (session?.user) {
        console.log('[OnboardingContext] Session found, restoring user:', session.user.id);
        
        // Convert Supabase user to app user format
        const { convertSupabaseUserToAppUser } = await import('../utils/userConversion');
        const appUser = convertSupabaseUserToAppUser(session.user);
        
        setUser(appUser);
        console.log('[OnboardingContext] User restored from session:', appUser.id);
        
        // Also update form data with user info
        setFormData(prev => ({
          ...prev,
          nickname: appUser.nickname,
          userEmail: appUser.email,
        }));
      } else {
        console.log('[OnboardingContext] No session found');
      }
    } catch (error) {
      console.error('[OnboardingContext] Error restoring session:', error);
    } finally {
      console.log('[OnboardingContext] Session restoration complete');
      setIsRestoringSession(false);
    }
  };

  // Define resetOnboarding function early so it can be used in useEffect
  // Use useCallback to ensure stable reference for useEffect dependencies
  // State setters from useState are stable, so they don't need to be in dependencies
  const resetOnboarding = useCallback(async () => {
    setCurrentStep(-1); // Go back to welcome screen (-1 = WelcomeScreen)
    setFormData({});
    setUser(null);
    setIsComplete(false);
    setIsDemoUser(false); // Reset demo user flag
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.log('Error resetting onboarding data:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // State setters are stable, no dependencies needed

  // Auth state listener - handle session expiration during onboarding
  useEffect(() => {
    if (!isSupabaseConfigured()) {
      return;
    }

    // Don't interfere with demo users
    if (isDemoUser) {
      return;
    }

    console.log('[OnboardingContext] Setting up auth state listener');

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[OnboardingContext] Auth state changed:', event, session ? 'session exists' : 'no session');

      // Handle sign out events
      if (event === 'SIGNED_OUT') {
        console.log('[OnboardingContext] SIGNED_OUT event detected during onboarding');
        // Clear user state and reset to WelcomeScreen
        setUser(null);
        setIsDemoUser(false);
        setCurrentStep(-1);
        try {
          await resetOnboarding();
        } catch (error) {
          console.error('[OnboardingContext] Error resetting onboarding on sign out:', error);
        }
        return;
      }

      // Handle token refresh failures
      if (event === 'TOKEN_REFRESHED' && !session) {
        console.log('[OnboardingContext] Token refresh failed during onboarding');
        // Clear user state and reset to WelcomeScreen
        setUser(null);
        setIsDemoUser(false);
        setCurrentStep(-1);
        try {
          await resetOnboarding();
        } catch (error) {
          console.error('[OnboardingContext] Error resetting onboarding on token refresh failure:', error);
        }
        return;
      }

      // If user exists in context but session is lost, clear state
      if (user !== null && !session && (event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED')) {
        console.log('[OnboardingContext] Session lost during onboarding');
        setUser(null);
        setIsDemoUser(false);
        setCurrentStep(-1);
        try {
          await resetOnboarding();
        } catch (error) {
          console.error('[OnboardingContext] Error resetting onboarding on session loss:', error);
        }
      }
    });

    return () => {
      console.log('[OnboardingContext] Cleaning up auth state listener');
      subscription.unsubscribe();
    };
  }, [user, isDemoUser, resetOnboarding, setUser, setIsDemoUser, setCurrentStep]);

  const initializeDatabase = async () => {
    try {
      await databaseService.init();
      console.log('Database initialized successfully');
    } catch (error) {
      console.error('Error initializing database:', error);
    }
  };

  const loadOnboardingData = async () => {
    try {
      // First, check database for finished_onboarding status if user is authenticated
      let dbOnboardingComplete = false;
      if (isSupabaseConfigured()) {
        try {
          const { surfer } = await supabaseDatabaseService.getCurrentUserData();
          if (surfer?.finished_onboarding) {
            dbOnboardingComplete = true;
            console.log('User has finished onboarding (from database)');
          }
        } catch (error) {
          console.log('Error checking database for onboarding status:', error);
          // Continue with local storage check if database check fails
        }
      }

      const savedData = await AsyncStorage.getItem(STORAGE_KEY);
      console.log('Loading saved data:', savedData);
      if (savedData) {
        const parsed = JSON.parse(savedData);
        console.log('Parsed data:', parsed);
        
        // Only override the current step if we're not on the swelly_chat route
        const isOnSwellyChatRoute = Platform.OS === 'web' && typeof window !== 'undefined' && window.location &&
          ((window.location.pathname || '').includes('swelly_chat') || (window.location.hash || '').includes('swelly_chat'));
        
        // Load user data if available
        const hasUser = parsed.user !== null && parsed.user !== undefined;
        if (hasUser) {
          setUser(parsed.user);
        }
        
        // Load onboarding completion status - prioritize database value over local storage
        const isOnboardingComplete = dbOnboardingComplete || parsed.isComplete === true;
        if (isOnboardingComplete) {
          setIsComplete(true);
        } else if (parsed.isComplete !== undefined) {
          setIsComplete(parsed.isComplete);
        }
        
        // Only restore step 0 (OnboardingWelcomeScreen) if:
        // 1. Not on swelly_chat route
        // 2. There's a user (logged in)
        // 3. Onboarding is not complete
        // Otherwise, default to -1 (WelcomeScreen)
        if (!isOnSwellyChatRoute) {
          if (hasUser && !isOnboardingComplete && parsed.currentStep === 0) {
            // User is logged in and needs onboarding, restore step 0
            setCurrentStep(0);
          } else if (parsed.currentStep !== undefined && parsed.currentStep > 0) {
            // Restore other steps (1-5) if they exist
            setCurrentStep(parsed.currentStep);
          } else {
            // No user or onboarding complete, default to WelcomeScreen
            setCurrentStep(-1);
          }
        }
        
        // Ensure form data has the correct structure
        const formData = parsed.formData || {};
        
        // Validate surfLevel structure (legacy support)
        if (formData.surfLevel && typeof formData.surfLevel === 'object') {
          // Validate that surfLevel has the expected structure
          if (typeof formData.surfLevel.id !== 'number' || typeof formData.surfLevel.description !== 'string') {
            console.log('Invalid surfLevel structure, resetting to default');
            formData.surfLevel = -1;
          } else {
            // Convert object to number ID
            formData.surfLevel = formData.surfLevel.id;
          }
        }
        
        // Ensure boardType is a number
        if (formData.boardType === undefined) {
          formData.boardType = -1;
        }
        
        // Ensure travelExperience is a number
        if (formData.travelExperience === undefined) {
          formData.travelExperience = 0;
        }
        
        console.log('Setting form data:', formData);
        setFormData(formData);
      }
    } catch (error) {
      console.log('Error loading onboarding data:', error);
    } finally {
      setIsLoaded(true);
    }
  };

  // Save to local storage only (for step tracking and recovery)
  // Supabase saving is handled explicitly when user presses "Next" button
  const saveToLocalStorage = async () => {
    try {
      const dataToSave = {
        currentStep,
        formData,
        user,
        isComplete,
        timestamp: Date.now(),
      };
      console.log('Saving data to local storage:', dataToSave);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
    } catch (error) {
      console.log('Error saving onboarding data to local storage:', error);
    }
  };

  // Method to save current step data to Supabase (called explicitly on "Next" button)
  const saveStepToSupabase = async (stepData: Partial<OnboardingData>) => {
    try {
      // Merge step data with existing formData
      const dataToSave = { ...formData, ...stepData };
      
      // Use onboarding service to save data
      await onboardingService.saveOnboardingData({
        nickname: dataToSave.nickname,
        userEmail: dataToSave.userEmail,
        location: dataToSave.location,
        age: dataToSave.age,
        profilePicture: dataToSave.profilePicture,
        pronouns: dataToSave.pronouns,
        boardType: dataToSave.boardType,
        surfLevel: dataToSave.surfLevel,
        travelExperience: dataToSave.travelExperience,
        isDemoUser: isDemoUser, // Pass demo user flag
      });
      console.log('Step data saved to Supabase successfully');
    } catch (supabaseError) {
      console.warn('Failed to save step data to Supabase:', supabaseError);
      // Don't throw - allow user to continue even if Supabase save fails
    }
  };

  const updateFormData = (newData: Partial<OnboardingData>) => {
    console.log('Updating form data with:', newData);
    setFormData(prev => {
      const updated = { ...prev, ...newData };
      return updated;
    });
  };

  const markOnboardingComplete = async () => {
    console.log('Marking onboarding as complete');
    setIsComplete(true);
    
    // Also save to database
    if (isSupabaseConfigured()) {
      try {
        await supabaseDatabaseService.markOnboardingComplete();
      } catch (error) {
        console.error('Error marking onboarding as complete in database:', error);
        // Don't throw - local state is already updated
      }
    }
  };

  /**
   * Check if the current user has finished onboarding in the database
   * Returns true if finished, false otherwise
   * Uses lightweight query for better performance and reliability
   */
  const checkOnboardingStatus = async (): Promise<boolean> => {
    if (!isSupabaseConfigured()) {
      return false;
    }

    try {
      // First try the lightweight method (only checks finished_onboarding)
      // This avoids querying columns that might not exist
      const finished = await supabaseDatabaseService.checkFinishedOnboarding();
      if (finished) {
        console.log('User has finished onboarding (from lightweight check)');
        setIsComplete(true);
        return true;
      }

      // Fallback: Try full data fetch if lightweight method fails
      // This handles edge cases where the lightweight query might fail
      try {
        const { surfer } = await supabaseDatabaseService.getCurrentUserData();
        if (surfer?.finished_onboarding) {
          console.log('User has finished onboarding (from full data check)');
          setIsComplete(true);
          return true;
        }
      } catch (fallbackError) {
        // If full data fetch also fails, just return false
        console.log('Fallback check also failed:', fallbackError);
      }

      return false;
    } catch (error) {
      console.log('Error checking onboarding status:', error);
      return false;
    }
  };

  const value: OnboardingContextType = {
    currentStep,
    formData,
    user,
    setCurrentStep,
    updateFormData,
    setUser,
    resetOnboarding,
    isComplete,
    saveStepToSupabase,
    markOnboardingComplete,
    checkOnboardingStatus,
    isDemoUser,
    setIsDemoUser,
    isRestoringSession,
  };

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
};

export const useOnboarding = () => {
  const context = useContext(OnboardingContext);
  if (context === undefined) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return context;
}; 