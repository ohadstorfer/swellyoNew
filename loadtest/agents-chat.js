// loadtest/agents-chat.js  (k6)
//
// 15 fake travelers ("agents") chat in the REAL operator trip "El Salvador 26"
// in PRODUCTION while real people watch on their phones.
// Spec: loadtest/AGENTS_TEST_SPEC.md (section C). Setup: agents/setup.sql.
// Run it only through run-agents.sh.
//
// One VU = one agent, pinned to its own token: scenario wave1 -> agents
// 01-05, wave2 -> 06-10, wave3 -> 11-15 (exec.scenario.iterationInTest:
// one iteration per VU, so it numbers the VUs 0-4 inside each wave).
//
// Burst timeline: min 0-3: 5 agents, 3-6: 10, 6-20: 15, then a 2-minute
// quiet tail where agents only read (no writes at all).
//
// Each agent, like a phone with the trip chat open:
//   - one realtime websocket with the app's channels (as prod-chat.js);
//     a refused join is retried with backoff (1, 2, 5, 10 s)
//   - ~MSG_PER_MIN messages a minute (never two within 5 s), a "typing"
//     broadcast 1-3 s before each; inserted exactly like messagingService
//     (upsert on sender_id,client_id, then conversations.updated_at)
//   - ~25% of its messages are replies to a recent message (frozen
//     reply_to_snapshot, as the app builds it)
//   - reactions: REACT_SHARE of the agents' messages get one reaction from
//     one other agent (picked by hashing the message id, so the 15 VUs agree
//     without talking to each other)
//   - read marks: 2 s trailing debounce -> conversation_members update +
//     read_receipt broadcast
//   - inbox sync on every inbox_change (400 ms trailing debounce)
//   - real people: a message from Ohad or Shakes (REAL_PEOPLE) gets 1-3
//     agents answering within 5-20 s: one reply (with snapshot) and one or
//     two reactions
//   - gear: personal_gear_by_me every ~5 min; one claim per agent (a 4xx
//     because the item is full is expected and counted); GEAR_REQUESTS gear
//     requests in the whole run (default 0, max 6: agents 02, 04, 07, 09, 12,
//     14). Off by default: each one notifies every trip admin, and the
//     co-operators (Jake, Moshe) are kept out of the test for now.
//   - leaves every 3-6 min (socket closed 30-90 s), then reconnects, rejoins
//     and runs the catch-up (messages after the last one seen + inbox sync)
//   - background reads: the prod-chat.js "new app" mix, one agent's worth
//
// Allowed writes (anything else aborts the run BEFORE it is sent):
//   POST  messages                  this chat, sender_id = me, type text
//   PATCH conversations             this chat, only updated_at
//   POST  message_reactions         user_id = me, a message seen in this chat
//   PATCH conversation_members      me in this chat, only the read watermark
//   PATCH group_trip_participants   me in this trip, only personal_gear_by_me
//   POST  group_trip_gear_claims    me, an item of this trip, quantity 1
//   POST  group_trip_gear_requests  me, this trip
//   POST  /realtime/v1/api/broadcast typing / read_receipt on this chat, as me
//   POST  rpc/<read-only RPC>       the same read RPCs as prod-chat.js
//
// Safety stops: refused request (allowlist, or 401/403 on a write); rolling
// 60 s p95 > SLOW_MS or > 5% errors that lasts 60 s (per agent); whole-run
// thresholds; > 10% failed channel joins. Ctrl+C at any time.
//
// Env (set by run-agents.sh): BASE_URL, ANON_KEY, AGENT_TOKENS (15 tokens,
//   comma-separated, agent01 first), MODE=smoke|burst, BURST_MINUTES (22), MSG_PER_MIN (4),
//   REACT_SHARE (0.33), RATE_PER_MIN (25, background), SLOW_MS (2000),
//   GEAR_REQUESTS (0..6, default 0).

import http from 'k6/http';
import ws from 'k6/ws';
import { sleep } from 'k6';
import { Rate, Counter, Trend } from 'k6/metrics';
import exec from 'k6/execution';
import encoding from 'k6/encoding';

// --------------------------------------------------------------- config ----
const TRIP = '5c042bf4-18af-496c-a3e1-262bfa0a3efc';
const TRIP_TITLE = 'El Salvador 26';
const CONV = '5c88d382-39f9-4515-8c94-67137e722f89';
const AGENT_COUNT = 15;
const AGENT_PREFIX = '10ad7e57-0000-4000-8000-0000000000'; // + 01..15, see agents/setup.sql
const agentId = (n) => AGENT_PREFIX + String(n).padStart(2, '0');
const isAgent = (id) => typeof id === 'string' && id.indexOf(AGENT_PREFIX) === 0;
// The only real people the agents answer or reply to (rule C.6). Anyone else
// who writes is ignored (no reply, no reaction). For now Ohad and Shakes: Jake
// (d64eb3c7-a6d4-4523-91b8-8441fc0d1822) and Moshe
// (58d118be-ca84-452c-8fce-b3c4771427b2) are not answered here. Add them
// back here to bring them in.
const REAL_PEOPLE = {
  'ecaaa678-974a-4641-895a-12cf12e74599': 'Ohad',
  'b8597836-81f6-43ee-a424-001d85864b74': 'Shakes',
};

const BASE_URL = (__ENV.BASE_URL || '').replace(/\/+$/, '');
const ANON_KEY = __ENV.ANON_KEY || '';
const MODE = (__ENV.MODE || 'smoke').toLowerCase();
const MSG_PER_MIN = Number(__ENV.MSG_PER_MIN || 4);
const REACT_SHARE = Number(__ENV.REACT_SHARE || 0.33);
const RATE_BEFORE = Number(__ENV.RATE_PER_MIN || 25);
const SLOW_MS = Number(__ENV.SLOW_MS || 2000);
const SMOKE = MODE === 'smoke';

const URL_OK = __ENV.URL_PATTERN ? new RegExp(__ENV.URL_PATTERN) : /^https:\/\/[a-z0-9]+\.supabase\.co$/;
if (!URL_OK.test(BASE_URL)) throw new Error(`BASE_URL must be https://<ref>.supabase.co, got "${BASE_URL}"`);
if (!ANON_KEY) throw new Error('ANON_KEY is required. Use run-agents.sh.');
if (MODE !== 'smoke' && MODE !== 'burst') throw new Error('MODE must be smoke or burst');

