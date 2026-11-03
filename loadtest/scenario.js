// loadtest/scenario.js  (k6)
//
// Replays the request mix of the 21 Oct 2026 group test against a LOCAL
// Supabase copy. One virtual user (VU) = one phone.
//
// Run (from the repo root):
//   k6 run -e ANON_KEY=... -e MIX=before -e RUN_LABEL=A loadtest/scenario.js
//
// Env:
//   BASE_URL        default http://127.0.0.1:54321 (only local hosts are allowed)
//   ANON_KEY        required. Local anon key (`supabase status -o env`).
//   TOKENS_FILE     default ./tokens.json (next to this file; made by mint-tokens.js)
//   MIX             before | after   (default before)
//   STEPS           VU steps, default "20,50,100"
//   HOLD            how long each step is held, default "3m"
//   RAMP            ramp time into each step, default "30s"
//   RATE_PER_MIN    requests per phone per minute in the `before` mix, default 25
//   MAX_BURST       max requests a phone fires at once, default 6
//   TRIP_IDS / CONVERSATION_IDS  optional comma lists, used only when a
//                   token entry has no trip / chat ids of its own
//   RUN_LABEL       name for the results file, default "<MIX>"
//   RESULTS_DIR     default loadtest/results (must exist; README makes it)
//
// Where the numbers come from: production edge_logs, read-only,
// 2026-10-21 01:15-01:45 UTC. 18 signed-in users sent 9,417 requests to
// /rest/v1, /auth/v1/user and /realtime/v1/api/broadcast in those 30 min.
// Storage/media (videos, images, ~1,600 requests) and anonymous traffic
// are left out on purpose.
//   - 17.4 req/user/min averaged over all 30 minutes
//   - 24.8 req/user/min over the minutes each user was really active
//   - ~33  req/user/min in the busiest minutes (01:30-01:39)
// RATE_PER_MIN=25 is the default; use 33 to replay the peak.

import http from 'k6/http';
import { sleep } from 'k6';
import { Rate, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';

// ------------------------------------------------- MIX=after assumptions --
// What the 21 Oct client fixes (iOS OTA) are assumed to remove.
// Change these when real numbers from the next test exist.

// getSessionUser() replaced getUser() on hot paths (messaging, analytics).
// Assume ~85% of GET /auth/v1/user calls are gone; useAuthGuard keeps the rest.
const AFTER_GET_USER_KEEP = 0.15;

// useTripRealtime merges broadcast events for 300 ms, then refreshes once.
// Assume the trip-detail bundle (requests tagged bundle 'trip') drops ~30%.
const AFTER_TRIP_BUNDLE_KEEP = 0.7;

// getConversationsUpdatedSince now asks only for the memberships of the
// conversations named in the broadcast. The "all my memberships" query turns
// into the scoped one (same count, smaller query).
const AFTER_INBOX_SCOPED = true;

// --------------------------------------------------------------- config --
const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1:54321').replace(/\/+$/, '');
const ANON_KEY = __ENV.ANON_KEY || '';
const MIX = (__ENV.MIX || 'before').toLowerCase();
const RATE_BEFORE = Number(__ENV.RATE_PER_MIN || 25);
const MAX_BURST = Math.max(1, Number(__ENV.MAX_BURST || 6));
const STEPS = (__ENV.STEPS || '20,50,100').split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
const HOLD = __ENV.HOLD || '3m';
const RAMP = __ENV.RAMP || '30s';
const RUN_LABEL = __ENV.RUN_LABEL || MIX;
const RESULTS_DIR = __ENV.RESULTS_DIR || 'loadtest/results';

// Safety: never point this at a hosted project.
if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|host\.docker\.internal)(:\d+)?$/.test(BASE_URL)) {
  throw new Error(`BASE_URL must be a local address, got ${BASE_URL}. This kit never runs against a hosted project.`);
}
if (!ANON_KEY) throw new Error('ANON_KEY is required (supabase status -o env).');
if (MIX !== 'before' && MIX !== 'after') throw new Error('MIX must be before or after');

