// Regenerates src/data/countryNames.ts (ISO-2 code → English common name) from
// react-native-country-picker-modal's bundled dataset. Offline + Hermes-safe so
// we don't depend on Intl.DisplayNames (unavailable on the app's Hermes build).
//
// Run: node scripts/gen-country-names.js
const fs = require('fs');
const path = require('path');

const data = require('react-native-country-picker-modal/lib/assets/data/countries-emoji.json');

const entries = Object.keys(data)
  .sort()
  .map(k => {
    const name = (data[k].name && data[k].name.common ? data[k].name.common : k).replace(/'/g, "\\'");
    return `  ${k}: '${name}',`;
  })
  .join('\n');

const out = `// ISO-2 country code → English common name. Generated from
// react-native-country-picker-modal's dataset (offline, Hermes-safe — no Intl).
// Regenerate: see scripts/gen-country-names.js
export const COUNTRY_NAMES: Record<string, string> = {
${entries}
};
`;

fs.writeFileSync(path.join(__dirname, '..', 'src', 'data', 'countryNames.ts'), out);
console.log('wrote src/data/countryNames.ts with', Object.keys(data).length, 'entries');
