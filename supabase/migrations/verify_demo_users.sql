-- Verification script to check for any demo users not properly flagged
-- Run this after migrations to verify all demo users have is_demo_user = true

-- Query to find demo users that are not flagged
SELECT 
  u.id AS user_id,
  u.email,
  s.is_demo_user,
  s.user_id AS surfer_user_id,
  CASE 
    WHEN s.user_id IS NULL THEN 'No surfer record exists'
    WHEN s.is_demo_user IS NULL THEN 'is_demo_user is NULL'
    WHEN s.is_demo_user = false THEN 'is_demo_user is false'
    ELSE 'Properly flagged'
  END AS status
FROM public.users u
LEFT JOIN public.surfers s ON u.id = s.user_id
WHERE u.email LIKE 'demo%'
  AND (s.is_demo_user IS NULL OR s.is_demo_user = false)
ORDER BY u.email;

-- Summary query
SELECT 
  COUNT(*) FILTER (WHERE u.email LIKE 'demo%') AS total_demo_users,
  COUNT(*) FILTER (WHERE u.email LIKE 'demo%' AND s.is_demo_user = true) AS flagged_demo_users,
  COUNT(*) FILTER (WHERE u.email LIKE 'demo%' AND (s.is_demo_user IS NULL OR s.is_demo_user = false)) AS unflagged_demo_users
FROM public.users u
LEFT JOIN public.surfers s ON u.id = s.user_id;