// Tokens: one per agent, in order. Check each one is signed for the right id.
const TOKENS = (__ENV.AGENT_TOKENS || '').split(',').map((t) => t.trim()).filter(Boolean);
if (TOKENS.length !== AGENT_COUNT) throw new Error(`AGENT_TOKENS must hold ${AGENT_COUNT} tokens, got ${TOKENS.length}. Use run-agents.sh.`);
TOKENS.forEach((t, i) => {
  let claims;
  try { claims = JSON.parse(encoding.b64decode(t.split('.')[1], 'rawurl', 's')); } catch (e) { throw new Error(`token ${i + 1} is not a JWT`); }
  if (claims.sub !== agentId(i + 1)) throw new Error(`token ${i + 1} is for ${claims.sub}, expected ${agentId(i + 1)}`);
  if (claims.exp * 1000 < Date.now() + 5 * 60 * 1000) throw new Error(`token ${i + 1} expires in less than 5 minutes`);
});

const LINES = JSON.parse(open('./agents/lines.json'));
const WS_URL = BASE_URL.replace(/^http/, 'ws') + `/realtime/v1/websocket?apikey=${ANON_KEY}&vsn=1.0.0`;
const EMOJIS = ['🤙', '🔥', '😂', '❤️', '👍', '🌊'];

const MIN = 60 * 1000;
// BURST_MINUTES shortens the whole burst; waves and read-only tail scale with it.
const BURST_SCALE = Number(__ENV.BURST_MINUTES || 22) / 22;
// Burst: who starts when (ms after the test starts).
const WAVES = [
  { name: 'wave1', start: 0, first: 1 },
  { name: 'wave2', start: 3 * MIN * BURST_SCALE, first: 6 },
  { name: 'wave3', start: 6 * MIN * BURST_SCALE, first: 11 },
];
const WAVE_SIZE = 5;
const WRITE_END = SMOKE ? 75 * 1000 : 20 * MIN * BURST_SCALE; // after this: reads only
const END = SMOKE ? 75 * 1000 : 22 * MIN * BURST_SCALE;
const GEAR_REQUESTS = Math.max(0, Math.min(6, Number(__ENV.GEAR_REQUESTS || 0)));
const GEAR_REQUEST_AGENTS = [2, 4, 7, 9, 12, 14].slice(0, GEAR_REQUESTS);
const SMOKE_MESSAGES = 3;

const READ_RPCS = new Set([
  'get_last_messages_per_conversation', 'operator_trip_my_requirements', 'staff_my_requirements',
  'my_trip_capabilities', 'search_users_for_staff', 'explore_feed', 'my_trips_feed', 'get_blocked_by_ids',
]);

// ------------------------------------------------------------- helpers ----
const rnd = (n) => Math.floor(Math.random() * n);
const between = (a, b) => a + Math.random() * (b - a);
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
const rest = (table, qs) => `${BASE_URL}/rest/v1/${table}${qs ? `?${qs}` : ''}`;
const rpc = (fn) => `${BASE_URL}/rest/v1/rpc/${fn}`;
const BROADCAST_URL = `${BASE_URL}/realtime/v1/api/broadcast`;
const keysOnly = (obj, allowed) => !!obj && Object.keys(obj).every((k) => allowed.indexOf(k) !== -1);
// FNV-1a: every VU gets the same answer for the same message id.
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
// Postgres timestamps have 6 decimals; JS Date.parse wants 3.
function parseTs(s) {
  if (!s) return NaN;
  return Date.parse(String(s).replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1').replace(/\+00(:00)?$/, 'Z'));
}
function parseJson(res) {
  try { return JSON.parse(res.body); } catch (e) { return null; }
}

// Same select lists the app sends (from prod-chat.js).
const SURFER_SHORT = 'user_id,name,age,country_from,travel_experience,surfboard_type,surf_level_category,profile_image_url,lifestyle_keywords';
const SURFER_FULL = 'user_id,name,age,date_of_birth,pronoun,country_from,display_currency,surfboard_type,surf_level,surf_level_description,surf_level_category,travel_experience,bio,profile_image_url,cover_image_url,profile_video_url,profile_video_thumbnail_url,profile_photo_url,destinations_array,lifestyle_keywords,lifestyle_image_urls,wave_type_keywords,travel_buddies,home_break_place_id,home_break_full,home_break_short,home_break_locality,home_break_country,home_break_lat,home_break_lng,welcome_guide_seen_at,surftrips_tip_seen_at,created_at,updated_at,finished_onboarding';
const MESSAGE_COLS = 'id,conversation_id,sender_id,body,attachments,client_id,is_system,edited,deleted,created_at,updated_at,type,image_metadata,video_metadata,audio_metadata,commitment_metadata,file_metadata,contact_metadata,reply_to_message_id,reply_to_snapshot,message_reactions(user_id,reaction,reacted_at)';

// ------------------------------------------------- background read mix ----
// Copied from prod-chat.js (count = requests in the 30-minute production
// window, 18 users). Weighted with the same "new app" rules.
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
  { name: 'conv_members_scoped', count: 111, build: (c) => [GET, rest('conversation_members', `select=conversation_id,last_read_at&user_id=eq.${c.me}&conversation_id=${inList(c.convs)}`)] },
  { name: 'conversations_trip_chat', count: 118, build: (c) => [GET, rest('conversations', `select=*&is_direct=eq.false&metadata->>trip_id=eq.${c.trip}&order=created_at.asc&limit=1`)] },
  { name: 'conversations_by_ids', count: 58, build: (c) => [GET, rest('conversations', `select=id,title,is_direct,metadata,created_by,created_at,updated_at&id=${inList(c.convs)}&order=updated_at.desc&offset=0&limit=51`)] },
  { name: 'messages_page', count: 109, build: (c) => [GET, rest('messages', `select=${MESSAGE_COLS}&conversation_id=eq.${c.conv}&order=created_at.desc&limit=31`)] },
  { name: 'messages_unread_scan', count: 67, build: (c) => [GET, rest('messages', `select=id,conversation_id,sender_id,created_at&conversation_id=${inList(c.convs)}&deleted=eq.false&sender_id=neq.${c.me}&created_at=gt.1970-01-01T00:00:00.000Z&limit=1000`)] },
  { name: 'message_reactions', count: 18, build: () => [GET, rest('message_reactions', `select=message_id,user_id,reaction,reacted_at&message_id=${inList([uuid(), uuid()])}`)] },
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
  { name: 'surftrip_groups', count: 78, build: (c) => [GET, rest('surftrip_groups', `select=conversation_id,hero_image_url&conversation_id=${inList(c.convs)}`)] },
];

