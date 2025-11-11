-- Fix RLS Policies for users table
-- Run this in Supabase SQL Editor

-- Step 1: Enable RLS (if not already enabled)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Step 2: Drop all existing policies on users table
-- This removes any policies that might cause recursion
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'users' AND schemaname = 'public') LOOP
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.users';
    END LOOP;
END $$;

-- Step 3: Create new policies that use auth.uid() directly (no table queries)

-- Policy for SELECT: Users can view their own record
CREATE POLICY "users_select_own"
ON public.users
FOR SELECT
USING (auth.uid() = id);

-- Policy for INSERT: Users can insert their own record
CREATE POLICY "users_insert_own"
ON public.users
FOR INSERT
WITH CHECK (auth.uid() = id);

-- Policy for UPDATE: Users can update their own record
CREATE POLICY "users_update_own"
ON public.users
FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Step 4: Fix RLS Policies for surfers table (preventive)

ALTER TABLE public.surfers ENABLE ROW LEVEL SECURITY;

-- Drop existing policies on surfers table
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'surfers' AND schemaname = 'public') LOOP
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.surfers';
    END LOOP;
END $$;

-- Policy for SELECT: Users can view their own surfer data
CREATE POLICY "surfers_select_own"
ON public.surfers
FOR SELECT
USING (auth.uid() = user_id);

-- Policy for INSERT: Users can insert their own surfer data
CREATE POLICY "surfers_insert_own"
ON public.surfers
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Policy for UPDATE: Users can update their own surfer data
CREATE POLICY "surfers_update_own"
ON public.surfers
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Verify policies were created
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE schemaname = 'public' 
AND tablename IN ('users', 'surfers')
ORDER BY tablename, policyname;

