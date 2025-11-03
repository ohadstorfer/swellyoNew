# Fix Google OAuth Redirect URI for Remote Deployment

## The Problem
Google OAuth works locally but fails remotely because the redirect URI doesn't match what's configured in Google Cloud Console.

## Current Setup
- **Local URL**: `http://localhost:8081`
- **Redirect URI**: Uses `window.location.origin` (dynamic)
- **Google Console**: Only configured for localhost

## Solution Steps

### 1. Find Your Remote URL
First, determine your remote deployment URL:
- **Netlify**: `https://your-app-name.netlify.app`
- **Vercel**: `https://your-app-name.vercel.app`
- **Custom Domain**: `https://your-domain.com`

### 2. Update Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select project: `swellyo-mvp`
3. Navigate to **APIs & Services** > **Credentials**

#### Add Authorized JavaScript Origins:
```
http://localhost:8081
http://127.0.0.1:8081
https://your-remote-domain.com
```

#### Add Authorized Redirect URIs:
```
http://localhost:8081
http://127.0.0.1:8081
https://your-remote-domain.com
```

### 3. Test the Configuration

1. Deploy your app to the remote URL
2. Open browser console
3. Try Google OAuth
4. Check console logs for:
   ```
   === OAuth Debug Info ===
   Current URL: https://your-domain.com/
   Current Origin: https://your-domain.com
   Redirect URI: https%3A//your-domain.com
   Full Auth URL: https://accounts.google.com/o/oauth2/v2/auth?...
   ========================
   ```

### 4. Common Issues & Solutions

#### Issue: "redirect_uri_mismatch"
**Solution**: Make sure the exact URL (including protocol) is added to Google Console

#### Issue: "invalid_client"
**Solution**: Verify client ID is correct and OAuth consent screen is configured

#### Issue: "access_denied"
**Solution**: Check OAuth consent screen settings and test users

### 5. Debugging Steps

1. **Check Current URL**: Look at browser console logs
2. **Verify Google Console**: Ensure URLs match exactly
3. **Test OAuth Flow**: Try the complete flow and check for errors
4. **Check Network Tab**: Look for failed requests

### 6. Example Configuration

For a Netlify deployment at `https://swellyo-app.netlify.app`:

**Authorized JavaScript Origins:**
```
http://localhost:8081
https://swellyo-app.netlify.app
```

**Authorized Redirect URIs:**
```
http://localhost:8081
https://swellyo-app.netlify.app
```

## What's Your Remote URL?
Please provide your remote deployment URL so I can help you configure it correctly.
