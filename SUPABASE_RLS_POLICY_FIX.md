# Fixing Supabase RLS Policy Infinite Recursion

## The Problem

The error `infinite recursion detected in policy for relation "users"` occurs when your Row Level Security (RLS) policy on the `users` table queries the `users` table itself, creating a circular dependency.

## The Solution

You need to update your RLS policies in Supabase to avoid querying the `users` table within the policy. Instead, use `auth.uid()` directly.

## Step-by-Step Fix

### 1. Go to Supabase Dashboard

1. Navigate to your Supabase project
2. Go to **Authentication** → **Policies** (or **Database** → **Tables** → **users** → **Policies**)

### 2. Delete Existing Policies (if any)

If you have existing policies on the `users` table that might be causing recursion, delete them first.

### 3. Create New Policies

Run these SQL commands in the Supabase SQL Editor:

```sql
-- First, ensure RLS is enabled
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Delete any existing policies that might cause recursion
DROP POLICY IF EXISTS "Users can view own data" ON public.users;
DROP POLICY IF EXISTS "Users can update own data" ON public.users;
DROP POLICY IF EXISTS "Users can insert own data" ON public.users;
DROP POLICY IF EXISTS "Users can view own user" ON public.users;
DROP POLICY IF EXISTS "Users can update own user" ON public.users;
DROP POLICY IF EXISTS "Users can insert own user" ON public.users;

-- Policy for SELECT: Users can view their own record
-- Uses auth.uid() directly, NOT a query to users table
CREATE POLICY "Users can view own data"
ON public.users
FOR SELECT
USING (auth.uid() = id);

-- Policy for INSERT: Users can insert their own record
-- Uses auth.uid() directly
CREATE POLICY "Users can insert own data"
ON public.users
FOR INSERT
WITH CHECK (auth.uid() = id);

-- Policy for UPDATE: Users can update their own record
-- Uses auth.uid() directly
CREATE POLICY "Users can update own data"
ON public.users
FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);
```

### 4. Important Notes

**DO NOT** create policies that:
- Query the `users` table within the policy condition
- Use subqueries that reference `users` table
- Reference other tables that might query `users`

**DO** use:
- `auth.uid()` directly - this gets the authenticated user's ID from the JWT token
- Simple comparisons like `auth.uid() = id`
- No subqueries or joins

### 5. Example of BAD Policy (causes recursion):

```sql
-- ❌ BAD: This queries the users table, causing recursion
CREATE POLICY "bad_policy"
ON public.users
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.users 
    WHERE id = auth.uid()
  )
);
```

### 6. Example of GOOD Policy (no recursion):

```sql
-- ✅ GOOD: Uses auth.uid() directly, no table query
CREATE POLICY "good_policy"
ON public.users
FOR SELECT
USING (auth.uid() = id);
```

## For the `surfers` Table

Similarly, ensure the `surfers` table policies don't cause recursion:

```sql
-- Ensure RLS is enabled
ALTER TABLE public.surfers ENABLE ROW LEVEL SECURITY;

-- Delete existing policies
DROP POLICY IF EXISTS "Users can view own surfer data" ON public.surfers;
DROP POLICY IF EXISTS "Users can update own surfer data" ON public.surfers;
DROP POLICY IF EXISTS "Users can insert own surfer data" ON public.surfers;

-- Policy for SELECT
CREATE POLICY "Users can view own surfer data"
ON public.surfers
FOR SELECT
USING (auth.uid() = user_id);

-- Policy for INSERT
CREATE POLICY "Users can insert own surfer data"
ON public.surfers
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Policy for UPDATE
CREATE POLICY "Users can update own surfer data"
ON public.surfers
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
```

## Testing

After updating the policies:

1. Try signing in with Google again
2. Complete the onboarding flow
3. Check the browser console - the error should be gone
4. Verify data is saved in Supabase Dashboard → Table Editor

## If You Still Get Errors

1. Check if there are any triggers on the `users` table that might query it
2. Check if there are any functions that are called by the policies
3. Make sure no policies reference other tables that query `users`

## Alternative: Service Role Key (NOT RECOMMENDED for production)

If you need to bypass RLS temporarily for testing, you can use the service role key, but **NEVER expose this in your frontend code**. Only use it in server-side code or for admin operations.

