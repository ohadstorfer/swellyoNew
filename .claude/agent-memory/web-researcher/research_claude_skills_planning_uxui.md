---
name: claude-skills-planning-uxui
description: Best Claude Code skills for planning/requirements thinking (Skill 1) and UX/UI design quality (Skill 2) — for a fast-urls workspace where Claude turns founder briefs into live web pages
metadata:
  type: reference
---

## Context
Researched for a "fast-urls" workspace that converts a non-technical founder's 2-line idea into a polished, live web page. Two skills needed.

---

## Skill 1 — Planning / Requirements Thinking

### Winner: obra/superpowers — brainstorming skill
- **Repo:** https://github.com/obra/superpowers
- **Stars:** 222,000 (MIT, actively maintained, v5.1.0 May 2026)
- **Maintainer:** Jesse Vincent / Prime Radiant — on Anthropic official marketplace
- **How it works:** 14 individual SKILL.md files. The `brainstorming` skill is the planning gate — enforces a 9-step Socratic process before any code is written:
  1. Explore context (read existing files, docs)
  2. Ask clarifying questions (one per message, multiple-choice format)
  3. Propose 2-3 approaches with trade-offs
  4. Present design section-by-section for approval
  5. Write validated spec to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
  6. Self-review spec for gaps/contradictions
  7. Gate on user approval before proceeding
  8. Then invoke `writing-plans` to create task-by-task implementation plan
- **Activation:** Mandatory for any feature/page/component. The `using-superpowers` skill enforces skill-checking before ANY response.
- **Key strength for non-technical founders:** Refuses batch questions. One conversational question at a time. Works for 40% non-code use cases (content, design, research). Not a code tool — a thinking discipline tool.

### Strong second: OthmanAdi/planning-with-files
- **Repo:** https://github.com/OthmanAdi/planning-with-files
- **Stars:** 22,900 (MIT, v2.43.0 May 2026, 66 releases)
- **Different focus:** Persistent memory across context resets — creates task_plan.md, findings.md, progress.md. Manus-style. Better for long multi-session projects; overkill for quick one-shot page builds.

---

## Skill 2 — UX/UI Design Quality

### Winner: Anthropic official frontend-design skill
- **Repo 1:** https://github.com/anthropics/skills/tree/main/skills/frontend-design (148k stars on parent repo)
- **Repo 2:** https://github.com/anthropics/claude-code/blob/main/plugins/frontend-design/skills/frontend-design/SKILL.md (277k+ installs, 65k stars, Feb 2026 update)
- **License:** Apache 2.0 — freely copyable and adaptable with attribution
- **Maintainer:** Anthropic — official, on Claude plugin marketplace
- **What it enforces:**
  - Pre-coding design thinking: Purpose, Tone (pick an extreme direction), Constraints, Differentiation
  - Bans explicitly: Inter/Roboto/Arial/Space Grotesk, purple gradients on white, predictable layouts, cookie-cutter patterns
  - Mandates: unexpected fonts, asymmetric layouts, dominant colors + sharp accents, CSS animations, noise textures/gradient meshes/grain overlays
  - Complexity matching: maximalist = elaborate code; minimalist = precision + restraint
  - Activation: any request to build web components, pages, landing pages, dashboards, HTML/CSS, React UI
