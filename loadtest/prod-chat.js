// loadtest/prod-chat.js  (k6)
//
// Chat + realtime load test against PRODUCTION, with the NEW app's request
// mix (after the 21 Oct 2026 OTA). See docs/load-test-slowness-2026-10-21.md.
//
// Every virtual phone is the SAME account (the person running it) and all
// messages go to ONE test conversation whose only member is that account.
// So: no push (send-push-notification skips the sender and finds no one
// else), no in-app banner (own messages never banner), no analytics row
// (first_message_sent already exists; group chats stop there).
//
// Because every phone listens on the same user-inbox topic, each message
// wakes ALL phones at once — the same fan-out as a 20-person group chat.
//
// Each phone:
//   - holds one realtime websocket with the channels the app opens:
//     user-inbox, user-trips, trips-mine, trips-list, trip:<id>,
//     messages:<test chat>, reactions:<test chat>, and the notifications
//     postgres_changes listener (INSERT + UPDATE)
//   - on every inbox_change: runs the app's inbox sync
//     (getConversationsUpdatedSince, restricted mode — 8 requests, 4 rounds)
//   - on every new_message in the open test chat: one read mark 2 s later
//     (debounced, like readWatermarkQueue)
//   - sends a "typing" broadcast, then a message, MSG_PER_MIN times a minute
//   - in the background: the read-only screen mix with the NEW app weights
//   - reconnects its socket every SOCKET_MINUTES (app resume / reconnect)
//
// Allowed writes (anything else aborts the run before it is sent):
//   - POST /rest/v1/messages            only into the test chat, as `me`
//   - PATCH /rest/v1/conversation_members only `me` in the test chat
//   - POST /realtime/v1/api/broadcast   only "typing" on the test chat topic
//
// Safety stops: same as prod-readonly.js (refused request, rolling p95 >
// SLOW_MS or > 5% errors per phone, whole-run thresholds), plus > 10%
// failed channel joins.
//
// Env (set by run-prod.sh): BASE_URL, ANON_KEY, TOKEN, CONTEXT_FILE,
//   MODE=smoke|load, STEPS (default 20,30,50), HOLDS (default 15m,5m,5m),
//   RATE_PER_MIN (old-app rate, default 25), MSG_PER_MIN (default 0.5),
//   SOCKET_MINUTES (default 4), SLOW_MS (default 1500).

import http from 'k6/http';
import ws from 'k6/ws';
import { sleep } from 'k6';
import { Rate, Counter, Trend } from 'k6/metrics';
import exec from 'k6/execution';

const BASE_URL = (__ENV.BASE_URL || '').replace(/\/+$/, '');
const ANON_KEY = __ENV.ANON_KEY || '';
const TOKEN = __ENV.TOKEN || '';
const MODE = (__ENV.MODE || 'smoke').toLowerCase();
const STEPS = (__ENV.STEPS || '20,30,50').split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
const HOLDS = (__ENV.HOLDS || '15m,5m,5m').split(',').map((s) => s.trim());
const RAMP = __ENV.RAMP || '1m';
const RATE_BEFORE = Number(__ENV.RATE_PER_MIN || 25);
const MSG_PER_MIN = Number(__ENV.MSG_PER_MIN || 0.5);
const SOCKET_MINUTES = Number(__ENV.SOCKET_MINUTES || 4);
const SLOW_MS = Number(__ENV.SLOW_MS || 1500);

const URL_OK = __ENV.URL_PATTERN ? new RegExp(__ENV.URL_PATTERN) : /^https:\/\/[a-z0-9]+\.supabase\.co$/;
if (!URL_OK.test(BASE_URL)) throw new Error(`BASE_URL must be https://<ref>.supabase.co, got "${BASE_URL}"`);
if (!ANON_KEY || !TOKEN) throw new Error('ANON_KEY and TOKEN are required. Use run-prod.sh.');
if (MODE !== 'smoke' && MODE !== 'load') throw new Error('MODE must be smoke or load');
if (HOLDS.length !== STEPS.length) throw new Error('STEPS and HOLDS need the same number of items');

const CTX = JSON.parse(open(__ENV.CONTEXT_FILE || './prod-context.json'));
const TEST_CONV = CTX.test_conv;
if (!TEST_CONV) throw new Error('prod-context.json has no test_conv (the load-test chat id).');
const WS_URL = BASE_URL.replace(/^http/, 'ws') + `/realtime/v1/websocket?apikey=${ANON_KEY}&vsn=1.0.0`;

const READ_RPCS = new Set([
  'get_last_messages_per_conversation', 'operator_trip_my_requirements', 'staff_my_requirements',
  'my_trip_capabilities', 'search_users_for_staff', 'explore_feed', 'my_trips_feed', 'get_blocked_by_ids',
]);

