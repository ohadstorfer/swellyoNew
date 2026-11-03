// loadtest/prod-readonly.js  (k6)
//
// READ-ONLY load test against PRODUCTION. Replays the 21 Oct 2026 request
// mix (see scenario.js and docs/load-test-slowness-2026-10-21.md) with every
// write removed, so nothing changes in the database and no push, email or
// in-app notification can fire (those all start from a write).
//
// Do not run this directly. Use loadtest/run-prod.sh: it signs a short-lived
// token for ONE account (the person running it) and never writes it to disk.
//
// What was removed from the mix (all writes): surfers PATCH, notifications
// mark-read, conversation_members read marks, sending messages, realtime
// broadcasts, user_activity PATCH, analytics inserts. The 8 RPCs kept were
// checked on 21 Oct 2026: none of them, nor the RLS helper functions they
// use, contains an insert/update/delete or an outbound call.
//
// Safety stops (any one ends the whole run):
//   - any request that is not GET/HEAD, or a POST to an RPC not in READ_RPCS
//     -> refused before it is sent, and the run aborts
//   - a phone sees p95 > SLOW_MS over its last 40 requests
//   - a phone sees > 5% errors (5xx, timeouts, 429) over its last 40 requests
//   - whole-run thresholds: p95 > SLOW_MS or 5xx > 2%
//
// Env (set by run-prod.sh): BASE_URL, ANON_KEY, TOKEN, CONTEXT_FILE,
//   MODE=smoke|load, STEPS (default 20,30,50), HOLDS (default 25m,5m,5m),
//   RATE_PER_MIN (default 25), SLOW_MS (default 1500).

import http from 'k6/http';
import { sleep } from 'k6';
import { Rate, Counter } from 'k6/metrics';
import exec from 'k6/execution';

const BASE_URL = (__ENV.BASE_URL || '').replace(/\/+$/, '');
const ANON_KEY = __ENV.ANON_KEY || '';
const TOKEN = __ENV.TOKEN || '';
const MODE = (__ENV.MODE || 'smoke').toLowerCase();
const STEPS = (__ENV.STEPS || '20,30,50').split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
const HOLDS = (__ENV.HOLDS || '25m,5m,5m').split(',').map((s) => s.trim());
const RAMP = __ENV.RAMP || '1m';
const RATE = Number(__ENV.RATE_PER_MIN || 25);
const MAX_BURST = 6;
const SLOW_MS = Number(__ENV.SLOW_MS || 1500);

if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(BASE_URL)) throw new Error(`BASE_URL must be https://<ref>.supabase.co, got "${BASE_URL}"`);
if (!ANON_KEY || !TOKEN) throw new Error('ANON_KEY and TOKEN are required. Use run-prod.sh.');
if (MODE !== 'smoke' && MODE !== 'load') throw new Error('MODE must be smoke or load');
if (HOLDS.length !== STEPS.length) throw new Error('STEPS and HOLDS need the same number of items');

const CTX = JSON.parse(open(__ENV.CONTEXT_FILE || './prod-context.json'));

// RPCs checked read-only on 21 Oct 2026. Anything else is refused.
const READ_RPCS = new Set([
  'get_last_messages_per_conversation', 'operator_trip_my_requirements', 'staff_my_requirements',
  'my_trip_capabilities', 'search_users_for_staff', 'explore_feed', 'my_trips_feed', 'get_blocked_by_ids',
]);

function assertReadOnly(method, url) {
  if (method === 'GET' || method === 'HEAD') return;
  const m = url.match(/\/rest\/v1\/rpc\/([a-z_]+)$/);
  if (method === 'POST' && m && READ_RPCS.has(m[1])) return;
  exec.test.abort(`REFUSED non-read request: ${method} ${url}`);
  throw new Error('refused');
}

