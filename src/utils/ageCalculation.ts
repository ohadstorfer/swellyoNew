/**
 * Age Calculation Utilities
 * 
 * Centralized functions for calculating age from date of birth,
 * validating dates, and formatting dates for display.
 */

/**
 * Calculate age in years from date of birth
 * Handles edge cases: leap years, timezone, birthday today
 * 
 * @param dateOfBirth - ISO date string (YYYY-MM-DD) or Date object
 * @returns Age in years (integer) or null if invalid
 */
export function calculateAgeFromDOB(dateOfBirth: string | Date): number | null {
  // Extract DOB year/month/day directly from the string when possible to
  // avoid Date timezone shifts (parsing "YYYY-MM-DD" as UTC then reading
  // local components can roll the day backward in negative UTC offsets).
  let dobYear: number;
  let dobMonth: number; // 1-12
  let dobDay: number;   // 1-31

  if (typeof dateOfBirth === 'string') {
    const m = dateOfBirth.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    dobYear = parseInt(m[1], 10);
    dobMonth = parseInt(m[2], 10);
    dobDay = parseInt(m[3], 10);
  } else {
    if (isNaN(dateOfBirth.getTime())) return null;
    dobYear = dateOfBirth.getUTCFullYear();
    dobMonth = dateOfBirth.getUTCMonth() + 1;
    dobDay = dateOfBirth.getUTCDate();
  }

  // "Today" uses the device's local calendar — that's the right notion of
  // "today" from the user's perspective.
  const now = new Date();
  const todayYear = now.getFullYear();
  const todayMonth = now.getMonth() + 1;
  const todayDay = now.getDate();

  let age = todayYear - dobYear;
  if (todayMonth < dobMonth || (todayMonth === dobMonth && todayDay < dobDay)) {
    age--;
  }
  return age >= 0 ? age : null;
}

/**
 * Format date of birth for display
 * 
 * @param date - Date object or ISO date string
 * @param locale - Optional locale (defaults to 'en-US')
 * @returns Formatted date string (MM/DD/YYYY for US, DD/MM/YYYY for other locales)
 */
export function formatDateOfBirth(date: Date | string, locale: string = 'en-US'): string {
  let dateObj: Date;
  
  if (typeof date === 'string') {
    dateObj = new Date(date + 'T00:00:00Z');
    if (isNaN(dateObj.getTime())) {
      return '';
    }
  } else {
    dateObj = date;
    if (isNaN(dateObj.getTime())) {
      return '';
    }
  }
  
  // Format based on locale
  if (locale === 'en-US') {
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const year = dateObj.getFullYear();
    return `${month}/${day}/${year}`;
  } else {
    // Default to DD/MM/YYYY for other locales
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();
    return `${day}/${month}/${year}`;
  }
}

/**
 * Validate date of birth
 * 
 * @param date - Date string or Date object
 * @returns Validation result with error message if invalid
 */
export function isValidDateOfBirth(date: string | Date): { valid: boolean; error?: string } {
  let dateObj: Date;
  
  if (typeof date === 'string') {
    // Validate ISO format (YYYY-MM-DD)
    const isoRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!isoRegex.test(date)) {
      return { valid: false, error: 'Please enter a valid date (YYYY-MM-DD)' };
    }
    dateObj = new Date(date + 'T00:00:00Z');
  } else {
    dateObj = date;
  }
  
  if (isNaN(dateObj.getTime())) {
    return { valid: false, error: 'Please enter a valid date' };
  }
  
  const today = new Date();
  const todayUTC = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const dateUTC = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()));
  
  // Check if date is in the future
  if (dateUTC > todayUTC) {
    return { valid: false, error: 'Date of birth cannot be in the future' };
  }
  
  // Calculate age
  const age = calculateAgeFromDOB(dateObj);
  
  if (age === null) {
    return { valid: false, error: 'Please enter a valid date of birth' };
  }
  
  // Check minimum age (18 years - app store requirement for matching apps)
  if (age < 18) {
    return { valid: false, error: 'You must be at least 18 years old to use this service' };
  }
  
  // Check maximum age (120 years - reasonable upper bound)
  if (age > 120) {
    return { valid: false, error: 'Please enter a valid date of birth' };
  }
  
  return { valid: true };
}

/**
 * Parse date of birth from various formats
 * 
 * @param input - Date string in various formats (MM/DD/YYYY, YYYY-MM-DD, etc.)
 * @returns Date object or null if invalid
 */
export function parseDateOfBirth(input: string): Date | null {
  if (!input || typeof input !== 'string') {
    return null;
  }
  
  // Try ISO format first (YYYY-MM-DD)
  const isoRegex = /^(\d{4})-(\d{2})-(\d{2})$/;
  const isoMatch = input.match(isoRegex);
  if (isoMatch) {
    const date = new Date(input + 'T00:00:00Z');
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  
  // Try MM/DD/YYYY format
  const usRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  const usMatch = input.match(usRegex);
  if (usMatch) {
    const month = parseInt(usMatch[1], 10) - 1; // Month is 0-indexed
    const day = parseInt(usMatch[2], 10);
    const year = parseInt(usMatch[3], 10);
    const date = new Date(Date.UTC(year, month, day));
    if (!isNaN(date.getTime()) && 
        date.getUTCFullYear() === year && 
        date.getUTCMonth() === month && 
        date.getUTCDate() === day) {
      return date;
    }
  }
  
  // Try DD/MM/YYYY format
  const euRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  const euMatch = input.match(euRegex);
  if (euMatch) {
    const day = parseInt(euMatch[1], 10);
    const month = parseInt(euMatch[2], 10) - 1; // Month is 0-indexed
    const year = parseInt(euMatch[3], 10);
    const date = new Date(Date.UTC(year, month, day));
    if (!isNaN(date.getTime()) && 
        date.getUTCFullYear() === year && 
        date.getUTCMonth() === month && 
        date.getUTCDate() === day) {
      return date;
    }
  }
  
  // Try generic Date parsing as last resort
  const date = new Date(input);
  if (!isNaN(date.getTime())) {
    return date;
  }
  
  return null;
}

/**
 * Convert Date object to ISO date string (YYYY-MM-DD)
 * 
 * @param date - Date object
 * @returns ISO date string or empty string if invalid
 */
export function dateToISOString(date: Date): string {
  if (!date || isNaN(date.getTime())) {
    return '';
  }
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

