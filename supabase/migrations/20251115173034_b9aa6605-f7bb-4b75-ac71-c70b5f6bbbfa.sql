-- Drop the restrictive SELECT policies
DROP POLICY IF EXISTS "users_select_own" ON public.users;
DROP POLICY IF EXISTS "surfers_select_own" ON public.surfers;

-- Allow all authenticated users to view user profiles
CREATE POLICY "users_select_authenticated"
ON public.users
FOR SELECT
TO authenticated
USING (true);

-- Allow all authenticated users to view surfer profiles
CREATE POLICY "surfers_select_authenticated"
ON public.surfers
FOR SELECT
TO authenticated
USING (true);