// ------------------------------------------------------------- helpers ----
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => (arr && arr.length ? arr[rnd(arr.length)] : undefined);
const sample = (arr, n) => {
  const copy = (arr || []).slice();
  const out = [];
  while (copy.length && out.length < n) out.push(copy.splice(rnd(copy.length), 1)[0]);
  return out;
};
const inList = (ids) => `in.(${ids.join(',')})`;
const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = rnd(16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
const nowIso = () => new Date().toISOString();
const rest = (table, qs) => `${BASE_URL}/rest/v1/${table}${qs ? `?${qs}` : ''}`;
const rpc = (fn) => `${BASE_URL}/rest/v1/rpc/${fn}`;


// Same select lists the app sends (from the logs).
const SURFER_SHORT = 'user_id,name,age,country_from,travel_experience,surfboard_type,surf_level_category,profile_image_url,lifestyle_keywords';
const SURFER_FULL = 'user_id,name,age,date_of_birth,pronoun,country_from,display_currency,surfboard_type,surf_level,surf_level_description,surf_level_category,travel_experience,bio,profile_image_url,cover_image_url,profile_video_url,profile_video_thumbnail_url,profile_photo_url,destinations_array,lifestyle_keywords,lifestyle_image_urls,wave_type_keywords,travel_buddies,home_break_place_id,home_break_full,home_break_short,home_break_locality,home_break_country,home_break_lat,home_break_lng,welcome_guide_seen_at,surftrips_tip_seen_at,created_at,updated_at,finished_onboarding';
const MESSAGE_COLS = 'id,conversation_id,sender_id,body,attachments,client_id,is_system,edited,deleted,created_at,updated_at,type,image_metadata,video_metadata,audio_metadata,commitment_metadata,file_metadata,contact_metadata,reply_to_message_id,reply_to_snapshot,message_reactions(user_id,reaction,reacted_at)';

// -------------------------------------------------------- the request mix --
// count = requests in the 30-minute production window (18 users).
// bundle 'trip' = refetched by the trip screen on realtime events.
// Left out (~1.8% of traffic, rare writes): join request create/delete/
// review, staff invites, consents, acknowledgements, document uploads,
// PUT /auth/v1/user, personal-info writes.
const GET = 'GET';
const ENDPOINTS = [
  { name: 'auth_user', count: 1038, build: () => [GET, `${BASE_URL}/auth/v1/user`] },

  { name: 'surfers_list_small', count: 426, bundle: 'trip', build: (c) => [GET, rest('surfers', `select=${SURFER_SHORT}&user_id=${inList(sample(c.peers, 1 + rnd(4)))}`)] },
  { name: 'surfers_list_roster', count: 427, bundle: 'trip', build: (c) => [GET, rest('surfers', `select=${SURFER_SHORT}&user_id=${inList(c.peers.slice(0, 25))}`)] },
  { name: 'surfers_me_full', count: 194, build: (c) => [GET, rest('surfers', `select=${SURFER_FULL}&user_id=eq.${c.me}`)] },
  { name: 'surfers_me_timezone', count: 178, build: (c) => [GET, rest('surfers', `select=timezone&user_id=eq.${c.me}`)] },

  { name: 'trips_detail', count: 504, bundle: 'trip', build: (c) => [GET, rest('group_trips', `select=*,destination:group_trip_destinations(name,short_label,country,admin_level_1,lat,lng)&id=eq.${c.trip}`)] },
  { name: 'trips_cost', count: 150, build: (c) => [GET, rest('group_trips', `select=cost_per_person,deposit_amount&id=eq.${c.trip}`)] },
  { name: 'trips_cancellation', count: 122, build: (c) => [GET, rest('group_trips', `select=cancellation_preset,cancellation_rules,cancellation_notes&id=eq.${c.trip}`)] },
  { name: 'trips_hero', count: 147, build: (c) => [GET, rest('group_trips', `select=id,hero_image_url&id=${inList(c.trips)}`)] },
  { name: 'participants_roster', count: 517, bundle: 'trip', build: (c) => [GET, rest('group_trip_participants', `select=role,status,joined_at,user_id,committed,commitment_status,commitment_items,commitment_note,personal_gear_by_host,personal_gear_by_me&trip_id=eq.${c.trip}&status=in.(onboarding,active)&order=joined_at.asc`)] },

  { name: 'join_req_mine', count: 421, bundle: 'trip', build: (c) => [GET, rest('group_trip_join_requests', `select=*&trip_id=eq.${c.trip}&requester_id=eq.${c.me}`)] },
  { name: 'join_req_pending', count: 86, bundle: 'trip', build: (c) => [GET, rest('group_trip_join_requests', `select=*&trip_id=eq.${c.trip}&status=eq.pending&order=created_at.asc`)] },
  { name: 'join_req_declined', count: 87, bundle: 'trip', build: (c) => [GET, rest('group_trip_join_requests', `select=*&trip_id=eq.${c.trip}&status=eq.declined&order=reviewed_at.desc`)] },
  { name: 'join_req_decisions', count: 32, build: (c) => [GET, rest('group_trip_join_requests', `select=id,trip_id,status,reviewed_at&requester_id=eq.${c.me}&status=in.(approved,declined)&seen_decision_at=is.null&order=reviewed_at.asc`)] },
  { name: 'admin_updates', count: 187, bundle: 'trip', build: (c) => [GET, rest('group_trip_admin_updates', `select=*&trip_id=eq.${c.trip}&order=created_at.desc`)] },
  { name: 'gear_items', count: 185, bundle: 'trip', build: (c) => [GET, rest('group_trip_gear_items', `select=*&trip_id=eq.${c.trip}&order=sort_order.asc.nullslast,created_at.asc`)] },
  { name: 'gear_requests', count: 27, bundle: 'trip', build: (c) => [GET, rest('group_trip_gear_requests', `select=*&trip_id=eq.${c.trip}&order=created_at.desc&status=eq.pending`)] },

  { name: 'notifications_unread_head', count: 714, head: true, build: () => ['HEAD', rest('notifications', 'select=id&read_at=is.null')] },
  { name: 'notifications_list', count: 40, build: () => [GET, rest('notifications', 'select=*&order=created_at.desc&limit=50')] },
  { name: 'notification_templates', count: 21, build: () => [GET, rest('notification_templates', 'select=key,bell_title,bell_body')] },

  { name: 'conv_members_all_mine', count: 120, build: (c) => [GET, rest('conversation_members', `select=*&user_id=eq.${c.me}`)] },
  { name: 'conv_members_one', count: 73, build: (c) => [GET, rest('conversation_members', `select=*&conversation_id=eq.${c.conv}&user_id=eq.${c.me}`)] },
  { name: 'conv_members_last_read', count: 51, build: (c) => [GET, rest('conversation_members', `select=last_read_at&conversation_id=eq.${c.conv}&user_id=eq.${c.me}`)] },
  { name: 'conv_members_scoped', count: 111, build: (c) => [GET, rest('conversation_members', `select=conversation_id,last_read_at&user_id=eq.${c.me}&conversation_id=${inList(sample(c.convs, 1 + rnd(2)))}`)] },
  { name: 'conversations_trip_chat', count: 118, build: (c) => [GET, rest('conversations', `select=*&is_direct=eq.false&metadata->>trip_id=eq.${c.trip}&order=created_at.asc&limit=1`)] },
  { name: 'conversations_by_ids', count: 58, build: (c) => [GET, rest('conversations', `select=id,title,is_direct,metadata,created_by,created_at,updated_at&id=${inList(c.convs)}&order=updated_at.desc&offset=0&limit=51`)] },
  { name: 'messages_page', count: 109, build: (c) => [GET, rest('messages', `select=${MESSAGE_COLS}&conversation_id=eq.${c.conv}&order=created_at.desc&limit=31`)] },
  { name: 'messages_unread_scan', count: 67, build: (c) => [GET, rest('messages', `select=id,conversation_id,sender_id,created_at&conversation_id=${inList(c.convs)}&deleted=eq.false&sender_id=neq.${c.me}&created_at=gt.1970-01-01T00:00:00.000Z&limit=1000`)] },
  { name: 'message_reactions', count: 18, build: (c) => [GET, rest('message_reactions', `select=message_id,user_id,reaction,reacted_at&message_id=${inList([uuid(), uuid()])}`)] },
  { name: 'rpc_get_last_messages', count: 53, build: (c) => ['POST', rpc('get_last_messages_per_conversation'), { conv_ids: c.convs }] },

  { name: 'payment_events_mine_sum', count: 151, build: (c) => [GET, rest('organized_trip_payment_events', `select=requirement_id,amount_usd&trip_id=eq.${c.trip}&user_id=eq.${c.me}&event_type=neq.failed&event_type=neq.processing&is_livemode=eq.false`)] },
  { name: 'payment_events_mine_status', count: 115, build: (c) => [GET, rest('organized_trip_payment_events', `select=requirement_id,event_type,provider_object_id,amount_charged,created_at&trip_id=eq.${c.trip}&user_id=eq.${c.me}&is_livemode=eq.false&event_type=in.(processing,paid,failed)`)] },
  { name: 'payment_events_trip', count: 66, build: (c) => [GET, rest('organized_trip_payment_events', `select=id,user_id,requirement_id,event_type,amount_usd,is_livemode,created_at&trip_id=eq.${c.trip}&order=created_at.desc`)] },
  { name: 'traveler_prices_mine', count: 150, build: (c) => [GET, rest('organized_trip_traveler_prices', `select=price_total_usd,deposit_usd&trip_id=eq.${c.trip}&user_id=eq.${c.me}`)] },
  { name: 'traveler_prices_trip', count: 56, build: (c) => [GET, rest('organized_trip_traveler_prices', `select=user_id,price_total_usd,deposit_usd&trip_id=eq.${c.trip}&role=eq.member`)] },
  { name: 'refunds_mine', count: 113, build: (c) => [GET, rest('organized_trip_refunds', `select=amount_usd,created_at&trip_id=eq.${c.trip}&user_id=eq.${c.me}&status=eq.succeeded&is_livemode=eq.false&order=created_at.desc`)] },
  { name: 'refunds_trip', count: 55, build: (c) => [GET, rest('organized_trip_refunds', `select=id,user_id,amount_usd,reason,status,failure_reason,created_at&trip_id=eq.${c.trip}&order=created_at.desc`)] },
  { name: 'staff_trip', count: 95, build: (c) => [GET, rest('organized_trip_staff', `select=*&trip_id=eq.${c.trip}&revoked_at=is.null`)] },
  { name: 'staff_mine', count: 90, build: (c) => [GET, rest('organized_trip_staff', `select=*&trip_id=eq.${c.trip}&user_id=eq.${c.me}&revoked_at=is.null`)] },
  { name: 'staff_roles', count: 108, build: () => [GET, rest('organized_trip_staff_roles', 'select=role_key,tier,label,blurb,capabilities&operator_id=is.null&order=tier.asc')] },
  { name: 'requirements_pay', count: 56, build: (c) => [GET, rest('organized_trip_requirements', `select=id,kind,title,is_active&trip_id=eq.${c.trip}&req_type=eq.pay&is_active=eq.true`)] },
  { name: 'requirements_traveler', count: 40, build: (c) => [GET, rest('organized_trip_requirements', `select=id,kind,req_type,title,skip_at_onboarding,deadline_days_before,is_active&trip_id=eq.${c.trip}&audience=eq.traveler&order=sort_order.asc`)] },
  { name: 'requirements_resolved', count: 24, build: (c) => [GET, rest('organized_trip_requirements_resolved', `select=id,kind,req_type,title,due_date,sort_order,skip_at_onboarding&trip_id=eq.${c.trip}&is_active=eq.true`)] },
  { name: 'policy_consents', count: 119, build: (c) => [GET, rest('organized_trip_policy_consents', `select=shown_text&trip_id=eq.${c.trip}&user_id=eq.${c.me}&order=created_at.desc&limit=1`)] },
  { name: 'personal_info_mine', count: 28, build: (c) => [GET, rest('organized_trip_personal_info', `select=id,allergies,allergies_none,dietary,dietary_none,injuries,injuries_none,medications,medications_none,emergency_name,emergency_phone,emergency_relation,completed_at&trip_id=eq.${c.trip}&user_id=eq.${c.me}`)] },
  { name: 'personal_info_trip', count: 25, build: (c) => [GET, rest('organized_trip_personal_info', `select=user_id,completed_at&trip_id=eq.${c.trip}`)] },
  { name: 'operator_documents', count: 38, build: (c) => [GET, rest('organized_trip_operator_documents', `select=id,version,body_text,storage_path&trip_id=eq.${c.trip}&kind=eq.waiver&order=version.desc&limit=1`)] },
  { name: 'travelers_documents', count: 27, build: (c) => [GET, rest('organized_trip_travelers_documents', `select=id,user_id,requirement_id,storage_path,uploaded_at,approved_at,rejected_at,approbation_note,file_deleted_at&trip_id=eq.${c.trip}`)] },
  { name: 'acknowledgements', count: 26, build: (c) => [GET, rest('group_trip_acknowledgements', `select=user_id,requirement_id,agreed_at,operator_document_id&trip_id=eq.${c.trip}`)] },

  { name: 'rpc_operator_trip_my_requirements', count: 151, build: (c) => ['POST', rpc('operator_trip_my_requirements'), { p_trip_id: c.trip }] },
  { name: 'rpc_staff_my_requirements', count: 108, build: (c) => ['POST', rpc('staff_my_requirements'), { p_trip_id: c.trip }] },
  { name: 'rpc_my_trip_capabilities', count: 78, build: (c) => ['POST', rpc('my_trip_capabilities'), { p_trip_id: c.trip }] },
  { name: 'rpc_search_users_for_staff', count: 24, build: (c) => ['POST', rpc('search_users_for_staff'), { p_trip_id: c.trip, p_query: 'load' }] },
  { name: 'rpc_explore_feed', count: 134, build: () => ['POST', rpc('explore_feed'), { p_limit: 20, p_cursor: null, p_cursor_id: null, p_months: null, p_budget_min: null, p_budget_max: null, p_cursor_participant_count: null }] },
  { name: 'rpc_my_trips_feed', count: 65, build: () => ['POST', rpc('my_trips_feed'), {}] },
  { name: 'rpc_get_blocked_by_ids', count: 21, build: () => ['POST', rpc('get_blocked_by_ids'), {}] },

  { name: 'users_me', count: 179, build: (c) => [GET, rest('users', `select=*&id=eq.${c.me}`)] },
  { name: 'users_emails', count: 57, build: (c) => [GET, rest('users', `select=id,email&id=${inList(sample(c.peers, 3 + rnd(4)))}`)] },
  { name: 'user_blocks', count: 21, build: (c) => [GET, rest('user_blocks', `select=blocked_id&blocker_id=eq.${c.me}`)] },
  { name: 'user_activity_get', count: 57, build: (c) => [GET, rest('user_activity', `select=user_id&user_id=eq.${c.me}`)] },
  { name: 'surftrip_groups', count: 78, build: (c) => [GET, rest('surftrip_groups', `select=conversation_id,hero_image_url&conversation_id=${inList(sample(c.convs, 1 + rnd(4)))}`)] },
];

// --------------------------------------------------------------- runner ----
const ALL = ENDPOINTS;
const TOTAL = ALL.reduce((s, e) => s + e.count, 0);
const CUM = [];
ALL.reduce((s, e, i) => (CUM[i] = s + e.count), 0);
function pickEndpoint() {
  const x = Math.random() * TOTAL;
  for (let i = 0; i < CUM.length; i++) if (x < CUM[i]) return ALL[i];
  return ALL[ALL.length - 1];
}

const serverErrors = new Rate('server_errors');
const clientErrors = new Rate('client_errors');
const reqCount = new Counter('reqs');

function ctxFor() {
  return {
    me: CTX.me,
    trips: CTX.trips,
    trip: CTX.trip,
    convs: CTX.convs,
    conv: pick(CTX.convs),
    peers: CTX.peers,
  };
}

function send(list) {
  const batch = list.map((e) => {
    const [method, url, body] = e.build(ctxFor());
    assertReadOnly(method, url);
    const headers = { apikey: ANON_KEY, Authorization: `Bearer ${TOKEN}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (e.head) headers.Prefer = 'count=exact';
    return {
      method, url,
      body: body === undefined ? null : JSON.stringify(body),
      params: { headers, tags: { endpoint: e.name, name: e.name }, timeout: '60s' },
    };
  });
  return { batch, responses: http.batch(batch) };
}

const stages = [];
STEPS.forEach((target, i) => {
  stages.push({ duration: RAMP, target });
  stages.push({ duration: HOLDS[i], target });
});
stages.push({ duration: '20s', target: 0 });

export const options = MODE === 'smoke'
  ? { vus: 1, iterations: 1, discardResponseBodies: true, userAgent: 'swellyo-loadtest-k6' }
  : {
      scenarios: { phones: { executor: 'ramping-vus', startVUs: 0, stages, gracefulRampDown: '10s' } },
      thresholds: {
        http_req_duration: [{ threshold: `p(95)<${SLOW_MS}`, abortOnFail: true, delayAbortEval: '1m' }],
        server_errors: [{ threshold: 'rate<0.02', abortOnFail: true, delayAbortEval: '1m' }],
      },
      summaryTrendStats: ['med', 'p(95)', 'p(99)', 'max', 'count'],
      discardResponseBodies: true,
      userAgent: 'swellyo-loadtest-k6',
    };

const recent = []; // this phone's last 40 requests: [ms, isError]

export default function () {
  if (MODE === 'smoke') {
    // Every endpoint once, one at a time. Prints the status of each.
    const bad = [];
    for (const e of ALL) {
      const { responses } = send([e]);
      const r = responses[0];
      const ok = r.status >= 200 && r.status < 300;
      console.log(`${ok ? 'OK ' : 'BAD'} ${String(r.status).padStart(3)} ${String(Math.round(r.timings.duration)).padStart(6)} ms  ${e.name}`);
      if (!ok) bad.push(`${e.name}=${r.status}`);
      sleep(0.2);
    }
    console.log(bad.length ? `SMOKE: ${bad.length} endpoints not OK: ${bad.join(', ')}` : `SMOKE: all ${ALL.length} endpoints OK`);
    return;
  }

  if (exec.vu.iterationInScenario === 0) sleep(Math.random() * 5);
  const burst = 1 + rnd(MAX_BURST);
  const chosen = [];
  for (let i = 0; i < burst; i++) chosen.push(pickEndpoint());
  const { responses } = send(chosen);
  responses.forEach((r, i) => {
    const tags = { endpoint: chosen[i].name };
    const isErr = r.status === 0 || r.status >= 500 || r.status === 429;
    reqCount.add(1, tags);
    serverErrors.add(isErr, tags);
    clientErrors.add(r.status >= 400 && r.status < 500, tags);
    recent.push([r.timings.duration, isErr]);
    if (recent.length > 40) recent.shift();
  });

  if (recent.length >= 40) {
    const sorted = recent.map((x) => x[0]).sort((a, b) => a - b);
    const p95 = sorted[Math.floor(0.95 * (sorted.length - 1))];
    const errRate = recent.filter((x) => x[1]).length / recent.length;
    if (p95 > SLOW_MS || errRate > 0.05) {
      exec.test.abort(`AUTO-STOP at ${exec.instance.vusActive} phones: last-40 p95=${Math.round(p95)}ms errors=${Math.round(errRate * 100)}%`);
    }
  }

  const meanSeconds = (60 / RATE) * burst;
  sleep(-Math.log(1 - Math.random()) * meanSeconds);
}
