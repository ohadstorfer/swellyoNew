---
name: swellyo-compliance
description: Swellyo marketplace compliance brief — MTL, 1099-K, Israeli VAT/withholding, EU PSD2/SCA, occupancy tax, GDPR, PCI-DSS, setup checklist
metadata:
  type: project
---

Full compliance research for Swellyo pre-launch. Delaware LLC/C-Corp, Stripe Connect Express/Custom, USA+Israel travelers+hosts, <$50k/mo, trip price $800-$2500.

**Why:** Needed before first payment is accepted to avoid MTL exposure and tax filing gaps.
**How to apply:** Reference when building payout, onboarding, or booking flows.

## MTL
- Stripe holds the license in all US states. Swellyo using Stripe Connect Express/Custom does NOT need its own MTL.
- Agent-of-payee doctrine covers ~35 states. NY and CA are covered BY STRIPE'S OWN LICENSE — Stripe is licensed as money transmitter in both states. The platform rides under Stripe.
- Critical: funds must NEVER sit in a Swellyo-controlled bank account. Stripe settles directly to connected accounts' bank accounts. If Swellyo ever holds float, exposure reappears.

## 1099-K (2026)
- Federal threshold for 2025 tax year (filed 2026): $20,000 AND 200+ transactions (OBBBA restored old rule — $600 was reversed).
- States that are LOWER: MA, MD, VT = $600; NJ = $1,000. Stripe handles state filing separately.
- Stripe Connect: $2.99/1099 e-filed with IRS, $1.49/state, $2.99/mailed.
- Express/Custom: Stripe automatically generates and delivers 1099s, collects W-9/W-8 at onboarding, enforces payout blocks if W-9 not submitted.

## Israeli Tax
- VAT: Israel raised rate to 18% (Jan 2025). The B2C digital services foreign supplier regime exists in law but the enabling legislation has NOT been enacted yet as of early 2026. Current legal status = gray area; enforcement risk at <$50k/mo is very low. No Israeli entity, no employee = no clear nexus today.
- Withholding on payouts to Israeli hosts: Swellyo pays foreign persons (Israelis) for services. Default US withholding = 30% NRA withholding (Form 1042-S). BUT: US-Israel tax treaty reduces this. Israeli hosts must submit W-8BEN claiming treaty benefits. Stripe Connect handles W-8 collection. Services income under the treaty is generally 0% if the Israeli host has no US presence. File Form 1042 annually regardless.
- Host reporting = host's own obligation in Israel. Swellyo's obligation is W-8BEN collection + 1042-S filing.

## EU PSD2 / SCA
- Stripe handles 3DS2 automatically for EU-issued cards. No action needed by Swellyo.
- No PSD2 license needed when using Stripe Connect (Stripe's license covers the platform).
- Conversion impact: ~5-15% drop-off on 3DS2 friction, but Stripe's SCA optimization recovers ~1.2% uplift net. At low EU volume, immaterial.
- PSD3 not in effect before 2026 at earliest.
- No EU representative needed at <$50k/mo with no EU establishment.

## Occupancy / Sales Tax
- Surf trips that include accommodation = potential lodging marketplace facilitator obligation in many states.
- If trips are "experiences" (coaching, guiding) without dedicated accommodation rental = generally NOT subject to occupancy tax. Services are not tangible property.
- If trips include STR-style overnight stays booked through Swellyo = marketplace facilitator laws apply in ~30+ states. Stripe Tax can automate this.
- Practical path: structure trip listings as "experiences/guided trips" not "accommodation rentals" to stay out of lodging tax regime initially.

## PCI-DSS
- Stripe Checkout / Elements / mobile SDK = SAQ-A eligibility (self-attestation only, no QSA audit).
- Annual PCI self-attestation questionnaire required — free, ~15 minutes.

## GDPR / Privacy
- Applies to any EU user data from day 1 regardless of US incorporation.
- Must-do: privacy policy + cookie consent + data processing agreements with Supabase/Stripe/PostHog.
- No DPO required at early stage.
- No EU representative required until "large scale" processing of EU data (not applicable at launch).
- Israeli Privacy Law Amendment 13 (effective Aug 14, 2025): granular consent required, DPO needed only for sensitive data at scale. Privacy policy + consent flow covers it.
- CCPA: threshold is 100,000 CA residents OR 50% revenue from selling CA data. Not applicable at launch.

## Setup Checklist Priority
- BLOCKERS: Stripe Connect Express/Custom setup, W-9/W-8 collection enabled, Terms of Service, Host Agreement, Privacy Policy.
- Pre-$10k revenue: 1042-S filing process for Israeli hosts, state 1099-K awareness (MA/VT/$600 threshold).
- Scale: Stripe Tax for occupancy/sales tax if adding accommodation listings; Israeli VAT registration if legislation passes and volume hits.
