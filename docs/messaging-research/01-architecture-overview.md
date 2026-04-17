# 01 — Architecture Overview

Comparison of the six major messaging systems at a glance.

## Comparison Table

| System | Transport | Primary Backend | Shard Unit | DAU / Scale | Notable trait |
|--------|-----------|-----------------|------------|-------------|---------------|
| **WhatsApp** | FunXMPP (custom XMPP) over TLS | Erlang/OTP (ejabberd fork) | Per-server process per user | 3B users, ~140B msgs/day (2024) | 2 engineers per million users at peak |
| **Signal** | Custom binary over TLS (uses Signal Protocol) | Java + Rust | Unknown (centralized) | ~40M DAU est. | Max privacy; minimal metadata retention |
| **Slack** | WebSocket (custom framing) | PHP + Java + Go; MySQL/Vitess | Channel ID (post-Vitess) | ~38M DAU (2023) | Flannel edge cache for membership data |
| **Discord** | WebSocket (custom JSON/ETF) | Elixir + Rust NIFs | Channel/guild | ~200M MAU, ~19M concurrent | Hybrid Elixir+Rust for in-memory guild state |
| **Telegram** | MTProto 2.0 over TCP/WebSocket | C++ (custom) | Unknown (distributed DCs) | ~950M MAU (2024) | Custom crypto protocol; optional E2EE only |
| **iMessage** | APNs (binary proprietary) | Swift/ObjC on Apple infra | Per Apple ID + device | Unknown (Apple-internal) | E2EE baked in; keys stored in IDS |

---

## WhatsApp

**Transport:** FunXMPP — a heavily modified version of XMPP, binary-encoded rather than XML, running over TLS. Messages are not stored on servers after delivery (historically, store-and-forward only until the recipient comes online).

**Backend:** Erlang/OTP running on FreeBSD. Built as a fork of ejabberd with major rewrites. Each active user connection is an Erlang process (~300 bytes each). One server handles 1–2 million concurrent connections. In 2014 (465M MAU), WhatsApp ran roughly 550 servers with 11,000 cores total, handling 70M Erlang messages/second. In-memory state kept in Mnesia (~2TB RAM across 16 partitions).

**Scale moment:** The famous 2013 moment when a single engineer's Erlang process-model change took a server from 200K to 2M simultaneous connections. By acquisition (2014, $19B), the team was ~50 engineers serving ~465M monthly users.

**What makes it notable:** The BEAM VM's lightweight process model and preemptive scheduling made extreme connection density possible without exotic hardware. FreeBSD kernel patches unlocked higher file descriptor limits. Erlang's built-in supervision trees gave five-nines fault tolerance without a dedicated ops team.

---

## Signal

**Transport:** Long-lived TLS connections with Signal's own framing. The Signal Protocol (X3DH + Double Ratchet) is the encryption layer, not the transport layer.

**Backend:** Java services (Signal-Server, open source on GitHub) with some Rust. No federation — centralized servers. Runs on AWS.

**Scale:** ~40M DAU estimate (Signal does not publish numbers). Notable for what it *does not store*: no message content after delivery, no message metadata in retrievable form, sealed sender hides who is messaging whom.

**What makes it notable:** Signal is an existence proof that a small nonprofit can run at scale with full E2EE. The protocol is the most widely audited and trusted modern encryption protocol — WhatsApp, Google Messages, and Facebook Messenger all use it.

---

## Slack

**Transport:** WebSocket with custom JSON framing. Clients maintain one persistent WebSocket to a Flannel edge node, which proxies to AWS-hosted backend services.

**Backend:** PHP (legacy web layer) + Java (backend services) + Go (newer services). Storage is MySQL sharded with Vitess (the open-source MySQL sharding proxy originally built by YouTube for Google). Pre-Vitess: workspace-sharded (all data for one workspace on one shard). Post-Vitess: channel-ID-sharded — far more even distribution.

**Scale:** 2.3M QPS at peak (2M reads, 300K writes), 2ms median / 11ms p99 latency. Handled a 50% QPS surge in one week during COVID-19 lockdown (March 2020) without downtime.

**What makes it notable:** Flannel, the application-level edge cache. Before Flannel, clients downloaded the entire team dataset on connect — a 32K-user team sent 44x more data than needed. Flannel caches user/channel/membership data at edge PoPs and serves lazy queries. Channel membership query latency dropped from 2,000ms to 200ms.

