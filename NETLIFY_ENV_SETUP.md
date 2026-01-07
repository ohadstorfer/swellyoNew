# Netlify Environment Variables Setup Guide

## Quick Setup

### Step 1: Access Environment Variables

1. Log in to [Netlify Dashboard](https://app.netlify.com)
2. Select your site
3. Go to **Site settings** → **Build & deploy** → **Environment variables**

### Step 2: Add Required Variables

Click **Add variable** and add each of these:

#### 1. EXPO_PUBLIC_SUPABASE_URL
- **Key**: `EXPO_PUBLIC_SUPABASE_URL`
- **Value**: Your Supabase project URL
- **Where to find**: 
  - Go to [Supabase Dashboard](https://app.supabase.com)
  - Select your project
  - Go to **Settings** → **API**
  - Copy the **Project URL**

#### 2. EXPO_PUBLIC_SUPABASE_ANON_KEY
- **Key**: `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- **Value**: Your Supabase anonymous/public key
- **Where to find**:
  - Same location as above (Supabase Dashboard → Settings → API)
  - Copy the **anon/public** key

#### 3. EXPO_PUBLIC_GOOGLE_CLIENT_ID ⚠️ **REQUIRED**
- **Key**: `EXPO_PUBLIC_GOOGLE_CLIENT_ID`
- **Value**: Your Google OAuth Web Client ID
- **Where to find**:
  1. Go to [Google Cloud Console](https://console.cloud.google.com/)
  2. Select your project (or create one)
  3. Go to **APIs & Services** → **Credentials**
  4. Click **Create Credentials** → **OAuth client ID**
  5. Application type: **Web application**
  6. Name: e.g., "Swellyo Web"
  7. **Authorized JavaScript origins**: 
     - Add: `https://your-site.netlify.app`
     - Add: `https://your-custom-domain.com` (if you have one)
  8. **Authorized redirect URIs**:
     - Add: `https://your-site.netlify.app`
     - Add: `https://your-custom-domain.com` (if you have one)
  9. Click **Create**
  10. Copy the **Client ID** (not the Client Secret)

### Step 3: Configure Google OAuth for Netlify

After creating the Google OAuth Client ID, make sure:

1. **Authorized JavaScript origins** includes:
   ```
   https://your-site.netlify.app
   https://your-custom-domain.com  (if applicable)
   ```

2. **Authorized redirect URIs** includes:
   ```
   https://your-site.netlify.app
   https://your-custom-domain.com  (if applicable)
   ```

### Step 4: Trigger New Deployment

**CRITICAL**: Environment variables are embedded at **build time**, not runtime.

After adding/changing environment variables:

1. Go to **Deploys** tab in Netlify
2. Click **Trigger deploy** → **Deploy site**
3. Wait for the build to complete
4. Test your site

## Verification

After deployment, check the browser console. You should NOT see:
- ❌ `EXPO_PUBLIC_GOOGLE_CLIENT_ID environment variable is not set`
- ❌ `EXPO_PUBLIC_SUPABASE_URL environment variable is not set`

## Troubleshooting

### Error: "EXPO_PUBLIC_GOOGLE_CLIENT_ID environment variable is not set"

**Solution**:
1. Verify the variable is set in Netlify (Site settings → Environment variables)
2. Check the variable name is exactly: `EXPO_PUBLIC_GOOGLE_CLIENT_ID` (case-sensitive)
3. **Trigger a new deployment** (environment variables are embedded at build time)
4. Wait for the build to complete
5. Clear browser cache and test again

### Google Sign-In Redirects to Error Page

**Solution**:
1. Check Google Cloud Console → Credentials → Your OAuth Client
2. Verify your Netlify domain is in **Authorized JavaScript origins**
3. Verify your Netlify domain is in **Authorized redirect URIs**
4. Make sure you're using the **Web Client ID** (not iOS/Android)

### Variables Not Working After Adding

**Solution**:
- Environment variables are embedded at **build time**
- You MUST trigger a new deployment after adding/changing variables
- Go to **Deploys** → **Trigger deploy** → **Deploy site**

## Environment Variable Contexts

You can set different values for different contexts:

- **Production**: Used for production deployments
- **Branch deploys**: Used for branch previews
- **Deploy previews**: Used for PR previews

To set context-specific variables:
1. Click on a variable
2. Select the context (Production, Branch, Deploy Preview)
3. Set different values if needed

## Security Notes

- Variables prefixed with `EXPO_PUBLIC_` are embedded in the JavaScript bundle
- They are visible in the browser (check DevTools → Sources)
- Only use `EXPO_PUBLIC_` for values that are safe to expose publicly
- Never put secrets (like API keys with write access) in `EXPO_PUBLIC_` variables




