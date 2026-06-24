---
name: il-payment-gateways-smaller
description: Smaller/newer Israeli payment gateways for a marketplace (surf-trip platform) — Grow/Meshulam, Z-Credit, PayMe, HYP/Pelecard, YaadPay, Allpay, Sumit, UNIPaaS, BridgerPay, iCredit/Rivhit, EZcount — split-payout feasibility, tashlumim, Bit, onboarding friction
metadata:
  type: project
---

Researched 2026-06-23. Swellyo needs Israeli domestic ILS acquiring + marketplace split payouts + tashlumim + Bit. Requires Israeli entity (Osek Murshe or Ltd). Relates to [[payments-research-index]].

## Pre-existing research baseline (from payments-research-index)
The major players (Tranzila, PayPlus, Cardcom) were already deeply researched 2026-06-22. Key facts still apply:
- Every Israeli domestic acquirer requires an Israeli entity (Shva number + Israeli bank).
- Tranzila is the lead pick for the Israeli rail (cheaper rates + in-app iframe UX), marketplace/split via Tranzila Finance (custody question outstanding).
- NO single platform lets a US-only company get domestic ILS + tashlumim + Bit.

## Provider-by-Provider Findings (smaller/newer)

### Grow / Meshulam (grow.business / api.meshulam.co.il)
- **Type**: Gateway/aggregator. Founded 2015. 70,000+ merchants. Israel's largest gateway by merchant count.
- **Marketplace/split**: API docs explicitly mention "support for multi-business systems" and "ability to collect marketplace commission from business payments" (תמיכה במערכת מרובת עסקים + גביית עמלת המרקט). However, the public docs center (grow-il.readme.io) has NO dedicated marketplace section — only core payments, recurring, SDK, webhooks. The multi-business/commission feature exists but appears undocumented publicly; likely needs direct sales call to activate.
- **Onboarding friction**: Advertises "fastest self-signup / start collecting in minutes." No public minimum volume or setup fee. Fees: 1.7% + ₪1/txn pay-as-you-go, OR ₪59/mo + 1.5%/txn service package.
- **Tashlumim + Bit**: YES to both. Up to 12 installments. Bit via SDK (iOS + Android).
- **Integration**: Hosted redirect checkout, iFrame. Bit SDK for iOS/Android. REST API. No native RN SDK (use WebView or REST).
- **Israeli entity required**: ALMOST CERTAINLY YES (Israeli entity standard requirement; no evidence foreign companies can onboard).
- **Verdict**: Hungry for customers, fast signup, confirmed tashlumim+Bit. Multi-business/commission EXISTS but poorly documented — needs a direct conversation to verify split-payout mechanics and whether money flows through your account or not.

### Z-Credit (zcredit.co.il / now Dejavoo Z-Credit)
- **Type**: Gateway/aggregator. POS + gateway focus, not a clearing house. Acquired by Dejavoo (US POS company) June 2024.
- **Marketplace/split**: NOT FOUND. No documented marketplace, split, or vendor payout features. Focus is hospitality POS.
- **Onboarding friction**: Unknown. Post-acquisition it's more of a hardware/POS play.
- **Tashlumim + Bit**: Likely yes (Israeli gateway standard) but unconfirmed.
- **Integration**: WebCheckout API (zcreditwc.docs.apiary.io — currently returning 502).
- **Verdict**: RULED OUT for marketplace use. POS/hospitality focus, no marketplace split evidence. Post-Dejavoo acquisition likely not interested in small merchants.

### PayMe (payme.io)
- **Type**: White-label embedded payments platform, NOT a simple gateway. B2B-focused. Founded 2014, Tel Aviv. ~37 employees. ISA licensed.
- **Marketplace/split**: YES — explicitly documented. "Split a transaction between multiple sellers and charge a dynamic fee from each transaction." "Onboard new sellers from around the world." "Control when sellers receive payouts." Also: wallet infrastructure, escrow-like control. Israeli Direct Debit supported. Tashlumim up to 12 installments (full amount upfront available via Discount service). Bit supported (up to ₪5,000/txn, ₪20,000/mo).
- **Onboarding friction**: WHITE-LABEL, NOT SELF-SERVE. Designed for banks, acquirers, financial institutions. Contact-us flow only. Pricing: OPAQUE, no published rates. Requires business negotiation.
- **Entity requirements**: Terms reference Israeli identity/company numbers in their clearing context. Previous research (2026-06-22) found create-seller API hard-requires Israeli teudat-zehut + Israeli bank per payee. LIKELY requires Israeli entity for the acquiring leg, though platform itself can be a foreign company with an Israeli operator entity.
- **Integration**: Full REST API + docs (docs.payme.io). Well-documented. No native RN SDK but REST-compatible.
- **Verdict**: MOST FEATURE-COMPLETE for marketplace split (confirmed split API, wallet, payout control, tashlumim, Bit). BUT enterprise/white-label — small merchant unlikely to get onboarded easily. ONE email to partnerships@payme.io to ask: "Can a surf-trip marketplace with an Israeli Osek Murshe entity use your marketplace split product? What's the minimum volume?" If yes, this is the strongest candidate.

