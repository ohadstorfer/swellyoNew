# Netlify Deployment Guide

This guide will help you deploy the Swellyo Expo web app to Netlify.

## Prerequisites

1. A Netlify account (sign up at https://www.netlify.com)
2. Your project connected to a Git repository (GitHub, GitLab, or Bitbucket)

## Deployment Steps

### 1. Connect Your Repository

1. Log in to your Netlify dashboard
2. Click "Add new site" → "Import an existing project"
3. Connect your Git provider (GitHub, GitLab, or Bitbucket)
4. Select your repository

### 2. Configure Build Settings

Netlify will auto-detect the build settings from `netlify.toml`, but you can verify:

- **Build command**: `npm run build:netlify`
- **Publish directory**: `dist`
- **Node version**: 18 (configured in netlify.toml)

### 2a. Disable Next.js Plugin (IMPORTANT)

**CRITICAL**: Netlify may auto-detect this as a Next.js project. You MUST disable the Next.js plugin:

1. Go to **Site settings** → **Build & deploy** → **Plugins**
2. If you see `@netlify/plugin-nextjs` in the list, click on it
3. Click **Disable** or **Remove** to disable it
4. Alternatively, go to **Site settings** → **Build & deploy** → **Build settings** → **Environment variables**
5. Add: `NETLIFY_NEXT_PLUGIN_SKIP` = `true`

**Why?** This is an Expo web app, not a Next.js app. The Next.js plugin will cause build failures.

### 3. Set Environment Variables (REQUIRED)

**IMPORTANT**: You MUST set these environment variables for the app to work properly.

In the Netlify dashboard, go to:
**Site settings** → **Build & deploy** → **Environment variables** → **Add variable**

Add the following environment variables:

#### Required Environment Variables:

1. **EXPO_PUBLIC_SUPABASE_URL**
   - Value: Your Supabase project URL
   - Example: `https://xxxxx.supabase.co`
   - Get it from: Supabase Dashboard → Settings → API → Project URL

2. **EXPO_PUBLIC_SUPABASE_ANON_KEY**
   - Value: Your Supabase anonymous/public key
   - Example: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
   - Get it from: Supabase Dashboard → Settings → API → anon/public key

3. **EXPO_PUBLIC_GOOGLE_CLIENT_ID** ⚠️ **REQUIRED FOR GOOGLE AUTH**
   - Value: Your Google OAuth Client ID
   - Example: `123456789-abcdefghijklmnop.apps.googleusercontent.com`
   - Get it from: [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
   - **Important**: This must be a Web Client ID (not iOS/Android)
   - **Authorized JavaScript origins**: Add your Netlify domain (e.g., `https://your-site.netlify.app`)
   - **Authorized redirect URIs**: Add your Netlify domain (e.g., `https://your-site.netlify.app`)

#### Optional Environment Variables:

- `EXPO_PUBLIC_PEXELS_API_KEY` - For fetching high-quality stock photos from Pexels (for country and lifestyle images)
  - Get it from: [Pexels API](https://www.pexels.com/api/)
  - Free tier available
  - If not set, the app will use placeholder images instead
- `EXPO_PUBLIC_OPENAI_API_KEY` - Only if using OpenAI features
- `EXPO_PUBLIC_API_BASE_URL` - If you have a custom API base URL

**Note**: 
- Variables prefixed with `EXPO_PUBLIC_` are embedded at build time and available in the browser
- These are safe to expose publicly (they're meant for client-side use)
- **After adding/changing environment variables, you MUST trigger a new deployment** for changes to take effect

### 4. Deploy

1. Click "Deploy site"
2. Netlify will automatically:
   - Install dependencies (`npm install`)
   - Run the build command (`npm run build:netlify`)
   - Deploy the `dist` directory

### 5. Verify Deployment

After deployment:
1. Check the build logs for any errors
2. Visit your site URL (provided by Netlify)
3. Test the application functionality

## Build Process

The `build:netlify` script:
1. Exports the Expo web app to the `dist` directory
2. Copies `swelly_chat.html` to `dist/index.html`
3. Copies `_redirects` file for SPA routing

## SPA Routing

The `_redirects` file and `netlify.toml` redirects ensure that all routes are handled by the React app for client-side routing.

## Custom Domain

To add a custom domain:
1. Go to **Site settings** → **Domain management**
2. Click "Add custom domain"
3. Follow the DNS configuration instructions

## Continuous Deployment

Netlify automatically deploys when you push to your main branch. You can:
- Configure branch deploys for previews
- Set up deploy contexts for different environments
- Add deploy hooks for manual deployments

## Troubleshooting

### Build Fails

1. **Next.js Plugin Error**: If you see "Your publish directory does not contain expected Next.js build output":
   - Go to **Site settings** → **Build & deploy** → **Plugins**
   - Disable or remove `@netlify/plugin-nextjs`
   - Add environment variable: `NETLIFY_NEXT_PLUGIN_SKIP` = `true`
   - Redeploy

2. Check the build logs in Netlify dashboard
3. Verify Node version (should be 18)
4. Ensure all dependencies are in `package.json`
5. Check for missing environment variables

### Routing Issues

If routes don't work:
1. Verify `_redirects` file is in the `dist` directory
2. Check `netlify.toml` redirects configuration
3. Ensure the redirect rule `/* /index.html 200` is present

### Environment Variables Not Working

1. **"EXPO_PUBLIC_GOOGLE_CLIENT_ID environment variable is not set"**
   - Go to **Site settings** → **Build & deploy** → **Environment variables**
   - Add `EXPO_PUBLIC_GOOGLE_CLIENT_ID` with your Google OAuth Client ID
   - **Trigger a new deployment** (go to **Deploys** → **Trigger deploy** → **Deploy site**)
   - Environment variables are embedded at build time, so a new build is required

2. **Variables not appearing in the app**
   - Ensure variables are prefixed with `EXPO_PUBLIC_` if needed in the browser
   - **Redeploy after adding/changing environment variables** (they're embedded at build time)
   - Check that variables are set in the correct deploy context (Production, Branch, Deploy Preview)
   - Verify there are no typos in variable names
   - Check for trailing spaces in variable values

3. **Google Sign-In not working**
   - Verify `EXPO_PUBLIC_GOOGLE_CLIENT_ID` is set correctly
   - Check Google Cloud Console that your Netlify domain is added to:
     - **Authorized JavaScript origins**: `https://your-site.netlify.app`
     - **Authorized redirect URIs**: `https://your-site.netlify.app`
   - Ensure you're using a **Web Client ID** (not iOS/Android client ID)
   - Redeploy after making changes

## Differences from AWS Amplify

- **Build output**: Uses `dist` instead of `web-build`
- **No Next.js detection**: Netlify doesn't require Next.js detection workarounds
- **Simpler configuration**: `netlify.toml` is more straightforward than `amplify.yml`
- **No required-server-files.json**: Not needed for Netlify

## Additional Resources

- [Netlify Documentation](https://docs.netlify.com/)
- [Expo Web Deployment](https://docs.expo.dev/workflow/web/)
- [Netlify Redirects](https://docs.netlify.com/routing/redirects/)

