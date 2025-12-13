# AWS Amplify Quick Start

## Files Created for Amplify Deployment

1. **`amplify.yml`** - Build configuration file
2. **`public/_redirects`** - SPA routing redirects (if needed)
3. **`AMPLIFY_DEPLOYMENT.md`** - Full deployment guide

## Quick Setup Steps

### 1. Connect Repository
- Go to [AWS Amplify Console](https://console.aws.amazon.com/amplify/)
- Click "New app" → "Host web app"
- Connect your Git repository

### 2. Set Environment Variables
In Amplify Console → App settings → Environment variables, add:

```
EXPO_PUBLIC_SUPABASE_URL=your_supabase_url_here
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
```

### 3. Deploy
- Amplify will automatically detect `amplify.yml`
- Click "Save and deploy"
- Wait for build to complete

## Build Output

The build creates a `dist/` directory with:
- Static HTML files
- JavaScript bundles
- Assets from `public/` directory

## Important Notes

- ✅ `dist/` is in `.gitignore` (correct - Amplify builds it)
- ✅ Environment variables must start with `EXPO_PUBLIC_` to be exposed
- ✅ Build command: `npm run build` (runs `expo export --platform web`)
- ✅ Output directory: `dist`

## Troubleshooting

**Build fails?**
- Check build logs in Amplify Console
- Verify environment variables are set
- Ensure `package-lock.json` is committed

**404 errors on routes?**
- Check that `public/_redirects` is copied to `dist/`
- Verify SPA routing is configured in Amplify Console

**Supabase connection issues?**
- Verify environment variables are correct
- Check Supabase project is active
- Ensure RLS policies allow necessary access