### HYP / Pelecard (hyp.co.il)
- **Type**: Israel's dominant payment INFRASTRUCTURE provider (Pelecard is legacy brand, HYP is rebrand). Not a gateway for end-merchants — they are the underlying infrastructure that OTHER Israeli gateways (Tranzila, Cardcom, etc.) run ON TOP OF. Also offers HYP Pay directly for SMBs and HYP Enterprise for large businesses. 50,000+ merchants.
- **Marketplace/split**: NOT FOUND in full documentation (llms-full.txt reviewed). No marketplace, split, sub-merchant features documented.
- **Tashlumim + Bit**: YES confirmed in docs. Tashlumim via `Tash` parameter, up to merchant-set max. Bit supported (max ₪5,000/txn, ILS only).
- **Onboarding friction**: HYP Pay for SMBs — how to apply not publicly documented (likely via Israeli bank or direct sales). Assumed Israeli entity required.
- **Integration**: REST API (developers.hyp.co.il) + doDeal endpoint as core operation. Active docs (updated March 2026). No native RN SDK.
- **Verdict**: NOT a marketplace tool directly. Use it indirectly by choosing a gateway (Tranzila/Cardcom/Grow) that runs on HYP infrastructure. If Swellyo ever grows to enterprise scale, HYP Enterprise might be relevant.

### YaadPay / Yaad Sarig (yaadpay.co.il)
- **Type**: BoI-authorized acquirer AND gateway. One of very few Israeli companies authorized by Shva to do direct acquiring (money moves card-company → Yaad → merchant directly). Founded ~2005. PCI-DSS Level 1.
- **Marketplace/split**: NOT FOUND. No documented marketplace or split features. The yaadpay.yaad.net domain now REDIRECTS to hyp.co.il/about-hyp — strong signal that YaadPay has been ABSORBED into or merged with HYP/Pelecard. Confirming this: Yaad Sarig and HYP are both under the same umbrella.
- **Tashlumim + Bit**: Assumed yes (Israeli acquirer standard).
- **Verdict**: EFFECTIVELY MERGED INTO HYP. Not a separate option.

### Allpay (allpay.co.il)
- **Type**: Gateway/aggregator. Newer, startup-positioned. Self-serve.
- **Marketplace/split**: NOT SUPPORTED. No marketplace or split-payout features found in pricing or docs.
- **Onboarding friction**: VERY LOW. Self-serve, no setup fee, 7-day free trial, cancel anytime. ₪50/mo subscription. CONFIRMED REQUIRES Israeli entity: "official business registration in Israel" + teudat zehut + Israeli bank account. Eligible types: Osek Patur, Osek Murshe, Hevra Ba'am, Amuta.
- **Tashlumim + Bit**: YES to both. Up to 12 installments. Bit activation ₪50 one-time.
- **Fees**: 1.45% domestic (Visa/MC) + ₪1/txn. 3.65% international. ₪50/mo. 0.2% for 3DS. Very transparent.
- **Integration**: API + webhooks + WooCommerce plugin. No native RN SDK. No marketplace support.
- **Verdict**: Great for a SINGLE-MERCHANT Israeli business. Transparent, low-friction, cheap. NOT suitable for marketplace — no split capability. Could serve individual trip operators who want their own checkout.

