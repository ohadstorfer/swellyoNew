---
name: netlify-agent-autodeploy
description: Can an AI coding agent (Claude Code) fully automate prompt → code → live Netlify URL with zero human steps? CLI mechanics, PAT auth, direct deploy path, real-world examples, and caveats.
metadata:
  type: reference
---

# Netlify Agent Auto-Deploy Research

**Date researched:** 2026-06-09

## Verdict
Technically possible today. Fully hands-off and reliable in practice requires upfront one-time setup (PAT, env vars pre-loaded, site created or named). After that setup, zero-click per-deploy is real.

## CLI Mechanics
- `netlify deploy --dir=dist --site=SITE_ID --auth=TOKEN --prod` is fully headless
- `--json` flag outputs machine-parseable JSON including `deploy_url` and `url` (live site URL)
- `netlify sites:create --name=my-site --auth=TOKEN` creates a new site programmatically, returns site_id
- No Git repo required — `--dir` deploys a local build folder directly
- `--allow-anonymous` creates a claimable temp site without any account (1-hr window)

## PAT Auth
- Netlify PATs are account-wide (no per-site scope restriction available as of 2026)
- Generated at: User Settings > Applications > Personal Access Tokens
- Set expiration date; shorter-lived = safer
- Passed via `NETLIFY_AUTH_TOKEN` env var OR `--auth` CLI flag
- A leaked PAT gives full account access: can delete sites, read env vars, redeploy anything
- Safer pattern: create a dedicated Netlify sub-account (free) specifically for agent use; isolates blast radius

## Direct Deploy (no Git)
- Yes — fully supported. `netlify deploy --dir=./dist` works with zero Git involvement
- Also available via REST API: POST to `/api/v1/sites` to create, then POST to `/api/v1/sites/{id}/builds` with a zip
- This is the key path for agent-driven deploys: build locally → zip → POST → get URL back

## Netlify MCP Server (2025-2026)
- Official MCP server: `@netlify/mcp`
- Install: `npm install -g @netlify/mcp-server`, add to `~/.claude/mcp.json`
- Exposes tools: create project, deploy, manage env vars, manage access controls
- Claude Code can call these tools in a single conversation turn
- Auth via PAT in MCP config JSON (`NETLIFY_PERSONAL_ACCESS_TOKEN`)

## Netlify Agent Runners (Dashboard feature)
- NOT zero-click: human must trigger from Netlify dashboard, review Deploy Preview, approve to production
- This is human-in-the-loop by design, not the autonomous path

## Real-World Pattern (what actually works)
1. One-time setup: generate PAT, store in agent's environment, set `NETLIFY_SITE_ID` for existing site OR let agent call `sites:create` for new sites
2. Agent writes/edits code → runs `npx expo export --platform web` → runs `netlify deploy --dir=dist --prod --json` → parses JSON for `url` → returns it
3. The `--json` output contains `deploy_url` (this deploy) and `url` (permanent site URL)

## Expo-Specific Notes
- Build command for Swellyo web: `npx expo export --platform web` (outputs to `dist/`)
- Or `npm run build:netlify` per CLAUDE.md
- EXPO_PUBLIC_ vars must be present in the environment at build time — they get baked in
- Mobile (iOS/Android) does NOT go through Netlify — only the web bundle does
- If EXPO_PUBLIC_SUPABASE_URL etc. are missing at build time, the app builds but is broken at runtime (silent failure)

## Caveats / Where "Zero Human Steps" Breaks
1. **Env vars at build time**: EXPO_PUBLIC_* must be in the agent's shell environment. If they're missing or wrong, deploy succeeds but app is broken.
2. **Build failures**: If TypeScript errors / missing deps exist, expo export fails; agent needs error-handling logic to surface this.
3. **First-time site creation**: `netlify sites:create` works but the site name must be unique across all of Netlify (not just your account).
4. **Custom domain**: Netlify auto-assigns a `.netlify.app` URL; custom domain setup requires DNS changes = human step.
5. **PAT scope**: PAT gives full account access — any bug in agent code could wipe all sites. Mitigate with sub-account.
6. **No per-site token scoping**: Cannot limit PAT to one site only (as of 2026).

## Sources
- https://cli.netlify.com/commands/deploy/
- https://docs.netlify.com/build/build-with-ai/netlify-mcp-server/
- https://docs.netlify.com/build/build-with-ai/netlify-skills/
- https://www.netlify.com/blog/netlify-mcp-server-ai-agents-deploy-your-code/
- https://docs.netlify.com/start/quickstarts/deploy-from-ai-code-generation-tool/
- https://developers.netlify.com/guides/deploy-zip-file-to-production-website/
- https://developers.netlify.com/guides/generating-personal-access-tokens-with-netlify-oauth/
- https://github.com/netlify/cli/issues/312 (--json URL output)
