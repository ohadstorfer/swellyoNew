# PostHog User Name Implementation - Summary

## What Was Implemented

This implementation ensures that PostHog surveys and dashboards display user names instead of UUIDs.

## Files Modified

### 1. `src/services/analytics/analyticsService.ts`
- **Updated `initialize()` method** to accept optional `userProperties` parameter
- Now passes user properties (name, email) when identifying users during initialization

### 2. `src/components/AppContent.tsx`
- **Added `useEffect` hook** (lines 112-124) to identify users when they sign in
- **Updated `handleStep4Next()`** (lines 295-304) to update PostHog when user changes their name in onboarding Step 4

## Files Created

### 3. `scripts/backfillPostHogUsers.js`
- **One-time migration script** to retroactively update all existing users in PostHog
- Fetches all users from Supabase and identifies them with their names
- Run with: `npm run backfill-posthog`

### 4. `scripts/backfillPostHogUsers.ts`
- TypeScript version of the migration script
- Run with: `npx ts-node scripts/backfillPostHogUsers.ts`

### 5. `scripts/README_POSTHOG_BACKFILL.md`
- Complete documentation for the migration scripts
- Includes usage instructions, troubleshooting, and examples

### 6. `package.json`
- **Added npm script**: `"backfill-posthog": "node scripts/backfillPostHogUsers.js"`

## How It Works

### For New Users (Automatic)
1. User signs in → `useEffect` in `AppContent` triggers
2. `analyticsService.identify()` called with user ID, name, and email
3. All future events show user name in PostHog

### For Existing Users (Two Ways)

**Option A: Automatic (Next Sign-in)**
- When existing users sign in again, they'll be automatically identified with their name

**Option B: Manual (One-time Script)**
- Run `npm run backfill-posthog` to update all users at once
- Safe to run multiple times (idempotent)

### For Name Changes
- When user updates their name in Step 4 of onboarding
- PostHog is automatically updated with the new name
- Historical events will show the new name

## User Properties Sent to PostHog

```typescript
{
  email: user.email,
  name: user.nickname || user.email.split('@')[0] || 'User'
}
```

## Benefits

✅ **Surveys show names** instead of UUIDs  
✅ **Dashboards are human-readable**  
✅ **Historical events** are retroactively enriched  
✅ **Automatic updates** when users change their names  
✅ **No data loss** - events keep their distinct_id

## Quick Start

### To Run the Backfill Script:

```bash
# Make sure environment variables are set
npm run backfill-posthog
```

### Expected Output:
```
🚀 Starting PostHog user backfill migration...
✅ Found 150 users
[1/150] ✅ Updated: John Doe (john@example.com)
...
🎉 All users successfully identified in PostHog!
```

## Testing

1. **Sign in as a user** → Check console logs for `[AppContent] User identified with PostHog:`
2. **Complete Step 4** with a different name → Check for `[AppContent] User name updated in PostHog:`
3. **View PostHog dashboard** → User should appear with their name
4. **Create a survey** → Survey should show user names in responses

## Notes

- **PostHog automatically applies properties to historical events** - no need to reprocess old data
- **The migration script is safe to run multiple times**
- **Rate limiting**: Script includes 100ms delay between users to avoid API limits
- **Future users**: New users will be automatically identified on sign-in (no script needed)

