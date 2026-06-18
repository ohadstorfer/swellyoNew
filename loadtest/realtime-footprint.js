// loadtest/realtime-footprint.js
//
// Hold N concurrent Supabase Realtime connections, each mimicking the per-user
// footprint of one active Swellyo user:
//   - own presence channel  presence:user:{id}  (subscribe + .track)
//   - private inbox channel  user-inbox:{id}     (broadcast, config.private)
//
// Usage:
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... node loadtest/realtime-footprint.js 500
//
// IMPORTANT:
//   - Run this against a STAGING / TEST project, NEVER production. Holding hundreds
//     of sockets will skew metrics and can hit quota on the real project.
//   - The private inbox channel (user-inbox:{id}, config.private = true) requires a
//     VALID SIGNED-IN JWT enforced by Realtime Authorization / RLS on
//     realtime.messages. With only the anon key the inbox subscribe will CHANNEL_ERROR
//     (presence channels still work). To exercise the real private footprint, mint a
//     per-user access token (e.g. supabase.auth.signInWithPassword for seeded test
//     users, or a service-role-signed JWT) and call sb.realtime.setAuth(token) before
//     subscribing. The skeleton below uses the anon key so you can at least load-test
//     the presence half out of the box.
//
// Watch the Supabase dashboard -> Realtime -> "Concurrent connections / peak" while
// this holds the sockets open.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const N = parseInt(process.argv[2] || '100', 10);
const RAMP_MS = 20; // stagger spawns so we don't thundering-herd the socket server

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY env vars.');
  console.error('Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... node loadtest/realtime-footprint.js 500');
  process.exit(1);
}

if (SUPABASE_URL.includes('placeholder')) {
  console.error('Refusing to run against a placeholder URL.');
  process.exit(1);
}

const clients = [];
let presenceSubscribed = 0;
let inboxSubscribed = 0;
let inboxErrors = 0;

async function spawn(i) {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: { heartbeatIntervalMs: 45000 },
  });

  const presence = sb.channel(`presence:user:test-${i}`, {
    config: { presence: { key: `test-${i}` } },
  });
  presence.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      presenceSubscribed++;
      presence.track({ online_at: Date.now() });
    }
  });

  const inbox = sb.channel(`user-inbox:test-${i}`, { config: { private: true } });
  inbox.subscribe((status) => {
    if (status === 'SUBSCRIBED') inboxSubscribed++;
    else if (status === 'CHANNEL_ERROR') inboxErrors++;
  });

  clients.push({ sb, presence, inbox });
}

async function teardown() {
  console.log('\nTearing down connections...');
  for (const { sb } of clients) {
    try {
      await sb.removeAllChannels();
    } catch (_) {
      // best effort
    }
  }
  process.exit(0);
}

process.on('SIGINT', teardown);
process.on('SIGTERM', teardown);

(async () => {
  for (let i = 0; i < N; i++) {
    await spawn(i);
    await new Promise((r) => setTimeout(r, RAMP_MS));
  }

  console.log(`Holding ${N} connections. Watch the Realtime dashboard "concurrent peak".`);

  // Periodic status so you can see how many channels actually came up.
  setInterval(() => {
    console.log(
      `[status] presence SUBSCRIBED=${presenceSubscribed}/${N} ` +
        `inbox SUBSCRIBED=${inboxSubscribed}/${N} inbox CHANNEL_ERROR=${inboxErrors}/${N}`
    );
  }, 10000);
})();
