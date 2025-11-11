# Setting Up Google Authentication with Supabase

This guide will help you configure Google OAuth in your Supabase project to work with the Swellyo app.

## Step 1: Configure Google OAuth in Supabase

1. Go to your Supabase project dashboard: [https://app.supabase.com](https://app.supabase.com)
2. Navigate to **Authentication** → **Providers**
3. Find **Google** in the list and click on it
4. Toggle **Enable Google provider** to ON
5. You'll need to provide:
   - **Client ID (for OAuth)**: Your Google OAuth Client ID
   - **Client Secret (for OAuth)**: Your Google OAuth Client Secret

## Step 2: Get Google OAuth Credentials

If you don't have Google OAuth credentials yet:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Navigate to **APIs & Services** → **Credentials**
4. Click **Create Credentials** → **OAuth client ID**
5. Configure the OAuth consent screen if prompted:
   - Choose **External** (unless you have a Google Workspace)
   - Fill in the required information
   - Add your email as a test user
6. Create OAuth client ID:
   - **Application type**: Web application
   - **Name**: Swellyo (or your app name)
   - **Authorized redirect URIs**: 
     - For Supabase: `https://<your-project-ref>.supabase.co/auth/v1/callback`
     - You can find your project ref in Supabase Dashboard → Settings → API
     - Example: `https://abcdefghijklmnop.supabase.co/auth/v1/callback`
7. Copy the **Client ID** and **Client Secret**

## Step 3: Add Redirect URIs to Google OAuth

In your Google Cloud Console OAuth client settings, add these redirect URIs:

### For Web:
- `http://localhost:8081` (for local development)
- `https://your-production-domain.com` (for production)
- Your Supabase callback URL: `https://<your-project-ref>.supabase.co/auth/v1/callback`

### For Mobile (Expo):
- `exp://localhost:8081` (for local development)
- `swellyo://` (your app scheme)
- Your Supabase callback URL: `https://<your-project-ref>.supabase.co/auth/v1/callback`

## Step 4: Configure Supabase Redirect URLs

1. In Supabase Dashboard, go to **Authentication** → **URL Configuration**
2. Add your redirect URLs:
   - **Site URL**: Your production URL (e.g., `https://your-domain.com`)
   - **Redirect URLs**: Add all URLs where users might be redirected after auth:
     - `http://localhost:8081/**` (for local web development)
     - `exp://localhost:8081/**` (for Expo Go)
     - `swellyo://**` (your app scheme)
     - `https://your-production-domain.com/**`

## Step 5: Create the Profiles Table (Optional but Recommended)

To store additional user profile information, create a `profiles` table in Supabase:

1. Go to **Table Editor** in Supabase Dashboard
2. Click **New Table**
3. Name it `profiles`
4. Add the following columns:
   - `id` (uuid, primary key, references auth.users(id))
   - `email` (text)
   - `nickname` (text)
   - `photo` (text, nullable)
   - `google_id` (text, nullable)
   - `created_at` (timestamptz, default: now())
   - `updated_at` (timestamptz, default: now())

5. Set up Row Level Security (RLS):
   - Enable RLS on the table
   - Create a policy: "Users can view their own profile"
     ```sql
     CREATE POLICY "Users can view own profile"
     ON profiles FOR SELECT
     USING (auth.uid() = id);
     ```
   - Create a policy: "Users can update their own profile"
     ```sql
     CREATE POLICY "Users can update own profile"
     ON profiles FOR UPDATE
     USING (auth.uid() = id);
     ```
   - Create a policy: "Users can insert their own profile"
     ```sql
     CREATE POLICY "Users can insert own profile"
     ON profiles FOR INSERT
     WITH CHECK (auth.uid() = id);
     ```

6. (Optional) Create a trigger to automatically create a profile when a user signs up:
   ```sql
   CREATE OR REPLACE FUNCTION public.handle_new_user()
   RETURNS trigger AS $$
   BEGIN
     INSERT INTO public.profiles (id, email, nickname, google_id, created_at, updated_at)
     VALUES (
       NEW.id,
       NEW.email,
       COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'User'),
       NEW.app_metadata->>'provider_id',
       NOW(),
       NOW()
     );
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql SECURITY DEFINER;

   CREATE TRIGGER on_auth_user_created
     AFTER INSERT ON auth.users
     FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
   ```

## Step 6: Update Your Environment Variables

Make sure your `.env` file has:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
EXPO_PUBLIC_GOOGLE_CLIENT_ID=your-google-client-id
```

**Note**: You don't need `EXPO_PUBLIC_GOOGLE_CLIENT_SECRET` anymore when using Supabase, as Supabase handles the OAuth flow server-side.

## Step 7: Test the Integration

1. Restart your development server:
   ```bash
   npm start
   ```

2. Try signing in with Google
3. Check the Supabase Dashboard → Authentication → Users to see if the user was created
4. Check the `profiles` table (if you created it) to see if the profile was created

## Troubleshooting

### "redirect_uri_mismatch" error
- Make sure you've added all redirect URIs to both Google Cloud Console and Supabase
- Check that the redirect URI in the error message matches one of your configured URIs

### User not appearing in Supabase
- Check Supabase Dashboard → Authentication → Users
- Verify that the OAuth flow completed successfully
- Check browser console for any errors

### Profile not created
- If you created the trigger, check if it's enabled
- Manually create a profile in the Table Editor to test
- Check Supabase logs for any errors

### "Supabase is not configured" error
- Verify your `.env` file has `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- Restart your development server after updating `.env`
- Check that the values don't have quotes around them

## Migration from Old Auth System

The new Supabase auth service is backward compatible. If Supabase is configured, it will automatically use Supabase for authentication. If not, it falls back to the old localStorage/AsyncStorage method.

To fully migrate:
1. Set up Supabase (follow steps above)
2. Test authentication with Supabase
3. Once confirmed working, you can remove the old `databaseService` calls if desired
4. Update any code that relies on the old User format (id as number) to use the new format (id as string)

## Additional Resources

- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth)
- [Supabase Google OAuth Guide](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Expo AuthSession Documentation](https://docs.expo.dev/guides/authentication/#google)

