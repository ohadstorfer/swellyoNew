# AWS Amplify Deployment Guide

This guide will help you deploy your Swellyo Expo app to AWS Amplify.

## Prerequisites

1. An AWS account
2. Your project connected to a Git repository (GitHub, GitLab, Bitbucket, or AWS CodeCommit)
3. Supabase credentials (URL and anon key)

## Step 1: Connect Your Repository to AWS Amplify

1. Go to [AWS Amplify Console](https://console.aws.amazon.com/amplify/)
2. Click "New app" → "Host web app"
3. Select your Git provider (GitHub, GitLab, Bitbucket, or AWS CodeCommit)
4. Authorize AWS Amplify to access your repository
5. Select your repository and branch (usually `main` or `master`)

## Step 2: Configure Build Settings

AWS Amplify will automatically detect the `amplify.yml` file in your repository. The configuration includes:

- **Build command**: `npm run build`
- **Output directory**: `dist`
- **Node version**: Uses the default (you can specify in `amplify.yml` if needed)

## Step 3: Configure Environment Variables

In the Amplify Console, go to your app → **App settings** → **Environment variables** and add:

### Required Environment Variables

```
EXPO_PUBLIC_SUPABASE_URL=your_supabase_project_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### How to Get Supabase Credentials

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Go to **Settings** → **API**
4. Copy:
   - **Project URL** → `EXPO_PUBLIC_SUPABASE_URL`
   - **anon/public key** → `EXPO_PUBLIC_SUPABASE_ANON_KEY`

## Step 4: Review and Deploy

1. Review the build settings in Amplify Console
2. Click "Save and deploy"
3. Amplify will:
   - Install dependencies
   - Run the build command
   - Deploy to a CloudFront distribution
   - Provide you with a URL (e.g., `https://main.xxxxx.amplifyapp.com`)

## Step 5: Configure Custom Domain (Optional)

1. In Amplify Console, go to **App settings** → **Domain management**
2. Click "Add domain"
3. Enter your domain name
4. Follow the DNS configuration instructions

## Step 6: Configure Redirects for SPA Routing

The `public/_redirects` file is included to handle client-side routing. This ensures that all routes are served by `index.html` for proper React Router/Expo Router functionality.

## Build Process

The build process:
1. Installs dependencies with `npm ci`
2. Runs `npm run build` which:
   - Exports the Expo web app (`expo export --platform web`)
   - Copies necessary files to `dist/`
   - Updates bundle references

## Troubleshooting

### Build Fails

1. Check the build logs in Amplify Console
2. Verify environment variables are set correctly
3. Ensure `package-lock.json` is committed to your repository
4. Check that Node.js version is compatible (Amplify uses Node 18 by default)

### Environment Variables Not Working

- Make sure variables start with `EXPO_PUBLIC_` for Expo to expose them
- Restart the build after adding/changing environment variables
- Check that variables don't have trailing spaces

### Routing Issues

- Ensure `public/_redirects` file is in your repository
- Verify the redirect rule: `/*    /index.html   200`

### Supabase Connection Issues

- Verify your Supabase URL and anon key are correct
- Check Supabase project is active and not paused
- Ensure RLS (Row Level Security) policies allow public access if needed

## Continuous Deployment

Amplify automatically deploys when you push to your connected branch. You can:
- Enable/disable auto-deploy in **App settings** → **General**
- Set up branch-specific environment variables
- Configure preview deployments for pull requests

## Additional Resources

- [AWS Amplify Documentation](https://docs.amplify.aws/)
- [Expo Web Deployment](https://docs.expo.dev/workflow/web/)
- [Supabase Documentation](https://supabase.com/docs)