const AFTER_GET_USER_KEEP = 0.15;
const AFTER_TRIP_BUNDLE_KEEP = 0.7;
// These come from the inbox sync and the chat's own reads below, so they are
// left out of the background mix to avoid counting them twice.
const FROM_INBOX_SYNC = new Set([
  'conv_members_all_mine', 'conv_members_scoped', 'conversations_by_ids',
  'rpc_get_last_messages', 'messages_unread_scan', 'users_emails',
]);
function weightAfter(e) {
  if (FROM_INBOX_SYNC.has(e.name)) return 0;
  if (e.name === 'auth_user') return e.count * AFTER_GET_USER_KEEP;
  if (e.bundle === 'trip') return e.count * AFTER_TRIP_BUNDLE_KEEP;
  return e.count;
}
const TOTAL_BEFORE = ENDPOINTS.reduce((s, e) => s + e.count, 0);
const BG = ENDPOINTS.filter((e) => weightAfter(e) > 0);
const BG_W = BG.map(weightAfter);
const BG_TOTAL = BG_W.reduce((s, w) => s + w, 0);
const BG_RATE = RATE_BEFORE * (BG_TOTAL / TOTAL_BEFORE); // background req/agent/min
const BG_CUM = [];
BG_W.reduce((s, w, i) => (BG_CUM[i] = s + w), 0);
function pickBg() {
  const x = Math.random() * BG_TOTAL;
  for (let i = 0; i < BG_CUM.length; i++) if (x < BG_CUM[i]) return BG[i];
  return BG[BG.length - 1];
}
const poisson = (lambda) => {
  let k = 0, p = 1;
  const L = Math.exp(-lambda);
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
};

// --------------------------------------------------------------- metrics ----
const serverErrors = new Rate('server_errors');
const clientErrors = new Rate('client_errors');
const reqCount = new Counter('reqs');
const joinFailed = new Rate('join_failed');
const socketSessions = new Counter('socket_sessions');
const inboxEvents = new Counter('inbox_events');
const msgEvents = new Counter('message_events');
const msgSent = new Counter('messages_sent');
const repliesSent = new Counter('replies_sent');
const realRepliesSent = new Counter('real_people_replies_sent');
const reactionsSent = new Counter('reactions_sent');
const readMarks = new Counter('read_marks');
const typingSent = new Counter('typing_sent');
const gearUpdates = new Counter('gear_personal_updates');
const gearClaimsOk = new Counter('gear_claims_ok');
const gearClaimsFull = new Counter('gear_claims_full');
const gearRequestsSent = new Counter('gear_requests_sent');
const catchupMessages = new Counter('catchup_messages');
// Known production bug (28 Oct 2026): every non-service UPDATE on
// conversations fails with "infinite recursion detected in policy for
// relation conversations" (conversations_update_admin_or_creator ->
// conversation_members_select -> conversations). The app ignores the error
// (fire-and-forget), so real phones hit it too. Counted here, not as errors.
const touchKnown500 = new Counter('conversation_touch_known_500');
const rtDeliveryMs = new Trend('rt_delivery_ms', true); // new_message received - messages.created_at (server clock)
const ownDeliveryMs = new Trend('own_delivery_ms', true); // own insert sent -> own new_message back
const syncMs = new Trend('inbox_sync_ms', true);
const catchupMs = new Trend('catchup_ms', true);

// ------------------------------------------------------------ k6 options ----
const COMMON = {
  summaryTrendStats: ['med', 'p(95)', 'p(99)', 'max', 'count'],
  discardResponseBodies: true,
  userAgent: 'swellyo-loadtest-k6-agents',
  setupTimeout: '60s',
  // Never fail; they only make k6 print these per sender kind.
  thresholds: {
    'rt_delivery_ms{sender:agent}': ['p(95)<3600000'],
    'rt_delivery_ms{sender:real}': ['p(95)<3600000'],
  },
};
export const options = SMOKE
  ? Object.assign({}, COMMON, {
      scenarios: { smoke: { executor: 'per-vu-iterations', vus: 2, iterations: 1, maxDuration: '3m' } },
    })
  : Object.assign({}, COMMON, {
      scenarios: WAVES.reduce((acc, w) => {
        acc[w.name] = {
          executor: 'per-vu-iterations', vus: WAVE_SIZE, iterations: 1,
          startTime: `${Math.round(w.start / 1000)}s`, maxDuration: `${Math.round((END - w.start) / 1000) + 120}s`, gracefulStop: '30s',
        };
        return acc;
      }, {}),
      thresholds: Object.assign({}, COMMON.thresholds, {
        http_req_duration: [{ threshold: `p(95)<${SLOW_MS}`, abortOnFail: true, delayAbortEval: '1m' }],
        server_errors: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '1m' }],
        join_failed: [{ threshold: 'rate<0.1', abortOnFail: true, delayAbortEval: '30s' }],
      }),
    });

// ------------------------------------------------------------- the agent ----
// One VU = one agent, so per-agent state lives at module level.
let A = null;

function agentNumber() {
  // k6 has no per-scenario VU id; with 1 iteration per VU the scenario's
  // iteration number (0-based, unique in the scenario) does the same job.
  const k = exec.scenario.iterationInTest;
  if (SMOKE) return k + 1; // 1, 2
  const w = WAVES.find((x) => x.name === exec.scenario.name);
  return w.first + k;
}
// Agents that have started by `now` (used to agree on who reacts / replies).
function startedAgents(t0, now) {
  if (SMOKE) return [1, 2];
  const out = [];
  for (const w of WAVES) if (now - t0 >= w.start) for (let i = 0; i < WAVE_SIZE; i++) out.push(w.first + i);
  return out;
}

