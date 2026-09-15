---
name: reference-trustpilot-fetch-unreliable
description: WebFetch on trustpilot.com/ca.trustpilot.com review pages returns inconsistent content across identical repeated calls - don't trust single-fetch quotes
metadata:
  type: reference
---

Discovered while researching [[project_wetravel_fx_markup_research]].

Fetching the exact same Trustpilot URL (e.g.
`https://ca.trustpilot.com/review/wetravel.com?page=7`) twice in a row, with
similar prompts, returned two completely different sets of reviews (different
reviewers, different dates, different content) — once returning 2026-dated
reviews mentioning specific fee percentages ("Jim H.", "Koen", "Nik"), and once
returning entirely different 2024-dated 5-star reviews with no fee mentions at
all. Likely cause: Trustpilot's page is JS-rendered/dynamically sorted
("most relevant" ordering can shift), and/or the small fetch-summarization
model fills gaps when a prompt strongly primes it to find specific content.

**Why this matters:** a single WebFetch call to a Trustpilot page is NOT a
reliable source for a verbatim quote. Reviewer names/dates/percentages
returned by one fetch may not be reproducible or even real.

**How to apply:** For any research task needing verbatim Trustpilot review
text, fetch the same URL 2+ times with a neutral (non-leading) prompt and only
trust content that reproduces identically. reviews.io, by contrast,
reproduced identically across 2 fetches in this session and was more
trustworthy. Prefer sites that render server-side / don't need JS.
