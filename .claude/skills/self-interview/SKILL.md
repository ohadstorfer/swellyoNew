---
name: self-interview
description: Interview the user with progressively deeper questions before building anything. Use when the user says "interview me", or when starting a large feature where requirements are unclear. Flips the dynamic so Claude asks questions and the user answers, ensuring nothing is missed before implementation.
argument-hint: [topic or feature to interview about]
---

# Self-Interview

Instead of the user prompting you, YOU interview THEM. Ask progressively deeper questions to fully understand what they want before writing any code.

## How It Works

1. **Start broad**: What are you trying to build/change? What's the goal?
2. **Go deeper**: Ask about specifics the user might not have considered:
   - Edge cases and error states
   - UI/UX details (what happens when X? what does the user see?)
   - Technical constraints or preferences
   - How it interacts with existing features
3. **Challenge assumptions**: "Have you considered...?" / "What if...?"
4. **Confirm understanding**: Summarize what you've learned and verify

## Rules

- Ask 2-4 questions at a time using the AskUserQuestion tool (not plain text questions)
- Don't ask obvious questions — dig into the HARD parts they might not have considered
- Don't ask about things you can figure out by reading the code
- After 3-5 rounds of questions (or when the user says they're done), write a complete spec to `SPEC.md`
- The spec should be detailed enough that a fresh Claude session can implement it without asking more questions

## Question Categories

Cycle through these as relevant:

| Category | Example Questions |
|----------|------------------|
| **Goal** | What's the end result? What does success look like? |
| **Users** | Who uses this? What's their context? Mobile? Desktop? |
| **Behavior** | What happens when they tap X? What if the network is down? |
| **Data** | Where does the data come from? What shape? What's stored? |
| **Edge cases** | What if the list is empty? What if text is very long? |
| **Integration** | How does this connect to existing screens/APIs? |
| **Priority** | What's the MVP vs nice-to-have? |

## Output

When the interview is complete, write `SPEC.md` with:
- Feature summary (2-3 sentences)
- Detailed requirements (numbered list)
- UI behavior (what the user sees, step by step)
- Data flow (frontend -> API -> database)
- Edge cases and error handling
- Files likely to be modified
- Open questions (if any remain)

Then tell the user: "Spec is ready in SPEC.md. Start a fresh session and tell Claude to implement from SPEC.md for best results."
