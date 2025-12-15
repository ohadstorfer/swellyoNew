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

### 3. Set Environment Variables

In the Netlify dashboard, go to:
**Site settings** → **Environment variables** → **Add variable**

Add the following environment variables (if needed):

```
EXPO_PUBLIC_SUPABASE_URL=your_supabase_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
EXPO_PUBLIC_GOOGLE_CLIENT_ID=your_google_client_id
```

**Note**: If your environment variables are prefixed with `EXPO_PUBLIC_`, they will be available in the browser. Make sure these are safe to expose publicly.

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

1. Check the build logs in Netlify dashboard
2. Verify Node version (should be 18)
3. Ensure all dependencies are in `package.json`
4. Check for missing environment variables

### Routing Issues

If routes don't work:
1. Verify `_redirects` file is in the `dist` directory
2. Check `netlify.toml` redirects configuration
3. Ensure the redirect rule `/* /index.html 200` is present

### Environment Variables Not Working

1. Ensure variables are prefixed with `EXPO_PUBLIC_` if needed in the browser
2. Redeploy after adding new environment variables
3. Check that variables are set in the correct deploy context

## Differences from AWS Amplify

- **Build output**: Uses `dist` instead of `web-build`
- **No Next.js detection**: Netlify doesn't require Next.js detection workarounds
- **Simpler configuration**: `netlify.toml` is more straightforward than `amplify.yml`
- **No required-server-files.json**: Not needed for Netlify

## Additional Resources

- [Netlify Documentation](https://docs.netlify.com/)
- [Expo Web Deployment](https://docs.expo.dev/workflow/web/)
- [Netlify Redirects](https://docs.netlify.com/routing/redirects/)

