---
name: verify
description: Verify the project builds, type-checks, and has no obvious issues. Use after completing any implementation task, code change, or bug fix. Also reviews for security issues, coding practices, and feature completeness. Use when the user says "verify", "check it works", "does it build", or after finishing any significant implementation.
allowed-tools: Bash, Read, Glob, Grep
---

## Verification steps

Run these checks in order. Stop at the first failure and report clearly what broke.

1. **Type check**: Run `npx tsc --noEmit`. Report any type errors with file paths and line numbers.
2. **Build**: Run `npm run build`. Report any build errors.
3. **Prisma client**: If any files in `prisma/` or `lib/` were changed, run `npm run db:generate` to ensure the Prisma client is up to date.

## Quick code review (on changed files only)

After build passes, scan the changed files for:

- **Security**: API keys or secrets accidentally in `src/`? Unvalidated user input passed to queries? XSS vectors in rendered content?
- **Completeness**: Does the implementation match what was requested? Any TODO/FIXME left behind? Any half-finished logic?
- **Sync**: If backend was touched, are `server.ts` and `netlify/functions/` still in sync?
- **i18n**: If UI strings were added, are both `en.json` and `es.json` updated?

## Output

Provide a brief summary:
- **Status**: PASS or FAIL (with details)
- **Files changed**: list them
- **What was done**: 1-2 sentences
- **Issues found**: security, sync, i18n, or completeness problems (if any)
- **Manual testing**: things to verify in the browser
