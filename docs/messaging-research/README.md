# Messaging Systems Research Dossier

Research into how WhatsApp, Signal, Slack, Discord, Telegram, and iMessage work under the hood. Written to inform a potential refactor or enhancement of Swellyo's messaging stack.

---

## How to Read This

**If planning a refactor of the messaging architecture:**
Start with `10-what-this-means-for-swellyo.md` (the synthesis and priority list), then read `03-data-model-and-storage.md` (schema patterns) and `08-delivery-semantics-and-offline.md` (delivery guarantees, offline outbox, idempotency). These three docs cover the highest-leverage changes to make first.

**If optimizing for scale:**
Read `09-scaling-lessons.md` first (concrete lessons from WhatsApp/Discord/Slack), then `02-realtime-protocols.md` (where Supabase Realtime fits in the protocol spectrum), then `03-data-model-and-storage.md` (sharding strategies and pagination).

**If adding E2EE:**
Read `04-end-to-end-encryption.md` (Signal Protocol explained for engineers, MLS overview), then `05-multi-device-sync.md` (how fan-out and key management change with E2EE), then `07-media-handling.md` (Signal's attachment pointer model for encrypted media), and `06-push-notifications.md` (how to deliver E2EE notification content via Notification Service Extension).

---

## Document Index

| File | Description |
|------|-------------|
| [`01-architecture-overview.md`](01-architecture-overview.md) | High-level comparison of WhatsApp, Signal, Slack, Discord, Telegram, and iMessage: transport protocols, backend languages, sharding units, scale numbers, and what makes each architecture notable. Includes a summary comparison table. |
| [`02-realtime-protocols.md`](02-realtime-protocols.md) | Deep dive on XMPP, MQTT, WebSocket, Signal Protocol transport, Matrix, and Phoenix Channels. Covers battery impact, NAT traversal, reconnect behavior, and QoS levels. Explains where Supabase Realtime sits in this spectrum and its specific limits. |
| [`03-data-model-and-storage.md`](03-data-model-and-storage.md) | How messages, conversations, read receipts, and reactions are modeled at scale. Covers Discord's MongoDB → Cassandra → ScyllaDB journey (with numbers), Slack's Vitess migration, Snowflake IDs vs UUID, cursor pagination, sharding strategies, and concrete SQL schemas. |
| [`04-end-to-end-encryption.md`](04-end-to-end-encryption.md) | The Signal Protocol (X3DH key exchange + Double Ratchet algorithm) explained step-by-step for engineers. Sender Keys for group E2EE. MLS (RFC 9420) and who is adopting it. Key backup trade-offs (WhatsApp HSM vault vs Signal local-only). What's feasible to add to a Supabase-backed app. |
| [`05-multi-device-sync.md`](05-multi-device-sync.md) | How WhatsApp built its 2021 companion architecture, Signal's linked devices model, and iMessage's APNs-based multi-device delivery. Covers client fan-out for E2EE, message history sync on device linking, read-state sync, and the phone-as-hub vs peer model trade-offs. |
| [`06-push-notifications.md`](06-push-notifications.md) | APNs and FCM deep dive: token rotation, alert vs. background vs. mutable-content pushes, Android Doze mode, deduplication against Supabase Realtime, Notification Service Extensions for on-device E2EE decryption, and a reliability checklist for React Native + Expo. |
| [`07-media-handling.md`](07-media-handling.md) | Chunked and resumable uploads (tus protocol, S3 multipart), Signal's attachment pointer model for E2EE media, thumbnail generation strategies, progressive video download (MP4 faststart, HLS), voice message waveforms, CDN strategies, and a full assessment of what Supabase Storage supports vs. what it lacks. |
| [`08-delivery-semantics-and-offline.md`](08-delivery-semantics-and-offline.md) | Message ordering guarantees (server-sequence vs Snowflake vs causal), at-least-once delivery, idempotency via client-generated IDs, the offline outbox pattern, WhatsApp's three-tick (sent/delivered/read) state machine, clock skew, and how to handle reconnect after extended offline periods with Supabase Realtime. |
| [`09-scaling-lessons.md`](09-scaling-lessons.md) | The concrete engineering stories: WhatsApp-on-Erlang (2 engineers per million users), Discord's Rust+Elixir hybrid (34x member list speedup), Slack's Flannel edge cache (44x payload reduction), the Cassandra → ScyllaDB migration. What each team optimized for and what it cost. Six transferable principles. |
| [`10-what-this-means-for-swellyo.md`](10-what-this-means-for-swellyo.md) | Synthesis and action plan. Current stack assessment, what to implement now (push, outbox, cursor pagination, read cursors), what to prototype soon (reconnect catch-up, typed broadcasts), what is premature (sharding, CDN edge), and what cannot be done without leaving Supabase (true E2EE, sealed sender). Opinionated priority order. |

---

## Key Numbers for Quick Reference

| System | Scale (as of source year) | Source year |
|--------|--------------------------|-------------|
| WhatsApp | 3B users, ~140B msgs/day | 2024 |
| WhatsApp (acquisition) | 465M MAU, 70M Erlang msg/s, ~50 engineers | 2014 |
| Discord | ~200M MAU, ~19M concurrent peak | 2023 |
| Discord messages stored | Trillions (72 ScyllaDB nodes) | 2022 |
| Slack | ~38M DAU, 2.3M QPS at peak | 2023 |
| iMessage | Apple does not publish numbers | — |
| Telegram | ~950M MAU | 2024 |
| Signal | ~40M DAU (estimated) | 2023 |
| Supabase Realtime (Team plan) | 10,000 concurrent connections, 2,500 msg/s | 2025 |
