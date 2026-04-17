# 02 — Real-Time Protocols

How the major apps move bytes between client and server, and where Supabase Realtime fits.

## Protocol Comparison Table

| Protocol | Framing | Binary? | QoS levels | Battery impact | NAT traversal | Best for |
|----------|---------|---------|------------|----------------|---------------|----------|
| XMPP | XML stanzas over TCP | No (text) | None built-in | Medium-high (persistent + verbose) | Poor (needs keep-alives) | Federation, presence |
| MQTT | Topic pub/sub over TCP | Yes | 0, 1, 2 | Low (designed for constrained devices) | Moderate | IoT, mobile signaling |
| WebSocket (raw) | Frames over HTTP upgrade | Yes/No | None | Medium | Good (port 80/443) | General real-time, browsers |
| Custom binary/WS | App-defined over WebSocket | Yes | App-defined | Medium | Good | High-throughput messaging (Slack, Discord) |
| Signal Protocol | TLS + custom framing | Yes | App-layer ACKs | Low-medium | Good | E2EE messaging |
| Matrix (HTTP) | JSON over HTTPS long-poll or WS | No | At-least-once via sync | Medium | Good | Federation, bridging |
| Phoenix Channels | JSON over WebSocket | Partial | None (fire-and-forget) | Medium | Good | Elixir/Supabase apps |
| MTProto | Custom binary over TCP/WS | Yes | Built-in ACKs | Low-medium | Good | Telegram |

---

## XMPP

Originally designed in 1999 for federated instant messaging. Messages are XML stanzas routed via Jabber IDs (`user@domain`). The federation model means any XMPP server can talk to any other — a design that influenced WhatsApp's use of ejabberd.

**WhatsApp's fork (FunXMPP):** WhatsApp stripped XML in favor of a compact binary encoding (called FunXMPP or the WhatsApp binary protocol). This reduced wire overhead dramatically. They kept XMPP's conceptual model (JIDs for routing, presence stanzas) but abandoned interoperability. Modern WhatsApp is not compatible with standard XMPP clients.

**Battery:** Standard XML-XMPP is expensive — verbose keep-alive stanzas over persistent TCP. Binary variants are better but still require persistent connections. XMPP's `<keepalive/>` pings every 60–90 seconds add to data usage.

**NAT traversal:** XMPP relies on server-mediated relay for client connections. Peer-to-peer XMPP (for file transfer) requires STUN/TURN proxies (XEP-0065, XEP-0176). Not suitable for direct mobile P2P.

**Reconnect:** XMPP clients must re-authenticate and rebuild presence subscriptions on reconnect. XEP-0198 (Stream Management) adds stanza acknowledgment and resumption to reduce reconnect cost, but not all servers implement it well.

---

## MQTT

Designed in 1999 for telemetry over satellite links (literally — IBM and Eurotech built it for oil pipelines). Publish/subscribe over persistent TCP. Clients publish to *topics*; brokers fan out to subscribers.

**Facebook Messenger (2011):** Chosen because it uses ~6–8% less power than HTTP polling and maintains persistent connections efficiently. The engineering team said MQTT let them achieve "phone-to-phone delivery in the hundreds of milliseconds, rather than multiple seconds."

**QoS levels:**
- QoS 0: fire-and-forget (at-most-once)
- QoS 1: at-least-once (broker ACKs)
- QoS 2: exactly-once (four-step handshake, rarely used)

**Battery:** Excellent. MQTT's keep-alive is configurable (60s default) and the packet overhead is tiny (2-byte fixed header). Designed explicitly for battery-constrained devices.

**NAT traversal:** Standard MQTT runs on port 1883 (or 8883 TLS). Most firewalls allow 443/80; running MQTT over WebSocket on 443 is common for mobile.

**Limitation:** MQTT is pub/sub only — no request/response primitives. Chat applications need to build conversation topic naming conventions (`chat/{conversation_id}`), message ordering, and read receipts on top.

---

## WebSocket (Raw / Custom Binary)

WebSocket upgrades an HTTP connection to a persistent full-duplex stream. No message ordering guarantees, no QoS, no built-in reconnect. Applications implement their own framing on top.

**Slack:** Custom JSON framing over WebSocket. Earlier architecture sent full team state on connect; Flannel edge nodes proxy and cache to reduce this. Clients send JSON event payloads; server pushes channel events.

**Discord:** WebSocket with JSON (human-readable) or ETF (Erlang Term Format binary, ~10–15% smaller). Guild state is maintained server-side in Elixir processes. Discord's gateway protocol defines specific opcodes for heartbeat, identify, guild member requests, etc. — effectively a custom application protocol on top of WebSocket.

**Battery:** Moderate. Persistent WebSocket requires keep-alive pings (Discord uses 41.25s heartbeat interval). More overhead per message than MQTT in the IoT sense, but browsers handle WebSocket natively and the overhead is acceptable for foreground apps.

