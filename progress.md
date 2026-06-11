# Progress Log — Navigation Migration

## Session 2026-06-11 (start of operation)
- Web research complete (6 streams, saved to .claude/agent-memory/web-researcher/)
- Architecture locked with Eyal: one deck + 3 roots, cards cover nav, sheets in history
- navigation-migration-plan.html approved ("generally good"; inventory known-incomplete)
- task_plan.md / findings.md / progress.md created
- DB-impact question answered: zero DB changes
- Phase R complete: 7-agent fleet (~733k subagent tokens, 15 min), reports R1–R7 on disk
- findings.md synthesized; 5 open decisions queued for Eyal
- Decisions: SwellyShaper kept; Copy→main merge approved (Phase 4); web ignored entirely
- Commit policy: Claude commits on nav-migration; Eyal reviews per phase before merge to main
- Phase 0 DONE (d1ff801): branch, bottom-tabs installed, guard comment; native patches were pre-existing
- Phase 1 DONE (c7e657d + 166ad31 review fixes): RootStack→HomeTabs skeleton, TripsBottomNav as
  tabBar, showTrips deleted, requestTab mechanism, Swelly z-order fix. tsc 268 baseline held;
  iOS export verified; code-reviewer audit passed (2 should-fixes applied).
- Phase 1 device-tested by Eyal: caught blank-Profile bug (slide-out on kept-mounted tab —
  fixed dcd085c) + PostHog useNavigationState noise (captureScreens off — ba3c034).
  Locked rule: ROOTS SNAP, CARDS SLIDE. Chat-slide expectations = Phase 3.
- Phase 2 DONE (ed7b797 + 3063bf3 + af59681): TripDetail/EditTrip = root-stack cards;
  NotificationsPanel = transparentModal route IN back history (original bug fixed);
  pendingTripDetailId state machine deleted; NotificationCenter split bell/panel.
  Review: no criticals; fixes applied. NOTE: reviewer's dep-array suggestion caused a real
  TDZ bug — reverted; dep arrays evaluate during render, late-declared callbacks can't go in.
- KNOWN pre-existing (Phase 3 fixes structurally): join-decision approve while a DM is open
  pushes the trip card invisibly under the DM overlay.
- Phase 2 device-testing saga (IMPORTANT lessons):
  - Bell from Lineup failed: ConversationsStack is `independent` — local dispatches don't
    reach root. Fixed with pushRootCard via navigationRef (2813e39).
  - transparentModal panel → iOS native modal context: cards-on-top presented as SHEETS,
    plus shivering/stuck-scroll/2 hard crashes (suspected same root). containedTransparentModal
    → cards rendered UNDERNEATH. Final fix 37d56d7: panel is a PLAIN CARD (it's opaque
    full-screen anyway); all self-animation machinery deleted. RULE: avoid modal-presentation
    routes for anything that gets cards pushed on top.
  - 51ff89d: bar is roots-only (ConversationsStack reports inner DM pushes via
    screenListeners → lineupInnerScreenOpen); Lineup top-left profile entry removed
    (display-only — profile via bottom nav).
- OPEN: Eyal to confirm crashes/shivering gone after panel-as-card; full phase-2.md checklist.
- NEXT after Phase 2 green: Phase 3 — STARTS WITH KEYBOARD SPIKE on device (DM in native-stack
  card; fallback JS sub-stack), then unify 3 DM paths, profile/Settings cards. See
  docs/nav-migration/phases-2-5-outline.md.
- Branch state: nav-migration, 12 commits ahead of main, NOT pushed. Eyal reviews before merge.
