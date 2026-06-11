# Phase 0 — Prep (no visible change)

## Pre-verified (already done, no action)
- MainActivity.kt fragment-restore patch: `super.onCreate(null)` ALREADY present (Expo template default)
- Predictive back: `android:enableOnBackInvokedCallback="false"` ALREADY in AndroidManifest.xml

## Steps
1. Branch: `git checkout main && git pull && git checkout -b nav-migration`
2. Carry planning files (task_plan.md, findings.md, progress.md, docs/nav-migration/) onto the branch.
3. AppContent.tsx top-of-file comment:
   `// NAV MIGRATION IN PROGRESS (see task_plan.md) — do NOT add new showX boolean flags.`
   `// New screens go through the navigator. Ask Eyal/Claude before touching routing logic here.`
4. Install nothing — all packages already present (@react-navigation/native 7.1.17, native-stack 7.14.11,
   bottom-tabs: VERIFY installed; if missing: npx expo install @react-navigation/bottom-tabs)
5. Verify: `npx tsc --noEmit` error count unchanged (baseline: 268); app boots in dev client.

## Acceptance
- Branch exists, comment in place, zero behavior change, Ohad notified (Eyal sends him the HTML plan).
