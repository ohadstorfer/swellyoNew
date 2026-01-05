import { supabaseDatabaseService, SupabaseSurfer } from '../database/supabaseDatabaseService';
import { supabaseAuthService } from '../auth/supabaseAuthService';

/**
 * Swelly Shaper Service
 * Handles AI-powered profile editing conversations
 * Identifies which profile fields users want to change and updates them
 */

export interface ProfileField {
  field: string;
  value: any;
  displayName: string;
}

export interface ShaperResponse {
  message: string;
  updatedFields?: ProfileField[];
  needsConfirmation?: boolean;
  confirmationField?: string;
  confirmationValue?: any;
}

class SwellyShaperService {
  // Field mapping: keywords that identify which field user wants to edit
  private fieldKeywords: { [key: string]: string[] } = {
    name: ['name', 'nickname', 'call me', 'my name is', 'change name', 'update name'],
    age: ['age', 'years old', 'i am', "i'm", 'change age', 'update age'],
    pronoun: ['pronoun', 'pronouns', 'preferred pronoun', 'gender', 'change pronoun'],
    country_from: ['country', 'from', 'origin', 'hometown', 'where i am from', 'where i\'m from', 'change country'],
    surfboard_type: ['board', 'surfboard', 'board type', 'shortboard', 'longboard', 'midlength', 'soft top', 'change board', 'update board'],
    surf_level: ['level', 'surf level', 'skill', 'ability', 'beginner', 'intermediate', 'advanced', 'expert', 'change level', 'update level'],
    travel_experience: ['travel', 'travel experience', 'traveled', 'trip experience', 'change travel experience'],
    bio: ['bio', 'biography', 'about me', 'description', 'tell about', 'change bio', 'update bio'],
    destinations_array: ['destination', 'trip', 'places', 'where i want to go', 'travel plans', 'surftrip', 'surf trip', 'went to', 'visited', 'traveled to', 'add trip', 'add destination'],
    travel_type: ['travel type', 'budget', 'spending', 'travel budget', 'travel style', 'change budget'],
    travel_buddies: ['travel buddies', 'travel alone', 'solo', 'with friends', 'crew', 'travel partner', 'travel with', 'change travel buddies'],
    lifestyle_keywords: ['lifestyle', 'interests', 'hobbies', 'what i like', 'lifestyle keywords', 'change lifestyle'],
    wave_type_keywords: ['wave', 'waves', 'wave type', 'prefer waves', 'wave preference', 'change wave type'],
  };

  // Surfboard type mapping
  private surfboardTypeMap: { [key: string]: string } = {
    'shortboard': 'shortboard',
    'short': 'shortboard',
    'short board': 'shortboard',
    'midlength': 'midlength',
    'mid': 'midlength',
    'mid length': 'midlength',
    'longboard': 'longboard',
    'long': 'longboard',
    'long board': 'longboard',
    'soft top': 'soft_top',
    'softtop': 'soft_top',
    'foam': 'soft_top',
    'foamie': 'soft_top',
  };

  // Travel experience mapping
  private travelExperienceMap: { [key: string]: string } = {
    'beginner': 'beginner',
    'new': 'beginner',
    'first time': 'beginner',
    'intermediate': 'intermediate',
    'moderate': 'intermediate',
    'experienced': 'experienced',
    'expert': 'experienced',
    'advanced': 'experienced',
    'many trips': 'experienced',
  };

  /**
   * Get initial welcome message
   */
  async getWelcomeMessage(): Promise<string> {
    try {
      const user = await supabaseAuthService.getCurrentUser();
      const userName = user?.nickname || user?.email?.split('@')[0] || 'there';
      
      return `Hey ${userName}, how are you? 👋\n\nI'm here to help you edit and modify your profile. I can help you update your surf level, surfboard type, add or change trips, and much more!\n\nWhat would you like to change today?`;
    } catch (error) {
      console.error('Error getting welcome message:', error);
      return `Hey there, how are you? 👋\n\nI'm here to help you edit and modify your profile. I can help you update your surf level, surfboard type, add or change trips, and much more!\n\nWhat would you like to change today?`;
    }
  }

