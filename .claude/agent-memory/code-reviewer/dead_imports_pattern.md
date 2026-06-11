---
name: dead-imports-pattern
description: TripsScreen accumulates dead Reanimated imports and unused StyleSheet entries when overlay code is deleted
metadata:
  type: project
---

After the Phase 2 migration deleted the `selectedTripId`/`editingTrip` overlay renders in TripsScreen, `SlideInRight` and `SlideOutRight` from react-native-reanimated were left as dead imports (lines 65-66). The `styles.screenOverlay` StyleSheet entry (line 1758) was also left unreferenced.

**Why:** The overlays that used them were removed but the imports/styles were not swept.

**How to apply:** When reviewing TripsScreen changes that remove overlay renders, grep for lingering Reanimated animation imports and orphaned StyleSheet keys.
