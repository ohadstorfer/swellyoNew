# Status — Onboarding freeze investigation, July 28 2026

1. Confirmed the freeze still reproduces in dev even with `EXPO_NO_METRO_LAZY=1`.
2. Temporarily disabled `SurfSkillCard` in `ProfileScreen`, including its preload/cache path.
3. Temporarily skipped the post-onboarding profile overlay in `AppContent`.
4. Temporarily disabled PostHog session replay.
5. The app still froze on a fresh onboarding run, but a full close and reopen comes up clean.
6. Updated [`docs/freeze-two-round-audit-verdict.md`](../freeze-two-round-audit-verdict.md) with the failed isolates and the new working hypothesis.

Current read: the bug is still in the first-launch onboarding transition path, but the video player and session replay are not enough to explain it by themselves. Next place to inspect is the boot-time work that runs immediately after onboarding completes.
