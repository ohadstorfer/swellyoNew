# Deploy and verify (surf-level filter)

## Deploy

After pulling the latest code, redeploy so the running edge function matches the repo:

```bash
supabase functions deploy swelly-trip-planning-copy
```

## Verify "beginner" filter

1. Run a **beginner shortboarder** search (e.g. ask for "beginner shortboarder", tap Search when prompted).
2. **Server logs:** In Supabase Dashboard → Edge Functions → Logs for `swelly-trip-planning-copy`, confirm:
   - `[find-matches] tripPlanningData.queryFilters` includes `surf_level_category: "beginner"` (or `["beginner"]`).
   - `[find-matches] surf_level_category present: true`.
   - Returned matches do **not** include surfers with `surf_level: 3` (e.g. "Trimming Lines" in the UI).
3. If "beginner" still returns advanced surfers, the new logs will show whether the problem is missing `queryFilters` / `surf_level_category` in the request or the filter logic (e.g. wrong deployment).
