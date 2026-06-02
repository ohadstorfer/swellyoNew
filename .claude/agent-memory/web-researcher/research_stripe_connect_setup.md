---
name: stripe-connect-setup
description: Stripe Connect account modes (Express/Custom/Standard/v2), fee math at $50k/mo, Israeli host payouts, chargeback liability, payout delays — for Swellyo pre-launch marketplace
metadata:
  type: project
---

# Stripe Connect Setup — Swellyo Marketplace

Researched May 2026. Swellyo is the merchant of record, US-incorporated, paying out to US + Israeli hosts.

## Account Modes

### Legacy v1 types (Express / Custom / Standard)
- **Standard**: host has their own Stripe account, Stripe bills host directly for fees. Platform pays NO $2/active fee, NO payout fee. Host sees full Stripe dashboard. Least control for platform.
- **Express**: Stripe-hosted onboarding (~2 min). Platform controls payouts + branding. "You handle" pricing = $2/active account/mo + 0.25%+$0.25/payout. Platform bears chargeback liability.
- **Custom**: Platform builds all onboarding UI. Same "you handle" fee structure. Most compliance burden. Only justified with dedicated engineering + legal team.

### v2 Accounts (new as of Dec 2025)
- Replaces the fixed Express/Custom/Standard types with flexible configurations.
- One Account object can be merchant + recipient (no separate Customer object needed).
- Stripe recommends v2 for all NEW platforms in 2026.
- Fee structure: same "you handle" fees apply when platform controls payouts.
- OAuth-based integrations: stay on v1 (v2 doesn't support OAuth yet).

## Pricing — "You Handle" Model (Express/Custom/v2 with platform payout control)
- $2/active connected account/month (active = received a payout that month)
- 0.25% + $0.25 per payout sent
- Cross-border payouts (US → non-US/EEA): +0.25% of payout volume
- Base card processing: 2.9% + $0.30 per charge (on top of above)
- Chargebacks: $15 per dispute fee (non-refundable even if you win)
- Instant payouts: 1% of payout volume (skip for launch)

## Pricing — "Stripe Handles" Model (Standard)
- No $2/active fee
- No payout fee charged to platform
- No per-payout volume fee
- Stripe bills connected account directly for processing fees

## Fee Math at $50k/Month (Swellyo as MoR, destination charges)

Assumptions: avg trip $1,500, ~33 bookings/month, 20 active hosts, platform takes 12% commission ($180/trip).

| Cost Item | Calculation | Monthly |
|---|---|---|
| Card processing | 2.9% + $0.30 × 33 | $1,460 |
| Active account fee | $2 × 20 hosts | $40 |
| Payout fee | (0.25% × $44k) + ($0.25 × 20) | $115 |
| **Total Stripe cost** | | **~$1,615** |
| Platform revenue (12%) | $180 × 33 | $5,940 |
| Net after Stripe | | **~$4,325** |

At this volume, $2/active fee is ~0.7% of revenue — not a killer. The main cost is card processing (2.9%).

## Israel Support — Confirmed

From official Stripe docs (`docs.stripe.com/connect/accounts`):
- **IL (Israel) is explicitly listed** as a supported country for both Express and Custom connected accounts.
- Israeli hosts can create connected accounts and receive payouts.
- Payout currency: ILS supported; USD also works via FX at Stripe's rate (~1% conversion fee).
- Onboarding for Israeli accounts requires identity verification — goes through Stripe's hosted flow for Express; expect 1-3 business days for manual review on some accounts.

IMPORTANT CAVEAT: Israel is NOT in the self-serve cross-border payouts list (that's US/UK/EEA/Canada/Switzerland only). However, Israel is in the full connected accounts country list — meaning Israeli entities can create their own Stripe connected accounts directly. This is different from "cross-border payouts from a US platform to an Israeli bank" — for that flow, contact Stripe sales or verify the current Global Payouts list.

## Chargeback Liability
- **Destination charges** (recommended for MoR marketplaces): platform balance is automatically debited for disputed amount + $15 fee.
- Platform must reverse transfer from connected account manually via API/dashboard.
- If connected account has insufficient balance: if `debit_negative_balances=true`, Stripe auto-debits their bank. Otherwise, platform is on the hook.
- Use destination charges (not direct charges) so platform is always the MoR and controls refund flow.

## Payout Delays
- First payout for new connected accounts: 7-day waiting period from first charge.
- After first payout: daily rolling payouts by default.
- Platform can set to `manual` (safest for travel: hold until trip completes) or `weekly`.
- For travel/surf trips, set payout to manual and release funds ~48h after trip ends. Gives chargeback window protection.

## Recommendation

Use **Express (v1) now, migrate to v2 when ready**. Specifically:
- Start with v1 Express for speed — Stripe-hosted onboarding works for both US and Israeli hosts.
- Use destination charges with the platform as MoR.
- Set `debit_negative_balances: true` on all connected accounts.
- Set payout schedule to `manual` — release funds manually after trip completion.
- For Israeli hosts: verify in test mode that IL bank accounts link correctly before launch.
- When v2 is more documented (Q3 2026+), migrate — the unified Account object is cleaner for a marketplace where hosts also book trips.

**Why not Standard?** Standard gives hosts their own Stripe dashboard and removes the $2/active + payout fees, but: platform loses payout control (can't hold funds until trip ends), platform loses ability to take commissions cleanly, and dispute management becomes much harder. Wrong fit for travel marketplace.

**Why not Custom?** Custom would save nothing at $50k/month scale — same fee structure as Express. The engineering cost of building custom onboarding UI (KYC, bank account linking) is weeks of work vs. hours for Express. Skip until $500k+/month.

## Sources
- https://docs.stripe.com/connect/accounts — country list confirming IL is supported
- https://stripe.com/connect/pricing — fee structure
- https://docs.stripe.com/connect/merchant-of-record — MoR liability
- https://docs.stripe.com/connect/disputes — chargeback handling
- https://docs.stripe.com/connect/manage-payout-schedule — payout delay details
- https://docs.stripe.com/connect/cross-border-payouts — cross-border NOT for Israel self-serve
- https://www.indiehackers.com/post/stripe-connect-express-custom-fees-too-high-c8bcc22399 — community fee math
