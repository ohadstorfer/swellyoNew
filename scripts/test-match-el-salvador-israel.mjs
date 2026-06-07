/**
 * Clean parity test for: "send me an Israeli surfer who surfed in El Salvador"
 *
 * Replicates the swelly-trip-planning-copy edge function /find-matches DESTINATION path
 * exactly (same helpers, same scoring), against real data. Read-only.
 *
 * GPT would extract:  destination_country = "El Salvador",  queryFilters.country_from = ["Israel"]
 *
 * Run (service role bypasses RLS, like the edge function):
 *   SUPABASE_SERVICE_ROLE_KEY=<your service role key> node scripts/test-match-el-salvador-israel.mjs
 */
import fs from 'fs';

// ---- env (merge .env then .env.local; .env.local wins) ----
function loadEnv(file) {
  try {
    return Object.fromEntries(
      fs.readFileSync(file, 'utf8').split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => {
        const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
      })
    );
  } catch { return {}; }
}
const env = { ...loadEnv('.env'), ...loadEnv('.env.local') };
const URL = env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY. Add a line to .env.local:\n  SUPABASE_SERVICE_ROLE_KEY=<service role key from Supabase dashboard → Settings → API>');
  process.exit(1);
}

const REQUEST = { destination_country: 'El Salvador', queryFilters: { country_from: ['Israel'] } };
const MATCHES_PAGE_SIZE = 3;
const COLUMNS = 'user_id,name,country_from,surfboard_type,surf_level,surf_level_category,age,travel_experience,destinations_array,is_demo_user';

// ---- exact ports of the edge function helpers (index.ts) ----
function getCountryFromUserDest(dest) {
  if (typeof dest === 'object' && dest !== null && 'country' in dest) return (dest.country || '').trim();
  if (typeof dest === 'object' && dest !== null && 'destination_name' in dest) return ((dest.destination_name || '').trim().split(',')[0] || '').trim();
  if (typeof dest === 'string') return (dest.split(',')[0] || '').trim();
  return '';
}
function countryMatchesRequest(requestCountry, userCountry, userState) {
  if (!requestCountry || !userCountry) return false;
  const requested = requestCountry.split(',').map(c => c.trim().toLowerCase()).filter(c => c.length > 0);
  const uc = userCountry.toLowerCase().trim();
  const us = userState != null ? String(userState).toLowerCase().trim() : undefined;
  return requested.some(r => {
    if (uc === r) return true;
    if ((r === 'usa' || r === 'united states') && (uc.includes('united states') || uc.includes('usa'))) return true;
    if ((r === 'uk' || r === 'united kingdom') && (uc.includes('united kingdom') || /\buk\b/.test(uc))) return true;
    const pfx = 'united states - ';
    if (r.startsWith(pfx)) {
      const rs = r.slice(pfx.length).trim();
      const isUS = uc.includes('united states') || uc === 'usa';
      if (isUS && rs.length > 0 && us) { if (us === rs) return true; if (us.includes(rs) || rs.includes(us)) return true; }
    }
    const esc = r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('\\b' + esc + '\\b', 'i').test(uc);
  });
}
function countryFromMatch(requested, userCountry) {
  if (!requested?.length) return true;
  if (!userCountry || typeof userCountry !== 'string') return false;
  const u = userCountry.trim().toLowerCase();
  return requested.some(c => {
    const r = String(c).trim().toLowerCase();
    if (u === r) return true;
    if ((r === 'united states' || r === 'usa') && (u.includes('united states') || u.includes('usa'))) return true;
    if ((r === 'uk' || r === 'united kingdom') && (u.includes('united kingdom') || /\buk\b/.test(u))) return true;
    return u.includes(r) || r.includes(u);
  });
}

// ---- fetch all surfers (service role), paginated ----
async function fetchAllSurfers() {
  const out = []; const pageSize = 1000; let from = 0;
  for (;;) {
    const res = await fetch(`${URL}/rest/v1/surfers?select=${encodeURIComponent(COLUMNS)}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Range: `${from}-${from + pageSize - 1}` },
    });
    if (!res.ok) { console.error('fetch failed', res.status, await res.text()); process.exit(1); }
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out.filter(s => s.is_demo_user === null || s.is_demo_user === false);
}

// ---- run the destination-path matching ----
const surfers = await fetchAllSurfers();
console.log(`\nTotal non-demo surfers: ${surfers.length}`);

const israeli = surfers.filter(s => countryFromMatch(REQUEST.queryFilters.country_from, s.country_from));
console.log(`Israeli surfers (country_from match): ${israeli.length}`);

const elSalvadorAny = surfers.filter(s =>
  (s.destinations_array || []).some(d => countryMatchesRequest(REQUEST.destination_country, getCountryFromUserDest(d), d?.state) && (d.time_in_days || 0) > 0)
);
console.log(`Surfers who surfed El Salvador (days > 0): ${elSalvadorAny.length}`);

// Destination path: country match (sum matched days) -> criteria filter (country_from)
const countryMatched = [];
for (const s of surfers) {
  let days = 0;
  for (const d of (s.destinations_array || [])) {
    if (!countryMatchesRequest(REQUEST.destination_country, getCountryFromUserDest(d), d?.state)) continue;
    days += d.time_in_days || 0;
  }
  if (days > 0) countryMatched.push({ s, days });
}
const afterCriteria = countryMatched.filter(({ s }) => countryFromMatch(REQUEST.queryFilters.country_from, s.country_from));
afterCriteria.sort((a, b) => b.days - a.days);

console.log(`\n=== RESULT for "Israeli surfer who surfed El Salvador" ===`);
console.log(`Qualifying surfers (Israeli AND surfed El Salvador): ${afterCriteria.length}`);
console.log(`Returned to user (top ${MATCHES_PAGE_SIZE}):`);
for (const { s, days } of afterCriteria.slice(0, MATCHES_PAGE_SIZE)) {
  console.log(`  - ${s.name} (${s.country_from}), ${days} days in El Salvador, user_id=${s.user_id}`);
}
if (afterCriteria.length === 0) {
  console.log('  (none — no Israeli surfer in the DB has El Salvador in their destinations)');
  console.log('  Sanity: of the', elSalvadorAny.length, 'El-Salvador surfers, country_from values:',
    [...new Set(elSalvadorAny.map(s => s.country_from))].slice(0, 20));
}
console.log();