### SUMIT / OfficeGuy (sumit.co.il)
- **Type**: Israeli SaaS business management + invoicing platform with a bundled payment clearing product. NOT a standalone gateway.
- **Marketplace/split**: CONFIRMED SUPPORTED (but with a catch). Documented in Hebrew help center: each vendor gets their own SUMIT account, marketplace manager gets oversight. Payments flow to individual vendor accounts directly. API endpoint `/website/companies/create/` for automated vendor onboarding. WordPress integration (Dokan, WCFM, WCVendors). CRITICAL LIMIT: only supports credit framework capture (J5) — no standard immediate charge.
- **Onboarding friction**: SaaS subscription model. Self-service. Israeli entity required (designed exclusively for Israeli businesses: invoicing, VAT, IRS reporting all Israel-specific).
- **Tashlumim + Bit**: Unclear — not specifically confirmed in marketplace docs.
- **Fees**: Subscription-based SaaS pricing (undisclosed in search results).
- **Verdict**: TECHNICALLY SUPPORTS MARKETPLACE SPLIT but J5-only is a major constraint (hold-then-capture, not instant charge). Better for simple WooCommerce marketplace stores. Probably not robust enough for a dynamic surf-trip booking flow. Worth confirming J5 limitation and whether direct API works.

### iCredit / Rivhit (icredit.rivhit.co.il)
- **Type**: iCredit is the payment clearing arm of Rivhit (a popular Israeli accounting/ERP software). NOT a standalone gateway.
- **Marketplace/split**: NOT FOUND. Rivhit is primarily accounting software with a bundled payment page for its own users.
- **Tashlumim + Bit**: Likely yes (standard Israeli gateway features).
- **Verdict**: EXCLUDED. Accounting software with a payment module, not a marketplace-capable gateway.

### EZcount (ezcount.co.il)
- **Type**: Digital invoicing SaaS platform with bundled payment clearing. Acquired June 2021.
- **Marketplace/split**: NOT FOUND. Invoicing-first product.
- **Verdict**: EXCLUDED. Same category as iCredit/Rivhit — invoicing tool, not a marketplace gateway.

### Green Invoice / Morning (greeninvoice.co.il)
- **Type**: Israeli accounting/invoicing SaaS. Acquired by TeamSystem Dec 2024 for $150M.
- **Marketplace/split**: NOT FOUND. Invoicing-first.
- **Verdict**: EXCLUDED. Same category.

### UNIPaaS (unipaas.com)
- **Type**: Embedded payments platform for SaaS/marketplaces. Israeli-founded (Tel Aviv, 2020), also has UK FCA-regulated entity. Built by ex-SafeCharge management team.
- **Marketplace/split**: YES — explicit. Platform-as-MoR model OR vendor-as-MoR model. Sub-merchant onboarding (KYB/KYC managed). Automated payouts. Fee control (charge at intake, payout, or both). Escrow-equivalent (control payout timing).
- **Onboarding friction**: NOT self-serve. Sales-led, custom pricing ("bespoke quote"). No public fees. "Book a demo" flow.
- **Entity requirements**: Terms don't restrict to Israeli entities. Onboarding docs reference UK-style banking (sort code, Plaid) — scope appears INTERNATIONAL, not Israel-only. This is the KEY differentiator — UNIPaaS may be usable by a US company.
- **Tashlumim + Bit**: NOT CONFIRMED. No explicit mention found. UNIPaaS appears more UK/EU/international rail (Visa/MC/bank transfer/direct debit). Israeli-specific methods (tashlumim, Bit) not documented.
- **Integration**: REST API (docs.unipaas.com). Clean, modern docs.
- **Verdict**: POTENTIAL EXCEPTION TO THE "ENTITY REQUIRED" RULE. UNIPaaS's UK entity + international scope suggests a US company might be eligible. But: likely no tashlumim or Bit (they appear to run on UK/EU rails, not Israeli SHVA). If tashlumim+Bit are required, this doesn't fully replace a local Israeli gateway. If you want a cleaner marketplace split without an Israeli entity and can live without tashlumim, worth ONE sales call. Comparable to Stripe Connect in position but with Israeli founders who understand the local market.

### BridgerPay (bridgerpay.com)
- **Type**: Payment ORCHESTRATION platform (not an acquirer). Connects to 500-1000+ PSPs/gateways. Israeli-founded. Has Shva Arena partnership (connects Israeli businesses to national payment infrastructure).
- **Marketplace/split**: PARTIAL. "Sub-merchant controls" and "multi-seller transactions" mentioned but the orchestration layer alone doesn't do splits — it routes to underlying acquirers which must do the split. Sits on top of other gateways.
- **Onboarding friction**: Enterprise/mid-market SaaS product. Not self-serve. Not for a small startup.
- **Entity requirements**: Unknown. As an orchestrator, the underlying gateway's requirements apply.
- **Verdict**: EXCLUDED for Swellyo's stage. Orchestration layer, not an acquirer. For a startup-scale marketplace, adding orchestration complexity on top of already-complex Israeli rails is overkill.

