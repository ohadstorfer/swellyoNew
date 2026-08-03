/** Jest config — unit tests only, no network/DB. See docs/superpowers/specs/2026-06-08-notifications-review-findings.md */
const expoPreset = require('jest-expo/jest-preset');

// Packages published as ESM only. Node cannot `require()` them, so Jest has to
// transform them instead of skipping node_modules as it normally does.
// Metro already transforms node_modules, so this is a test-only concern.
const ESM_ONLY_DEPENDENCIES = ['mrz'];

module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}'],
  // Safety: these suites must never hit the network. The supabase client is mocked per-suite.

  // Extend jest-expo's list rather than replacing it — the preset's entries are
  // what keep React Native and Expo transforming at all, and hardcoding a copy
  // here would silently rot the next time the preset changes.
  transformIgnorePatterns: expoPreset.transformIgnorePatterns.map(pattern =>
    pattern.startsWith('/node_modules/(?!(')
      ? pattern.replace(/\)\)$/, `|${ESM_ONLY_DEPENDENCIES.join('|')}))`)
      : pattern,
  ),
};
