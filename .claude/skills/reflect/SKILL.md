---
name: reflect
description: End-of-session reflection. Reviews the conversation for corrections, friction, and patterns. Interviews the user to decide what to keep, then updates memory and/or CLAUDE.md. Use when the user says "reflect", or at the end of a work session.
argument-hint: [optional: specific area to reflect on]
allowed-tools: Read, Edit, Write, Grep, Glob, AskUserQuestion
---

# Session Reflection

You are performing an end-of-session review. Your job is to mine this conversation for lessons, then collaborate with the user to decide what becomes permanent knowledge.

## Phase 1: Silent Analysis

Review the ENTIRE conversation and identify:

1. **Corrections** — places the user said "no", "not that", "stop", "wrong", redirected you, or rejected a tool call
2. **Friction** — approaches that took multiple attempts, went in circles, or wasted time
3. **Wins** — approaches that worked well, especially non-obvious ones the user confirmed
4. **Patterns** — recurring themes across corrections or wins (e.g., "always researches before X", "prefers Y over Z")
5. **CLAUDE.md gaps** — things you had to figure out that should have been documented (quirks, conventions, preferences)

Categorize each finding as:
- **Memory-worthy** — useful for future sessions but not a hard rule (save to memory/)
- **CLAUDE.md-worthy** — a pattern strong enough to become a permanent project instruction
- **Skip** — one-off situation, not generalizable

## Phase 2: Interview the User

Use AskUserQuestion to present your findings and get the user's input. Structure it as:

### Round 1: Present Findings
Show a concise summary of what you found, grouped by category. For each item, state:
- What happened (1 sentence)
- What you learned (1 sentence)
- Your recommendation: memory, CLAUDE.md, or skip

Ask: "Which of these do you agree with? Anything to change, drop, or add?"

### Round 2: Drill Into CLAUDE.md Changes
For any item the user approved as CLAUDE.md-worthy, propose the exact text you'd add. Show:
- Which section it belongs in
- The exact wording (following the meta-rules below)

Ask: "Good with this wording? Want me to adjust anything?"

### Round 3: Confirm and Execute
Summarize the final plan:
- What goes to memory (with file names)
- What goes to CLAUDE.md (with exact placement)
- What gets skipped

Ask: "Ready to write these? Anything else from this session I missed?"

Keep rounds tight — 2-4 questions max per round. Don't over-ask. If the session was simple with few corrections, you might only need 1 round.

## Phase 3: Write

After user approval:

1. **Memory files** — write to the project memory directory following the existing frontmatter format (name, description, type). Update MEMORY.md index.
2. **CLAUDE.md edits** — apply changes to the appropriate section. Follow the meta-rules below strictly.

## Meta-Rules for Writing CLAUDE.md Rules

When adding rules to CLAUDE.md, follow these principles to prevent bloat and maintain quality:

### Always:
- **Use absolute directives** — start with NEVER or ALWAYS for non-negotiable rules
- **Lead with why** — explain the problem before the solution (1 line max)
- **Be concrete** — include actual file paths, commands, or code patterns from this project
- **One rule, one line** — if it needs a paragraph, it's too complex or too vague

### Never:
- Add rules that duplicate what's already in CLAUDE.md
- Add rules that are obvious from the code itself (conventions a competent dev would infer)
- Add vague vibes ("be careful with X") — make it actionable
- Add rules from a single incident unless the user explicitly says to
- Let CLAUDE.md grow past ~200 lines — if adding, consider what can be removed or consolidated

### Placement Guide:
| Type of rule | Section |
|-------------|---------|
| API/endpoint behavior | Architecture |
| Code style/patterns | Conventions |
| Workflow preference | How to work with me |
| Dangerous gotcha | Known quirks |
| Non-negotiable constraint | Hard rules |

## Important

- Do NOT reflect mid-session. This skill runs only when explicitly invoked.
- Do NOT fabricate corrections that didn't happen. Only report what's actually in the conversation.
- If the session had no corrections or friction, say so. Don't force lessons where there are none.
- Prioritize quality over quantity. 1 good CLAUDE.md rule > 5 mediocre memory entries.
