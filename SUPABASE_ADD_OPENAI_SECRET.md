# How to Add OpenAI API Key Secret in Supabase

## Step-by-Step Guide

### Step 1: Get Your OpenAI API Key

If you don't have an OpenAI API key yet:

1. Go to https://platform.openai.com/api-keys
2. Sign in or create an account
3. Click **"Create new secret key"**
4. Give it a name (e.g., "Swelly Chatbot")
5. Copy the key immediately (you won't be able to see it again!)

**Important:** Keep this key secure and never commit it to version control.

### Step 2: Add Secret to Supabase Dashboard

#### Option A: Using Supabase Dashboard (Recommended)

1. **Open Supabase Dashboard**
   - Go to https://supabase.com/dashboard
   - Sign in to your account

2. **Navigate to Your Project**
   - Select your Swellyo project from the list

3. **Go to Edge Functions Settings**
   - In the left sidebar, click on **"Edge Functions"** (under "Project Settings")
   - Or go directly to: `https://supabase.com/dashboard/project/YOUR_PROJECT_ID/settings/functions`

4. **Add the Secret**
   - Scroll down to the **"Secrets"** section
   - Click **"Add new secret"** or **"Add secret"** button
   - In the **"Name"** field, enter: `OPENAI_API_KEY`
   - In the **"Value"** field, paste your OpenAI API key
   - Click **"Save"** or **"Add secret"**

#### Option B: Using Supabase CLI

If you prefer using the command line:

```bash
# Make sure you're logged in
supabase login

# Link your project (if not already linked)
supabase link --project-ref your-project-ref

# Set the secret
supabase secrets set OPENAI_API_KEY=your-actual-openai-api-key-here
```

**Note:** Replace `your-actual-openai-api-key-here` with your actual OpenAI API key.

### Step 3: Verify the Secret is Set

#### Using Dashboard:
- Go back to Edge Functions settings
- You should see `OPENAI_API_KEY` listed in the secrets section
- The value will be hidden (showing as `••••••••`)

#### Using CLI:
```bash
# List all secrets (values are hidden)
supabase secrets list
```

### Step 4: Test the Edge Function

After setting the secret, you can test if it's working:

1. **Deploy the function** (if not already deployed):
   ```bash
   supabase functions deploy swelly-chat
   ```

2. **Check the logs**:
   ```bash
   supabase functions logs swelly-chat
   ```

3. **Test from your app** - Try starting a Swelly conversation and check:
   - Supabase Dashboard → Edge Functions → Logs
   - Look for any errors related to `OPENAI_API_KEY`

## Troubleshooting

### Issue: "OPENAI_API_KEY is not set" error

**Solution:**
1. Make sure the secret name is exactly `OPENAI_API_KEY` (case-sensitive)
2. Redeploy the function after adding the secret:
   ```bash
   supabase functions deploy swelly-chat
   ```
3. Wait a few seconds for the secret to propagate

### Issue: "Invalid API key" error from OpenAI

**Solution:**
1. Verify your OpenAI API key is correct
2. Check if your OpenAI account has credits/billing set up
3. Make sure the key hasn't been revoked or expired
4. Test the key directly with OpenAI:
   ```bash
   curl https://api.openai.com/v1/models \
     -H "Authorization: Bearer YOUR_API_KEY"
   ```

### Issue: Can't find "Edge Functions" in settings

**Solution:**
- Make sure you're on a paid plan (Edge Functions require a paid Supabase plan)
- Free tier doesn't include Edge Functions
- Upgrade at: https://supabase.com/dashboard/project/_/settings/billing

### Issue: Secret not appearing after adding

**Solution:**
1. Refresh the page
2. Make sure you're in the correct project
3. Try redeploying the function:
   ```bash
   supabase functions deploy swelly-chat
   ```

## Alternative: Using Environment Variables (Not Recommended for Production)

If you're testing locally, you can also set environment variables, but this is **NOT recommended for production**:

```bash
# In your .env file (local development only)
OPENAI_API_KEY=your-key-here
```

**Important:** Never commit `.env` files to git!

## Security Best Practices

1. ✅ **Use Supabase Secrets** for production (recommended)
2. ✅ **Never commit API keys** to version control
3. ✅ **Rotate keys regularly** if compromised
4. ✅ **Use different keys** for development and production
5. ✅ **Monitor usage** in OpenAI dashboard to detect abuse

## Quick Reference

- **Supabase Dashboard:** https://supabase.com/dashboard
- **OpenAI API Keys:** https://platform.openai.com/api-keys
- **Supabase Edge Functions Docs:** https://supabase.com/docs/guides/functions
- **Supabase Secrets Docs:** https://supabase.com/docs/guides/functions/secrets

## Visual Guide (Dashboard Path)

```
Supabase Dashboard
  └── Your Project
      └── Settings (gear icon in sidebar)
          └── Edge Functions
              └── Secrets section
                  └── "Add new secret" button
                      └── Name: OPENAI_API_KEY
                      └── Value: [paste your key]
                      └── Save
```


