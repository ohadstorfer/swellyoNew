# Waiver — what we must keep to hold up legally

**Status:** research note, 2026-07-24. Not legal advice — a build checklist to hand a lawyer.
**Why:** we decided to keep `group_trip_acknowledgements` (the row that records a signature).
This says exactly what that row should carry so an operator can prove a waiver in a dispute.
**Related:** `waiver-medical.md` (how the waiver is built), `operator-trips-db-changes.html`.

> ⚠️ **Two things only a lawyer decides, not us.** (1) The **waiver text itself** — a waiver is
> only enforceable if the wording is valid, and that varies by country and by how bad the harm
> was (gross negligence usually can't be waived anywhere). (2) The **jurisdiction** — our
> operators may be based in Israel and travelers may be from the EU, so US ESIGN/UETA is the
> starting frame, not the whole story (the EU has eIDAS). Get sign-off before launch. What is
> below is the **record-keeping** half, which is the part we build.

---

## 1. The four things the law wants (ESIGN / UETA)

An electronic signature counts the same as pen-on-paper when all four are true:

1. **Intent to sign** — the person did a clear, deliberate action to agree (tapping "I agree").
2. **Consent to do business electronically** — they agreed to sign digitally at all.
3. **The signature is tied to the exact document** — you can show the precise text they saw,
   not a later edited version.
4. **They can keep a copy** — the signer can get back the document they agreed to.

On top of these, a dispute is won or lost on the **audit trail**: the stored proof that *this
person* agreed to *this version* at *this moment*, from *this device*.

---

## 2. What we already store (and it's the hard part)

Our current design is strong exactly where waivers usually fail — the document version.

| We keep | In | Covers |
|---|---|---|
| The exact waiver text/PDF, **versioned and append-only** (never edited, never deleted) | `organized_trip_operator_documents` | Pillar 3 — the signature points at the real text they saw |
| Which version the person agreed to | `group_trip_acknowledgements.operator_document_id` + `agreed_version` | Pillar 3 — no "which version?" argument |
| The name they typed at agree time | `agreed_name` | The signature act |
| Server timestamp | `agreed_at` (UTC) | When |
| Who, tied to a logged-in Swellyo account | `user_id` → `auth.users` | Identity is **attributable** — the law's word |

Most waiver lawsuits are lost because the company edited the waiver text and can't prove what
the person actually signed. Our append-only versions table already closes that hole.

---

## 3. What to ADD to be defensible — ✅ APPLIED 2026-07-24

Migration `20260724000800`. All nullable, none block the client flow — recorded at the "I agree"
tap.

| Added | Where | How it's filled |
|---|---|---|
| `ip_address` | `group_trip_acknowledgements` | Captured **server-side** in `operator_requirement_acknowledge` from the `x-forwarded-for` header — the client can't forge it |
| `user_agent` | `group_trip_acknowledgements` | Same, from the `user-agent` header |
| `consent_electronic` | `group_trip_acknowledgements` | Set `true` at agree time (they used the e-flow). Split into an explicit disclosure step later if the lawyer wants it |
| `document_hash` | `organized_trip_operator_documents` | Text waivers hashed **server-side** (SHA-256) by a trigger; PDF waivers carry a client-supplied hash |

Verified end-to-end: the hash auto-computes and matches, and IP / user-agent / consent all
populate from request headers.

Nice-to-have, only if an operator's insurer ever demands more (not v1): a drawn signature, a
photo-ID upload, or a selfie. The spec already parks these as a later path.

---

## 4. Retention — do NOT let the waiver record get purged

The 30-day purge is for **travelers' personal files** (passports, insurance). Waiver
agreements and the waiver versions are **different**:

- They are **not** special-category personal data — just a name, a time, a version.
- They are the **evidence**, so they must **outlive** the trip, not get deleted after it.

**Rule to set:** keep both `group_trip_acknowledgements` and `organized_trip_operator_documents`
for the full injury-claim window — often **2–7 years after the trip**, depending on country.
Pick the number with the lawyer, and make sure the purge job **never** touches these two tables.

The record must also stay **reproducible**: given one agreement row, we can pull up the exact
waiver text the person saw and show it back. Our version link already makes this a single join —
just make sure there's a screen that does it (for the operator, and for the traveler's own copy).

---

## 5. The record we should be able to produce, per signature

When a lawyer or insurer asks "prove X agreed to the waiver," we hand over one page:

- **Who:** name typed + the Swellyo account it came from
- **What:** the full waiver text of that exact version (rendered from the append-only row)
- **When:** server timestamp (UTC)
- **From where:** IP + device/browser *(after §3 is added)*
- **Proof of intent:** the "I agree" action was required to continue — no way past it without it
- **Proof of consent to e-sign:** the account's electronic-consent record *(after §3)*

If we can print that, the record-keeping side is done. Whether it *wins* still depends on the
waiver wording and the jurisdiction — §caveat at the top.

---

## 6. Open questions for Eyal & the lawyer

1. **Retention period** — how many years after the trip do we keep the waiver record? (2? 7?)
2. **Where does e-consent live** — a column on each signature, or one Terms acceptance at signup
   that we point back to?
3. **Jurisdiction** — Israel-based operators + international travelers: does US ESIGN/UETA even
   govern, or eIDAS / local law? Sets whether the §3 fields are enough.
4. **Is the current "type your name + I agree" enough**, or does any operator's insurer require a
   drawn signature or photo ID? (Affects nobody in v1 unless asked.)

## Sources

- [Formfy — legally enforceable digital waivers (2026)](https://formfy.ai/blog/legally-enforceable-digital-waivers-guide)
- [United Educators — enforceable electronic waivers](https://www.ue.org/risk-management/compliance/electronic-waivers/)
- [Ironclad — ESIGN and UETA electronic signature law](https://ironcladapp.com/journal/contract-management/electronic-signature-law)
