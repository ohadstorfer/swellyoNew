import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { OnboardingData } from '../screens/OnboardingStep1Screen';
import { User, databaseService } from '../utils/databaseService';
import { supabaseDatabaseService } from '../utils/supabaseDatabaseService';
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

  // Load saved data on mount
  useEffect(() => {
    loadOnboardingData();
    initializeDatabase();
  }, []);

  // Save data whenever it changes
  useEffect(() => {
    if (isLoaded) {
      saveOnboardingData();
    }
  }, [currentStep, formData, isLoaded]);

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

  const saveOnboardingData = async () => {
    try {
      // Save to local storage for step tracking
      const dataToSave = {
        currentStep,
        formData,
        user,
        timestamp: Date.now(),
      };
      console.log('Saving data to local storage:', dataToSave);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));

      // If Supabase is configured and we have complete data, save to Supabase
      if (isSupabaseConfigured() && formData && Object.keys(formData).length > 0) {
        try {
          await supabaseDatabaseService.saveOnboardingData({
            nickname: formData.nickname,
            userEmail: formData.userEmail,
            location: formData.location,
            age: formData.age,
            profilePicture: formData.profilePicture,
            pronouns: formData.pronouns,
            boardType: formData.boardType,
            surfLevel: formData.surfLevel,
            travelExperience: formData.travelExperience,
          });
          console.log('Onboarding data saved to Supabase successfully');
        } catch (supabaseError) {
          console.warn('Failed to save to Supabase (will use local storage):', supabaseError);
          // Continue with local storage if Supabase fails
        }
      }
    } catch (error) {
      console.log('Error saving onboarding data:', error);
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
    setCurrentStep(1);
    setFormData({});
    setUser(null);
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.log('Error resetting onboarding data:', error);
    }
  };

  const isComplete = currentStep > 4;

  const value: OnboardingContextType = {
    currentStep,
    formData,
    user,
    setCurrentStep,
    updateFormData,
    setUser,
    resetOnboarding,
    isComplete,
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