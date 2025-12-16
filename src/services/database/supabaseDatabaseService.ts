import { supabase, isSupabaseConfigured } from '../../config/supabase';
import { Platform } from 'react-native';

/**
 * Supabase Database Service
 * Handles saving and retrieving user data from Supabase tables:
 * - users: Basic user information
 * - surfers: Surfer experience and preferences
 */

// User table interface (basic user information)
// Matches: public.users table
export interface SupabaseUser {
  id: string; // UUID, primary key
  email: string; // varchar(255), unique, not null
  role?: string; // user_role enum, default 'traveler'
  user_type?: string; // user_type column (type depends on your schema)
  created_at: string; // timestamptz
  updated_at: string; // timestamptz
}

// Surfer table interface (surfer experience and preferences)
// Matches: public.surfers table
export interface SupabaseSurfer {
  user_id: string; // UUID, primary key, foreign key to users.id
  name: string; // varchar(255), not null
  age?: number; // integer, nullable, check >= 0
  pronoun?: string; // varchar(50), nullable
  country_from?: string; // varchar(255), nullable
  surfboard_type?: string; // surfboard_type enum, nullable
  surf_level?: number; // integer, nullable, check 1-5
  travel_experience?: string; // travel_experience enum, nullable
  bio?: string; // text, nullable
  profile_image_url?: string; // varchar(2048), nullable
  // Swelly conversation results
  onboarding_summary_text?: string; // text, nullable
  destinations_array?: Array<{ destination_name: string; time_in_days: number }>; // jsonb, nullable
  travel_type?: 'budget' | 'mid' | 'high'; // text, nullable
  travel_buddies?: 'solo' | '2' | 'crew'; // text, nullable
  lifestyle_keywords?: string[]; // text[], nullable
  wave_type_keywords?: string[]; // text[], nullable
  is_demo_user?: boolean; // boolean, default false
  finished_onboarding?: boolean; // boolean, default false
  created_at: string; // timestamptz
  updated_at: string; // timestamptz
}

// Legacy User interface for backward compatibility
export interface User {
  id: number;
  email: string;
  nickname: string;
  googleId: string;
  createdAt: string;
  updatedAt: string;
}