const USERS = new SharedArray('users', () => {
  const list = JSON.parse(open(__ENV.TOKENS_FILE || './tokens.json'));
  if (!Array.isArray(list) || list.length === 0) throw new Error('TOKENS_FILE is empty');
  return list;
});
const ENV_TRIPS = (__ENV.TRIP_IDS || '').split(',').filter(Boolean);
const ENV_CONVS = (__ENV.CONVERSATION_IDS || '').split(',').filter(Boolean);

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
  { name: 'surfers_patch_me', count: 214, build: (c) => ['PATCH', rest('surfers', `user_id=eq.${c.me}`), { timezone: 'UTC' }] },

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
  { name: 'notifications_mark_read', count: 27, build: (c) => ['PATCH', rest('notifications', `recipient_id=eq.${c.me}&read_at=is.null&type=eq.trip_reminder`), { read_at: nowIso() }] },
  { name: 'notification_templates', count: 21, build: () => [GET, rest('notification_templates', 'select=key,bell_title,bell_body')] },

  { name: 'conv_members_all_mine', count: 120, build: (c) => [GET, rest('conversation_members', `select=*&user_id=eq.${c.me}`)] },
  { name: 'conv_members_one', count: 73, build: (c) => [GET, rest('conversation_members', `select=*&conversation_id=eq.${c.conv}&user_id=eq.${c.me}`)] },
  { name: 'conv_members_last_read', count: 51, build: (c) => [GET, rest('conversation_members', `select=last_read_at&conversation_id=eq.${c.conv}&user_id=eq.${c.me}`)] },
  { name: 'conv_members_scoped', count: 111, build: (c) => [GET, rest('conversation_members', `select=conversation_id,last_read_at&user_id=eq.${c.me}&conversation_id=${inList(sample(c.convs, 1 + rnd(2)))}`)] },
  { name: 'conv_members_patch_read', count: 51, build: (c) => ['PATCH', rest('conversation_members', `conversation_id=eq.${c.conv}&user_id=eq.${c.me}`), { last_read_at: nowIso() }] },
  { name: 'conversations_trip_chat', count: 118, build: (c) => [GET, rest('conversations', `select=*&is_direct=eq.false&metadata->>trip_id=eq.${c.trip}&order=created_at.asc&limit=1`)] },
  { name: 'conversations_by_ids', count: 58, build: (c) => [GET, rest('conversations', `select=id,title,is_direct,metadata,created_by,created_at,updated_at&id=${inList(c.convs)}&order=updated_at.desc&offset=0&limit=51`)] },
  { name: 'messages_page', count: 109, build: (c) => [GET, rest('messages', `select=${MESSAGE_COLS}&conversation_id=eq.${c.conv}&order=created_at.desc&limit=31`)] },
  { name: 'messages_unread_scan', count: 67, build: (c) => [GET, rest('messages', `select=id,conversation_id,sender_id,created_at&conversation_id=${inList(c.convs)}&deleted=eq.false&sender_id=neq.${c.me}&created_at=gt.1970-01-01T00:00:00.000Z&limit=1000`)] },
  { name: 'messages_send', count: 4, build: (c) => ['POST', rest('messages', 'on_conflict=sender_id,client_id&select=*'), { conversation_id: c.conv, sender_id: c.me, body: 'load test message', type: 'text', client_id: uuid() }] },
  { name: 'message_reactions', count: 18, build: (c) => [GET, rest('message_reactions', `select=message_id,user_id,reaction,reacted_at&message_id=${inList([uuid(), uuid()])}`)] },
  { name: 'rpc_get_last_messages', count: 53, build: (c) => ['POST', rpc('get_last_messages_per_conversation'), { conv_ids: c.convs }] },
  { name: 'realtime_broadcast', count: 58, build: (c) => ['POST', `${BASE_URL}/realtime/v1/api/broadcast`, { messages: [{ topic: `messages:${c.conv}`, event: 'typing', payload: { userId: c.me, isTyping: true }, private: true }] }] },

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
  { name: 'user_activity_patch', count: 56, build: (c) => ['PATCH', rest('user_activity', `user_id=eq.${c.me}`), { last_seen_at: nowIso() }] },
  { name: 'surftrip_groups', count: 78, build: (c) => [GET, rest('surftrip_groups', `select=conversation_id,hero_image_url&conversation_id=${inList(sample(c.convs, 1 + rnd(4)))}`)] },
  { name: 'analytics_insert', count: 202, build: (c) => ['POST', rest('analytics_events'), { event_name: 'loadtest_event', user_id: c.me, properties: { source: 'k6' } }] },
];