---

## Discord

**Transport:** WebSocket with JSON or ETF (Erlang Term Format) binary encoding. Clients connect to gateway servers.

**Backend:** Elixir on the BEAM VM for the real-time gateway (guilds, presence, sessions). Each guild has an Erlang process; each online user has a session process. Rust NIFs (Native Implemented Functions via Rustler) handle hot data structures that exceed BEAM's performance ceiling — specifically, the sorted member list used for the visible member panel. Storage: ScyllaDB (messages), Cassandra-compatible but written in C++ with no GC pauses.

**Scale:** ~19M concurrent users at peak. 11M concurrent was the trigger for the Rust NIF work (SortedSet bottleneck). Messages: trillions stored across 72 ScyllaDB nodes (reduced from 177 Cassandra nodes in 2022 migration).

**What makes it notable:** The Rust+Elixir hybrid is a documented pattern for when BEAM alone isn't enough. Discord's engineering blog is one of the most transparent sources on database migration trade-offs at real scale.

---

## Telegram

**Transport:** MTProto 2.0, a custom binary protocol over TCP or WebSocket. MTProto handles framing, auth, and encryption in one stack — unlike Signal (which separates these concerns). Optional E2EE "Secret Chats" use a separate DH-based session; regular "Cloud Chats" are encrypted in transit but not E2EE (Telegram holds keys).

**Backend:** C++ custom servers across distributed data centers in multiple jurisdictions (Dubai, Singapore, Netherlands, US). Architecture details are not publicly documented — Telegram does not publish engineering blog posts.

**Scale:** 950M MAU (2024). No breakdown of messages/day publicly available.

**What makes it notable:** MTProto has been the subject of multiple academic security analyses with mixed results. The protocol is not widely trusted by the cryptography community despite Telegram's claims, though MTProto 2.0 is substantially better than 1.0. The notable scaling story is distribution across jurisdictions for regulatory/resilience reasons rather than any specific technical innovation.

---

## iMessage

**Transport:** Apple Push Notification service (APNs), a proprietary binary protocol running persistent TLS connections to Apple servers. Every Apple device maintains a keep-alive APNs connection. iMessage piggybacks on this rather than maintaining a separate socket.

**Backend:** Apple's private infrastructure. Architecture is not published.

**E2EE:** Messages encrypted on-device using public keys fetched from Apple Identity Service (IDS). Each device has its own key pair; group messages are individually encrypted per-device. Apple cannot read message content but does see metadata (who is messaging whom, when).

**Multi-device:** Messages delivered to all devices signed into the same Apple Account. When iCloud Messages is on, message history is stored in iCloud — protected by iCloud Advanced Data Protection (AESGCM with client-held keys) if enabled, otherwise Apple holds the keys.

**What makes it notable:** APNs bidirectional channel as a universal transport substrate for Apple services. IDS as a public key directory. The fallback to SMS (green bubbles) is a deliberate UX choice to maintain reach, not a technical limitation.

---

## Sources

- [WhatsApp Engineering at Meta — Multi-device](https://engineering.fb.com/2021/07/14/security/whatsapp-multi-device/)
- [High Scalability — WhatsApp 500M users, 11000 cores](https://highscalability.com/how-whatsapp-grew-to-nearly-500-million-users-11000-cores-an/)
- [High Scalability — WhatsApp Architecture Facebook bought for $19B](http://highscalability.com/blog/2014/2/26/the-whatsapp-architecture-facebook-bought-for-19-billion.html)
- [Discord Engineering — Using Rust to Scale Elixir for 11M Concurrent Users](https://discord.com/blog/using-rust-to-scale-elixir-for-11-million-concurrent-users)
- [Discord Engineering — How Discord Stores Trillions of Messages](https://discord.com/blog/how-discord-stores-trillions-of-messages)
- [Slack Engineering — Scaling Datastores at Slack with Vitess](https://slack.engineering/scaling-datastores-at-slack-with-vitess/)
- [Slack Engineering — Flannel: An Application-Level Edge Cache](https://slack.engineering/flannel-an-application-level-edge-cache-to-make-slack-scale/)
- [iMessage Security Overview — Apple Support](https://support.apple.com/guide/security/imessage-security-overview-secd9764312f/web)
- [Telegram MTProto Protocol](https://core.telegram.org/mtproto)
- [Signal Documentation](https://signal.org/docs/)
