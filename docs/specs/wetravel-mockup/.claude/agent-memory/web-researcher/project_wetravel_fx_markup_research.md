---
name: project-wetravel-fx-markup-research
description: WeTravel FX/currency-conversion markup research (Aug 2026) - what WeTravel publishes vs what reviews claim
metadata:
  type: project
---

Researched (2026-08-25) whether WeTravel (wetravel.com) publishes a numeric FX
markup/spread anywhere, for a competitive-analysis doc under
`docs/specs/wetravel-mockup/`.

**Bottom line: WeTravel never publishes a spread/markup percentage for currency
conversion anywhere in its help center or product pages.** It only uses
qualitative marketing language ("market-leading exchange rates", "best-in-market
FX rates", "better than most commercial banks", "no additional fees"). The
classic "free conversion, margin hidden in the rate itself" pattern.

**Why:** informs how to frame any comparison — Swellyo/other products should be
explicit that WeTravel's true FX cost is unknowable from public sources, not
"X% vs our Y%".

**How to apply:** If this topic resurfaces (e.g. building a pricing comparison
page or pitch deck), don't re-run the same searches — the sourced quotes below
are current as of 2026-08-25. Re-verify only if >3 months old, since help
articles get edited without changing URLs.

## Verified quotes (fetched directly from help.wetravel.com / product.wetravel.com, reproduced consistently)

- Inter-wallet convert (help.wetravel.com/en/articles/9039078): "The conversion
  from one currency to another has no additional fees for you." + "The exchange
  rate changes based on the international rate" (rate source undefined — not
  stated as mid-market).
- Multi-currency checkout (help.wetravel.com/en/articles/8694062): "market
  leading exchange rates that are better than most commercial banks"; "Any
  differences due to exchange rate fluctuations will be absorbed by WeTravel."
- Pricing (help.wetravel.com/en/articles/434422): "3.9% credit card fee" for
  trips priced in currencies outside WeTravel's supported holding list; wire
  transfers "$15 (or equivalent) per transfer"; academy.wetravel.com states
  baseline card fee as "2.9% credit card processing fee (3.9% for AMEX)" —
  these two 3.9% figures may or may not be the same line item, could not
  fully reconcile.
- product.wetravel.com/pricing and /payment-processing: "Best-in-market FX
  rates" listed as a bullet feature — no number given anywhere on either page.
- WeTravel Card (International) (help.wetravel.com/en/articles/16032403): "no
  annual, card-creation, membership, or cross-border fees"; off-held-currency
  spend "auto-converts from your main balance at our issuing partner's rate —
  with no separate conversion fee" (i.e., markup, if any, is inside that rate,
  never disclosed as %). Card cannot do cash withdrawals (no ATM fee applies
  because no ATM function exists).
- WeTravel Card (US) per search snippet only (page itself is a collection, not
  fully fetchable as one article): "Payments in non-USD currencies will be
  converted at the midmarket rate, and foreign transaction fees may apply" —
  notably this is the ONLY place WeTravel uses the words "midmarket rate"
  explicitly, and only for the US card, not the international card or the
  general inter-wallet convert / checkout products.
- WeTravel Card Program Agreement (wetravel.com/card_agreement — blocked by
  403 direct fetch and returns only a cookie-consent shell via r.jina.ai, so
  this is SEARCH-SNIPPET SOURCED ONLY, not independently read): "WeTravel may
  decide to charge a foreign transaction fee (not to exceed 3% of the total
  transaction amount)" — reads like standard card-issuing-program boilerplate
  (Marqeta/Visa template), i.e. a permitted ceiling, not a confirmed charged
  rate.

## Reviews (reviews.io, consistently reproduced across 2 fetches — treat as reliable)

- Ross Ramsay (Verified, ~1yr old snapshot at research time): "Wetravel charge
  high transfer fees but then make their real money by using exchange rates
  that are unreasonable compared to the rates offered by banks and can cost
  users many hundreds of dollars in extra hidden costs." No figures given.
- Anonymous (Verified): "Awful, awful fees and exchange rates, esp. if you're
  paying from outside the US, UK, and Western Europe." No figures.
- Anonymous (Unverified, dive shop): "not only do they charge 3% for using a
  credit card, but they also charge a slightly higher fee, which... comes out
  to just over 6% for using a credit card." This is a card-fee-stacking
  complaint (their bank's foreign-card fee + WeTravel's card fee), NOT a clean
  isolated FX-conversion spread — don't cite as "WeTravel's FX markup is 6%".

## The "€41 fee / €250 hidden FX cost" claim — COULD NOT VERIFY, likely a search-tool hallucination

Extensive attempts (Trustpilot pages 1/2/3/5/7 across multiple fetches,
reviews.io full review list x2, targeted searches) never located this specific
review. It first appeared as a WebSearch tool's own synthesized summary
(no direct link to the actual review), and could not be reproduced from any
direct page fetch. Do not cite these numbers as real without a directly-quoted
source with a working permalink.

See [[reference_trustpilot_fetch_unreliable]] for the underlying tool-reliability
problem that made this hard to run down.

## Not found despite searching
- No blog/forum post where an operator measured WeTravel's actual conversion
  rate against xe.com/mid-market on the same day.
- No G2/Sitejabber-specific FX complaints (searches ran out of budget before
  fully covering these — worth a follow-up pass if this topic reopens).