function refuse(why) {
  exec.test.abort(`REFUSED: ${why}`);
  throw new Error('refused');
}

function assertAllowed(method, url, body) {
  if (method === 'GET' || method === 'HEAD') return;
  const me = A.me;
  const rpcMatch = url.match(/\/rest\/v1\/rpc\/([a-z_]+)$/);
  if (method === 'POST' && rpcMatch && READ_RPCS.has(rpcMatch[1])) return;

  if (method === 'POST' && url === rest('messages', 'on_conflict=sender_id,client_id&select=*')) {
    if (body && body.conversation_id === CONV && body.sender_id === me && body.type === 'text'
      && typeof body.body === 'string' && body.body.length > 0 && Array.isArray(body.attachments) && body.attachments.length === 0
      && keysOnly(body, ['conversation_id', 'sender_id', 'body', 'attachments', 'type', 'client_id', 'reply_to_message_id', 'reply_to_snapshot'])
      && (!body.reply_to_message_id || (A.seen[body.reply_to_message_id] && body.reply_to_snapshot && body.reply_to_snapshot.message_id === body.reply_to_message_id))) return;
    refuse(`message not allowed: ${JSON.stringify(body)}`);
  }
  if (method === 'PATCH' && url === rest('conversations', `id=eq.${CONV}`)) {
    if (keysOnly(body, ['updated_at'])) return;
    refuse(`conversations update not allowed: ${JSON.stringify(body)}`);
  }
  if (method === 'POST' && url === rest('message_reactions', 'on_conflict=message_id,user_id')) {
    if (body && body.user_id === me && A.seen[body.message_id] && EMOJIS.indexOf(body.reaction) !== -1
      && keysOnly(body, ['message_id', 'user_id', 'reaction', 'reacted_at'])) return;
    refuse(`reaction not allowed: ${JSON.stringify(body)}`);
  }
  if (method === 'PATCH' && url === rest('conversation_members', `conversation_id=eq.${CONV}&user_id=eq.${me}`)) {
    if (keysOnly(body, ['last_read_message_id', 'last_read_at'])) return;
    refuse(`read mark not allowed: ${JSON.stringify(body)}`);
  }
  if (method === 'PATCH' && url === rest('group_trip_participants', `trip_id=eq.${TRIP}&user_id=eq.${me}`)) {
    if (keysOnly(body, ['personal_gear_by_me']) && Array.isArray(body.personal_gear_by_me)) return;
    refuse(`participant update not allowed: ${JSON.stringify(body)}`);
  }
  if (method === 'POST' && url === rest('group_trip_gear_claims', 'on_conflict=item_id,user_id&select=*')) {
    if (body && body.user_id === me && body.quantity === 1 && A.items.indexOf(body.item_id) !== -1
      && keysOnly(body, ['item_id', 'user_id', 'quantity'])) return;
    refuse(`gear claim not allowed: ${JSON.stringify(body)}`);
  }
  if (method === 'POST' && url === rest('group_trip_gear_requests', 'select=*')) {
    if (body && body.trip_id === TRIP && body.requester_id === me
      && keysOnly(body, ['trip_id', 'requester_id', 'item_name', 'needed_qty', 'note'])) return;
    refuse(`gear request not allowed: ${JSON.stringify(body)}`);
  }
  if (method === 'POST' && url === BROADCAST_URL) {
    const msgs = (body && body.messages) || [];
    if (msgs.length && msgs.every((m) => m.topic === `messages:${CONV}`
      && (m.event === 'typing' || m.event === 'read_receipt') && m.payload && m.payload.userId === me)) return;
    refuse(`broadcast not allowed: ${JSON.stringify(body)}`);
  }
  refuse(`${method} ${url}`);
}

// Rolling 60 s window per agent: stop when p95 or errors stay bad for 60 s.
const win = [];
let badSince = 0;
function safety(duration, isErr) {
  const now = Date.now();
  win.push([now, duration, isErr]);
  while (win.length && win[0][0] < now - MIN) win.shift();
  if (win.length < 20) { badSince = 0; return; }
  const sorted = win.map((x) => x[1]).sort((a, b) => a - b);
  const p95 = sorted[Math.floor(0.95 * (sorted.length - 1))];
  const errRate = win.filter((x) => x[2]).length / win.length;
  if (p95 <= SLOW_MS && errRate <= 0.05) { badSince = 0; return; }
  if (!badSince) { badSince = now; return; }
  if (now - badSince >= MIN) {
    exec.test.abort(`AUTO-STOP (agent ${A.n}): 60 s window p95=${Math.round(p95)}ms errors=${Math.round(errRate * 100)}% for 60 s`);
  }
}

function track(res, r) {
  const tags = { endpoint: r.name };
  if (r.known500 && res.status === 500) {
    touchKnown500.add(1);
    reqCount.add(1, tags);
    if (SMOKE) console.log(`agent${String(A.n).padStart(2, '0')} KNOWN 500 ${String(Math.round(res.timings.duration)).padStart(6)} ms  ${r.name} (policy recursion bug)`);
    return;
  }
  const isErr = res.status === 0 || res.status >= 500 || res.status === 429;
  const is4xx = res.status >= 400 && res.status < 500 && res.status !== 429;
  reqCount.add(1, tags);
  serverErrors.add(isErr, tags);
  // A full gear item answers 4xx on purpose: counted, not an error.
  clientErrors.add(is4xx && !r.expect4xx, tags);
  if (r.method !== 'GET' && r.method !== 'HEAD' && !READ_RPCS.has((r.url.match(/\/rpc\/([a-z_]+)$/) || [])[1])
    && (res.status === 401 || res.status === 403)) {
    exec.test.abort(`REFUSED by the server: ${res.status} on ${r.name} (agent ${A.n})`);
  }
  if (res.status === 401) exec.test.abort(`REFUSED by the server: 401 on ${r.name} (agent ${A.n}) - token problem`);
  if (SMOKE) {
    console.log(`agent${String(A.n).padStart(2, '0')} ${res.status >= 200 && res.status < 300 ? 'OK ' : 'BAD'} ${String(res.status).padStart(3)} ${String(Math.round(res.timings.duration)).padStart(6)} ms  ${r.name}`);
    return;
  }
  safety(res.timings.duration, isErr);
}