  /**
   * Process user message and identify which field to update
   */
  async processMessage(userMessage: string): Promise<ShaperResponse> {
    const lowerMessage = userMessage.toLowerCase().trim();
    
    // Get current profile to show what can be changed
    const { surfer } = await supabaseDatabaseService.getCurrentUserData();
    
    // Check for multiple field updates (e.g., "add trip to X and change board to Y")
    const updates: { field: string; value: any }[] = [];
    
    // Check for trip/destination additions
    const tripInfo = this.extractTripInfo(lowerMessage);
    if (tripInfo) {
      updates.push({ field: 'destinations_array', value: tripInfo });
    }
    
    // Identify other fields the user wants to change
    const identifiedFields = this.identifyFields(lowerMessage);
    
    // Extract values for identified fields
    for (const field of identifiedFields) {
      // Skip destinations_array as we already handled it
      if (field === 'destinations_array') continue;
      
      // Skip profile_image_url - can't update via text
      if (field === 'profile_image_url') {
        return {
          message: "I can't update your profile picture through text. Please use the profile screen to upload a new photo.",
        };
      }
      
      const extractedValue = this.extractValue(lowerMessage, field, surfer);
      if (extractedValue !== null) {
        updates.push({ field, value: extractedValue });
      }
    }
    
    // If no updates found, show help message
    if (updates.length === 0) {
      // Check if user mentioned a field but value couldn't be extracted
      const mentionedFields = this.identifyFields(lowerMessage);
      if (mentionedFields.length > 0) {
        const firstField = mentionedFields[0];
        return {
          message: this.getFieldPrompt(firstField, surfer),
          needsConfirmation: false,
        };
      }
      
        return {
          message: "I'd be happy to help you update your profile! You can change things like:\n\n• Your name, age, or pronouns\n• Your country of origin\n• Your surf level (1-5)\n• Your surfboard type (shortboard, midlength, longboard, soft top)\n• Your travel experience\n• Your bio\n• Add trips (e.g., \"add trip to El Salvador for 3 months\")\n• Travel budget and preferences\n• Lifestyle interests\n• Wave preferences\n\nWhat would you like to update?",
        };
    }

    // Process all updates
    const updatedFields: ProfileField[] = [];
    const successMessages: string[] = [];
    
    try {
      for (const update of updates) {
        await this.updateProfileField(update.field, update.value, surfer);
        
        const displayValue = this.formatFieldValueForMessage(update.field, update.value);
        updatedFields.push({
          field: update.field,
          value: update.value,
          displayName: this.getFieldDisplayName(update.field),
        });
        
        successMessages.push(this.getSuccessMessage(update.field, update.value, displayValue));
      }
      
      // Combine success messages
      const combinedMessage = successMessages.length === 1
        ? successMessages[0]
        : `Great! I've updated the following:\n\n${successMessages.map((msg, i) => `${i + 1}. ${msg.split('\n')[0]}`).join('\n')}\n\nIs there anything else you'd like to change?`;
      
      return {
        message: combinedMessage,
        updatedFields,
      };
    } catch (error: any) {
      console.error('Error updating profile:', error);
      return {
        message: `Sorry, I encountered an error updating your profile. Please try again or contact support.`,
      };
    }
  }

  /**
   * Identify which field the user wants to change
   */
  private identifyField(message: string): string | null {
    for (const [field, keywords] of Object.entries(this.fieldKeywords)) {
      for (const keyword of keywords) {
        if (message.includes(keyword)) {
          return field;
        }
      }
    }
    return null;
  }

  /**
   * Identify all fields the user wants to change (for multiple updates)
   */
  private identifyFields(message: string): string[] {
    const fields: string[] = [];
    for (const [field, keywords] of Object.entries(this.fieldKeywords)) {
      for (const keyword of keywords) {
        if (message.includes(keyword) && !fields.includes(field)) {
          fields.push(field);
        }
      }
    }
    return fields;
  }