- **Known gap (from Justin Wetch's analysis):** "Never converge across generations" is unactionable since Claude has no cross-session memory. Fix: replace with "Never settle on the first obvious choice; if a font/color/layout feels common, deliberately explore alternatives."

### Runner-up: nextlevelbuilder/ui-ux-pro-max
- **Repo:** https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
- **Stars:** ~90k on repo page (as of June 2026), but growth chart shows sudden vertical spike from near-zero, not organic growth. Created Nov 30, 2025 — 90k in ~6 months is a red flag. Snyk cites 29,636 independently. Treat the star count as suspicious.
- **License:** MIT
- **Last update:** v2.5.0 on March 10, 2026
- **Primary language:** Python (78.5%), JS/TS (18%)

#### What it actually is (deep audit, June 2026)
It is a data-driven design intelligence system with a Python search engine at its core. NOT just a SKILL.md prompt file.

**Internal architecture:**
- `src/ui-ux-pro-max/data/` — 14 CSV databases: products.csv, styles.csv, colors.csv, typography.csv, ui-reasoning.csv, ux-guidelines.csv, charts.csv, google-fonts.csv, landing.csv, react-performance.csv, icons.csv, design.csv, draft.csv + `stacks/` subdir
- `src/ui-ux-pro-max/scripts/` — Python search engine: `search.py` (CLI), `core.py` (BM25 + regex hybrid search), `design_system.py` (design system generation)
- `.claude/skills/ui-ux-pro-max/` — SKILL.md + symlinks back to src/
- 7 sub-skills total: `ui-ux-pro-max`, `design`, `design-system`, `ui-styling`, `brand`, `banner-design`, `slides`

**How it works mechanically:**
Claude (or the user) runs `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain <domain>` to query the CSVs. The BM25+regex hybrid search returns ranked design recommendations. The `--design-system` flag generates a complete design system. Results can be persisted as markdown files. Claude's SKILL.md instructs it to call this script when any UI task is requested.

**Requires Python 3.x** on the machine. Not pure prompt injection.

**Content databases:**
- 67 UI styles (glassmorphism, neumorphism, brutalism, AI-native, etc.)
- 161 color palettes (industry-aligned)
- 57 font pairings (Google Fonts)
- 99 UX guidelines (accessibility, touch targets, animation durations, etc.)
- 161 industry reasoning rules (product types: SaaS, fintech, healthcare, e-commerce, etc.)
- 25 chart types
- 15 tech stacks (React, Next.js, Vue, Svelte, SwiftUI, React Native, Flutter, Tailwind, shadcn/ui, HTML/CSS, others)

**Mobile/React Native support:** Listed as a supported stack. Mobile pre-delivery checklist covers safe areas, accessibility labels, modal scrim opacity. However no RN/Expo-specific community feedback found validating this. Web (Tailwind/React) is clearly the primary use case.

**Token footprint:** Not documented officially. SKILL.md alone is modest (~medium prompt size), but the Python search engine + CSV databases are not in-context — they're executed externally and results injected.

**Install methods:**
1. CLI: `npm install -g uipro-cli` then `uipro init --ai claude` in project root
2. Global: `uipro init --ai claude --global` (installs to `~/.claude/skills/`)
3. Plugin marketplace: `/plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill`
- Files land in `.claude/skills/ui-ux-pro-max/` (known broken path in early versions — Issue #123 documented that Claude Code expected root `skills/` not `.claude/skills/`, fixed in later CLI versions)

**Invocation:** Auto-activates on any UI request. No explicit slash command needed for Claude Code.

**Community red flags (June 2026):**
- Issue #161: User claims premium subscription disappeared, support unresponsive, called it a "scam" (closed as not planned, no response from maintainer visible)
- Issue #304: "messed up my opencode client" on uninstall
- Issue #333: "Claude tags [skill] as malicious" — Claude flagging the injected system prompt
- Issue #335: "tags as prompt injection" — security concern about skill contents
- Multiple "can't install" / "can't uninstall" open issues
- No community comments on promotional articles — no verified user success stories found

**Freemium model:** The skill has a paid subscription tier ("Polar" payment platform). Free tier is the open-source SKILL.md + CSVs. What the paid tier adds is unclear from docs — one user complaint suggests "credits" model.

**Verdict vs Anthropic frontend-design:**
- Anthropic skill = opinionated creative direction (what to avoid, what to mandate). Pure SKILL.md, no deps, no Python, no install friction.
- ui-ux-pro-max = encyclopedic searchable database. More systematic, more moving parts, suspicious star count, active community complaints about install/uninstall/security flags, possible freemium friction.

---

## Snyk's ranked list for UI/UX (June 2026)
1. Anthropic frontend-design — 65,847 stars
2. Vercel Web Design Guidelines — 19,487 stars
3. UI/UX Pro Max — 29,636 stars (Snyk number)

---

## Key "gotcha" for adaptation
The Anthropic frontend-design skill says "vary themes across generations" which is impossible (Claude has no memory between sessions). When adapting, remove or reframe any cross-session instructions to be single-session directives.
