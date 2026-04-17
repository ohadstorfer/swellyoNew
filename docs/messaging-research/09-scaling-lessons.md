# 09 — Scaling Lessons

What WhatsApp, Discord, and Slack actually learned at scale, and what transfers to smaller apps.

---

## WhatsApp: The Erlang/Ejabberd Story

### The achievement
By the time of its $19B acquisition in February 2014, WhatsApp served ~465 million monthly users with a team of ~55 engineers (50 of them technical). At peak they handled:
- 147 million concurrent connections
- 70 million Erlang messages per second
- 342,000 messages inbound per second, 712,000 outbound
- ~11,000 cores across roughly 550 servers

The ratio was roughly 8–10 million users per engineer. No company has beaten this at comparable scale.

### What they actually did

**Erlang/OTP with FreeBSD:** The BEAM VM's preemptive scheduler can pause any Erlang process to run another, with no single process starving the system. Combined with FreeBSD's superior network stack (at the time, Linux had worse poll/epoll behavior under millions of file descriptors), this gave each server 2 million concurrent connections.

**Ejabberd fork:** WhatsApp started with the open-source ejabberd XMPP server written in Erlang, then rewrote most of it. The protocol (FunXMPP) is binary, not XML. The server architecture kept the process-per-connection model of BEAM but removed the XMPP features they didn't need.

**Mnesia for routing state:** Erlang's built-in distributed database. WhatsApp used ~2TB of RAM across 16 partitions to store 18 billion records. Mnesia is a fast in-memory store — appropriate for ephemeral routing data (where is Bob's current connection?) but not persistent message history.

**What they optimized for:** Connection density. The goal was to handle as many concurrent connections per server as possible with as few servers (and thus engineers) as possible. They patched the FreeBSD kernel and the BEAM emulator to remove the remaining bottlenecks.

**What it cost them:** Erlang's runtime, while excellent for concurrent connections, is not ideal for CPU-heavy processing (image transcoding, complex queries). WhatsApp outsourced media storage to third-party CDNs (Facebook's CDN post-acquisition). Message history is on the client — the server doesn't need to serve it.

**Lesson:** Choose the language and runtime that matches your primary bottleneck. If your bottleneck is concurrent I/O-bound connections, Erlang/Elixir is hard to beat. If it's CPU-bound computation (ML inference, video transcoding), Rust or C++ is better.

---

## Discord: Rust + Elixir Hybrid

### The member list problem
Discord's real-time gateway is built in Elixir on the BEAM VM. For 99% of its use cases this works beautifully — guild and session processes model maps naturally onto Erlang processes. The problem surfaced with large servers (hundreds of thousands of members in a single guild) and the member list sidebar.

The member list must be sorted and efficiently updated as users join, leave, or change roles. Elixir's immutable data structures require copying the full list on every modification. For a list of 250,000 entries:
- Custom Elixir list wrapper: ~170,000 microseconds worst case
- Erlang's `ordsets`: ~27,000 microseconds
- Neither was acceptable for real-time updates

**The Rust NIF solution:** Discord built a `SortedSet` data structure in Rust, compiled as a Native Implemented Function (NIF) and called directly from Elixir via the Rustler library. Rust's memory model allows mutable sorted data structures (like a BTreeSet or SkipList) without the copy-on-modify cost of Elixir immutability.

Result for 250,000-item lists: 640 microseconds worst case (from 170,000). A 265x improvement.

**What this means:** Erlang/Elixir and the BEAM are excellent for coordination-heavy, I/O-bound work. They are not good at mutable in-memory data structures. At scale, hybrid approaches (Elixir for orchestration, Rust for hot data paths) are a real pattern used in production.

### The database migration (Cassandra → ScyllaDB)
The core issue was Java's garbage collector, not Cassandra's data model. During GC pauses, all in-flight requests would stall, causing p99 spikes up to 125ms. ScyllaDB, written in C++ with the Seastar async framework, eliminates GC entirely.

