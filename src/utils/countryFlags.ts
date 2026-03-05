/**
 * Comprehensive country name to flag emoji mapping
 * Handles variations, typos, and alternative names
 * Direct mapping to flag emojis for better React Native compatibility
 */

// Country name variations directly to flag emojis
const COUNTRY_TO_FLAG: { [key: string]: string } = {
  // North America
  'usa': '🇺🇸',
  'united states': '🇺🇸',
  'united states of america': '🇺🇸',
  'us': '🇺🇸',
  'america': '🇺🇸',
  'u.s.a': '🇺🇸',
  'u.s.': '🇺🇸',
  'canada': '🇨🇦',
  'mexico': '🇲🇽',
  
  // Central America
  'costa rica': '🇨🇷',
  'nicaragua': '🇳🇮',
  'panama': '🇵🇦',
  'el salvador': '🇸🇻',
  'guatemala': '🇬🇹',
  'belize': '🇧🇿',
  'honduras': '🇭🇳',
  
  // South America
  'brazil': '🇧🇷',
  'brasil': '🇧🇷',
  'argentina': '🇦🇷',
  'chile': '🇨🇱',
  'peru': '🇵🇪',
  'colombia': '🇨🇴',
  'ecuador': '🇪🇨',
  'venezuela': '🇻🇪',
  'uruguay': '🇺🇾',
  'paraguay': '🇵🇾',
  'bolivia': '🇧🇴',
  
  // Europe
  'portugal': '🇵🇹',
  'spain': '🇪🇸',
  'france': '🇫🇷',
  'italy': '🇮🇹',
  'germany': '🇩🇪',
  'united kingdom': '🇬🇧',
  'uk': '🇬🇧',
  'england': '🇬🇧',
  'ireland': '🇮🇪',
  'netherlands': '🇳🇱',
  'holland': '🇳🇱',
  'belgium': '🇧🇪',
  'switzerland': '🇨🇭',
  'austria': '🇦🇹',
  'greece': '🇬🇷',
  'sweden': '🇸🇪',
  'norway': '🇳🇴',
  'denmark': '🇩🇰',
  'finland': '🇫🇮',
  'poland': '🇵🇱',
  'czech republic': '🇨🇿',
  'hungary': '🇭🇺',
  'romania': '🇷🇴',
  'croatia': '🇭🇷',
  'slovenia': '🇸🇮',
  'iceland': '🇮🇸',
  
  // Asia
  'israel': '🇮🇱',
  'isreal': '🇮🇱', // Common typo
  'japan': '🇯🇵',
  'china': '🇨🇳',
  'south korea': '🇰🇷',
  'korea': '🇰🇷',
  'thailand': '🇹🇭',
  'indonesia': '🇮🇩',
  'philippines': '🇵🇭',
  'philippins': '🇵🇭', // Common typo
  'filipins': '🇵🇭', // Common typo
  'phillipines': '🇵🇭', // Common typo
  'india': '🇮🇳',
  'sri lanka': '🇱🇰',
  'malaysia': '🇲🇾',
  'vietnam': '🇻🇳',
  'singapore': '🇸🇬',
  'taiwan': '🇹🇼',
  'hong kong': '🇭🇰',
  
  // Oceania
  'australia': '🇦🇺',
  'new zealand': '🇳🇿',
  'fiji': '🇫🇯',
  'maldives': '🇲🇻',
  'seychelles': '🇸🇨',
  
  // Africa
  'south africa': '🇿🇦',
  'morocco': '🇲🇦',
  'egypt': '🇪🇬',
  'kenya': '🇰🇪',
  'tanzania': '🇹🇿',
  'madagascar': '🇲🇬',
  
  // Middle East
  'uae': '🇦🇪',
  'united arab emirates': '🇦🇪',
  'turkey': '🇹🇷',
  'lebanon': '🇱🇧',
};