function refuse(why) {
  exec.test.abort(`REFUSED: ${why}`);
  throw new Error('refused');
}

function assertAllowed(method, url, body) {
  if (method === 'GET' || method === 'HEAD') return;
  const rpcMatch = url.match(/\/rest\/v1\/rpc\/([a-z_]+)$/);
  if (method === 'POST' && rpcMatch && READ_RPCS.has(rpcMatch[1])) return;
  if (method === 'POST' && /\/rest\/v1\/messages\?/.test(url)) {
    if (body && body.conversation_id === TEST_CONV && body.sender_id === CTX.me) return;
    refuse(`message outside the test chat: ${JSON.stringify(body)}`);
  }
  if (method === 'PATCH' && url.indexOf(`/rest/v1/conversation_members?conversation_id=eq.${TEST_CONV}&user_id=eq.${CTX.me}`) !== -1) return;
  if (method === 'POST' && /\/realtime\/v1\/api\/broadcast$/.test(url)) {
    const msgs = (body && body.messages) || [];
    if (msgs.length && msgs.every((m) => m.topic === `messages:${TEST_CONV}` && m.event === 'typing')) return;
    refuse(`broadcast outside the test chat: ${JSON.stringify(body)}`);
  }
  refuse(`${method} ${url}`);
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

// ------------------------------------------------- new-app mix (MIX=after) --
// Same assumptions as scenario.js MIX=after.
const AFTER_GET_USER_KEEP = 0.15;
const AFTER_TRIP_BUNDLE_KEEP = 0.7;
// These come from the inbox sync below (driven by real broadcasts), so they
// are left out of the background mix to avoid counting them twice.
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
const BG_RATE = RATE_BEFORE * (BG_TOTAL / TOTAL_BEFORE); // background req/phone/min
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
const inboxEvents = new Counter('inbox_events');
const msgEvents = new Counter('message_events');
const msgSent = new Counter('messages_sent');
const syncMs = new Trend('inbox_sync_ms', true);
const deliveryMs = new Trend('message_delivery_ms', true); // insert -> new_message on the socket

const recent = [];
function track(res, name) {
  const tags = { endpoint: name };
  const isErr = res.status === 0 || res.status >= 500 || res.status === 429;
  reqCount.add(1, tags);
  serverErrors.add(isErr, tags);
  clientErrors.add(res.status >= 400 && res.status < 500, tags);
  if (MODE === 'smoke') {
    console.log(`${res.status >= 200 && res.status < 300 ? 'OK ' : 'BAD'} ${String(res.status).padStart(3)} ${String(Math.round(res.timings.duration)).padStart(6)} ms  ${name}`);
    return;
  }
  recent.push([res.timings.duration, isErr]);
  if (recent.length > 40) recent.shift();
  if (recent.length >= 40) {
    const sorted = recent.map((x) => x[0]).sort((a, b) => a - b);
    const p95 = sorted[Math.floor(0.95 * (sorted.length - 1))];
    const errRate = recent.filter((x) => x[1]).length / recent.length;
    if (p95 > SLOW_MS || errRate > 0.05) {
      exec.test.abort(`AUTO-STOP at ${exec.instance.vusActive} phones: last-40 p95=${Math.round(p95)}ms errors=${Math.round(errRate * 100)}%`);
    }
  }
}

function headers(json) {
  const h = { apikey: ANON_KEY, Authorization: `Bearer ${TOKEN}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

// Sends a list of {name, method, url, body, prefer} at once and tracks them.
function run(reqs) {
  const batch = reqs.map((r) => {
    assertAllowed(r.method, r.url, r.body);
    const h = headers(r.body !== undefined);
    if (r.prefer) h.Prefer = r.prefer;
    return {
      method: r.method, url: r.url,
      body: r.body === undefined ? null : JSON.stringify(r.body),
      params: { headers: h, tags: { endpoint: r.name, name: r.name }, timeout: '60s' },
    };
  });
  const res = http.batch(batch);
  res.forEach((x, i) => track(x, reqs[i].name));
  return res;
}

function ctxFor() {
  return { me: CTX.me, trips: CTX.trips, trip: CTX.trip, convs: CTX.convs, conv: pick(CTX.convs), peers: CTX.peers };
}

function backgroundBurst(n) {
  const c = ctxFor();
  const reqs = [];
  for (let i = 0; i < n; i++) {
    const e = pickBg();
    const [method, url, body] = e.build(c);
    reqs.push({ name: e.name, method, url, body, prefer: e.head ? 'count=exact' : undefined });
  }
  if (reqs.length) run(reqs);
}

// The app's inbox sync for one named conversation (getConversationsUpdatedSince
// in restricted mode, after the 21 Oct fixes): 8 requests in 4 rounds.
const MEMBER_IDS_FALLBACK = [CTX.me];
function inboxSync(convId) {
  const t0 = Date.now();
  const me = CTX.me;
  const ids = [convId];
  run([{ name: 'sync_memberships_scoped', method: 'GET', url: rest('conversation_members', `select=*&user_id=eq.${me}&conversation_id=${inList(ids)}`) }]);
  run([{ name: 'sync_conversations', method: 'GET', url: rest('conversations', `select=id,title,is_direct,metadata,created_by,created_at,updated_at&id=${inList(ids)}&id=${inList(ids)}&order=updated_at.desc`) }]);
  run([
    { name: 'sync_rpc_last_messages', method: 'POST', url: rpc('get_last_messages_per_conversation'), body: { conv_ids: ids } },
    { name: 'sync_all_members', method: 'GET', url: rest('conversation_members', `select=*&conversation_id=${inList(ids)}`) },
    { name: 'sync_my_read_state', method: 'GET', url: rest('conversation_members', `select=conversation_id,last_read_at&user_id=eq.${me}&conversation_id=${inList(ids)}`) },
  ]);
  run([
    { name: 'sync_users', method: 'GET', url: rest('users', `select=id,email&id=${inList(MEMBER_IDS_FALLBACK)}`) },
    { name: 'sync_surfers', method: 'GET', url: rest('surfers', `select=user_id,name,profile_image_url&user_id=${inList(MEMBER_IDS_FALLBACK)}`) },
    { name: 'sync_unread_scan', method: 'GET', url: rest('messages', `select=id,conversation_id,sender_id,created_at&conversation_id=${inList(ids)}&deleted=eq.false&sender_id=neq.${me}&created_at=gt.${new Date(Date.now() - 86400000).toISOString()}&limit=1000`) },
  ]);
  syncMs.add(Date.now() - t0);
}

function sendMessage() {
  run([{ name: 'typing_broadcast', method: 'POST', url: `${BASE_URL}/realtime/v1/api/broadcast`,
    body: { messages: [{ topic: `messages:${TEST_CONV}`, event: 'typing', payload: { userId: CTX.me, isTyping: true }, private: true }] } }]);
  const clientId = uuid();
  const sentAt = Date.now();
  run([{ name: 'message_send', method: 'POST', url: rest('messages', 'on_conflict=sender_id,client_id&select=*'), prefer: 'return=minimal',
    body: { conversation_id: TEST_CONV, sender_id: CTX.me, body: `load test ${new Date().toISOString()}`, type: 'text', client_id: clientId } }]);
  msgSent.add(1);
  return { clientId, sentAt };
}

function markRead(messageId) {
  run([{ name: 'read_mark', method: 'PATCH', prefer: 'return=minimal',
    url: rest('conversation_members', `conversation_id=eq.${TEST_CONV}&user_id=eq.${CTX.me}`),
    body: { last_read_message_id: messageId || null, last_read_at: new Date().toISOString() } }]);
}

// ------------------------------------------------------------ k6 options ----
const stages = [];
STEPS.forEach((target, i) => {
  stages.push({ duration: RAMP, target });
  stages.push({ duration: HOLDS[i], target });
});
stages.push({ duration: '20s', target: 0 });

export const options = MODE === 'smoke'
  ? { vus: 1, iterations: 1, userAgent: 'swellyo-loadtest-k6', discardResponseBodies: true }
  : {
      scenarios: { phones: { executor: 'ramping-vus', startVUs: 0, stages, gracefulRampDown: '15s', gracefulStop: '15s' } },
      thresholds: {
        http_req_duration: [{ threshold: `p(95)<${SLOW_MS}`, abortOnFail: true, delayAbortEval: '1m' }],
        server_errors: [{ threshold: 'rate<0.02', abortOnFail: true, delayAbortEval: '1m' }],
        join_failed: [{ threshold: 'rate<0.1', abortOnFail: true, delayAbortEval: '30s' }],
      },
      summaryTrendStats: ['med', 'p(95)', 'p(99)', 'max', 'count'],
      discardResponseBodies: true,
      userAgent: 'swellyo-loadtest-k6',
    };

// ------------------------------------------------------------- per phone ----
const CHANNELS = [
  { topic: `user-inbox:${CTX.me}`, priv: true },
  { topic: `user-trips:${CTX.me}`, priv: true },
  { topic: `trips-mine:${CTX.me}`, priv: true },
  { topic: 'trips-list', priv: true },
  { topic: `trip:${CTX.trip}`, priv: true },
  { topic: `messages:${TEST_CONV}`, priv: true },
  { topic: `reactions:${TEST_CONV}`, priv: true },
  { topic: `notifications-hub:${CTX.me}`, priv: false, pg: [
    { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${CTX.me}` },
    { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${CTX.me}` },
  ] },
];

export default function () {
  const smoke = MODE === 'smoke';
  const lifetimeMs = smoke ? 20000 : (SOCKET_MINUTES * 60 * 1000) * (0.75 + Math.random() * 0.5);
  let ref = 0;
  const joinRefs = {};
  let syncPending = false;
  let readTimer = null;
  let lastMsgId = null;
  const sentAtByClientId = {};
  let smokeSent = false;
  const smokeSeen = { inbox: 0, message: 0, joinsOk: 0, joinsBad: 0 };

  if (!smoke && exec.vu.iterationInScenario === 0) sleep(Math.random() * 5);

  const res = ws.connect(WS_URL, { tags: { endpoint: 'ws' } }, (socket) => {
    const send = (topic, event, payload) => {
      ref += 1;
      socket.send(JSON.stringify({ topic, event, payload, ref: String(ref) }));
      return String(ref);
    };

    socket.on('open', () => {
      for (const ch of CHANNELS) {
        const config = { broadcast: { ack: false, self: false }, presence: { key: '', enabled: false }, private: ch.priv };
        if (ch.pg) config.postgres_changes = ch.pg;
        const r = send(`realtime:${ch.topic}`, 'phx_join', { config, access_token: TOKEN });
        joinRefs[r] = ch.topic;
      }
      socket.setInterval(() => send('phoenix', 'heartbeat', {}), 25000);

      if (!smoke) {
        // Background screen traffic: one batch every 3 s, Poisson-sized.
        socket.setInterval(() => backgroundBurst(poisson(BG_RATE * 3 / 60)), 3000);
        // Messages: on average MSG_PER_MIN per phone per minute.
        socket.setInterval(() => {
          if (Math.random() < MSG_PER_MIN / 60) {
            const { clientId, sentAt } = sendMessage();
            sentAtByClientId[clientId] = sentAt;
          }
        }, 1000);
      } else {
        socket.setTimeout(() => {
          const { clientId, sentAt } = sendMessage();
          sentAtByClientId[clientId] = sentAt;
          smokeSent = true;
        }, 4000);
      }
      socket.setTimeout(() => socket.close(), lifetimeMs);
    });

    socket.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch (e) { return; }
      if (m.event === 'phx_reply' && joinRefs[m.ref]) {
        const ok = m.payload && m.payload.status === 'ok';
        joinFailed.add(!ok, { channel: joinRefs[m.ref].split(':')[0] });
        if (ok) smokeSeen.joinsOk++; else smokeSeen.joinsBad++;
        if (smoke) console.log(`${ok ? 'OK ' : 'BAD'} join ${joinRefs[m.ref]}${ok ? '' : ' ' + JSON.stringify(m.payload)}`);
        delete joinRefs[m.ref];
        return;
      }
      if (m.event !== 'broadcast' || !m.payload) return;
      const ev = m.payload.event;
      if (ev === 'inbox_change' && m.topic === `realtime:user-inbox:${CTX.me}`) {
        inboxEvents.add(1);
        smokeSeen.inbox++;
        // MessagingProvider debounces inbox events by 400 ms.
        if (!syncPending) {
          syncPending = true;
          socket.setTimeout(() => {
            syncPending = false;
            inboxSync((m.payload.payload && m.payload.payload.conversation_id) || TEST_CONV);
          }, 400);
        }
      } else if (ev === 'new_message' && m.topic === `realtime:messages:${TEST_CONV}`) {
        msgEvents.add(1);
        smokeSeen.message++;
        const row = (m.payload.payload && m.payload.payload.message) || {};
        lastMsgId = row.id || lastMsgId;
        if (row.client_id && sentAtByClientId[row.client_id]) {
          deliveryMs.add(Date.now() - sentAtByClientId[row.client_id]);
          delete sentAtByClientId[row.client_id];
        }
        // readWatermarkQueue: trailing 2 s debounce.
        if (readTimer === null) {
          readTimer = true;
          socket.setTimeout(() => { readTimer = null; markRead(lastMsgId); }, 2000);
        }
      }
    });

    socket.on('error', (e) => {
      if (smoke) console.log(`BAD websocket error: ${e.error()}`);
    });
  });

  if (!res || res.status !== 101) {
    joinFailed.add(true, { channel: 'socket' });
    if (smoke) console.log(`BAD websocket connect status=${res && res.status}`);
  }

  if (smoke) {
    const ok = smokeSeen.joinsBad === 0 && smokeSeen.joinsOk === CHANNELS.length && smokeSent && smokeSeen.inbox > 0 && smokeSeen.message > 0;
    console.log(`SMOKE: joins ok=${smokeSeen.joinsOk}/${CHANNELS.length}, message sent=${smokeSent}, inbox events=${smokeSeen.inbox}, chat events=${smokeSeen.message} -> ${ok ? 'ALL OK' : 'NOT OK'}`);
  }
}
