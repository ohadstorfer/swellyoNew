# 04 — End-to-End Encryption

The Signal Protocol, MLS, key management, and what E2EE means for a Supabase-backed app.

---

## The Signal Protocol

Used by: Signal, WhatsApp, Facebook Messenger (optional), Google Messages, Skype (optional), Wire.

The protocol has two phases: **initial key agreement (X3DH)** and **ongoing ratcheted encryption (Double Ratchet)**.

### X3DH — Extended Triple Diffie-Hellman

X3DH establishes a shared secret between two parties who may never have been online at the same time. It is designed for asynchronous messaging.

Each user registers four key types on the server:
1. **IK** (Identity Key): a long-lived Curve25519 key pair. This is the user's identity.
2. **SPK** (Signed Pre-Key): a medium-term key pair, rotated periodically (weeks/months), signed by IK.
3. **OPKs** (One-Time Pre-Keys): a batch of one-use key pairs. After each handshake, one is consumed and the server discards it. Users upload new batches periodically.
4. **EK** (Ephemeral Key): generated fresh per outgoing message initiation.

When Alice wants to message Bob (who is offline):
1. Alice fetches Bob's IK, SPK, and one OPK from the Signal server.
2. Alice generates a fresh EK.
3. Alice computes four Diffie-Hellman operations:
   - DH1 = DH(Alice.IK, Bob.SPK)
   - DH2 = DH(Alice.EK, Bob.IK)
   - DH3 = DH(Alice.EK, Bob.SPK)
   - DH4 = DH(Alice.EK, Bob.OPK) [if OPK available]
4. The shared secret is `KDF(DH1 || DH2 || DH3 || DH4)`.
5. Alice encrypts the first message with this key and includes her EK and IK in the header (in plaintext — Bob needs them to derive the same secret).

When Bob comes online and reads Alice's first message, he recomputes the same DH operations (he has all his private keys) and derives the identical shared secret. No network round-trip needed; Alice could be offline at this point.

**Security property:** Even if the server is compromised, it cannot derive the shared secret because it never holds private keys.

### Double Ratchet Algorithm

Once X3DH establishes the initial shared secret, the Double Ratchet takes over for all subsequent messages. It combines two ratchets:

**1. Symmetric-Key Ratchet (KDF chain):** For each message, a chain key is advanced through a one-way KDF:
```
(chain_key_new, message_key) = KDF(chain_key_old)
```
Each message gets a unique encryption key derived from the chain. Old message keys cannot be derived from new ones (forward secrecy within a session).

**2. Diffie-Hellman Ratchet:** Every time a message is received, the recipient generates a new DH key pair and includes the public key in their next message. When Alice receives a message with Bob's new DH public key, she performs a new DH operation, advances the root key, and derives new chain keys. This "heals" the session after a compromise — even if someone steals all current keys, after the next DH ratchet step, they lose access to future messages (break-in recovery / "post-compromise security").

**Combined effect:**
- Forward secrecy: past messages are safe even if current keys leak.
- Post-compromise security: future messages are safe after the next DH ratchet, even if current keys leaked.
- Out-of-order delivery: each message carries enough header info to derive its own key even if messages arrive out-of-order (skipped message keys are cached temporarily).

---

## Group Messaging: Sender Keys

1:1 encryption with Double Ratchet works well, but groups are expensive: if Alice has 100 group members, she would need 100 separate Double Ratchet sessions to send one message. That's 100x the encryption work and 100x the ciphertext.

**Solution: Sender Keys (Signal Protocol v3, also used by WhatsApp).** Each sender generates a single Sender Key for the group and distributes it once to all members (via individual pairwise sessions). Subsequent messages use that Sender Key — one encrypt operation, one ciphertext, delivered to all. When a member leaves, the Sender Key is rotated (a new one is generated and distributed to the remaining members).

**Trade-off:** Sender Keys break forward secrecy across membership changes. A member who saves their key before being removed can potentially decrypt future messages until the key rotates. Apps mitigate this by rotating keys promptly on member removal.

---

## MLS — Messaging Layer Security (RFC 9420, published July 2023)

MLS is the IETF standard that supersedes ad-hoc group E2EE schemes. Designed specifically for large, dynamic groups with efficient rekeying.

**Core structure:** A binary tree (called the ratchet tree) where leaf nodes are group members' key pairs, and each internal node is derived from its children. Updating one leaf (adding/removing a member) only requires updating the path from that leaf to the root — `O(log N)` operations rather than O(N).

**Key operations:**
- `Add`: New member is added to the tree; only path nodes need updating.
- `Remove`: Member is removed; path nodes are rederived excluding the removed member.
- `Update`: Any member can rotate their own leaf key; path updates propagate.

**Adoption (as of 2024–2025):**
- Google Messages: announced intent to add MLS to RCS E2EE.
- Apple: committed to RCS Universal Profile 3.0 with MLS support (announced March 2025).
- Cisco Webex: early adopter, used MLS before RFC publication.
- Wire: implemented MLS for group chats.
- WhatsApp: as of mid-2025, no confirmed public migration announcement to MLS. Still on Signal Protocol Sender Keys for groups.
- Discord: no confirmed MLS adoption.
- AWS: published `mls-rs`, an open-source MLS implementation in Rust.

