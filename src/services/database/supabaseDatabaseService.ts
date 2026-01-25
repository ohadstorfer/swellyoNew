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
  surf_level_description?: string; // text, nullable - board-specific description (e.g., "Snapping", "Cross Stepping")
  surf_level_category?: string; // text, nullable - general category: 'beginner', 'intermediate', 'advanced', 'pro'
  travel_experience?: number; // number of trips (0-20+), nullable
  bio?: string; // text, nullable
  profile_image_url?: string; // varchar(2048), nullable
  profile_video_url?: string; // varchar(2048), nullable - URL to user-uploaded custom surf level video
  // Swelly conversation results
  onboarding_summary_text?: string; // text, nullable
  destinations_array?: Array<{ country: string; area: string[]; time_in_days: number; time_in_text?: string }>; // jsonb, nullable
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
    email?: string; // Optional: if not provided, will use auth user's email
    nickname?: string;
    profilePicture?: string;
    pronouns?: string;
    age?: number;
    location?: string;
    googleId?: string;
    userType?: string; // New user_type column
    userId?: string; // Optional: for demo user creation, bypasses auth check
  }): Promise<User> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured. Please set up your Supabase credentials.');
    }

    try {
      // Get the current authenticated user, or use provided userId for demo users
      let authUser;
      if (userData.userId) {
        // For demo users, we have the userId from signUp but might not be authenticated yet
        // Try to get the current session first
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id === userData.userId) {
          // User is authenticated, use session user
          authUser = session.user;
        } else {
          // User not authenticated yet, but we have userId from signUp
          // Create a minimal user object for database operations
          // Note: This will only work if RLS allows inserts for unauthenticated users
          // or if we're using a service role (which we're not on client)
          // For now, we'll try to use the userId directly and let RLS handle it
          authUser = { id: userData.userId, email: userData.email } as any;
        }
      } else {
        // Normal flow: get authenticated user
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
          throw new Error('User not authenticated. Please sign in first.');
        }
        authUser = user;
      }
      
      if (!authUser || !authUser.id) {
        throw new Error('User not authenticated. Please sign in first.');
      }

      // Check if user already exists in users table
      const { data: existingUser, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();

      // Determine the email to use: prefer provided email, fallback to auth user email, then existing user email
      const emailToUse = userData.email || authUser.email || existingUser?.email || '';
      
      const userDataToSave: Partial<SupabaseUser> = {
        id: authUser.id,
        email: emailToUse,
        user_type: userData.userType,
        // Note: users table has id, email, role, user_type - other data goes to surfers table
      };

      let savedUser: SupabaseUser;

      if (existingUser) {
        // Update existing user (only update email if it's different and not empty)
        // Only update user_type if it's provided and different
        const updateData: Partial<SupabaseUser> = {};
        
        // Only update email if:
        // 1. A new email was provided AND
        // 2. It's different from the existing email AND
        // 3. It's not empty
        if (userData.email && userData.email !== existingUser.email && userData.email.trim() !== '') {
          updateData.email = userDataToSave.email;
        }
        
        // Only update user_type if it's provided and different
        if (userDataToSave.user_type !== undefined && userDataToSave.user_type !== existingUser.user_type) {
          updateData.user_type = userDataToSave.user_type;
        }
        
        // Only perform update if there are actual changes
        if (Object.keys(updateData).length > 0) {
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
          // No changes needed, return existing user
          savedUser = existingUser;
        }
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
    travelExperience?: number; // number of trips (0-20+)
    bio?: string;
    profileImageUrl?: string;
    profileVideoUrl?: string; // URL to user-uploaded custom surf level video
    boardType?: number; // Legacy support - will be converted to surfboardType enum
    // Swelly conversation results
    onboardingSummaryText?: string;
    finishedOnboarding?: boolean; // Whether user has completed onboarding
    destinationsArray?: Array<{ country: string; area: string[]; time_in_days: number; time_in_text?: string }>;
    travelType?: 'budget' | 'mid' | 'high';
    travelBuddies?: 'solo' | '2' | 'crew';
    lifestyleKeywords?: string[];
    waveTypeKeywords?: string[];
    isDemoUser?: boolean; // Whether this is a demo user
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

      // Calculate surf_level_description and surf_level_category from board type and numeric level
      let surfLevelDescription: string | undefined = surferData.surfLevelDescription;
      let surfLevelCategory: string | undefined = surferData.surfLevelCategory;
      
      // If not explicitly provided, calculate from board type and numeric level
      // Use surferData.surfLevel (0-4) for mapping, not the converted surfLevel (1-5)
      if (surferData.surfLevel !== undefined && (surfLevelDescription === undefined || surfLevelCategory === undefined)) {
        const boardTypeForMapping = surferData.boardType !== undefined 
          ? surferData.boardType 
          : (surfboardType ? (surfboardType === 'shortboard' ? 0 : 
                              surfboardType === 'mid_length' ? 1 :
                              surfboardType === 'longboard' ? 2 : 3) : undefined);
        
        if (boardTypeForMapping !== undefined) {
          try {
            const { getSurfLevelMapping } = await import('../../utils/surfLevelMapping');
            const mapping = getSurfLevelMapping(boardTypeForMapping, surferData.surfLevel);
            if (mapping) {
              surfLevelDescription = mapping.description || undefined;
              surfLevelCategory = mapping.category;
              console.log('✅ Calculated surf level mapping:', {
                boardType: boardTypeForMapping,
                surfLevel: surferData.surfLevel,
                description: surfLevelDescription,
                category: surfLevelCategory,
              });
            } else {
              console.warn('⚠️ No mapping found for boardType:', boardTypeForMapping, 'surfLevel:', surferData.surfLevel);
            }
          } catch (error) {
            console.error('❌ Error calculating surf level mapping:', error);
          }
        } else {
          console.warn('⚠️ Cannot calculate surf level mapping - boardTypeForMapping is undefined');
        }
      }

      // Truncate profile_image_url if it's too long (max 2048 characters)
      let profileImageUrl = surferData.profileImageUrl;
      if (profileImageUrl && profileImageUrl.length > 2048) {
        console.warn(`Profile image URL is too long (${profileImageUrl.length} chars), truncating to 2048 characters`);
        profileImageUrl = profileImageUrl.substring(0, 2048);
      }

      // Truncate profile_video_url if it's too long (max 2048 characters)
      let profileVideoUrl = surferData.profileVideoUrl;
      if (profileVideoUrl && profileVideoUrl.length > 2048) {
        console.warn(`Profile video URL is too long (${profileVideoUrl.length} chars), truncating to 2048 characters`);
        profileVideoUrl = profileVideoUrl.substring(0, 2048);
      }

      const surferDataToSave: Partial<SupabaseSurfer> = {
        user_id: authUser.id,
        name: surferData.name || existingSurfer?.name || googleName || 'User', // Required field - prefer provided name, then existing, then Google name, then 'User'
        age: surferData.age,
        pronoun: surferData.pronoun,
        country_from: surferData.countryFrom,
        surfboard_type: surfboardType,
        surf_level: surfLevel,
        surf_level_description: surfLevelDescription,
        surf_level_category: surfLevelCategory,
        travel_experience: surferData.travelExperience,
        bio: surferData.bio,
        profile_image_url: profileImageUrl,
        profile_video_url: profileVideoUrl,
        // Swelly conversation results
        onboarding_summary_text: surferData.onboardingSummaryText,
        finished_onboarding: surferData.finishedOnboarding,
        destinations_array: surferData.destinationsArray,
        travel_type: surferData.travelType,
        travel_buddies: surferData.travelBuddies,
        lifestyle_keywords: surferData.lifestyleKeywords,
        wave_type_keywords: surferData.waveTypeKeywords,
        is_demo_user: surferData.isDemoUser ?? false, // Set is_demo_user flag
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
    isDemoUser?: boolean; // Whether this is a demo user
  }): Promise<{ user: User; surfer: SupabaseSurfer }> {
    try {
      // Save user data (only email goes to users table)
      // Only pass email if it's provided and not empty
      // This prevents trying to update email to empty string during onboarding steps
      const userDataToSave: {
        email?: string;
        nickname?: string;
        profilePicture?: string;
        pronouns?: string;
        age?: number;
        location?: string;
        userType?: string;
      } = {
        nickname: onboardingData.nickname, // Will be used for surfer.name
        profilePicture: onboardingData.profilePicture, // Will be used for surfer.profile_image_url
        pronouns: onboardingData.pronouns, // Will be used for surfer.pronoun
        age: onboardingData.age, // Will be used for surfer.age
        location: onboardingData.location, // Will be used for surfer.country_from
      };
      
      // Only include email if it's provided and not empty
      if (onboardingData.userEmail && onboardingData.userEmail.trim() !== '') {
        userDataToSave.email = onboardingData.userEmail;
      }
      
      const user = await this.saveUser(userDataToSave);

      // Save surfer data (all profile and preference data goes here)
      // travelExperience is now saved as integer (number of trips, 0-20+)
      const surfer = await this.saveSurfer({
        name: onboardingData.nickname || 'User',
        age: onboardingData.age,
        pronoun: onboardingData.pronouns,
        countryFrom: onboardingData.location,
        boardType: onboardingData.boardType, // Will be converted to surfboard_type enum
        surfLevel: onboardingData.surfLevel, // Will be validated to 1-5 range
        travelExperience: onboardingData.travelExperience, // Save as integer (number of trips)
        profileImageUrl: onboardingData.profilePicture,
        isDemoUser: onboardingData.isDemoUser ?? false, // Pass is_demo_user flag
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
   * OPTIMIZED: Uses specific column selects for better performance
   * Note: Only selects columns that actually exist in the database
   */
  async getSurferByUserId(userId: string): Promise<SupabaseSurfer | null> {
    if (!isSupabaseConfigured()) {
      return null;
    }

    
    try {
      // OPTIMIZATION: Select only columns that exist in the database
      // destinations_map does NOT exist - only destinations_array exists
      const { data, error } = await supabase
        .from('surfers')
        .select('user_id, name, age, pronoun, country_from, surfboard_type, surf_level, surf_level_description, surf_level_category, travel_experience, bio, profile_image_url, profile_video_url, destinations_array, lifestyle_keywords, wave_type_keywords, travel_buddies, created_at, updated_at, finished_onboarding')
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned
          return null;
        }
        
        // If specific columns fail, try with * as fallback
        if (error.code === '42703' || error.message?.includes('does not exist')) {
          console.warn('Specific column select failed, trying with *:', error.message);
          const { data: fallbackData, error: fallbackError } = await supabase
            .from('surfers')
            .select('*')
            .eq('user_id', userId)
            .single();
          
          if (fallbackError) {
            if (fallbackError.code === 'PGRST116') {
              return null;
            }
            throw fallbackError;
          }
          
          return fallbackData;
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
   * Check if current user has finished onboarding (lightweight query)
   * This is a simpler method that only checks finished_onboarding without fetching all data
   */
  async checkFinishedOnboarding(): Promise<boolean> {
    if (!isSupabaseConfigured()) {
      return false;
    }

    try {
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      
      if (authError || !authUser) {
        return false;
      }

      const { data, error } = await supabase
        .from('surfers')
        .select('finished_onboarding')
        .eq('user_id', authUser.id)
        .maybeSingle();

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned - user hasn't completed onboarding
          return false;
        }
        console.error('Error checking finished_onboarding:', error);
        return false;
      }

      return data?.finished_onboarding === true;
    } catch (error: any) {
      console.error('Error checking finished_onboarding:', error);
      return false;
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

