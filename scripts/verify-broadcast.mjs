// Phase 0 verification: prove the DB trigger broadcasts to a real subscribed client.
//
// ONE input — a logged-in user's JWT. Everything else is automatic:
//   - loads EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY from .env
//   - decodes your user id from the JWT
//   - subscribes to your private inbox topic (fires for a message in ANY of your chats)
//   - also auto-picks one of your conversations and subscribes to its full-row topic
//
// Setup (avoids shell mangling / leaking the token):
//   1. Get a JWT: open the web app logged in, browser console, paste:
//        JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith('-auth-token')))).access_token
//   2. Paste that string into a new file scripts/.jwt (one line, gitignored), save.
//   3. Run:  node scripts/verify-broadcast.mjs
//
// Then send a message in any of your conversations in the app.
// Expected: an INBOX line (and, if you send in the picked conversation, a NEW line).

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// --- tiny .env loader (no dependency) ---
function loadEnv(path) {
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  } catch { /* ignore */ }
}
loadEnv('.env');
loadEnv('.env.local');

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

let jwt;
try {
  jwt = readFileSync('scripts/.jwt', 'utf8').trim();
} catch {
  console.error('Missing scripts/.jwt — paste your access_token into that file (one line) and rerun.');
  process.exit(1);
}

if (!url || !anon) { console.error('Missing EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY in .env'); process.exit(1); }
if (jwt.split('.').length !== 3) {
  console.error('scripts/.jwt does not look like a JWT (need 3 dot-separated parts). Re-copy the access_token cleanly.');
  process.exit(1);
}

// --- decode user id (sub) from the JWT, no verification needed (just to build the topic) ---
function decodeSub(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload.sub;
  } catch { return null; }
}
const userId = decodeSub(jwt);
if (!userId) { console.error('Could not decode user id from JWT — is it a full access_token?'); process.exit(1); }

const supabase = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
supabase.realtime.setAuth(jwt); // authorize the realtime socket as this user (required for private channels)

console.log(`User id: ${userId}`);

// 1) Inbox topic — fires for a message in ANY of your conversations
const inboxTopic = `user-inbox:${userId}`;
supabase
  .channel(inboxTopic, { config: { private: true } })
  .on('broadcast', { event: 'inbox_change' }, (p) => console.log('INBOX', JSON.stringify(p.payload)))
  .subscribe((status) => {
    console.log(`[${inboxTopic}] status:`, status);
    if (status === 'SUBSCRIBED') console.log('OK — now send a message in any of your chats.');
    if (status === 'CHANNEL_ERROR') console.log('CHANNEL_ERROR on inbox — RLS denied (is this a valid logged-in token?).');
  });

// 2) Also subscribe to one specific conversation's full-row topic (best-effort)
const { data: rows } = await supabase
  .from('conversation_members')
  .select('conversation_id')
  .eq('user_id', userId)
  .limit(1);

const convId = rows?.[0]?.conversation_id;
if (convId) {
  const convTopic = `messages:${convId}`;
  console.log(`Also watching ${convTopic} (send here to also see a NEW line)`);
  supabase
    .channel(convTopic, { config: { private: true } })
    .on('broadcast', { event: 'new_message' },    (p) => console.log('NEW', JSON.stringify(p.payload)))
    .on('broadcast', { event: 'update_message' }, (p) => console.log('UPD', JSON.stringify(p.payload)))
    .on('broadcast', { event: 'delete_message' }, (p) => console.log('DEL', JSON.stringify(p.payload)))
    .subscribe((status) => console.log(`[${convTopic}] status:`, status));
} else {
  console.log('(No conversation found for this user — the inbox topic above is enough to verify.)');
}

console.log('\nListening... press Ctrl+C to stop.\n');
process.on('SIGINT', () => process.exit(0));
