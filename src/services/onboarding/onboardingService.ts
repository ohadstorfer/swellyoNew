import { supabaseDatabaseService } from '../database/supabaseDatabaseService';
import { isSupabaseConfigured } from '../../config/supabase';

/**
 * Onboarding Service
 * 
 * Handles all Supabase operations and functions related to onboarding steps 1-4:
 * - Step 1: Board type selection
 * - Step 2: Surf level selection
 * - Step 3: Travel experience (number of surf trips)
 * - Step 4: Profile details (name, email, location, age, profile picture, pronouns)
 */

export interface OnboardingStepData {
  nickname?: string;
  userEmail?: string;
  location?: string;
  age?: number;
  dateOfBirth?: string; // ISO YYYY-MM-DD; preferred over `age` (DB trigger derives age from this)
  profilePicture?: string;
  pronouns?: string;
  boardType?: number;
  surfLevel?: number;
  travelExperience?: number;
  isDemoUser?: boolean; // Whether this is a demo user
  // Home break (Google Places) — pass all together when set.
  homeBreakPlaceId?: string;
  homeBreakFull?: string;
  homeBreakShort?: string;
  homeBreakLocality?: string;
  homeBreakCountry?: string;
  homeBreakLat?: number;
  homeBreakLng?: number;
}

class OnboardingService {
  /**
   * Save Step 1 data (Board Type)
   * @param boardType - Board type ID (0: Shortboard, 1: Midlength, 2: Longboard, 3: Soft Top)
   */
  async saveStep1(boardType: number): Promise<void> {
    if (!isSupabaseConfigured()) {
      console.log('Supabase not configured, skipping Step 1 save');
      return;
    }

    try {
      await supabaseDatabaseService.saveOnboardingData({
        boardType,
      });
      console.log('Step 1 (board type) saved to Supabase successfully');
    } catch (error: any) {
      console.error('Error saving Step 1 to Supabase:', error);
      throw new Error(`Failed to save Step 1: ${error.message || String(error)}`);
    }
  }

  /**
   * Save Step 2 data (Surf Level)
   * @param boardType - Board type ID
   * @param surfLevel - Surf level (0-4, will be converted to 1-5 in database)
   * @param dateOfBirth - Optional ISO date string. Promoted from device-local
   *   AsyncStorage (welcome-screen age gate) into the surfers row at this step
   *   so the value lives in the DB before step 4. Trigger derives age from it.
   */
  async saveStep2(boardType: number, surfLevel: number, dateOfBirth?: string): Promise<void> {
    if (!isSupabaseConfigured()) {
      console.log('Supabase not configured, skipping Step 2 save');
      return;
    }

    try {
      await supabaseDatabaseService.saveOnboardingData({
        boardType,
        surfLevel,
        dateOfBirth,
      });
      console.log('Step 2 (surf level) saved to Supabase successfully');
    } catch (error: any) {
      console.error('Error saving Step 2 to Supabase:', error);
      throw new Error(`Failed to save Step 2: ${error.message || String(error)}`);
    }
  }

  /**
   * Save Step 3 data (Travel Experience)
   * @param boardType - Board type ID
   * @param surfLevel - Surf level (0-4)
   * @param travelExperience - Number of surf trips (0-20+)
   */
  async saveStep3(boardType: number, surfLevel: number, travelExperience: number): Promise<void> {
    if (!isSupabaseConfigured()) {
      console.log('Supabase not configured, skipping Step 3 save');
      return;
    }

    try {
      await supabaseDatabaseService.saveOnboardingData({
        boardType,
        surfLevel,
        travelExperience,
      });
      console.log('Step 3 (travel experience) saved to Supabase successfully');
    } catch (error: any) {
      console.error('Error saving Step 3 to Supabase:', error);
      throw new Error(`Failed to save Step 3: ${error.message || String(error)}`);
    }
  }

  /**
   * Save Step 4 data (Complete Profile Details)
   * This saves all profile information including:
   * - Personal info: nickname, email, location, age, pronouns
   * - Profile picture
   * - Board preferences: boardType, surfLevel
   * - Travel experience
   * 
   * @param data - Complete onboarding data from step 4
   */
  async saveStep4(data: OnboardingStepData): Promise<void> {
    if (!isSupabaseConfigured()) {
      console.log('Supabase not configured, skipping Step 4 save');
      return;
    }

    try {
      await supabaseDatabaseService.saveOnboardingData({
        nickname: data.nickname,
        userEmail: data.userEmail,
        location: data.location,
        age: data.age,
        dateOfBirth: data.dateOfBirth,
        profilePicture: data.profilePicture,
        pronouns: data.pronouns,
        boardType: data.boardType,
        surfLevel: data.surfLevel,
        travelExperience: data.travelExperience,
        isDemoUser: data.isDemoUser ?? false, // Pass demo user flag
        homeBreakPlaceId: data.homeBreakPlaceId,
        homeBreakFull: data.homeBreakFull,
        homeBreakShort: data.homeBreakShort,
        homeBreakLocality: data.homeBreakLocality,
        homeBreakCountry: data.homeBreakCountry,
        homeBreakLat: data.homeBreakLat,
        homeBreakLng: data.homeBreakLng,
      });
      console.log('Step 4 (complete profile) saved to Supabase successfully');
    } catch (error: any) {
      console.error('Error saving Step 4 to Supabase:', error);
      throw new Error(`Failed to save Step 4: ${error.message || String(error)}`);
    }
  }

  /**
   * Save partial onboarding data (used for incremental saves)
   * This is useful when you want to save data from multiple steps at once
   * 
   * @param data - Partial onboarding data
   */
  async saveOnboardingData(data: Partial<OnboardingStepData>): Promise<void> {
    if (!isSupabaseConfigured()) {
      console.log('Supabase not configured, skipping save');
      return;
    }

    try {
      await supabaseDatabaseService.saveOnboardingData({
        nickname: data.nickname,
        userEmail: data.userEmail,
        location: data.location,
        age: data.age,
        dateOfBirth: data.dateOfBirth,
        profilePicture: data.profilePicture,
        pronouns: data.pronouns,
        boardType: data.boardType,
        surfLevel: data.surfLevel,
        travelExperience: data.travelExperience,
        isDemoUser: data.isDemoUser ?? false, // Pass demo user flag
      });
      console.log('Onboarding data saved to Supabase successfully');
    } catch (error: any) {
      console.error('Error saving onboarding data to Supabase:', error);
      throw new Error(`Failed to save onboarding data: ${error.message || String(error)}`);
    }
  }
}

export const onboardingService = new OnboardingService();

