# MVP Onboarding-Only Deployment Guide

This guide explains how to deploy the MVP onboarding-only version of the app to Netlify.

## Overview

The MVP version stops after the onboarding process (including the Swelly onboarding chat) and shows a "Thank You" screen instead of the full app. This allows you to test the onboarding experience with real users.

## Implementation

The MVP mode is controlled by the `EXPO_PUBLIC_MVP_MODE` environment variable:
- When set to `"true"`: Shows thank you screen after onboarding
- When not set or `"false"`: Normal app behavior (shows full app after onboarding)

## Deployment Steps

### Option 1: Separate Netlify Site (Recommended)

1. **Create a new Netlify site:**
   - Go to Netlify Dashboard
   - Click "Add new site" → "Import an existing project"
   - Connect to your GitHub repository
   - Use the same build settings as your main site

2. **Configure environment variables:**
   - Go to Site settings → Environment variables
   - Add: `EXPO_PUBLIC_MVP_MODE` = `true`
   - Add all other required environment variables:
     - `EXPO_PUBLIC_SUPABASE_URL`
     - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
     - `EXPO_PUBLIC_POSTHOG_API_KEY`
     - `EXPO_PUBLIC_POSTHOG_HOST`
     - `EXPO_PUBLIC_GOOGLE_CLIENT_ID`
     - `EXPO_PUBLIC_GOOGLE_CLIENT_SECRET`
     - `SECRETS_SCAN_OMIT_KEYS` = `EXPO_PUBLIC_POSTHOG_API_KEY`

3. **Connect your domain:**
   - Go to Site settings → Domain management
   - Add your custom domain (e.g., `mvp.yourdomain.com` or `onboarding.yourdomain.com`)
   - Follow Netlify's DNS instructions

4. **Deploy:**
   - Push to your main branch (or create a separate branch if preferred)
   - Netlify will automatically build and deploy

### Option 2: Branch-Based Deployment

1. **Create a branch:**
   ```bash
   git checkout -b mvp-onboarding
   ```

2. **Create a new Netlify site from this branch:**
   - In Netlify, create a new site
   - Connect to your GitHub repo
   - Set the production branch to `mvp-onboarding`

3. **Configure environment variables** (same as Option 1)

4. **Deploy:**
   - Push changes to the `mvp-onboarding` branch
   - Netlify will deploy automatically

## Environment Variables Required

Make sure to set these in Netlify's environment variables:

### Required for MVP:
- `EXPO_PUBLIC_MVP_MODE` = `true`

### Required for app functionality:
- `EXPO_PUBLIC_SUPABASE_URL` = Your Supabase project URL
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` = Your Supabase anon key
- `EXPO_PUBLIC_POSTHOG_API_KEY` = Your PostHog API key
- `EXPO_PUBLIC_POSTHOG_HOST` = `https://app.posthog.com` (or your PostHog host)
- `EXPO_PUBLIC_GOOGLE_CLIENT_ID` = Your Google OAuth client ID
- `EXPO_PUBLIC_GOOGLE_CLIENT_SECRET` = Your Google OAuth client secret

### Required to prevent build errors:
- `SECRETS_SCAN_OMIT_KEYS` = `EXPO_PUBLIC_POSTHOG_API_KEY`

## Testing Locally

To test MVP mode locally:

1. Create a `.env.local` file in the root directory:
   ```
   EXPO_PUBLIC_MVP_MODE=true
   ```

2. Start the development server:
   ```bash
   npm start
   ```

3. Complete the onboarding flow to see the thank you screen

## Switching Back to Normal Mode

To disable MVP mode:
1. Remove `EXPO_PUBLIC_MVP_MODE` from environment variables, OR
2. Set `EXPO_PUBLIC_MVP_MODE` = `false`
3. Redeploy

## User Flow in MVP Mode

1. User lands on welcome screen
2. User clicks "Get Started"
3. User completes onboarding steps (1-4)
4. User completes Swelly onboarding chat
5. **MVP Mode:** User sees "Thank You" screen with "Back to Homepage" button
6. User clicks "Back to Homepage" → Returns to welcome screen

## Notes

- The MVP mode only affects what happens after onboarding completion
- All onboarding functionality remains the same
- Users can still log out and start over
- The thank you screen is responsive and works on desktop and mobile

