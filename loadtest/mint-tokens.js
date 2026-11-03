#!/usr/bin/env node
// loadtest/mint-tokens.js
//
// Signs a 2-hour access token (HS256 JWT) for each fake user in
// fixtures.json, using the LOCAL Supabase JWT secret, and writes tokens.json.
// No npm packages: node:crypto only.
//
// Usage (from the repo root):
//   JWT_SECRET=<local secret from `supabase status -o env`> node loadtest/mint-tokens.js
//
// Env:
//   JWT_SECRET     required. The LOCAL secret. Never a production secret.
//   FIXTURES_FILE  default loadtest/fixtures.json (made by load.sh)
//   TOKENS_OUT     default loadtest/tokens.json   (git-ignored)
//   TTL_SECONDS    default 7200 (2 hours)

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const here = __dirname;
const secret = process.env.JWT_SECRET;
const fixturesFile = process.env.FIXTURES_FILE || path.join(here, 'fixtures.json');
const outFile = process.env.TOKENS_OUT || path.join(here, 'tokens.json');
const ttl = Number(process.env.TTL_SECONDS || 7200);

if (!secret || secret.length < 32) {
  console.error('JWT_SECRET is missing or too short. Get it with: supabase status -o env (JWT_SECRET=...)');
  process.exit(1);
}

const users = JSON.parse(fs.readFileSync(fixturesFile, 'utf8'));
if (!Array.isArray(users) || users.length === 0) {
  console.error(`No users in ${fixturesFile}. Run load.sh first.`);
  process.exit(1);
}

// Safety: only fake users. The seed gives them @loadtest.invalid emails.
const notFake = users.filter((u) => !String(u.email || '').endsWith('@loadtest.invalid'));
if (notFake.length > 0) {
  console.error(`Refusing: ${notFake.length} users in fixtures are not @loadtest.invalid.`);
  process.exit(1);
}

const b64url = (input) =>
  Buffer.from(typeof input === 'string' ? input : JSON.stringify(input))
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

function sign(payload) {
  const head = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url(payload);
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${head}.${body}`)
    .digest('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${head}.${body}.${sig}`;
}

const now = Math.floor(Date.now() / 1000);
const out = users.map((u) => ({
  ...u,
  access_token: sign({
    aud: 'authenticated',
    role: 'authenticated',
    sub: u.user_id,
    email: u.email,
    iat: now,
    exp: now + ttl,
    aal: 'aal1',
    is_anonymous: false,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
  }),
}));

fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(`Wrote ${out.length} tokens to ${outFile} (valid ${Math.round(ttl / 60)} min).`);
