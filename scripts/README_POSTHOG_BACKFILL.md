# PostHog User Backfill Migration Script

This directory contains scripts to retroactively update PostHog with user names for all existing users.

## Purpose

When you first set up PostHog, users may have been identified only by their UUID. This script fetches all users from your Supabase database and identifies them in PostHog with their `name` and `email` properties, so:

- **Historical events** will show user names instead of UUIDs
- **Surveys** will display user names
- **Dashboards** will show human-readable user information

## Prerequisites

1. **Environment variables** must be set:
   ```
   EXPO_PUBLIC_SUPABASE_URL=your_supabase_url
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   EXPO_PUBLIC_POSTHOG_API_KEY=your_posthog_api_key
   EXPO_PUBLIC_POSTHOG_HOST=https://app.posthog.com
   ```

2. **Service Role Key (Required for migration)**:
   ```
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   ```
   
   **Why?** The migration script needs to read ALL users from your database, but Row Level Security (RLS) policies prevent the anon key from accessing other users' data. The service role key bypasses RLS.
   
   **How to get it:**
   - Go to Supabase Dashboard
   - Settings → API
   - Copy the `service_role` key (keep it secret!)
   
   **Security Note:** ⚠️ Never commit this key to git! Only use it locally for admin tasks.

3. **Dependencies** - Only requires `@supabase/supabase-js` (already installed):
   ```bash
   npm install
   ```

4. **Node.js** version 14 or higher

## Usage

### Step 1: Set the Service Role Key

For security, set it as an environment variable (don't add to .env file):

**Windows (Command Prompt):**
```cmd
set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
npm run backfill-posthog
```

**Windows (PowerShell):**
```powershell
$env:SUPABASE_SERVICE_ROLE_KEY="your_service_role_key_here"
npm run backfill-posthog
```

**Mac/Linux:**
```bash
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here npm run backfill-posthog
```

### Step 2: Run the Script

The script will automatically use the service role key if available, otherwise it will use the anon key (which may be restricted by RLS).

### Alternative: TypeScript Version

If you prefer TypeScript:

```bash
SUPABASE_SERVICE_ROLE_KEY=your_key npx ts-node scripts/backfillPostHogUsers.ts
```

## What the Script Does

1. ✅ Connects to Supabase and fetches all users
2. ✅ Uses PostHog REST API to identify each user with name and email
3. ✅ Shows progress for each user
4. ✅ Provides a summary report

**Note**: This script uses the PostHog REST API directly (not the React Native SDK) so it can run in Node.js.

## Sample Output

```
🚀 Starting PostHog user backfill migration...

🔌 Connecting to Supabase...
✅ Supabase connected

📊 PostHog API configured
   Host: https://app.posthog.com

📥 Fetching users from Supabase...
✅ Found 150 users

🔄 Starting identification process...

[1/150] ✅ Updated: John Doe (john@example.com)
[2/150] ✅ Updated: Jane Smith (jane@example.com)
[3/150] ✅ Updated: Bob Johnson (bob@example.com)
...

============================================================
📊 Migration Summary:
============================================================
Total users:     150
✅ Successful:   150
❌ Failed:       0
============================================================

🎉 All users successfully identified in PostHog!
📝 Historical events will now show user names instead of UUIDs.

✅ Migration completed
```

## Important Notes

1. **Rate Limiting**: The script includes a 100ms delay between requests to avoid rate limiting
2. **Idempotent**: Safe to run multiple times - PostHog will simply update the user properties
3. **No Data Loss**: This only adds/updates user properties, it doesn't modify or delete any events
4. **Immediate Effect**: Changes take effect immediately in PostHog's UI

## Troubleshooting

### Error: Missing environment variables
Make sure your `.env` file is in the project root and contains all required variables.

### Error: Cannot connect to Supabase
- Check your `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- Verify your Supabase project is running
- Check your internet connection

### Error: PostHog API key invalid
- Verify your `EXPO_PUBLIC_POSTHOG_API_KEY` is correct
- Check that the API key has the necessary permissions

### Some users failed
The script will continue even if some users fail. Check the error messages for specific users and investigate why they failed.

## When to Run This Script

- **After implementing PostHog identify calls**: Run once to backfill existing users
- **Not needed regularly**: Once users start signing in again, they'll be automatically identified by the app
- **Safe to re-run**: If you add new users or update user information, you can run this again

## Future Users

After running this script once, all **new users** will automatically be identified with their names through the normal app flow (the `useEffect` in `AppContent.tsx`), so you won't need to run this script again.