**What changed:** Not the schema (it's Cassandra-compatible). Not the query patterns. What changed was the runtime performance of the storage engine and the addition of the Rust data service layer that coalesces duplicate requests.

**Lesson:** Garbage-collected languages (Java, Go to a lesser extent) introduce latency unpredictability under load. For high-throughput storage engines or low-latency request paths, GC-free runtimes (C++, Rust) provide more predictable tail latencies.

---

## Slack: The Vitess Migration

### The workspace sharding ceiling
Slack's original architecture sharded by workspace. This was correct for a world where every customer was a small team. It broke when large enterprises arrived — a single enterprise customer would saturate a shard.

The problem is not just capacity: it is operational. If one shard is hot, you can't easily move the large customer to a different shard without application downtime. Slack needed to re-shard live production data.

**Vitess as a migration path:** Rather than rewriting application code to be shard-aware (which would have required changes in every query throughout the codebase), Slack added Vitess as a transparent proxy layer. The application sends queries to Vitess as if it were a single MySQL server; Vitess routes to the correct shard.

This gave them three years to migrate from workspace sharding to channel sharding without a single rewrites of business logic.

**COVID-19 resilience test:** In March 2020, Slack's QPS increased 50% in a single week. The old architecture would have required emergency hardware capacity planning; Vitess allowed horizontal scaling without architectural changes.

**Lesson:** Sharding is hard to add retroactively. If you start with a single database, ensure your schema is structured so that the natural sharding key (channel ID, conversation ID) is indexed from the beginning. When you eventually need to shard, the data model won't need to change — only the routing layer.

---

## Flannel: The Edge Cache Lesson

Before Flannel, Slack sent each client the entire team dataset on connection: all users, all channels, all memberships. For a 32,000-user workspace, this was a massive payload — every reconnect (app restart, brief network drop) hammered the backend.

**The fix:** Move data to the edge and serve lazily. Flannel caches per-team data at geographic edge nodes and serves clients lazy-load queries. The startup payload shrank by 44x for large teams.

**Lesson:** Don't send more data than the client needs right now. Lazy loading and edge caching are multiplicative — they reduce backend load and improve client startup time simultaneously. This is especially important on mobile, where bandwidth and battery are constrained.

---

## Scaling Principles That Transfer to Small Apps

These are extracted from the above and apply at any scale:

**1. Optimize for your actual bottleneck.**
WhatsApp's bottleneck was concurrent connections → Erlang. Discord's bottleneck was sorted in-memory state → Rust. Slack's bottleneck was startup payload size → Flannel edge cache. Before optimizing, measure.

**2. Server-side state is easier than client-side at scale — but harder to change.**
Slack and Discord's multi-device story is trivial because everything is on the server. WhatsApp's is complex because the server is a relay. Choose the model that fits your current needs; migrating later is painful.

**3. Sharding key determines which queries are fast.**
Discord shards by `(channel_id, bucket)` — channel history is fast, per-user history requires scatter-gather. Slack shards by channel ID — same trade-off. Choose your access patterns first, then choose your sharding key.

**4. At-least-once + idempotency = practical exactly-once.**
No one implements true exactly-once. Everyone implements retry + client-generated idempotency keys + `ON CONFLICT DO NOTHING` (or equivalent). This is sufficient.

**5. The outbox pattern beats optimistic UI alone.**
Optimistic UI is necessary (the app must feel fast). But without a persistent outbox, messages disappear on app restart during a send. Use both.

**6. Tail latency is dominated by GC pauses and hot partitions.**
Two recurring causes of p99 spikes in production messaging systems: JVM GC pauses (Discord fixed by switching to ScyllaDB) and hot database partitions (fixed by request coalescing + consistent routing). If you're on Postgres, hot tables are not a problem at Swellyo's scale — but watch your `pg_stat_activity` and index hit rates.

---

## Sources

- [High Scalability — How WhatsApp Grew to Nearly 500 Million Users](https://highscalability.com/how-whatsapp-grew-to-nearly-500-million-users-11000-cores-an/)
- [Hacker News — Why WhatsApp Only Needs 50 Engineers for 900M Users](https://news.ycombinator.com/item?id=10225096)
- [Discord Engineering — Using Rust to Scale Elixir for 11 Million Concurrent Users](https://discord.com/blog/using-rust-to-scale-elixir-for-11-million-concurrent-users)
- [Discord Engineering — How Discord Stores Trillions of Messages](https://discord.com/blog/how-discord-stores-trillions-of-messages)
- [Slack Engineering — Scaling Datastores at Slack with Vitess](https://slack.engineering/scaling-datastores-at-slack-with-vitess/)
- [Slack Engineering — Flannel: An Application-Level Edge Cache](https://slack.engineering/flannel-an-application-level-edge-cache-to-make-slack-scale/)
- [InfoQ — Scaling Slack (conference talk)](https://www.infoq.com/presentations/slack-scalability/)
- [Elixir Lang — Real-time Communication at Scale with Elixir at Discord](https://elixir-lang.org/blog/2020/10/08/real-time-communication-at-scale-with-elixir-at-discord/)