  /**
   * Extract trip/destination information from message
   * Returns array of {destination_name, time_in_days} or null
   */
  private extractTripInfo(message: string): Array<{ destination_name: string; time_in_days: number }> | null {
    // Common words to exclude from destination names
    const excludeWords = new Set(['add', 'a', 'surf', 'trip', 'that', 'i', 'did', 'to', 'went', 'visited', 'surfed', 'traveled', 'want', 'been', 'there', 'for']);
    
    // Patterns for trip mentions (order matters - more specific first)
    // Pattern 1: "to [Destination]. i been there for [number] [unit]" - handle "been there" format
    const beenTherePattern = /to\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}?)\s*[.,]\s*(?:i\s+)?(?:been|was|were)\s+(?:there\s+)?for\s+(\d+)\s*(month|week|day)s?/i;
    let match = message.match(beenTherePattern);
    
    if (match) {
      let destination = match[1].trim();
      const duration = parseInt(match[2]);
      const unit = match[3].toLowerCase();
      
      // Filter out common words
      const words = destination.split(/\s+/);
      const filteredWords = words.filter(word => !excludeWords.has(word.toLowerCase()));
      
      if (filteredWords.length > 0) {
        destination = filteredWords.join(' ');
        
        // Convert to days
        let days = duration;
        if (unit.startsWith('month')) {
          days = duration * 30;
        } else if (unit.startsWith('week')) {
          days = duration * 7;
        }
        
        if (destination && days > 0) {
          const capitalizedDestination = destination
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
          
          return [{ destination_name: capitalizedDestination, time_in_days: days }];
        }
      }
    }
    
    // Pattern 2: "to [Destination], [number] [unit]" - most common format
    const toPattern = /to\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}?)\s*[.,]?\s*(?:i\s+)?(?:been|was|were)?\s*(?:there\s+)?(?:for\s+)?(\d+)\s*(month|week|day)s?/i;
    match = message.match(toPattern);
    
    if (match) {
      let destination = match[1].trim();
      const duration = parseInt(match[2]);
      const unit = match[3].toLowerCase();
      
      // Filter out common words
      const words = destination.split(/\s+/);
      const filteredWords = words.filter(word => !excludeWords.has(word.toLowerCase()));
      
      if (filteredWords.length > 0) {
        destination = filteredWords.join(' ');
        
        // Convert to days
        let days = duration;
        if (unit.startsWith('month')) {
          days = duration * 30;
        } else if (unit.startsWith('week')) {
          days = duration * 7;
        }
        
        if (destination && days > 0) {
          const capitalizedDestination = destination
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
          
          return [{ destination_name: capitalizedDestination, time_in_days: days }];
        }
      }
    }
    
    // Pattern 3: "to [Destination] for [number] [unit]"
    const toForPattern = /to\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}?)\s+for\s+(\d+)\s*(month|week|day)s?/i;
    match = message.match(toForPattern);
    
    if (match) {
      let destination = match[1].trim();
      const duration = parseInt(match[2]);
      const unit = match[3].toLowerCase();
      
      const words = destination.split(/\s+/);
      const filteredWords = words.filter(word => !excludeWords.has(word.toLowerCase()));
      
      if (filteredWords.length > 0) {
        destination = filteredWords.join(' ');
        
        let days = duration;
        if (unit.startsWith('month')) {
          days = duration * 30;
        } else if (unit.startsWith('week')) {
          days = duration * 7;
        }
        
        if (destination && days > 0) {
          const capitalizedDestination = destination
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
          
          return [{ destination_name: capitalizedDestination, time_in_days: days }];
        }
      }
    }
    
    // Pattern 4: "[Destination], [number] [unit]" - capitalized place name
    const directPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}?)\s*[.,]?\s*(?:i\s+)?(?:been|was|were)?\s*(?:there\s+)?(?:for\s+)?(\d+)\s*(month|week|day)s?/;
    match = message.match(directPattern);
    
    if (match) {
      const destination = match[1].trim();
      const duration = parseInt(match[2]);
      const unit = match[3].toLowerCase();
      
      // Skip if first word is in exclude list
      const firstWord = destination.split(' ')[0].toLowerCase();
      if (!excludeWords.has(firstWord) && destination.length >= 2) {
        let days = duration;
        if (unit.startsWith('month')) {
          days = duration * 30;
        } else if (unit.startsWith('week')) {
          days = duration * 7;
        }
        
        if (destination && days > 0) {
          return [{ destination_name: destination, time_in_days: days }];
        }
      }
    }
    
    return null;
  }

  /**
   * Extract value from user message
   */
  private extractValue(message: string, field: string, currentProfile: SupabaseSurfer | null): any {
    switch (field) {
      case 'name':
        // Extract name after keywords like "name is", "call me", etc.
        const nameMatch = message.match(/(?:name is|call me|i'm|i am|change name to|update name to|my name is)\s+([a-z\s]+)/i);
        if (nameMatch) {
          return nameMatch[1].trim();
        }
        // Try to extract quoted name
        const quotedName = message.match(/"([^"]+)"/);
        if (quotedName) return quotedName[1];
        // Try "name: X" format
        const colonName = message.match(/name\s*:\s*([a-z\s]+)/i);
        if (colonName) return colonName[1].trim();
        return null;

      case 'age':
        // Extract age number - various formats
        const ageMatch = message.match(/(?:age|i am|i'm)\s*(?:is|:)?\s*(\d+)\s*(?:years?|yrs?|old)?/i);
        if (ageMatch) {
          const age = parseInt(ageMatch[1]);
          if (age >= 0 && age <= 120) return age;
        }
        // Try just a number (but be careful - only if context suggests age)
        if (message.includes('age') || message.includes('old')) {
          const numberMatch = message.match(/\b(\d{1,3})\b/);
          if (numberMatch) {
            const age = parseInt(numberMatch[1]);
            if (age >= 0 && age <= 120) return age;
          }
        }
        return null;

      case 'pronoun':
        const pronounMatch = message.match(/(?:pronouns?|preferred pronoun)\s+(?:are|is)?\s*([a-z\/]+)/i);
        if (pronounMatch) return pronounMatch[1].trim();
        // Check for common pronouns
        if (message.includes('he/him') || message.includes('he him')) return 'he/him';
        if (message.includes('she/her') || message.includes('she her')) return 'she/her';
        if (message.includes('they/them') || message.includes('they them')) return 'they/them';
        return null;

      case 'country_from':
        // Extract country name - various formats
        const countryMatch = message.match(/(?:from|country|origin|hometown|i'm from|i am from)\s+(?:is|:)?\s*([a-z\s]+)/i);
        if (countryMatch) {
          let country = countryMatch[1].trim();
          // Remove trailing common words
          country = country.replace(/\s+(and|or|the|a|an)$/i, '').trim();
          return country;
        }
        // Try "country: X" format
        const colonCountry = message.match(/country\s*:\s*([a-z\s]+)/i);
        if (colonCountry) return colonCountry[1].trim();
        return null;

      case 'surfboard_type':
        // Check for explicit board type mentions
        for (const [key, value] of Object.entries(this.surfboardTypeMap)) {
          if (message.includes(key)) {
            return value;
          }
        }
        // Try "change board to X" format
        const boardChangeMatch = message.match(/(?:change|update|switch)\s+(?:board|surfboard)\s+(?:to|is|:)?\s*(shortboard|longboard|midlength|soft\s*top|short|long|mid|foam)/i);
        if (boardChangeMatch) {
          const boardType = boardChangeMatch[1].toLowerCase().replace(/\s+/, '_');
          for (const [key, value] of Object.entries(this.surfboardTypeMap)) {
            if (key.includes(boardType) || boardType.includes(key)) {
              return value;
            }
          }
        }
        return null;

      case 'surf_level':
        // Extract level number (1-5) - service expects 0-4 and converts to 1-5
        const levelMatch = message.match(/(?:level|skill|surf level)\s*(?:is|:)?\s*(\d)/i);
        if (levelMatch) {
          const level = parseInt(levelMatch[1]);
          if (level >= 1 && level <= 5) {
            // Convert to 0-based (0-4) for service, which then converts to 1-5 for database
            return level - 1;
          }
        }
        // Check for text descriptions - convert to 0-based
        if (message.includes('beginner') || message.includes('level 1') || message.includes('level one')) return 0;
        if (message.includes('novice') || message.includes('level 2') || message.includes('level two')) return 1;
        if (message.includes('intermediate') || message.includes('level 3') || message.includes('level three')) return 2;
        if (message.includes('advanced') || message.includes('level 4') || message.includes('level four')) return 3;
        if (message.includes('expert') || message.includes('level 5') || message.includes('level five')) return 4;
        return null;

      case 'travel_experience':
        for (const [key, value] of Object.entries(this.travelExperienceMap)) {
          if (message.includes(key)) {
            return value;
          }
        }
        return null;

      case 'bio':
        // Extract text after "bio is" or similar
        const bioMatch = message.match(/(?:bio|about me|description|tell about)\s+(?:is|:)?\s*(.+)/i);
        if (bioMatch) {
          let bio = bioMatch[1].trim();
          // Remove trailing question marks or common phrases
          bio = bio.replace(/\?+$/, '').trim();
          return bio;
        }
        // If message is long and doesn't match other fields, treat as bio
        if (message.length > 30 && !this.identifyFields(message).some(f => f !== 'bio')) {
          return message.trim();
        }
        return null;

      case 'travel_type':
        if (message.includes('budget') || message.includes('cheap')) return 'budget';
        if (message.includes('mid') || message.includes('moderate')) return 'mid';
        if (message.includes('high') || message.includes('luxury')) return 'high';
        return null;

      case 'travel_buddies':
        if (message.includes('solo') || message.includes('alone') || message.includes('by myself')) return 'solo';
        if (message.includes('2') || message.includes('two') || message.includes('partner') || message.includes('couple')) return '2';
        if (message.includes('crew') || message.includes('friends') || message.includes('group')) return 'crew';
        return null;

      case 'lifestyle_keywords':
        // Extract keywords from message - look for common lifestyle terms
        const lifestyleTerms: string[] = [];
        const lifestyleKeywords = ['adventure', 'relax', 'party', 'yoga', 'fitness', 'nature', 'culture', 'food', 'music', 'art', 'photography', 'diving', 'hiking', 'exploring'];
        for (const keyword of lifestyleKeywords) {
          if (message.includes(keyword)) {
            lifestyleTerms.push(keyword);
          }
        }
        // Also try to extract after "lifestyle" or "interests"
        const lifestyleMatch = message.match(/(?:lifestyle|interests|hobbies|i like|i enjoy)\s+(?:are|is|:)?\s*(.+)/i);
        if (lifestyleMatch) {
          const text = lifestyleMatch[1].trim();
          // Split by common separators and extract keywords
          const words = text.split(/[,\s]+/).filter(w => w.length > 2);
          lifestyleTerms.push(...words.slice(0, 5)); // Limit to 5 keywords
        }
        return lifestyleTerms.length > 0 ? lifestyleTerms : null;

      case 'wave_type_keywords':
        // Extract wave preferences
        const waveTerms: string[] = [];
        const waveKeywords = ['barrel', 'tube', 'point break', 'beach break', 'reef', 'big wave', 'small wave', 'mellow', 'powerful', 'hollow', 'crumbling'];
        for (const keyword of waveKeywords) {
          if (message.includes(keyword)) {
            waveTerms.push(keyword);
          }
        }
        // Also try to extract after "wave" or "prefer"
        const waveMatch = message.match(/(?:wave|waves|prefer|like)\s+(?:are|is|:)?\s*(.+)/i);
        if (waveMatch) {
          const text = waveMatch[1].trim();
          const words = text.split(/[,\s]+/).filter(w => w.length > 2);
          waveTerms.push(...words.slice(0, 5)); // Limit to 5 keywords
        }
        return waveTerms.length > 0 ? waveTerms : null;

      case 'profile_image_url':
        // Can't update profile picture via text - inform user
        return null;

      default:
        return null;
    }
  }

  /**
   * Get prompt message for a field when value is not provided
   */
  private getFieldPrompt(field: string, currentProfile: SupabaseSurfer | null): string {
    const currentValue = currentProfile ? (currentProfile as any)[field] : null;
    const currentText = currentValue ? ` (currently: ${this.formatFieldValue(field, currentValue)})` : '';
    
    switch (field) {
      case 'name':
        return `What name would you like to use?${currentText}`;
      case 'age':
        return `How old are you?${currentText}`;
      case 'pronoun':
        return `What are your preferred pronouns? (e.g., he/him, she/her, they/them)${currentText}`;
      case 'country_from':
        return `Which country are you from?${currentText}`;
      case 'surfboard_type':
        return `What type of surfboard do you ride? (shortboard, midlength, longboard, or soft top)${currentText}`;
      case 'surf_level':
        // Display current level from database (1-5) but note we'll convert
        const currentLevel = currentProfile?.surf_level;
        const levelText = currentLevel ? ` (currently: ${currentLevel}/5)` : '';
        return `What's your surf level? (1 = beginner, 5 = expert)${levelText}`;
      case 'travel_experience':
        return `What's your travel experience level? (beginner, intermediate, or experienced)${currentText}`;
      case 'bio':
        return `Tell me about yourself. What would you like your bio to say?${currentText}`;
      case 'travel_type':
        return `What's your travel budget preference? (budget, mid, or high)${currentText}`;
      case 'travel_buddies':
        return `Do you prefer to travel solo, with a partner (2), or with a crew?${currentText}`;
      case 'destinations_array':
        if (currentValue && Array.isArray(currentValue) && currentValue.length > 0) {
          const tripsList = currentValue.map((trip: any, idx: number) => {
            const durationText = trip.time_in_days >= 30 
              ? `${Math.round(trip.time_in_days / 30)} months`
              : trip.time_in_days >= 7
              ? `${Math.round(trip.time_in_days / 7)} weeks`
              : `${trip.time_in_days} days`;
            return `${idx + 1}. ${trip.destination_name} (${durationText})`;
          }).join('\n');
          return `You currently have ${currentValue.length} trip(s):\n${tripsList}\n\nTo add a new trip, tell me: "add trip to [destination] for [duration]". For example: "add trip to Costa Rica for 6 months"`;
        }
        return `You don't have any trips yet. To add a trip, tell me: "add trip to [destination] for [duration]". For example: "add trip to Costa Rica for 6 months"`;
      case 'lifestyle_keywords':
        return `What are your lifestyle interests? (e.g., adventure, yoga, fitness, nature, culture, food, music, art)${currentText}`;
      case 'wave_type_keywords':
        return `What type of waves do you prefer? (e.g., barrel, point break, beach break, mellow, powerful)${currentText}`;
      case 'profile_image_url':
        return `I can't update your profile picture through text. Please use the profile screen to upload a new photo.`;
      default:
        return `What value would you like to set for ${this.getFieldDisplayName(field)}?${currentText}`;
    }
  }

  /**
   * Update a profile field
   */
  private async updateProfileField(field: string, value: any, currentProfile: SupabaseSurfer | null = null): Promise<void> {
    const updateData: any = {};
    
    // Special handling for destinations_array - merge with existing
    if (field === 'destinations_array' && Array.isArray(value)) {
      const existingTrips = currentProfile?.destinations_array || [];
      // Merge new trips with existing, avoiding duplicates by destination name
      const existingDestinations = new Set(existingTrips.map((t: any) => t.destination_name?.toLowerCase()));
      const newTrips = value.filter((t: any) => !existingDestinations.has(t.destination_name?.toLowerCase()));
      const mergedTrips = [...existingTrips, ...newTrips];
      
      updateData.destinationsArray = mergedTrips;
    } else {
      // Map field names to service parameter names
      const fieldMapping: { [key: string]: string } = {
        name: 'name',
        age: 'age',
        pronoun: 'pronoun',
        country_from: 'countryFrom',
        surfboard_type: 'surfboardType',
        surf_level: 'surfLevel',
        travel_experience: 'travelExperience',
        bio: 'bio',
        travel_type: 'travelType',
        travel_buddies: 'travelBuddies',
        lifestyle_keywords: 'lifestyleKeywords',
        wave_type_keywords: 'waveTypeKeywords',
        // Note: profile_image_url can't be updated via text
      };

      const serviceField = fieldMapping[field] || field;
      updateData[serviceField] = value;
    }

    await supabaseDatabaseService.saveSurfer(updateData);
  }

  /**
   * Get success message after update
   */
  private getSuccessMessage(field: string, value: any, displayValue?: string): string {
    // For surf_level, convert 0-4 to 1-5 for display
    let formattedValue = displayValue;
    if (!formattedValue) {
      let displayVal: any = value;
      if (field === 'surf_level' && typeof value === 'number') {
        displayVal = value + 1; // Convert 0-4 to 1-5 for display
      }
      formattedValue = this.formatFieldValue(field, displayVal);
    }
    
    if (field === 'destinations_array' && Array.isArray(value) && value.length > 0) {
      const trip = value[0];
      const durationText = trip.time_in_days >= 30 
        ? `${Math.round(trip.time_in_days / 30)} months`
        : trip.time_in_days >= 7
        ? `${Math.round(trip.time_in_days / 7)} weeks`
        : `${trip.time_in_days} days`;
      return `Great! I've added a trip to ${trip.destination_name} for ${durationText}. ✅`;
    }
    
    return `Great! I've updated your ${this.getFieldDisplayName(field)} to "${formattedValue}". ✅`;
  }

  /**
   * Format field value for message display
   */
  private formatFieldValueForMessage(field: string, value: any): string {
    if (field === 'destinations_array' && Array.isArray(value) && value.length > 0) {
      const trip = value[0];
      const durationText = trip.time_in_days >= 30 
        ? `${Math.round(trip.time_in_days / 30)} months`
        : trip.time_in_days >= 7
        ? `${Math.round(trip.time_in_days / 7)} weeks`
        : `${trip.time_in_days} days`;
      return `${trip.destination_name} (${durationText})`;
    }
    return this.formatFieldValue(field, value);
  }

  /**
   * Format field value for display
   */
  private formatFieldValue(field: string, value: any): string {
    if (value === null || value === undefined) return 'not set';
    
    switch (field) {
      case 'surfboard_type':
        return value.replace('_', ' ');
      case 'surf_level':
        // Database stores 1-5, display as is
        return `${value}/5`;
      case 'travel_experience':
        return value;
      case 'destinations_array':
        // Format destinations array properly
        if (Array.isArray(value) && value.length > 0) {
          return value.map((trip: any) => {
            const durationText = trip.time_in_days >= 30 
              ? `${Math.round(trip.time_in_days / 30)} months`
              : trip.time_in_days >= 7
              ? `${Math.round(trip.time_in_days / 7)} weeks`
              : `${trip.time_in_days} days`;
            return `${trip.destination_name} (${durationText})`;
          }).join(', ');
        }
        return 'no trips';
      case 'lifestyle_keywords':
        if (Array.isArray(value)) {
          return value.join(', ');
        }
        return String(value);
      case 'wave_type_keywords':
        if (Array.isArray(value)) {
          return value.join(', ');
        }
        return String(value);
      default:
        return String(value);
    }
  }

  /**
   * Get display name for a field
   */
  private getFieldDisplayName(field: string): string {
    const displayNames: { [key: string]: string } = {
      name: 'name',
      age: 'age',
      pronoun: 'pronouns',
      country_from: 'country',
      surfboard_type: 'surfboard type',
      surf_level: 'surf level',
      travel_experience: 'travel experience',
      bio: 'bio',
      profile_image_url: 'profile picture',
      travel_type: 'travel budget',
      travel_buddies: 'travel preference',
      lifestyle_keywords: 'lifestyle interests',
      wave_type_keywords: 'wave preferences',
    };
    return displayNames[field] || field;
  }
}

export const swellyShaperService = new SwellyShaperService();

