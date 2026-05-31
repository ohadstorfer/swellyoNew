/**
 * One-shot backfill: enrich existing group_trip_destinations rows with
 * admin_level_1/2, types, and geohash buckets by calling the
 * geocode-group-trip-destinations Edge Function for each row.
 *
 * Idempotent — only picks rows that have a place_id and NULL admin_level_1.
 * Throttled to avoid hammering Google Geocoding API.
 *
 * Required env vars:
 *   EXPO_PUBLIC_SUPABASE_URL          (project URL)
 *   SUPABASE_SERVICE_ROLE_KEY         (service-role key; bypasses RLS)
 *   GEOCODE_INTERNAL_SECRET           (must match the function's secret)
 *
 * Usage:
 *   EXPO_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     GEOCODE_INTERNAL_SECRET=... \
 *     npx ts-node scripts/backfillGroupTripDestinationsGeo.ts
 *
 * NOT a Supabase migration — costs Google API credits, so it's run manually
 * post-deploy.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTERNAL_SECRET = process.env.GEOCODE_INTERNAL_SECRET;
const THROTTLE_MS = 150;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !INTERNAL_SECRET) {
  console.error(
    'Missing env: EXPO_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEOCODE_INTERNAL_SECRET are required.'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface PendingRow {
  trip_id: string;
  place_id: string | null;
}

async function fetchPending(): Promise<PendingRow[]> {
  const { data, error } = await supabase
    .from('group_trip_destinations')
    .select('trip_id, place_id')
    .is('admin_level_1', null)
    .not('place_id', 'is', null);
  if (error) {
    console.error('Fetch pending rows error:', error);
    throw error;
  }
  return (data || []) as PendingRow[];
}

async function enrichOne(tripId: string): Promise<{ ok: boolean; reason?: string }> {
  const url = `${SUPABASE_URL}/functions/v1/geocode-group-trip-destinations`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'x-internal-secret': INTERNAL_SECRET!,
      },
      body: JSON.stringify({ trip_id: tripId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.success === false) {
      return { ok: false, reason: body?.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: e?.message || 'fetch failed' };
  }
}

async function main() {
  console.log('Fetching pending group_trip_destinations rows...');
  const pending = await fetchPending();
  console.log(`Found ${pending.length} rows needing enrichment.`);
  if (pending.length === 0) return;

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < pending.length; i++) {
    const row = pending[i];
    const progress = `[${i + 1}/${pending.length}]`;
    const result = await enrichOne(row.trip_id);
    if (result.ok) {
      ok++;
      console.log(`${progress} ok  trip_id=${row.trip_id}`);
    } else {
      fail++;
      console.warn(`${progress} fail trip_id=${row.trip_id} reason=${result.reason}`);
    }
    if (i < pending.length - 1) {
      await new Promise((r) => setTimeout(r, THROTTLE_MS));
    }
  }

  console.log(`\nDone. ok=${ok} fail=${fail} total=${pending.length}`);
}

main().catch((e) => {
  console.error('Backfill crashed:', e);
  process.exit(1);
});
