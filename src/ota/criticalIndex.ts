/**
 * Critical-OTA counter baked into this JS bundle.
 *
 * To ship a CRITICAL over-the-air update (one users must get on the very
 * launch they open the app, not the one after):
 *   1. Bump this number by 1 in the commit you publish.
 *   2. Publish the OTA for BOTH platforms.
 *   3. ONLY THEN set `app_config.ota_critical` in Supabase to the same number.
 *
 * At launch the app compares the server value with this one. Server higher =
 * "a critical update exists that this bundle doesn't have" → the app waits for
 * it (see otaGate.ts). Full steps: docs/OTA_CRITICAL_UPDATES.md.
 *
 * Never lower this number.
 */
export const CRITICAL_INDEX = 0;