### Nayax (nayax.com)
- **Type**: Cashless payment terminal company for vending/unattended retail. NYSE listed. 3.5B txns/yr.
- **Verdict**: EXCLUDED. Vending machine payments. Completely wrong product.

### PayBox (paybox.co.il)
- **Type**: Israeli P2P payment app (consumer). Owned by Discount Bank. 1.4M users.
- **Verdict**: EXCLUDED. Consumer P2P app, not a merchant acquiring product.

## Summary Table

| Provider | Split/Marketplace | Tashlumim | Bit | Israeli Entity? | Onboarding Friction | Fees |
|---|---|---|---|---|---|---|
| **Grow/Meshulam** | MAYBE (undocumented "multi-business") | YES (12) | YES | LIKELY YES | VERY LOW (self-serve) | 1.7%+₪1 or ₪59/mo+1.5% |
| **Z-Credit** | NO | UNCLEAR | UNCLEAR | YES | MEDIUM | Unknown (post-Dejavoo) |
| **PayMe** | YES (documented API) | YES (12) | YES | LIKELY YES (vendor leg) | HIGH (white-label/enterprise) | OPAQUE |
| **HYP/Pelecard** | NO | YES | YES (≤₪5k) | YES (implied) | MEDIUM | Unknown |
| **YaadPay** | NO | UNCLEAR | UNCLEAR | YES | N/A (now merged into HYP) | N/A |
| **Allpay** | NO | YES (12) | YES | YES (explicit) | VERY LOW | 1.45%+₪1/txn, ₪50/mo |
| **SUMIT** | YES (J5 only) | UNCLEAR | UNCLEAR | YES | LOW (SaaS) | Subscription |
| **iCredit/Rivhit** | NO | UNCLEAR | UNCLEAR | YES | LOW | Unknown |
| **EZcount** | NO | NO | NO | YES | LOW | Unknown |
| **UNIPaaS** | YES | UNCLEAR/LIKELY NO | LIKELY NO | POSSIBLY NO | HIGH (sales-led) | OPAQUE |
| **BridgerPay** | PARTIAL (orchestration) | VIA UNDERLYING | VIA UNDERLYING | DEPENDS | HIGH (enterprise) | OPAQUE |
| **Nayax** | NO | NO | NO | YES | N/A | N/A |

## The Two Worth Calling

**Call 1 — PayMe (partnerships@payme.io):** Has the most complete marketplace/split API. The decisive question: "We have an Israeli Osek Murshe / Ltd co-founder. Can that entity sign up for your marketplace platform API with split/payout features? What's your minimum volume threshold?" If yes → strongest domestic option.

**Call 2 — UNIPaaS (sales form):** The only candidate that MAY work without an Israeli entity (UK-licensed, international scope). The decisive question: "We're a US LLC. Can we use your platform for a marketplace with Israeli trip operators as sub-merchants? Do you support Israeli domestic ILS acquiring (SHVA), tashlumim, and Bit?" If they support Israeli domestic rails → solves the entity problem. If not → they're just a more expensive Stripe Connect.

## Sources
- https://grow.business/api-developers/ — Grow multi-business mention
- https://grow-il.readme.io/ — Grow docs sections list
- https://docs.payme.io/docs/payments/1840bzrqlh9vn-platforms-and-marketplaces — PayMe marketplace docs
- https://help.payme.io/hc/en-us/articles/360013964399-Alternative-Payment-Method-Bit — PayMe Bit support
- https://developers.hyp.co.il/llms-full.txt — HYP full docs (tashlumim + Bit confirmed, no marketplace)
- https://www.allpay.co.il/en/help/onboarding-requirements — Allpay Israeli entity requirement (explicit)
- https://www.allpay.co.il/en/pricing — Allpay fees
- https://help.sumit.co.il/he/articles/5832873 — SUMIT marketplace clearing (Hebrew)
- https://docs.unipaas.com/docs/platform-overview — UNIPaaS platform
- https://docs.unipaas.com/docs/onboarding-statuses — UNIPaaS international scope (sort code, Plaid)
- https://www.unipaas.com/pricing — custom quote only
- https://tracxn.com/d/companies/unipaas — UNIPaaS founded 2020, UK entity
- https://www.finsmes.com/2024/06/dejavoo-acquires-z-credit-and-z2c.html — Z-Credit acquired by Dejavoo June 2024
- https://payatlas.com/countries/israel-il — Israeli payment landscape overview
- https://forum.bubble.io/t/how-to-implement-split-payments-between-multiple-recipients-without-passing-through-platform-s-bank-account-israel-based-marketplace/375376 — community thread, no solution found