function headers(json) {
  const h = { apikey: ANON_KEY, Authorization: `Bearer ${A.token}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

// Sends a list of {name, method, url, body, prefer, parse, expect4xx} at once.
function run(reqs) {
  const batch = reqs.map((r) => {
    assertAllowed(r.method, r.url, r.body);
    const h = headers(r.body !== undefined);
    if (r.prefer) h.Prefer = r.prefer;
    const params = { headers: h, tags: { endpoint: r.name, name: r.name }, timeout: '30s' };
    if (r.parse) params.responseType = 'text';
    return { method: r.method, url: r.url, body: r.body === undefined ? null : JSON.stringify(r.body), params };
  });
  const res = http.batch(batch);
  res.forEach((x, i) => track(x, reqs[i]));
  return res;
}
const one = (r) => run([r])[0];

function ctx() {
  return { me: A.me, trip: TRIP, trips: [TRIP], conv: CONV, convs: [CONV], peers: A.members };
}

function backgroundBurst(n) {
  const c = ctx();
  const reqs = [];
  for (let i = 0; i < n; i++) {
    const e = pickBg();
    const [method, url, body] = e.build(c);
    reqs.push({ name: e.name, method, url, body, prefer: e.head ? 'count=exact' : undefined });
  }
  if (reqs.length) run(reqs);
}

// --------------------------------------------------------- chat helpers ----
// Remember a message from this chat (for replies, reactions, catch-up).
function remember(row) {
  if (!row || !row.id || (row.conversation_id && row.conversation_id !== CONV)) return;
  A.seen[row.id] = true;
  if (!row.is_system && !row.deleted && (row.type || 'text') === 'text' && row.body) {
    A.recent.push({ id: row.id, sender_id: row.sender_id, body: row.body });
    if (A.recent.length > 12) A.recent.shift();
  }
  const t = parseTs(row.created_at);
  if (!A.lastSeen || t >= A.lastSeen.t) A.lastSeen = { id: row.id, created_at: row.created_at, t };
  if (row.sender_id && !(row.sender_id in A.names)) A.unknownSenders[row.sender_id] = true;
}

// Names for reply snapshots (the app's senderNamesById).
function learnNames(ids) {
  if (!ids.length) return;
  const r = one({ name: 'chat_sender_names', method: 'GET', url: rest('surfers', `select=user_id,name&user_id=${inList(ids)}`), parse: true });
  ids.forEach((id) => { A.names[id] = ''; });
  (parseJson(r) || []).forEach((s) => { A.names[s.user_id] = s.name || ''; });
}

// The app's inbox sync for this chat (getConversationsUpdatedSince, restricted
// mode): 8 requests in 4 rounds. Same as prod-chat.js, with the real members.
function inboxSync() {
  const t0 = Date.now();
  const me = A.me;
  const ids = [CONV];
  const memberIds = A.members.slice(0, 50);
  run([{ name: 'sync_memberships_scoped', method: 'GET', url: rest('conversation_members', `select=*&user_id=eq.${me}&conversation_id=${inList(ids)}`) }]);
  run([{ name: 'sync_conversations', method: 'GET', url: rest('conversations', `select=id,title,is_direct,metadata,created_by,created_at,updated_at&id=${inList(ids)}&id=${inList(ids)}&order=updated_at.desc`) }]);
  run([
    { name: 'sync_rpc_last_messages', method: 'POST', url: rpc('get_last_messages_per_conversation'), body: { conv_ids: ids } },
    { name: 'sync_all_members', method: 'GET', url: rest('conversation_members', `select=*&conversation_id=${inList(ids)}`) },
    { name: 'sync_my_read_state', method: 'GET', url: rest('conversation_members', `select=conversation_id,last_read_at&user_id=eq.${me}&conversation_id=${inList(ids)}`) },
  ]);
  run([
    { name: 'sync_users', method: 'GET', url: rest('users', `select=id,email&id=${inList(memberIds)}`) },
    { name: 'sync_surfers', method: 'GET', url: rest('surfers', `select=user_id,name,profile_image_url&user_id=${inList(memberIds)}`) },
    { name: 'sync_unread_scan', method: 'GET', url: rest('messages', `select=id,conversation_id,sender_id,created_at&conversation_id=${inList(ids)}&deleted=eq.false&sender_id=neq.${me}&created_at=gt.${new Date(Date.now() - 86400000).toISOString()}&limit=1000`) },
  ]);
  syncMs.add(Date.now() - t0);
}

// Back from the background: the messages after the last one seen (as
// getMessages(afterMessageId) does: look up its created_at, then page
// ascending), then the inbox sync.
function catchUp() {
  const t0 = Date.now();
  if (A.lastSeen) {
    one({ name: 'catchup_cursor', method: 'GET', url: rest('messages', `select=created_at&id=eq.${A.lastSeen.id}`) });
    const r = one({ name: 'catchup_messages', method: 'GET', parse: true,
      url: rest('messages', `select=${MESSAGE_COLS}&conversation_id=eq.${CONV}&order=created_at.asc&limit=51&created_at=gt.${encodeURIComponent(A.lastSeen.created_at)}`) });
    const rows = parseJson(r) || [];
    catchupMessages.add(rows.length);
    rows.forEach(remember);
  }
  inboxSync();
  catchupMs.add(Date.now() - t0);
}

function threadLine() {
  const threads = LINES.threads;
  const thread = threads[Math.floor((Date.now() - A.t0) / (2 * MIN)) % threads.length];
  let line = pick(thread.lines);
  if (line === A.lastLine) line = pick(thread.lines);
  A.lastLine = line;
  return line;
}

const MEDIA_LABEL = { image: 'Photo', video: 'Video', audio: 'Voice message' };
function snapshotOf(msg) {
  return { message_id: msg.id, sender_id: msg.sender_id, sender_name: A.names[msg.sender_id] || '', type: 'text', body: msg.body };
}

// What to send next: a queued answer to a real person first, else a normal
// line (25% of them replies to a recent message from someone else).
function nextItem(now) {
  const due = A.queue.findIndex((q) => q.kind === 'reply' && q.at <= now);
  if (due !== -1) return A.queue.splice(due, 1)[0];
  if (now < A.nextSendAt) return null;
  if (SMOKE && A.smokeSent >= SMOKE_MESSAGES) return null;
  // Reply only to agents and REAL_PEOPLE (never quote someone kept out).
  const others = A.recent.filter((m) => m.sender_id !== A.me && (isAgent(m.sender_id) || REAL_PEOPLE[m.sender_id])).slice(-8);
  if (!SMOKE && others.length && Math.random() < 0.25) {
    const target = pick(others);
    return { kind: 'line', body: Math.random() < 0.6 ? pick(LINES.replies) : threadLine(), replyTo: snapshotOf(target) };
  }
  return { kind: 'line', body: threadLine() };
}

function sendTyping() {
  one({ name: 'typing_broadcast', method: 'POST', url: BROADCAST_URL,
    body: { messages: [{ topic: `messages:${CONV}`, event: 'typing', payload: { userId: A.me, isTyping: true }, private: true }] } });
  typingSent.add(1);
}

function sendMessage(item) {
  const clientId = uuid();
  const body = { conversation_id: CONV, sender_id: A.me, body: item.body, attachments: [], type: 'text', client_id: clientId };
  if (item.replyTo) {
    body.reply_to_message_id = item.replyTo.message_id;
    body.reply_to_snapshot = item.replyTo;
  }
  A.sentAt[clientId] = Date.now();
  one({ name: 'message_send', method: 'POST', url: rest('messages', 'on_conflict=sender_id,client_id&select=*'),
    prefer: 'resolution=ignore-duplicates,return=representation', body });
  one({ name: 'conversation_touch', method: 'PATCH', url: rest('conversations', `id=eq.${CONV}`),
    prefer: 'return=minimal', known500: true, body: { updated_at: new Date().toISOString() } });
  msgSent.add(1);
  if (item.replyTo) repliesSent.add(1);
  if (item.real) realRepliesSent.add(1);
  if (SMOKE) A.smokeSent++;
}

function react(messageId) {
  if (!A.seen[messageId]) return;
  one({ name: 'reaction_set', method: 'POST', url: rest('message_reactions', 'on_conflict=message_id,user_id'),
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { message_id: messageId, user_id: A.me, reaction: pick(EMOJIS), reacted_at: new Date().toISOString() } });
  reactionsSent.add(1);
}

function markRead() {
  if (!A.lastSeen) return;
  const lastReadAt = new Date().toISOString();
  one({ name: 'read_mark', method: 'PATCH', prefer: 'return=minimal',
    url: rest('conversation_members', `conversation_id=eq.${CONV}&user_id=eq.${A.me}`),
    body: { last_read_message_id: A.lastSeen.id, last_read_at: lastReadAt } });
  one({ name: 'read_receipt_broadcast', method: 'POST', url: BROADCAST_URL,
    body: { messages: [{ topic: `messages:${CONV}`, event: 'read_receipt', payload: { userId: A.me, lastReadAt }, private: true }] } });
  readMarks.add(1);
}

function updatePersonalGear() {
  if (!A.gear.length || (Math.random() < 0.5 && A.gear.length < 8)) {
    const next = LINES.personal_gear.find((g) => !A.gear.some((x) => x.name === g));
    if (next) A.gear.push({ name: next, done: false });
  } else {
    const item = pick(A.gear);
    item.done = !item.done;
  }
  one({ name: 'gear_personal_update', method: 'PATCH', prefer: 'return=minimal',
    url: rest('group_trip_participants', `trip_id=eq.${TRIP}&user_id=eq.${A.me}`),
    body: { personal_gear_by_me: A.gear.map((g) => ({ name: g.name, done: g.done })) } });
  gearUpdates.add(1);
}

function claimGear() {
  const item = pick(A.items);
  if (!item) return;
  const r = one({ name: 'gear_claim', method: 'POST', url: rest('group_trip_gear_claims', 'on_conflict=item_id,user_id&select=*'),
    prefer: 'resolution=merge-duplicates,return=representation', expect4xx: true,
    body: { item_id: item, user_id: A.me, quantity: 1 } });
  if (r.status >= 200 && r.status < 300) gearClaimsOk.add(1);
  else if (r.status >= 400 && r.status < 500) gearClaimsFull.add(1);
}

function requestGear() {
  const req = LINES.gear_requests[GEAR_REQUEST_AGENTS.indexOf(A.n)];
  if (!req) return;
  one({ name: 'gear_request', method: 'POST', url: rest('group_trip_gear_requests', 'select=*'), prefer: 'return=representation',
    body: { trip_id: TRIP, requester_id: A.me, item_name: req.item_name, needed_qty: 1, note: req.note } });
  gearRequestsSent.add(1);
}

// A new message in the chat: decide (the same way in every VU) who reacts
// and who answers.
function onChatMessage(row, now) {
  if (!row.id || row.sender_id === A.me || row.is_system) return;
  const started = startedAgents(A.t0, now);
  if (isAgent(row.sender_id)) {
    if (SMOKE) {
      // Smoke: agent02 reacts once, to the first agent01 message it sees.
      if (A.n === 2 && !A.smokeReacted) { A.smokeReacted = true; A.queue.push({ kind: 'react', id: row.id, at: now + 2000 }); }
      return;
    }
    if (hash(row.id + ':r') % 1000 >= REACT_SHARE * 1000) return;
    const candidates = started.filter((n) => agentId(n) !== row.sender_id);
    if (candidates[hash(row.id + ':who') % candidates.length] === A.n) {
      A.queue.push({ kind: 'react', id: row.id, at: now + between(1000, 6000) });
    }
    return;
  }
  // A real person (only Ohad, Jake, Moshe).
  if (!REAL_PEOPLE[row.sender_id] || SMOKE || now - A.t0 >= WRITE_END) return;
  const k = 1 + (hash(row.id + ':k') % 3);
  const chosen = started.slice().sort((a, b) => hash(row.id + ':' + a) - hash(row.id + ':' + b)).slice(0, k);
  const role = chosen.indexOf(A.n);
  if (role === -1) return;
  const at = now + between(5000, 20000);
  if (role === 0) {
    A.queue.push({ kind: 'reply', at, real: true, body: pick(LINES.real_replies),
      replyTo: { message_id: row.id, sender_id: row.sender_id, sender_name: A.names[row.sender_id] || '', type: row.type || 'text', body: MEDIA_LABEL[row.type] || row.body || '' } });
  }
  if (role > 0 || k === 1) A.queue.push({ kind: 'react', id: row.id, at: at + between(500, 3000) });
}

// ------------------------------------------------------------ the socket ----
function channels(me) {
  return [
    { topic: `user-inbox:${me}`, priv: true },
    { topic: `user-trips:${me}`, priv: true },
    { topic: `trips-mine:${me}`, priv: true },
    { topic: 'trips-list', priv: true },
    { topic: `trip:${TRIP}`, priv: true },
    { topic: `messages:${CONV}`, priv: true },
    { topic: `reactions:${CONV}`, priv: true },
    { topic: `notifications-hub:${me}`, priv: false, pg: [
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${me}` },
      { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${me}` },
    ] },
  ];
}
const JOIN_BACKOFF = [1000, 2000, 5000, 10000];

function session(isReturn, lifetimeMs) {
  socketSessions.add(1);
  // A phone that was away does not answer messages from minutes ago.
  A.queue = A.queue.filter((q) => q.at > Date.now() - 30000);
  const chans = channels(A.me);
  const joinRefs = {};
  let ref = 0;
  let inboxPending = false;
  let lastInboxAt = 0;
  let readPending = false;
  let sending = false;
  const seenStats = { joinsOk: 0, joinsBad: 0, inbox: 0, message: 0 };

  const res = ws.connect(WS_URL, { tags: { endpoint: 'ws' } }, (socket) => {
    const send = (topic, event, payload) => {
      ref += 1;
      socket.send(JSON.stringify({ topic, event, payload, ref: String(ref) }));
      return String(ref);
    };
    const join = (ch, attempt) => {
      const config = { broadcast: { ack: false, self: false }, presence: { key: '', enabled: false }, private: ch.priv };
      if (ch.pg) config.postgres_changes = ch.pg;
      joinRefs[send(`realtime:${ch.topic}`, 'phx_join', { config, access_token: A.token })] = { ch, attempt };
    };
    const writesOpen = () => Date.now() - A.t0 < WRITE_END;

    // Trailing debounces (k6 sockets have no clearTimeout).
    const inboxCheck = () => {
      const wait = 400 - (Date.now() - lastInboxAt);
      if (wait > 0) { socket.setTimeout(inboxCheck, wait); return; }
      inboxPending = false;
      inboxSync();
    };

    socket.on('open', () => {
      chans.forEach((ch) => join(ch, 0));
      socket.setInterval(() => send('phoenix', 'heartbeat', {}), 25000);
      if (!SMOKE) socket.setInterval(() => backgroundBurst(poisson(BG_RATE * 3 / 60)), 3000);

      // The agent's clock: one tick a second.
      socket.setInterval(() => {
        const now = Date.now();
        if (!writesOpen()) return;

        // Reactions that are due.
        for (let i = A.queue.length - 1; i >= 0; i--) {
          const q = A.queue[i];
          if (q.kind === 'react' && q.at <= now) { A.queue.splice(i, 1); react(q.id); }
        }

        // Messages: typing first, the message 1-3 s later, >= 5 s apart.
        if (!sending && now - A.lastSentAt >= 5000) {
          const item = nextItem(now);
          if (item) {
            sending = true;
            sendTyping();
            socket.setTimeout(() => {
              sending = false;
              if (!writesOpen()) return;
              sendMessage(item);
              A.lastSentAt = Date.now();
              if (item.kind === 'line') {
                A.nextSendAt = A.lastSentAt + (SMOKE ? 8000 : 5000 + -Math.log(1 - Math.random()) * Math.max(1000, 60000 / MSG_PER_MIN - 7000));
              }
            }, between(1000, 3000));
          }
        }

        // Gear.
        if (A.nextGearAt && now >= A.nextGearAt) {
          A.nextGearAt = SMOKE ? 0 : now + between(4 * MIN, 6 * MIN);
          updatePersonalGear();
        }
        if (A.claimAt && now >= A.claimAt) { A.claimAt = 0; claimGear(); }
        if (A.requestAt && now >= A.requestAt) { A.requestAt = 0; requestGear(); }
      }, 1000);

      socket.setTimeout(() => socket.close(), lifetimeMs);
    });

    socket.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch (e) { return; }

      if (m.event === 'phx_reply' && joinRefs[m.ref]) {
        const { ch, attempt } = joinRefs[m.ref];
        delete joinRefs[m.ref];
        const ok = m.payload && m.payload.status === 'ok';
        joinFailed.add(!ok, { channel: ch.topic.split(':')[0] });
        if (ok) seenStats.joinsOk++; else seenStats.joinsBad++;
        if (SMOKE) console.log(`agent${String(A.n).padStart(2, '0')} ${ok ? 'OK ' : 'BAD'} join ${ch.topic}${ok ? '' : ' ' + JSON.stringify(m.payload)}`);
        if (!ok && attempt < JOIN_BACKOFF.length) socket.setTimeout(() => join(ch, attempt + 1), JOIN_BACKOFF[attempt]);
        // Back from the background: catch up once the chat channel is in.
        if (ok && isReturn && ch.topic === `messages:${CONV}`) catchUp();
        return;
      }
      if (m.event !== 'broadcast' || !m.payload) return;
      const ev = m.payload.event;
      const now = Date.now();

      if (ev === 'inbox_change' && m.topic === `realtime:user-inbox:${A.me}`) {
        inboxEvents.add(1);
        seenStats.inbox++;
        lastInboxAt = now;
        if (!inboxPending) { inboxPending = true; socket.setTimeout(inboxCheck, 400); }
      } else if (ev === 'new_message' && m.topic === `realtime:messages:${CONV}`) {
        msgEvents.add(1);
        seenStats.message++;
        const row = (m.payload.payload && m.payload.payload.message) || {};
        const created = parseTs(row.created_at);
        if (!isNaN(created)) rtDeliveryMs.add(now - created, { sender: isAgent(row.sender_id) ? 'agent' : 'real' });
        if (row.client_id && A.sentAt[row.client_id]) {
          ownDeliveryMs.add(now - A.sentAt[row.client_id]);
          delete A.sentAt[row.client_id];
        }
        remember(row);
        // Someone new in the chat (a real person joined mid-test).
        if (row.sender_id && A.members.indexOf(row.sender_id) === -1) A.members.push(row.sender_id);
        const unknown = Object.keys(A.unknownSenders);
        if (unknown.length) { A.unknownSenders = {}; learnNames(unknown); }
        onChatMessage(row, now);
        // readWatermarkQueue: 2 s trailing debounce.
        if (row.sender_id !== A.me && !readPending && writesOpen()) {
          readPending = true;
          socket.setTimeout(() => { readPending = false; if (writesOpen()) markRead(); }, 2000);
        }
      }
    });

    socket.on('error', (e) => {
      if (SMOKE) console.log(`agent${String(A.n).padStart(2, '0')} BAD websocket error: ${e.error()}`);
    });
  });

  if (!res || res.status !== 101) {
    joinFailed.add(true, { channel: 'socket' });
    console.log(`agent${String(A.n).padStart(2, '0')} BAD websocket connect status=${res && res.status}`);
  }
  return seenStats;
}

// ------------------------------------------------------------- lifecycle ----
// Runs once, as agent01: the trip and its chat must be the right ones.
export function setup() {
  A = { n: 1, me: agentId(1), token: TOKENS[0], seen: {}, items: [] };
  const t = one({ name: 'setup_trip', method: 'GET', parse: true, url: rest('group_trips', `select=id,title&id=eq.${TRIP}`) });
  const trip = (parseJson(t) || [])[0];
  if (!trip || trip.title !== TRIP_TITLE) exec.test.abort(`REFUSED: trip ${TRIP} is not "${TRIP_TITLE}" (got ${JSON.stringify(trip)}). Was setup.sql run?`);
  const c = one({ name: 'setup_trip_chat', method: 'GET', parse: true,
    url: rest('conversations', `select=id&is_direct=eq.false&metadata->>trip_id=eq.${TRIP}&order=created_at.asc&limit=1`) });
  const conv = (parseJson(c) || [])[0];
  if (!conv || conv.id !== CONV) exec.test.abort(`REFUSED: the trip chat is ${JSON.stringify(conv)}, expected ${CONV}`);
  return { t0: Date.now() };
}

export default function (data) {
  const n = agentNumber();
  if (!(n >= 1 && n <= AGENT_COUNT) || !TOKENS[n - 1]) {
    exec.test.abort(`REFUSED: bad agent number ${n} (scenario ${exec.scenario.name}, iteration ${exec.scenario.iterationInTest})`);
    return;
  }
  const now0 = Date.now();
  A = {
    n, me: agentId(n), token: TOKENS[n - 1], t0: data.t0,
    seen: {}, recent: [], lastSeen: null, members: [], names: {}, unknownSenders: {}, items: [],
    queue: [], sentAt: {}, gear: [], lastLine: null,
    lastSentAt: 0, nextSendAt: now0 + (SMOKE ? 4000 + (n - 1) * 2000 : between(2000, 15000)),
    nextGearAt: SMOKE ? (n === 1 ? now0 + 30000 : 0) : now0 + between(1 * MIN, 4 * MIN),
    claimAt: SMOKE ? 0 : now0 + between(1 * MIN, 10 * MIN),
    requestAt: 0, smokeSent: 0, smokeReacted: false,
  };
  if (!SMOKE && GEAR_REQUEST_AGENTS.indexOf(n) !== -1) {
    const from = Math.max(now0 + MIN, data.t0 + 2 * MIN);
    A.requestAt = between(from, Math.max(from + MIN, data.t0 + 15 * MIN));
  }

  // Opening the trip chat: members, their names, gear items, last page.
  const [mem, items, page] = run([
    { name: 'chat_members', method: 'GET', parse: true, url: rest('conversation_members', `select=user_id,left_at&conversation_id=eq.${CONV}`) },
    { name: 'gear_items_ids', method: 'GET', parse: true, url: rest('group_trip_gear_items', `select=id&trip_id=eq.${TRIP}`) },
    { name: 'messages_page_open', method: 'GET', parse: true, url: rest('messages', `select=${MESSAGE_COLS}&conversation_id=eq.${CONV}&order=created_at.desc&limit=31`) },
  ]);
  const members = parseJson(mem) || [];
  if (!members.some((r) => r.user_id === A.me && !r.left_at)) {
    exec.test.abort(`REFUSED: agent ${n} (${A.me}) is not an active member of the trip chat. Run agents/setup.sql first.`);
    return;
  }
  A.members = members.filter((r) => !r.left_at).map((r) => r.user_id);
  A.items = (parseJson(items) || []).map((r) => r.id);
  (parseJson(page) || []).slice().reverse().forEach(remember);
  learnNames(A.members.concat(Object.keys(A.unknownSenders).filter((id) => A.members.indexOf(id) === -1)));
  A.unknownSenders = {};

  let sessions = 0;
  const totals = { joinsOk: 0, joinsBad: 0, inbox: 0, message: 0 };
  while (Date.now() - A.t0 < END) {
    const left = A.t0 + END - Date.now();
    const lifetime = SMOKE ? left : Math.min(between(3 * MIN, 6 * MIN), left);
    const s = session(sessions > 0, lifetime);
    Object.keys(totals).forEach((k) => { totals[k] += s[k]; });
    sessions++;
    if (SMOKE) break;
    // In the background for 30-90 s.
    const off = between(30000, 90000);
    if (Date.now() + off >= A.t0 + END) break;
    sleep(off / 1000);
  }

  if (SMOKE) {
    const chans = channels(A.me).length;
    const ok = totals.joinsBad === 0 && totals.joinsOk === chans && A.smokeSent === SMOKE_MESSAGES && totals.message > 0 && totals.inbox > 0;
    console.log(`SMOKE agent${String(n).padStart(2, '0')}: joins ok=${totals.joinsOk}/${chans}, joins refused (then retried)=${totals.joinsBad}, messages sent=${A.smokeSent}/${SMOKE_MESSAGES}, chat events=${totals.message}, inbox events=${totals.inbox}${n === 2 ? `, reacted=${A.smokeReacted}` : ''} -> ${ok ? 'ALL OK' : 'NOT OK'}`);
  }
}