// Apply the MIX=after assumptions to the weights.
function weightFor(e) {
  if (MIX === 'before') return e.count;
  if (e.name === 'auth_user') return e.count * AFTER_GET_USER_KEEP;
  if (AFTER_INBOX_SCOPED && e.name === 'conv_members_all_mine') return 0;
  if (AFTER_INBOX_SCOPED && e.name === 'conv_members_scoped') {
    return e.count + ENDPOINTS.find((x) => x.name === 'conv_members_all_mine').count;
  }
  if (e.bundle === 'trip') return e.count * AFTER_TRIP_BUNDLE_KEEP;
  return e.count;
}
const WEIGHTS = ENDPOINTS.map(weightFor);
const TOTAL_BEFORE = ENDPOINTS.reduce((s, e) => s + e.count, 0);
const TOTAL_NOW = WEIGHTS.reduce((s, w) => s + w, 0);
// Same user behaviour, fewer requests: the `after` rate shrinks with the mix.
const RATE = RATE_BEFORE * (TOTAL_NOW / TOTAL_BEFORE);
const CUMULATIVE = [];
WEIGHTS.reduce((s, w, i) => (CUMULATIVE[i] = s + w), 0);

function pickEndpoint() {
  const x = Math.random() * TOTAL_NOW;
  for (let i = 0; i < CUMULATIVE.length; i++) if (x < CUMULATIVE[i]) return ENDPOINTS[i];
  return ENDPOINTS[ENDPOINTS.length - 1];
}

// ------------------------------------------------------- k6 scenario ----
function toSeconds(d) {
  const m = String(d).match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/);
  if (!m) throw new Error(`Bad duration: ${d}`);
  return Number(m[1]) * { ms: 0.001, s: 1, m: 60, h: 3600 }[m[2]];
}

const stages = [];
const stepWindows = []; // [startSec, endSec, label] for the "hold" part of each step
let t = 0;
for (const target of STEPS) {
  stages.push({ duration: RAMP, target });
  t += toSeconds(RAMP);
  stages.push({ duration: HOLD, target });
  stepWindows.push([t, t + toSeconds(HOLD), `vus_${target}`]);
  t += toSeconds(HOLD);
}
stages.push({ duration: '15s', target: 0 });

function currentStep() {
  const s = exec.instance.currentTestRunDuration / 1000;
  for (const [a, b, label] of stepWindows) if (s >= a && s < b) return label;
  return 'ramp';
}

const serverErrors = new Rate('server_errors'); // 5xx or no response (timeouts)
const clientErrors = new Rate('client_errors'); // 4xx
const reqCount = new Counter('reqs');

