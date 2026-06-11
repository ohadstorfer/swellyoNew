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
- **Stars:** 29,636 (per Snyk — repo page shows 89k which appears inflated; contributor section errors out)
- **MIT license**
- **Different strength:** Massive database approach — 50+ styles, 97 color palettes, 57 font pairings, 99 UX guidelines across 10 tech stacks. More systematic/encyclopedic vs Anthropic's more opinionated/creative approach.
- **Legitimacy flag:** Star count discrepancy (29k vs reported 89k), contributor section load errors. Treat as lower-confidence than Anthropic official.

---

## Snyk's ranked list for UI/UX (June 2026)
1. Anthropic frontend-design — 65,847 stars
2. Vercel Web Design Guidelines — 19,487 stars
3. UI/UX Pro Max — 29,636 stars (Snyk number)

---

## Key "gotcha" for adaptation
The Anthropic frontend-design skill says "vary themes across generations" which is impossible (Claude has no memory between sessions). When adapting, remove or reframe any cross-session instructions to be single-session directives.
