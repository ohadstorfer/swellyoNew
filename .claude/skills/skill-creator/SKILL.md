---
name: skill-creator
description: Create new Claude Code skills interactively. Use when the user wants to create a skill from scratch, turn a workflow into a skill, or says things like "make a skill for", "create a slash command", "turn this into a skill".
---

# Skill Creator

Help the user create a new Claude Code skill through an interactive process.

## Step 1: Capture Intent

Ask the user (using AskUserQuestion):
1. What should this skill do? (What task does it automate or guide?)
2. When should it trigger? (What would the user type or what context activates it?)
3. Who invokes it — the user manually, Claude automatically, or both?
4. Does it need arguments? (e.g., `/skill-name [filename]`)

If the user said "turn this into a skill" about a workflow in the current conversation, extract answers from the conversation history first.

## Step 2: Determine Configuration

Based on answers, decide:

| Question | Setting |
|----------|---------|
| Only user triggers it? | `disable-model-invocation: true` |
| Only Claude triggers it? | `user-invocable: false` |
| Needs specific tools? | `allowed-tools: Read, Grep, Bash` |
| Should run in isolation? | `context: fork` + `agent: Explore` |
| Takes arguments? | `argument-hint: [description]` |

## Step 3: Write the SKILL.md

Generate a complete SKILL.md with:

```yaml
---
name: skill-name
description: [Detailed description including WHEN to use it. Be slightly "pushy" — list multiple trigger phrases so Claude doesn't under-trigger.]
[other frontmatter as needed]
---

[Clear, imperative instructions]
[Steps numbered if it's a workflow]
[Output format if applicable]
```

### Writing Guidelines
- Use imperative form ("Run X", "Check Y", not "You should run X")
- Explain WHY things matter, not just WHAT to do
- Include a "When to use / When NOT to use" section
- Keep under 200 lines (ideally under 100)
- If the skill needs templates or scripts, create supporting files

## Step 4: Install

Create the skill at the appropriate location:
- **Project-specific**: `.claude/skills/<name>/SKILL.md`
- **Personal (all projects)**: `~/.claude/skills/<name>/SKILL.md`

Ask the user which they prefer.

## Step 5: Test

Suggest 2-3 example prompts the user can try to verify the skill works correctly. Explain how to invoke it (`/<name>` or automatic based on description).

## Description Writing Tips

The description is the #1 factor for whether Claude auto-triggers a skill. Make it:
- Specific about WHAT it does
- Generous with WHEN to use it (list contexts, trigger phrases)
- Slightly pushy — "Use this whenever the user mentions X, Y, or Z"
- Not too long — ~2-3 sentences max