**Why it matters:** MLS is the likely long-term standard. Apps built today that want E2EE should at least design their key distribution infrastructure to be MLS-compatible.

---

## Key Management: The Hard Part

### Key Distribution
Someone must store public keys so senders can find recipients' encryption keys. Options:
- **Centralized key server** (Signal's IDS, WhatsApp's key distribution): Fast, simple, but the server can lie about keys (MITM attack). Trust anchored to the server.
- **Key transparency / certificate trees**: Signal added Key Transparency (2023) — an append-only, auditable log of key changes. Users and auditors can detect server-supplied fraudulent keys.
- **Federation**: Matrix uses homeservers as key directories; keys are anchored to the homeserver identity.

### Key Backup and Restore
The E2EE dilemma: if keys are only on-device, losing your device means losing your message history and potentially your identity. Solutions:

**WhatsApp encrypted backup (2021):** Users set a password (or receive a 64-digit key). WhatsApp derives an encryption key and stores it in an HSM-backed Backup Key Vault, geographically distributed across data centers. The backup (in iCloud or Google Drive) is encrypted with this key. To restore, you provide the password; WhatsApp's HSM verifies and releases the key. Neither WhatsApp nor the backup provider can read the backup — but the HSM system is still controlled by Meta.

**Signal:** Local encrypted backups only (iOS: iCloud, Android: local file). No server-side key backup. If you lose all devices and backup files, you lose everything. This maximizes privacy at the cost of usability.

**iMessage with iCloud:** Messages stored in iCloud are encrypted. If Advanced Data Protection (ADP) is *off* (the default for years), Apple holds the iCloud encryption key and can access your messages in response to legal requests. ADP (enabled by user opt-in) shifts to client-held keys; Apple cannot access.

### Key Verification
Even with E2EE, you must verify that the key you're using belongs to the person you think it does (not the server substituting its own key). Apps handle this with:
- Safety numbers / QR code scanning (Signal, WhatsApp): Users compare a fingerprint of their shared key in person or via a separate channel.
- Key Change Notifications: Apps warn when a contact's key changes ("Bob's security number changed").

---

## What's Feasible for a Supabase-Backed App

### What works
- **Signal Protocol (1:1):** Open source libraries exist. `libsignal` (the canonical library in Rust/Java/TypeScript) can be compiled for React Native. The main cost is key management infrastructure: you'd need a key distribution endpoint (could be a Supabase table of public keys + Edge Function for pre-key bundles) and a way to handle key rotation.
- **Sender Keys (group):** Implementable on top of Signal Protocol. Complexity is in the group membership sync.
- **Client-side encryption before upload:** Media files can be encrypted on-device before upload to Supabase Storage. Only the encrypted blob is stored; the key is passed as an attachment pointer in the E2EE message.

### What requires moving off Supabase
- **True E2EE with Supabase RLS:** RLS cannot enforce E2EE at the row level — if Supabase serves ciphertext, that is fine, but your RLS policies are still enforced by a server that holds the Postgres master key. You cannot guarantee the database operator cannot read plaintext content if you store it unencrypted.
- **Sealed sender / metadata hiding:** Supabase's Realtime and Auth systems log sender/receiver metadata. You would need custom infrastructure (similar to Signal's sealed sender) to hide this.
- **Key transparency:** Not a Supabase feature. Would require a custom append-only audit log service.
- **HSM-backed key vault for backups:** Requires infrastructure like AWS KMS + CloudHSM. Not available in Supabase.

### Practical recommendation for Swellyo
Adding full E2EE is a significant architectural commitment. The minimum viable step is: encrypt sensitive message fields client-side using a shared secret derived from a Diffie-Hellman exchange, store ciphertext in Postgres, and distribute public keys via a simple Supabase table. This gives content confidentiality against database-level breaches but does not protect against a compromised Supabase admin or subpoena. Full E2EE (protecting even against the server operator) requires building a key distribution and sealed-delivery layer outside Supabase.

---

## Sources

- [Signal Specifications — X3DH Key Agreement Protocol](https://signal.org/docs/specifications/x3dh/)
- [Signal Specifications — The Double Ratchet Algorithm](https://signal.org/docs/specifications/doubleratchet/)
- [RFC 9420 — The Messaging Layer Security (MLS) Protocol](https://datatracker.ietf.org/doc/rfc9420/)
- [Engineering at Meta — How WhatsApp Enables E2EE Backups](https://engineering.fb.com/2021/09/10/security/whatsapp-e2ee-backups/)
- [Engineering at Meta — WhatsApp Multi-Device Security](https://engineering.fb.com/2021/07/14/security/whatsapp-multi-device/)
- [Google Messages to Adopt MLS](https://www.androidheadlines.com/2023/07/google-messages-adopt-messaging-layer-security-mls-protocol.html)
- [RFC 9750 — MLS Architecture](https://www.rfc-editor.org/rfc/rfc9750.html)
- [AWS Labs mls-rs](https://github.com/awslabs/mls-rs)
