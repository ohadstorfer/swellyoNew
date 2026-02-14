# Quick Fix: Environment Variables Not Working on Netlify

## The Problem

You added environment variables to Netlify, but you're still seeing:
```
Error: EXPO_PUBLIC_GOOGLE_CLIENT_ID environment variable is not set
```

## The Solution

**Environment variables are embedded at BUILD TIME, not runtime.**

After adding environment variables to Netlify, you **MUST trigger a new deployment** for them to take effect.

## Quick Fix Steps

### 1. Verify Environment Variables Are Set

1. Go to [Netlify Dashboard](https://app.netlify.com)
2. Select your site
3. Go to **Site settings** → **Build & deploy** → **Environment variables**
4. Verify these variables exist:
   - ✅ `EXPO_PUBLIC_GOOGLE_CLIENT_ID`
   - ✅ `EXPO_PUBLIC_SUPABASE_URL`
   - ✅ `EXPO_PUBLIC_SUPABASE_ANON_KEY`

### 2. Trigger a New Deployment

**This is the critical step!**

1. In Netlify Dashboard, go to the **Deploys** tab
2. Click **Trigger deploy** (top right)
3. Select **Deploy site**
4. Wait for the build to complete (usually 2-5 minutes)

### 3. Verify It Works

After the deployment completes:

1. Visit your site URL
2. Open browser DevTools (F12) → Console
3. Try to sign in with Google
4. You should see: `✅ EXPO_PUBLIC_GOOGLE_CLIENT_ID is set: ...`
5. The error should be gone!

## Why This Happens

Expo embeds `EXPO_PUBLIC_*` environment variables directly into the JavaScript bundle during the build process. This means:

- ❌ **Adding variables to Netlify** = Variables are available during build
- ❌ **Not redeploying** = Old bundle still deployed (without variables)
- ✅ **Adding variables + Redeploying** = New bundle with variables embedded

## Common Mistakes

1. **Adding variables but not redeploying** ❌
   - Fix: Trigger a new deployment

2. **Typo in variable name** ❌
   - Fix: Check it's exactly `EXPO_PUBLIC_GOOGLE_CLIENT_ID` (case-sensitive)

3. **Setting variable in wrong context** ❌
   - Fix: Make sure it's set for "Production" context

4. **Using wrong Google Client ID type** ❌
   - Fix: Use Web Client ID, not iOS/Android

## Still Not Working?

1. **Check build logs**:
   - Go to **Deploys** → Click on the latest deploy → View build logs
   - Look for any errors during the build

2. **Verify variable is in build**:
   - After deployment, open DevTools → Sources
   - Search for your variable name in the JavaScript files
   - You should see it embedded in the code

3. **Clear browser cache**:
   - Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
   - Or clear cache completely

4. **Check variable value**:
   - Make sure there are no extra spaces
   - Make sure it's the full Client ID (not truncated)

## Need More Help?

See the full guide: [NETLIFY_ENV_SETUP.md](./NETLIFY_ENV_SETUP.md)












