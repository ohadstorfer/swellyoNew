---
name: User Blocking System Research
description: Best practices for implementing user blocking in chat/social apps — DB schema, UX behavior, Apple requirements, Supabase RLS patterns
type: project
---

Researched April 2026. Covers DB design, major app behavior (WhatsApp/Instagram/Discord/Mastodon), Apple App Store requirements, Supabase Realtime patterns, and unblocking UX.

**Key findings:**

- Separate `user_blocks` table is the standard. Mastodon uses: `account_id` (blocker), `target_account_id` (blocked), `created_at`, `updated_at`, unique composite index on both columns + index on target_account_id. Simple, clean, unidirectional.
- Blocking is ALWAYS unidirectional in major apps. Only the blocker's view is affected. The blocked person is NOT notified, and their view of the blocker's content changes separately (Instagram: profile appears empty; Telegram: last seen shows "a long time ago").
- Conversations are NOT deleted when blocking. WhatsApp keeps chat history on both sides. Old messages remain visible. Only new messages are blocked. Blocked messages sent during the block are permanently lost — they are NOT delivered if/when user unblocks.
- Matching/search: Instagram hides the blocker's profile from search entirely. Discord hides messages in shared servers (collapsible). Matching queries must exclude blocked users via server-side filtering.
- Apple App Store Guideline 1.2 REQUIRES: ability to block abusive users, report mechanism, 24hr response to reports. No block = rejection. Reviewer will test it directly.
- Supabase RLS approach: Block table-based NOT EXISTS check in SELECT policies on profiles and messages tables. Realtime channels don't auto-enforce RLS per-message — they check permissions at channel join time, and cache those permissions for the connection duration. Client must manually removeChannel() when a block occurs.
- Race condition: A message in-flight as block happens is benign from the blocker's side (it won't be visible due to RLS). The real risk is the blocked user's client still having an open channel subscription. Solution: server-side RLS is the safety net; client-side unsubscribe is best effort cleanup.
- Unblocking: Industry standard is to NOT restore messages sent during the block period. Conversation history from before the block becomes visible again. No auto-reconnect of relationships.

**Why:** Full implementation research for Swellyo App Store submission. Blocking is a hard App Store requirement for social apps with UGC.
**How to apply:** Use this before designing the blocking schema, RLS policies, and UI flow for Swellyo.
