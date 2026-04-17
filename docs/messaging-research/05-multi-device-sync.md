# 05 — Multi-Device Sync

How WhatsApp, Signal, and iMessage handle multiple devices per account.

---

## The Core Problem

A user has a phone and a laptop. They send a message from the phone. The laptop needs to show it. Now multiply by: the laptop was offline for 3 days, the phone might be offline, the message is E2EE (so the server can't read it to copy it), and read state needs to sync too.

Three architectural models exist:

| Model | Examples | Server stores content? | Phone required? |
|-------|----------|------------------------|-----------------|
| Phone-as-hub | Old WhatsApp (pre-2021) | No | Yes |
| Primary + peer devices | WhatsApp (2021+), Signal | Encrypted copies only | No (after link) |
| Symmetric multi-device | iMessage, Slack, Discord | Yes (plaintext or server-decryptable) | No |

---

## WhatsApp: Companion Architecture (2021)

Before 2021, WhatsApp Web was a mirror of the phone — your phone had to stay online for the web interface to work. All encryption keys lived exclusively on the phone.

**The redesign problem:** To allow true independence (phone off, web still works), each companion device needs its own identity key pair and its own E2EE sessions with every contact. But you can't just generate keys on each device independently — contacts need to know which keys to use, and the account must feel like one identity.

### How it works now

**Device identity:**
- Each device (phone + up to 4 companions) generates its own Curve25519 identity key pair at link time.
- All devices' public keys are registered with WhatsApp's key distribution server under the same account.
- When Alice messages Bob, Alice's device fetches ALL of Bob's registered device keys and encrypts the message once per device (client fan-out).

**Message fan-out:**
- Sender encrypts N copies of the message, one per recipient device (using X3DH/Double Ratchet sessions established with each device key).
- Server routes each copy to the appropriate device.
- "Messages are not stored on the server after they are delivered" — the server is a router, not a store.

**Application state sync:**
- Account settings, contact names, group metadata, starred messages, etc. are synchronized via an encrypted, server-stored copy.
- This state is end-to-end encrypted with constantly-changing keys known only to the user's devices.
- Implemented as a CRDT-like log of mutations so devices can merge state when they reconnect.

**Linking a new device:**
1. New device generates an identity key pair and a provisioning address.
2. New device displays a QR code encoding the provisioning address + public key.
3. Primary phone scans the QR code.
4. Phone sends an encrypted provisioning message to the provisioning address, containing the account's registration info and a bootstrap key.
5. New device derives session keys from the bootstrap key.
6. Phone encrypts recent message history (a bundle) and sends it to the new device via the provisioning channel.
7. New device downloads, decrypts, and stores the history. Keys are discarded. From this point the device operates independently.

**Read state sync:**
- When a user reads a message on one device, a sync event (encrypted) is sent to all other devices.
- Each device updates its local read cursor upon receipt.

---

## Signal: Linked Devices

Signal's model is similar to WhatsApp's post-2021 architecture: primary device + companions, each with independent identity keys, client-side fan-out for E2EE.

**Differences from WhatsApp:**
- Signal links up to 5 companion devices (desktop/iPad).
- Linking uses a QR code displaying a temporary provisioning address and a Curve25519 public key.
- On link, the primary device packages the last 45 days of message history into a compressed, encrypted archive.
- The archive uses a one-time AES-256 key transferred via the provisioning channel. After decryption, the key is discarded.
- Media is *not* re-uploaded — the archive contains attachment pointers. The new device fetches encrypted media from Signal's CDN on demand (attachments expire after 45 days from upload).
- Text-only history compresses efficiently — "even years of heavy usage typically requires just a few megabytes after compression."

**Per-message fan-out:**
- Every message from Alice to Bob is encrypted once per device (using separately established Double Ratchet sessions).
- Signal's server is a sealed mailbox — it does not know which device will receive which encrypted blob; it just routes by device registration ID.

**Conflict resolution:**
- Signal devices are symmetric — no "primary" after initial linking. Each device has a full local copy.
- Read receipts and reactions sent from one device propagate as sync messages to other devices via the Signal Protocol.
- Clock skew: messages are ordered by server-assigned timestamp (the server stamps on receipt), not client time. This prevents clients with wrong clocks from reordering conversations.

---

## iMessage

iMessage is the closest to a symmetric multi-device model without server-side E2EE decryption (when Advanced Data Protection is enabled).

**Key distribution:**
- Each device registers its public keys with Apple Identity Service (IDS).
- IDS maps phone numbers and email addresses to the set of device keys for that Apple Account.
- When Alice sends a message to Bob, Alice's device fetches all of Bob's device keys from IDS and encrypts one copy per device.

**Message storage:**
- With iCloud Messages **enabled**: messages are stored in iCloud. If ADP (Advanced Data Protection) is off, Apple holds the iCloud encryption key. If ADP is on, the key is client-held and Apple cannot access content.
- With iCloud Messages **disabled**: each device stores messages locally only. A new device gets no history.

**APNs as transport:**
- All iMessage delivery goes through APNs — the same persistent connection used for push notifications.
- APNs is bidirectional: Apple's servers route encrypted payloads to each device's registered APNs address.
- The APNs delivery is itself encrypted (TLS), but the routing metadata (who is messaging whom, device IDs) is visible to Apple.

**Read-state sync:**
- Read receipts are propagated as sync events to all devices on the account.
- "Send read receipts" is a per-conversation setting, not per-device.

---

## Slack and Discord: Non-E2EE Multi-Device

Both systems store all messages on the server in a form the server can read. Multi-device is trivial: every device connects, subscribes to the same channels, and fetches history from the server.

**Slack:**
- All messages stored in MySQL/Vitess.
- Every device queries the same API on connect.
- Read state stored server-side per user per channel (last-read cursor).
- No client-side fan-out needed — server delivers the same message to all connected sessions of a user.

**Discord:**
- All messages stored in ScyllaDB.
- Device is just a client session — no special architecture.
- Read state (muted channels, last-read) stored server-side.

The trade-off is clear: server-side storage makes multi-device trivially easy at the cost of E2EE.

---

## Applying to Swellyo

**Current state:** Supabase stores all messages in Postgres. Multi-device is already solved by definition — any device that authenticates gets access to all messages. Read cursors should be stored server-side (one row per user per conversation in a `read_cursors` table) to sync read state across devices.

**If E2EE is added later:** You would need to adopt a client fan-out model (one encrypted copy per device), maintain a key registry (one row per registered device per user), and handle device linking (a provisioning flow with QR code or link). This is a non-trivial migration from the current architecture.

**Short-term recommendation:** Add a server-side `read_cursors` table now. This is compatible with both the current non-E2EE model and a future E2EE model.

---

## Sources

- [Engineering at Meta — How WhatsApp Enables Multi-Device Capability](https://engineering.fb.com/2021/07/14/security/whatsapp-multi-device/)
- [Signal Blog — A Synchronized Start for Linked Devices](https://signal.org/blog/a-synchronized-start-for-linked-devices/)
- [iMessage Security Overview — Apple Support](https://support.apple.com/guide/security/imessage-security-overview-secd9764312f/web)
- [InfoQ — WhatsApp Adopts Signal Protocol for Secure Multi-Device Communication](https://www.infoq.com/news/2021/07/WhatsApp-signal-protocol/)
- [iMessage Explained — JJTech (reverse engineering)](https://jjtech.dev/reverse-engineering/imessage-explained/)
