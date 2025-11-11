# Supabase Setup Guide

This guide will help you set up Supabase as your backend for the Swellyo app.

## Step 1: Create a Supabase Project

1. Go to [https://app.supabase.com](https://app.supabase.com)
2. Sign up or log in to your account
3. Click "New Project"
4. Fill in your project details:
   - **Name**: Choose a name for your project (e.g., "swellyo")
   - **Database Password**: Create a strong password (save this securely!)
   - **Region**: Choose the region closest to your users
5. Click "Create new project" and wait for it to be set up (takes 1-2 minutes)

## Step 2: Get Your Supabase Credentials

1. In your Supabase project dashboard, go to **Settings** → **API**
2. You'll find two important values:
   - **Project URL**: This is your `EXPO_PUBLIC_SUPABASE_URL`
   - **anon/public key**: This is your `EXPO_PUBLIC_SUPABASE_ANON_KEY`

## Step 3: Configure Environment Variables

1. Copy the `.env.example` file to create a `.env` file:
   ```bash
   cp .env.example .env
   ```

2. Open the `.env` file and replace the placeholder values:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
   ```

3. **Important**: The `.env` file is already in `.gitignore`, so your credentials won't be committed to git.

## Step 4: Restart Your Development Server

After creating/updating your `.env` file, restart your Expo development server:

```bash
npm start
```

Or if you're using a custom script:
```bash
npm run start
```

## Step 5: Verify the Connection

The app will log Supabase configuration status in the console when it starts. Look for:
```
Supabase Configuration: { isConfigured: true, ... }
```

## Using Supabase in Your Code

Import the Supabase client in your components:

```typescript
import { supabase, isSupabaseConfigured } from '../config/supabase';

// Check if configured
if (isSupabaseConfigured()) {
  // Use Supabase
  const { data, error } = await supabase
    .from('your_table')
    .select('*');
}
```

## Common Use Cases

### Authentication
```typescript
// Sign up
const { data, error } = await supabase.auth.signUp({
  email: 'user@example.com',
  password: 'password123',
});

// Sign in
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password123',
});

// Sign out
await supabase.auth.signOut();
```

### Database Queries
```typescript
// Select data
const { data, error } = await supabase
  .from('users')
  .select('*');

// Insert data
const { data, error } = await supabase
  .from('users')
  .insert([{ name: 'John', email: 'john@example.com' }]);

// Update data
const { data, error } = await supabase
  .from('users')
  .update({ name: 'Jane' })
  .eq('id', userId);
```

### Real-time Subscriptions
```typescript
const subscription = supabase
  .channel('messages')
  .on('postgres_changes', 
    { event: 'INSERT', schema: 'public', table: 'messages' },
    (payload) => {
      console.log('New message:', payload.new);
    }
  )
  .subscribe();
```

## Security Notes

- The `anon` key is safe to use in client-side code, but Row Level Security (RLS) policies should be set up in Supabase to protect your data
- Never commit your `.env` file to version control
- For production, consider using environment variables in your deployment platform

## Troubleshooting

### "Missing environment variables" error
- Make sure you created a `.env` file (not just `.env.example`)
- Restart your development server after creating/updating `.env`
- Check that variable names start with `EXPO_PUBLIC_` (required for Expo)

### Connection issues
- Verify your Supabase URL and key are correct
- Check that your Supabase project is active (not paused)
- Ensure your network allows connections to Supabase

### Authentication not working
- Make sure you've enabled the authentication providers you want to use in Supabase Dashboard → Authentication → Providers
- Check that your redirect URLs are configured correctly in Supabase settings

## Next Steps

1. Set up your database schema in Supabase Dashboard → Table Editor
2. Configure Row Level Security (RLS) policies for data protection
3. Set up authentication providers (Email, Google, etc.) in Authentication settings
4. Create any necessary database functions or triggers

For more information, visit the [Supabase Documentation](https://supabase.com/docs).

