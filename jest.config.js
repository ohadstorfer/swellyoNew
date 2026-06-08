/** Jest config — unit tests only, no network/DB. See docs/superpowers/specs/2026-06-08-notifications-review-findings.md */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}'],
  // Safety: these suites must never hit the network. The supabase client is mocked per-suite.
};