const thresholds = {
  // Report only: thresholds never stop the run.
  http_req_duration: [{ threshold: 'p(95)<1000', abortOnFail: false }],
  server_errors: [{ threshold: 'rate<0.01', abortOnFail: false }],
};
for (const e of ENDPOINTS) {
  thresholds[`http_req_duration{endpoint:${e.name}}`] = [{ threshold: 'p(95)<1000', abortOnFail: false }];
  thresholds[`server_errors{endpoint:${e.name}}`] = [{ threshold: 'rate<0.01', abortOnFail: false }];
  thresholds[`reqs{endpoint:${e.name}}`] = ['count>=0'];
}
for (const [, , label] of stepWindows) {
  thresholds[`http_req_duration{step:${label}}`] = [{ threshold: 'p(95)<1000', abortOnFail: false }];
  thresholds[`server_errors{step:${label}}`] = [{ threshold: 'rate<0.01', abortOnFail: false }];
  thresholds[`reqs{step:${label}}`] = ['count>=0'];
}

export const options = {
  scenarios: {
    phones: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages,
      gracefulRampDown: '10s',
    },
  },
  thresholds,
  summaryTrendStats: ['med', 'p(95)', 'p(99)', 'max', 'count'],
  discardResponseBodies: true, // we only need status + timing
  userAgent: 'swellyo-loadtest-k6',
};

// ---------------------------------------------------------- per phone ----
function contextFor(vu) {
  const u = USERS[(vu - 1) % USERS.length];
  const trips = (u.trip_ids && u.trip_ids.length ? u.trip_ids : u.staff_trip_ids && u.staff_trip_ids.length ? u.staff_trip_ids : ENV_TRIPS) || [];
  const convs = [...(u.trip_conversation_ids || []), ...(u.dm_conversation_ids || [])];
  const peers = u.trip_member_ids && u.trip_member_ids.length
    ? u.trip_member_ids
    : USERS.slice(0, 25).map((x) => x.user_id).filter((id) => id !== u.user_id);
  return {
    me: u.user_id,
    token: u.access_token,
    trips: trips.length ? trips : ENV_TRIPS,
    convs: convs.length ? convs : ENV_CONVS,
    peers,
  };
}

let ctx = null;