**Reconnect:** Applications must implement exponential backoff and re-subscribe to channels/guilds on reconnect. Discord and Slack both use sequence numbers so clients can resume from a known point after brief disconnects.

---

## The Signal Protocol Transport

Signal's transport is not a named open protocol — it is TLS connections to Signal's servers with the application-layer Signal Protocol for encryption. Key characteristics:

- **Sealed Sender:** Metadata protection mechanism where the server cannot see who is sending a message (the sender identity is itself encrypted inside the message).
- **Server as store-and-forward:** Messages are queued on Signal's server until the recipient's device retrieves them. Server cannot read content, only knows account IDs.
- **Multi-device fan-out:** Each linked device receives a separately encrypted copy of each message.
- **Reconnect:** Clients fetch any pending messages on connect via a REST-like sealed delivery API.

---

## Matrix

Federated messaging protocol using HTTP as the transport. Clients talk to their homeserver via HTTP (short-poll `/sync` or Server-Sent Events). Homeservers federate to each other over HTTP. All events are stored on all participating servers — decentralized but data-heavy.

**Encryption:** E2EE via Olm (1:1) and Megolm (group) — libraries that implement the same Double Ratchet and Sender Key concepts as the Signal Protocol.

**Trade-off vs. XMPP:** Matrix stores full room history on every participating server (high durability, high storage cost). XMPP doesn't replicate history.

**Battery:** HTTP long-poll or polling is more expensive than persistent TCP. Matrix clients typically do background sync at configurable intervals. Element (the main Matrix client) has known battery issues on mobile.

**Supabase relevance:** Matrix is not used in Swellyo's stack but is worth knowing as an alternative architecture for a self-hosted or federated future.

---

## Supabase Realtime: Phoenix Channels over WebSocket

Supabase Realtime is an Elixir application built on the Phoenix Framework, deployed alongside your Postgres instance. It exposes three capabilities over a single WebSocket connection:

1. **Broadcast:** Any client publishes to a channel; all subscribers receive it. Messages are not persisted. Used for ephemeral events like typing indicators.
2. **Presence:** CRDT-backed in-memory key-value store. Tracks who is connected to a channel. State propagated via Phoenix.PubSub.PG2 (Erlang process groups across cluster nodes).
3. **Postgres Changes:** Supabase Realtime subscribes to Postgres WAL (write-ahead log) via logical replication. On `INSERT`/`UPDATE`/`DELETE`, a Realtime server process reads the WAL, maps it to subscribed channel IDs, and pushes to clients. Delivered as JSON patches.

**Where Supabase Realtime sits in the protocol spectrum:** It is effectively custom JSON over WebSocket, similar to Slack/Discord. No QoS guarantees — messages can be dropped if the client is slow or the connection drops. Postgres Changes are processed on a single Elixir thread per subscription to preserve order, which means compute upgrades do not linearly improve WAL throughput.

**Plan limits (as of 2025):**
- Free: 200 concurrent connections, 100 msg/s
- Pro: 500 concurrent, 500 msg/s
- Team/Enterprise: 10,000 concurrent, 2,500 msg/s

For a small app with hundreds of active users this is fine. For tens of thousands of concurrent chatters, the Pro plan becomes a hard ceiling and self-hosted Realtime is the only path to higher limits.

**Key limitation for messaging:** Supabase Realtime Broadcast does not persist messages. Messages must be written to Postgres separately (in Swellyo's case, via `messagingService.ts`). This means delivery requires both: (a) a successful Postgres write and (b) the Realtime broadcast. If the client is offline, the Postgres write ensures messages are not lost, but the client will only see them by querying the database on reconnect — not via Realtime.

---

## Sources

- [Building Facebook Messenger — Engineering at Meta](https://engineering.fb.com/2011/08/12/android/building-facebook-messenger/)
- [Supabase Realtime Architecture](https://supabase.com/docs/guides/realtime/architecture)
- [Supabase Realtime Limits](https://supabase.com/docs/guides/realtime/limits)
- [XMPP vs WebSocket — Ably](https://ably.com/topic/xmpp-vs-websocket)
- [XMPP vs Matrix vs MQTT — RST Software](https://www.rst.software/blog/xmpp-vs-matrix-vs-mqtt-which-instant-messaging-protocol-is-best-for-your-chat-application)
- [Discord Engineering — Real-time communication at scale with Elixir](https://elixir-lang.org/blog/2020/10/08/real-time-communication-at-scale-with-elixir-at-discord/)
- [Signal Specifications](https://signal.org/docs/)
- [XEP-0184: Message Delivery Receipts](https://xmpp.org/extensions/xep-0184.html)
- [XEP-0333: Displayed Markers](https://xmpp.org/extensions/xep-0333.html)
- [HiveMQ — The Origin of MQTT](https://www.hivemq.com/blog/the-history-of-mqtt-part-1-the-origin/)