// Country name to ISO code mapping for flag images
const COUNTRY_TO_ISO: { [key: string]: string } = {
  // North America
  'usa': 'us',
  'united states': 'us',
  'united states of america': 'us',
  'us': 'us',
  'america': 'us',
  'u.s.a': 'us',
  'u.s.': 'us',
  'canada': 'ca',
  'mexico': 'mx',
  
  // Central America
  'costa rica': 'cr',
  'nicaragua': 'ni',
  'panama': 'pa',
  'el salvador': 'sv',
  'guatemala': 'gt',
  'belize': 'bz',
  'honduras': 'hn',
  
  // South America
  'brazil': 'br',
  'brasil': 'br',
  'argentina': 'ar',
  'chile': 'cl',
  'peru': 'pe',
  'colombia': 'co',
  'ecuador': 'ec',
  'venezuela': 've',
  'uruguay': 'uy',
  'paraguay': 'py',
  'bolivia': 'bo',
  
  // Europe
  'portugal': 'pt',
  'spain': 'es',
  'france': 'fr',
  'italy': 'it',
  'germany': 'de',
  'united kingdom': 'gb',
  'uk': 'gb',
  'england': 'gb',
  'ireland': 'ie',
  'netherlands': 'nl',
  'holland': 'nl',
  'belgium': 'be',
  'switzerland': 'ch',
  'austria': 'at',
  'greece': 'gr',
  'sweden': 'se',
  'norway': 'no',
  'denmark': 'dk',
  'finland': 'fi',
  'poland': 'pl',
  'czech republic': 'cz',
  'hungary': 'hu',
  'romania': 'ro',
  'croatia': 'hr',
  'slovenia': 'si',
  'iceland': 'is',
  
  // Asia
  'israel': 'il',
  'isreal': 'il', // Common typo
  'japan': 'jp',
  'china': 'cn',
  'south korea': 'kr',
  'korea': 'kr',
  'thailand': 'th',
  'indonesia': 'id',
  'philippines': 'ph',
  'philippins': 'ph', // Common typo
  'filipins': 'ph', // Common typo
  'phillipines': 'ph', // Common typo
  'india': 'in',
  'sri lanka': 'lk',
  'malaysia': 'my',
  'vietnam': 'vn',
  'singapore': 'sg',
  'taiwan': 'tw',
  'hong kong': 'hk',
  
  // Oceania
  'australia': 'au',
  'new zealand': 'nz',
  'fiji': 'fj',
  'maldives': 'mv',
  'seychelles': 'sc',
  
  // Africa
  'south africa': 'za',
  'morocco': 'ma',
  'egypt': 'eg',
  'kenya': 'ke',
  'tanzania': 'tz',
  'madagascar': 'mg',
  
  // Middle East
  'uae': 'ae',
  'united arab emirates': 'ae',
  'turkey': 'tr',
  'lebanon': 'lb',
};

// US state name to flagcdn ISO 3166-2 code (checked before COUNTRY_TO_ISO so "California" gets state flag)
const STATE_TO_ISO: { [key: string]: string } = {
  'california': 'us-ca',
  'hawaii': 'us-hi',
};

/**
 * Get country ISO code from country name
 * Handles variations, typos, and alternative names.
 * US states (e.g. California, Hawaii) are checked first for state flag URLs.
 */
function getCountryISO(countryName?: string): string | null {
  if (!countryName) return null;
  
  const normalized = countryName.toLowerCase().trim();
  
  // US state flags first (so "California" -> us-ca, not us)
  if (STATE_TO_ISO[normalized]) {
    return STATE_TO_ISO[normalized];
  }
  
  // Direct match
  if (COUNTRY_TO_ISO[normalized]) {
    return COUNTRY_TO_ISO[normalized];
  }
  
  // Try partial matches (for compound names like "Costa Rica")
  for (const [key, iso] of Object.entries(COUNTRY_TO_ISO)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return iso;
    }
  }
  
  // Try matching without spaces and special characters
  const normalizedNoSpaces = normalized.replace(/[^a-z]/g, '');
  for (const [key, iso] of Object.entries(COUNTRY_TO_ISO)) {
    const normalizedKey = key.replace(/[^a-z]/g, '');
    if (normalizedNoSpaces === normalizedKey || 
        normalizedNoSpaces.includes(normalizedKey) || 
        normalizedKey.includes(normalizedNoSpaces)) {
      return iso;
    }
  }
  
  return null;
}

/** Flag image width: use w160 for sharp display at 50–80px (e.g. destination card circles). w20 was too small and looked blurry when scaled. */
const FLAG_IMAGE_WIDTH = 160;

/**
 * Get flag image URL for a country name
 * Uses flagcdn.com API (w160 for crisp display in cards/circles)
 */
export function getCountryFlag(countryName?: string): string | null {
  const iso = getCountryISO(countryName);
  if (!iso) return null;
  return `https://flagcdn.com/w${FLAG_IMAGE_WIDTH}/${iso}.png`;
}