export default function () {
  if (!ctx) {
    ctx = contextFor(exec.vu.idInTest);
    if (exec.vu.idInTest > USERS.length && exec.vu.iterationInScenario === 0) {
      console.warn(`VU ${exec.vu.idInTest} reuses a user: only ${USERS.length} tokens.`);
    }
    sleep(Math.random() * 5); // phones do not all start on the same tick
  }
  const step = currentStep();
  const c = {
    me: ctx.me,
    trips: ctx.trips,
    trip: ctx.trips[0] || pick(ctx.trips),
    convs: ctx.convs,
    conv: pick(ctx.convs),
    peers: ctx.peers,
  };

  // A phone fires a small burst at once (screen open / realtime refresh),
  // then waits. Average rate per phone = RATE requests per minute.
  const burst = 1 + rnd(MAX_BURST);
  const chosen = [];
  for (let i = 0; i < burst; i++) chosen.push(pickEndpoint());

  const batch = chosen.map((e) => {
    const [method, url, body] = e.build(c);
    const headers = {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ctx.token}`,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (e.head) headers.Prefer = 'count=exact';
    if (method === 'PATCH') headers.Prefer = 'return=minimal';
    return {
      method,
      url,
      body: body === undefined ? null : JSON.stringify(body),
      params: { headers, tags: { endpoint: e.name, name: e.name, step, mix: MIX }, timeout: '130s' },
    };
  });

  const responses = http.batch(batch);
  responses.forEach((res, i) => {
    const tags = { endpoint: chosen[i].name, step };
    reqCount.add(1, tags);
    serverErrors.add(res.status === 0 || res.status >= 500, tags);
    clientErrors.add(res.status >= 400 && res.status < 500, tags);
  });

  // Exponential think time keeps the average at RATE but lets requests cluster.
  const meanSeconds = (60 / RATE) * burst;
  sleep(-Math.log(1 - Math.random()) * meanSeconds);
}

// ------------------------------------------------------------- summary ----
function val(data, metric, stat) {
  const m = data.metrics[metric];
  return m && m.values && m.values[stat] !== undefined ? m.values[stat] : null;
}
const fmt = (n, d = 0) => (n === null || n === undefined ? '-' : Number(n).toFixed(d));
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

export function handleSummary(data) {
  const lines = [];
  lines.push(`\nSwellyo load test  label=${RUN_LABEL}  mix=${MIX}  rate=${fmt(RATE, 1)} req/phone/min  steps=${STEPS.join(',')}  hold=${HOLD}`);
  lines.push(`All requests: p50 ${fmt(val(data, 'http_req_duration', 'med'))} ms, p95 ${fmt(val(data, 'http_req_duration', 'p(95)'))} ms, ` +
    `server errors ${fmt(100 * (val(data, 'server_errors', 'rate') || 0), 2)}%, 4xx ${fmt(100 * (val(data, 'client_errors', 'rate') || 0), 2)}%`);

  lines.push('\nPer step (hold part only):');
  lines.push(`${pad('step', 10)}${lpad('reqs', 8)}${lpad('req/s', 8)}${lpad('p50 ms', 9)}${lpad('p95 ms', 9)}${lpad('p99 ms', 9)}${lpad('5xx %', 8)}`);
  const perStep = {};
  for (const [, , label] of stepWindows) {
    const n = val(data, `reqs{step:${label}}`, 'count');
    const row = {
      reqs: n,
      rps: n ? n / toSeconds(HOLD) : 0,
      p50: val(data, `http_req_duration{step:${label}}`, 'med'),
      p95: val(data, `http_req_duration{step:${label}}`, 'p(95)'),
      p99: val(data, `http_req_duration{step:${label}}`, 'p(99)'),
      err: val(data, `server_errors{step:${label}}`, 'rate'),
    };
    perStep[label] = row;
    lines.push(`${pad(label, 10)}${lpad(fmt(row.reqs), 8)}${lpad(fmt(row.rps, 1), 8)}${lpad(fmt(row.p50), 9)}${lpad(fmt(row.p95), 9)}${lpad(fmt(row.p99), 9)}${lpad(fmt(100 * (row.err || 0), 2), 8)}`);
  }

  const perEndpoint = ENDPOINTS.map((e) => ({
    endpoint: e.name,
    reqs: val(data, `reqs{endpoint:${e.name}}`, 'count') || 0,
    p50: val(data, `http_req_duration{endpoint:${e.name}}`, 'med'),
    p95: val(data, `http_req_duration{endpoint:${e.name}}`, 'p(95)'),
    max: val(data, `http_req_duration{endpoint:${e.name}}`, 'max'),
    err: val(data, `server_errors{endpoint:${e.name}}`, 'rate'),
  })).sort((a, b) => b.reqs - a.reqs);

  lines.push('\nPer endpoint (whole run, sorted by count):');
  lines.push(`${pad('endpoint', 36)}${lpad('reqs', 8)}${lpad('p50 ms', 9)}${lpad('p95 ms', 9)}${lpad('max ms', 9)}${lpad('5xx %', 8)}`);
  for (const r of perEndpoint) {
    if (!r.reqs) continue;
    lines.push(`${pad(r.endpoint, 36)}${lpad(fmt(r.reqs), 8)}${lpad(fmt(r.p50), 9)}${lpad(fmt(r.p95), 9)}${lpad(fmt(r.max), 9)}${lpad(fmt(100 * (r.err || 0), 2), 8)}`);
  }
  lines.push('\nThresholds (p95 < 1000 ms, 5xx < 1%) only report; they never stop the run.\n');

  const json = {
    label: RUN_LABEL,
    mix: MIX,
    rate_per_phone_per_min: RATE,
    steps: STEPS,
    hold: HOLD,
    finished_at: new Date().toISOString(),
    per_step: perStep,
    per_endpoint: perEndpoint,
  };
  return {
    stdout: lines.join('\n'),
    [`${RESULTS_DIR}/${RUN_LABEL}.json`]: JSON.stringify(json, null, 2),
  };
}
