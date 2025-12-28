import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { OnboardingData } from '../screens/OnboardingStep1Screen';
import { User, databaseService } from '../services/database/databaseService';
import { onboardingService } from '../services/onboarding/onboardingService';
import { supabaseDatabaseService } from '../services/database/supabaseDatabaseService';
import { isSupabaseConfigured } from '../config/supabase';
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
    return 0; // Default to welcome screen
  };

  const [currentStep, setCurrentStep] = useState(getInitialStep());
  const [formData, setFormData] = useState<Partial<OnboardingData>>({});
  const [user, setUser] = useState<User | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [isDemoUser, setIsDemoUser] = useState(false);

  // Load saved data on mount
  useEffect(() => {
    loadOnboardingData();
    initializeDatabase();
  }, []);

  // Save to local storage whenever step, formData, or isComplete changes (for step tracking and recovery)
  // Note: Supabase saving happens only when user presses "Next" button
  useEffect(() => {
    if (isLoaded) {
      saveToLocalStorage();
    }
  }, [currentStep, formData, isLoaded, isComplete]);

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
        
        if (!isOnSwellyChatRoute) {
          setCurrentStep(parsed.currentStep || 0);
        }
        
        // Load user data if available
        if (parsed.user) {
          setUser(parsed.user);
        }
        
        // Load onboarding completion status - prioritize database value over local storage
        if (dbOnboardingComplete) {
          setIsComplete(true);
        } else if (parsed.isComplete !== undefined) {
          setIsComplete(parsed.isComplete);
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
      console.log('Updated form data:', updated);
      return updated;
    });
  };


  const resetOnboarding = async () => {
    setCurrentStep(0); // Go back to welcome screen
    setFormData({});
    setUser(null);
    setIsComplete(false);
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.log('Error resetting onboarding data:', error);
    }
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