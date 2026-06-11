---
name: appcontent-effect-deps
description: AppContent effects calling openTripCard/requestTab omit them from deps; currently safe because those callbacks have [] deps, but fragile
metadata:
  type: feedback
---

Several useEffect hooks in AppContent call `openTripCard` or `requestTab` without listing them in the dep array (invite resolver at line 276, push-handler setup at line 381). Today this is safe because `openTripCard` and `requestTab` are both `useCallback([], [])` — stable across all renders. But if either grows deps in the future, the effects will silently capture stale closures.

**Why:** The pattern was inherited from the old `setPendingTripDetailId` state-setter approach (setters are always stable). The callbacks moved to useCallback but the effect deps were not updated to match.

**How to apply:** When reviewing AppContent effect changes, flag any effect that calls these callbacks without including them in deps. Consider adding a lint comment if intentionally omitted.
