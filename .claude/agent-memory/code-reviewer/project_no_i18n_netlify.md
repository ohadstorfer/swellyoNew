---
name: project-no-i18n-netlify
description: Swellyo has neither src/locales/ nor netlify/functions/ — the code-reviewer persona's generic hard rules about i18n en/es sync and server.ts/Netlify Function dual-sync do not apply to this codebase
metadata:
  type: project
---

Confirmed 2026-07 (verified via directory listing): `src/locales/` and `netlify/functions/` do not exist in
this repo. Swellyo's actual backend is Supabase (Auth, DB, Realtime, Storage, Edge Functions) plus a
Python `backend/` (Render/FastAPI) that is explicitly dead code per project CLAUDE.md — there is no
`server.ts` Express file either. All user-facing strings across screens (e.g. `ConversationsScreen.tsx`,
`DirectMessageScreen.tsx`) are hardcoded English literals, no `useTranslation`/`t()` calls anywhere.

**Why this matters:** the code-reviewer system prompt used for this project describes a different generic
app archetype (Express `server.ts` + Netlify Functions + Prisma + dual i18n locale files). None of that
exists in Swellyo. Applying those "Critical" rules verbatim would produce false-positive findings every
review.

**How to apply:** when reviewing Swellyo, skip the dual-API-sync and en.json/es.json-sync checks entirely
(nothing to check — no such files). Do still flag genuine `prisma/schema.prisma` changes if that file
exists and is touched (Swellyo does use Prisma-adjacent Supabase migrations — verify current state before
assuming), and do still flag frontend secret exposure (`OPENAI_API_KEY` etc. in `src/`) since OpenAI calls
must stay in Supabase Edge Functions per project convention, not because of the persona's Netlify-specific
wording.
