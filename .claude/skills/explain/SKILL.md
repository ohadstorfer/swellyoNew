---
name: explain
description: Trace and explain how a specific feature or flow works end-to-end across the codebase. Use when the user asks how something works, wants to understand a flow, or says things like "explain", "how does X work", "walk me through".
allowed-tools: Read, Grep, Glob
argument-hint: [feature or flow to explain]
---

## How to explain

Trace the flow for: **$ARGUMENTS**

1. **Start from the user action** — what triggers this flow? (screen, button, event)
2. **Follow the code path** — read the actual source files, don't guess. Trace from frontend → API call → server → database and back.
3. **Show the chain** — list each file and function involved, in order:
   ```
   UserTapsButton (Screen.tsx:42)
     → apiFunction (src/lib/api.ts:186)
       → POST /api/endpoint (server.ts:398)
         → dbFunction (lib/chat-log.ts:55)
           → Prisma query → chats_log table
   ```
4. **Explain non-obvious parts** — why is it done this way? What would break if you changed it?
5. **Keep it concise** — no need to explain basic React or Express patterns. Focus on the project-specific logic.