class SupabaseDatabaseService {
  /**
   * Save or update user in the users table
   * Note: users table stores id, email, role, and user_type
   */
  async saveUser(userData: {
    email: string;
    nickname?: string;
    profilePicture?: string;
    pronouns?: string;
    age?: number;
    location?: string;
    googleId?: string;
    userType?: string; // New user_type column
  }): Promise<User> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured. Please set up your Supabase credentials.');
    }

    try {
      // Get the current authenticated user
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      
      if (authError || !authUser) {
        throw new Error('User not authenticated. Please sign in first.');
      }

      // Check if user already exists in users table
      const { data: existingUser, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();

      const userDataToSave: Partial<SupabaseUser> = {
        id: authUser.id,
        email: userData.email || authUser.email || '',
        user_type: userData.userType,
        // Note: users table has id, email, role, user_type - other data goes to surfers table
      };

      let savedUser: SupabaseUser;

      if (existingUser) {
        // Update existing user (email and user_type can be updated in users table)
        const updateData: Partial<SupabaseUser> = { email: userDataToSave.email };
        if (userDataToSave.user_type !== undefined) {
          updateData.user_type = userDataToSave.user_type;
        }
        const { data, error } = await supabase
          .from('users')
          .update(updateData)
          .eq('id', authUser.id)
          .select()
          .single();

        if (error) {
          throw error;
        }

        savedUser = data;
      } else {
        // Create new user
        const insertData: any = {
          id: authUser.id,
          email: userDataToSave.email,
          role: 'traveler', // Default role
        };
        if (userDataToSave.user_type !== undefined) {
          insertData.user_type = userDataToSave.user_type;
        }
        const { data, error } = await supabase
          .from('users')
          .insert(insertData)
          .select()
          .single();

        if (error) {
          throw error;
        }

        savedUser = data;
      }

      // Convert to legacy User format for backward compatibility
      return this.convertToLegacyUser(savedUser, userData.googleId || authUser.id, userData.nickname || '');
    } catch (error: any) {
      console.error('Error saving user to Supabase:', error);
      throw new Error(`Failed to save user: ${error.message || String(error)}`);
    }
  }

  /**
   * Save or update surfer data in the surfers table
   * Matches: public.surfers table schema
   */
  async saveSurfer(surferData: {
    name?: string;
    age?: number;
    pronoun?: string;
    countryFrom?: string;
    surfboardType?: string; // surfboard_type enum
    surfLevel?: number; // 1-5
    travelExperience?: string; // travel_experience enum
    bio?: string;
    profileImageUrl?: string;
    boardType?: number; // Legacy support - will be converted to surfboardType enum
    // Swelly conversation results
    onboardingSummaryText?: string;
    destinationsArray?: Array<{ destination_name: string; time_in_days: number }>;
    travelType?: 'budget' | 'mid' | 'high';
    travelBuddies?: 'solo' | '2' | 'crew';
    lifestyleKeywords?: string[];
    waveTypeKeywords?: string[];
  }): Promise<SupabaseSurfer> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured. Please set up your Supabase credentials.');
    }

    try {
      // Get the current authenticated user
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      
      if (authError || !authUser) {
        throw new Error('User not authenticated. Please sign in first.');
      }

      // Check if surfer data already exists
      // Use .maybeSingle() instead of .single() to avoid errors if no record exists
      const { data: existingSurfer, error: fetchError } = await supabase
        .from('surfers')
        .select('*')
        .eq('user_id', authUser.id)
        .maybeSingle();
      
      // Log fetch error but don't throw - it's okay if the record doesn't exist yet
      if (fetchError && fetchError.code !== 'PGRST116') {
        console.warn('Error checking for existing surfer (non-critical):', fetchError);
      }

      // Get Google name from user metadata as fallback if name is not provided
      let googleName: string | undefined;
      if (!surferData.name && !existingSurfer?.name) {
        const { data: { user: authUserWithMetadata } } = await supabase.auth.getUser();
        if (authUserWithMetadata) {
          googleName = authUserWithMetadata.user_metadata?.full_name || 
                      authUserWithMetadata.user_metadata?.name || 
                      authUserWithMetadata.email?.split('@')[0];
        }
      }

      // Convert boardType number to enum if needed
      // NOTE: You may need to adjust these enum values to match your Supabase enum definition
      let surfboardType: string | undefined = surferData.surfboardType;
      if (!surfboardType && surferData.boardType !== undefined) {
        // Map boardType number to enum string
        // App board types: 0=Short Board, 1=Mid Length, 2=Long Board, 3=Soft Top
        // Adjust these mappings to match your actual Supabase surfboard_type enum values
        const boardTypeMap: { [key: number]: string } = {
          0: 'shortboard',      // Short Board
          1: 'mid_length',     // Mid Length
          2: 'longboard',       // Long Board
          3: 'soft_top',        // Soft Top
        };
        surfboardType = boardTypeMap[surferData.boardType];
      }

      // Ensure surf_level is within valid range (1-5)
      // App uses 0-4 (5 levels), database expects 1-5
      let surfLevel = surferData.surfLevel;
      if (surfLevel !== undefined) {
        // Convert from 0-based (0-4) to 1-based (1-5)
        surfLevel = surfLevel + 1;
        // Clamp to valid range (shouldn't be needed, but safety check)
        surfLevel = Math.max(1, Math.min(5, surfLevel));
      }

      // Truncate profile_image_url if it's too long (max 2048 characters)
      let profileImageUrl = surferData.profileImageUrl;
      if (profileImageUrl && profileImageUrl.length > 2048) {
        console.warn(`Profile image URL is too long (${profileImageUrl.length} chars), truncating to 2048 characters`);
        profileImageUrl = profileImageUrl.substring(0, 2048);
      }

      const surferDataToSave: Partial<SupabaseSurfer> = {
        user_id: authUser.id,
        name: surferData.name || existingSurfer?.name || googleName || 'User', // Required field - prefer provided name, then existing, then Google name, then 'User'
        age: surferData.age,
        pronoun: surferData.pronoun,
        country_from: surferData.countryFrom,
        surfboard_type: surfboardType,
        surf_level: surfLevel,
        travel_experience: surferData.travelExperience,
        bio: surferData.bio,
        profile_image_url: profileImageUrl,
        // Swelly conversation results
        onboarding_summary_text: surferData.onboardingSummaryText,
        finished_onboarding: surferData.finishedOnboarding,
        destinations_array: surferData.destinationsArray,
        travel_type: surferData.travelType,
        travel_buddies: surferData.travelBuddies,
        lifestyle_keywords: surferData.lifestyleKeywords,
        wave_type_keywords: surferData.waveTypeKeywords,
      };

      let savedSurfer: SupabaseSurfer;

      if (existingSurfer) {
        // Update existing surfer
        const { data, error } = await supabase
          .from('surfers')
          .update(surferDataToSave)
          .eq('user_id', authUser.id)
          .select()
          .single();

        if (error) {
          console.error('Error updating surfer:', error);
          throw error;
        }

        if (!data) {
          throw new Error('Update succeeded but no data returned');
        }

        savedSurfer = data;
      } else {
        // Create new surfer
        const insertData = {
          ...surferDataToSave,
          name: surferDataToSave.name || googleName || 'User', // Ensure name is provided - prefer Google name over 'User'
        };
        
        const { data, error } = await supabase
          .from('surfers')
          .insert(insertData)
          .select()
          .single();

        if (error) {
          console.error('Error inserting surfer:', error);
          console.error('Insert data:', JSON.stringify(insertData, null, 2));
          throw error;
        }

        if (!data) {
          throw new Error('Insert succeeded but no data returned');
        }

        savedSurfer = data;
      }

      console.log('Surfer data saved to Supabase:', savedSurfer);
      return savedSurfer;
    } catch (error: any) {
      console.error('Error saving surfer to Supabase:', error);
      throw new Error(`Failed to save surfer data: ${error.message || String(error)}`);
    }
  }

  /**
   * Save complete onboarding data (both user and surfer)
   * Maps onboarding data to the actual database schema
   */
  async saveOnboardingData(onboardingData: {
    nickname?: string;
    userEmail?: string;
    location?: string;
    age?: number;
    profilePicture?: string;
    pronouns?: string;
    boardType?: number;
    surfLevel?: number;
    travelExperience?: number;
  }): Promise<{ user: User; surfer: SupabaseSurfer }> {
    try {
      // Save user data (only email goes to users table)
      const user = await this.saveUser({
        email: onboardingData.userEmail || '',
        nickname: onboardingData.nickname, // Will be used for surfer.name
        profilePicture: onboardingData.profilePicture, // Will be used for surfer.profile_image_url
        pronouns: onboardingData.pronouns, // Will be used for surfer.pronoun
        age: onboardingData.age, // Will be used for surfer.age
        location: onboardingData.location, // Will be used for surfer.country_from
      });

      // Convert travelExperience (number of trips) to enum string
      // Map number of trips to category:
      // 0-3 trips: new_nomad
      // 4-9 trips: rising_voyager
      // 10-19 trips: wave_hunter
      // 20+ trips: chicken_joe
      let travelExperienceEnum: string | undefined;
      if (onboardingData.travelExperience !== undefined) {
        const trips = onboardingData.travelExperience;
        if (trips <= 3) {
          travelExperienceEnum = 'new_nomad';
        } else if (trips <= 9) {
          travelExperienceEnum = 'rising_voyager';
        } else if (trips <= 19) {
          travelExperienceEnum = 'wave_hunter';
        } else {
          travelExperienceEnum = 'chicken_joe'; // 20+
        }
      }

      // Save surfer data (all profile and preference data goes here)
      const surfer = await this.saveSurfer({
        name: onboardingData.nickname || 'User',
        age: onboardingData.age,
        pronoun: onboardingData.pronouns,
        countryFrom: onboardingData.location,
        boardType: onboardingData.boardType, // Will be converted to surfboard_type enum
        surfLevel: onboardingData.surfLevel, // Will be validated to 1-5 range
        travelExperience: travelExperienceEnum,
        profileImageUrl: onboardingData.profilePicture,
      });

      return { user, surfer };
    } catch (error: any) {
      console.error('Error saving onboarding data:', error);
      throw error;
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<SupabaseUser | null> {
    if (!isSupabaseConfigured()) {
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned
          return null;
        }
        throw error;
      }

      return data;
    } catch (error: any) {
      console.error('Error getting user from Supabase:', error);
      return null;
    }
  }

  /**
   * Get surfer data by user ID
   */
  async getSurferByUserId(userId: string): Promise<SupabaseSurfer | null> {
    if (!isSupabaseConfigured()) {
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('surfers')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned
          return null;
        }
        throw error;
      }

      return data;
    } catch (error: any) {
      console.error('Error getting surfer from Supabase:', error);
      return null;
    }
  }

  /**
   * Get current user's data (both user and surfer)
   */
  async getCurrentUserData(): Promise<{ user: SupabaseUser | null; surfer: SupabaseSurfer | null }> {
    if (!isSupabaseConfigured()) {
      return { user: null, surfer: null };
    }

    try {
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      
      if (authError || !authUser) {
        return { user: null, surfer: null };
      }

      const [user, surfer] = await Promise.all([
        this.getUserById(authUser.id),
        this.getSurferByUserId(authUser.id),
      ]);

      return { user, surfer };
    } catch (error: any) {
      console.error('Error getting current user data:', error);
      return { user: null, surfer: null };
    }
  }

  /**
   * Mark onboarding as complete for the current user
   */
  async markOnboardingComplete(): Promise<void> {
    if (!isSupabaseConfigured()) {
      console.log('Supabase not configured, skipping markOnboardingComplete');
      return;
    }

    try {
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      
      if (authError || !authUser) {
        throw new Error('User not authenticated. Please sign in first.');
      }

      const { error } = await supabase
        .from('surfers')
        .update({ finished_onboarding: true })
        .eq('user_id', authUser.id);

      if (error) {
        throw error;
      }

      console.log('Marked onboarding as complete in database');
    } catch (error: any) {
      console.error('Error marking onboarding as complete:', error);
      throw new Error(`Failed to mark onboarding as complete: ${error.message || String(error)}`);
    }
  }

  /**
   * Convert Supabase user to legacy User format for backward compatibility
   */
  private convertToLegacyUser(supabaseUser: SupabaseUser, googleId: string, nickname: string = ''): User {
    // Convert UUID to number (hash the UUID)
    const idNumber = parseInt(supabaseUser.id.replace(/-/g, '').substring(0, 15), 16) || Date.now();
    
    return {
      id: idNumber,
      email: supabaseUser.email,
      nickname: nickname || '',
      googleId: googleId,
      createdAt: supabaseUser.created_at,
      updatedAt: supabaseUser.updated_at,
    };
  }

  /**
   * Get user by email (for backward compatibility)
   */
  async getUserByEmail(email: string): Promise<User | null> {
    if (!isSupabaseConfigured()) {
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }

      // Get Google ID from auth metadata if available
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const googleId = authUser?.app_metadata?.provider_id || authUser?.id || '';

      return this.convertToLegacyUser(data, googleId);
    } catch (error: any) {
      console.error('Error getting user by email from Supabase:', error);
      return null;
    }
  }

  /**
   * Get user by Google ID (for backward compatibility)
   */
  async getUserByGoogleId(googleId: string): Promise<User | null> {
    // Google ID is stored in auth metadata, so we need to find by email or user ID
    // This is a simplified version - you may need to adjust based on your auth setup
    if (!isSupabaseConfigured()) {
      return null;
    }

    try {
      // Try to get current user first
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const user = await this.getUserById(authUser.id);
        if (user) {
          return this.convertToLegacyUser(user, googleId);
        }
      }
      return null;
    } catch (error: any) {
      console.error('Error getting user by Google ID from Supabase:', error);
      return null;
    }
  }

  /**
   * Save a surf trip plan to the surf_trip_plans table
   */
  async saveSurfTripPlan(tripPlanData: {
    destinations?: string[];
    timeInDays?: number;
    travelType?: 'budget' | 'mid' | 'high';
    travelBuddies?: 'solo' | '2' | 'crew';
    lifestyleKeywords?: string[];
    waveTypeKeywords?: string[];
    summaryText?: string;
  }): Promise<any> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured. Please set up your Supabase credentials.');
    }

    try {
      // Get the current authenticated user
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      
      if (authError || !authUser) {
        throw new Error('User not authenticated. Please sign in first.');
      }

      const tripPlanToSave: any = {
        created_by: authUser.id,
        destinations: tripPlanData.destinations || null,
        time_in_days: tripPlanData.timeInDays || null,
        travel_type: tripPlanData.travelType || null,
        travel_buddies: tripPlanData.travelBuddies || null,
        lifestyle_keywords: tripPlanData.lifestyleKeywords || null,
        wave_type_keywords: tripPlanData.waveTypeKeywords || null,
        summary_text: tripPlanData.summaryText || null,
      };

      const { data, error } = await supabase
        .from('surf_trip_plans')
        .insert(tripPlanToSave)
        .select()
        .single();

      if (error) {
        throw error;
      }

      if (!data) {
        throw new Error('Insert succeeded but no data returned');
      }

      console.log('Surf trip plan saved to Supabase:', data);
      return data;
    } catch (error: any) {
      console.error('Error saving surf trip plan to Supabase:', error);
      throw new Error(`Failed to save surf trip plan: ${error.message || String(error)}`);
    }
  }
}

export const supabaseDatabaseService = new SupabaseDatabaseService();

