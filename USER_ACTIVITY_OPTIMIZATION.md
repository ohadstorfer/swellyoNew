# User Activity System Optimization

## Overview
The user activity system has been simplified and optimized to reduce resource usage while maintaining functionality.

## Key Changes

### 1. Simplified Database Schema
**Before:**
- `user_id` (PK)
- `last_seen_at` (timestamptz)
- `is_online` (boolean) ❌ **Redundant**
- `updated_at` (timestamptz) ❌ **Redundant**

**After:**
- `user_id` (PK)
- `last_seen_at` (timestamptz) ✅ **Single source of truth**

**Why:** Online status is now calculated from `last_seen_at` (active within 5 minutes = online). This eliminates:
- Constant boolean updates
- Redundant timestamp tracking
- Database write overhead

### 2. Reduced Database Writes
**Before:**
- Database write every 30 seconds (even when unchanged)
- Separate timers for presence (20s) and DB updates (30s)
- Complex debouncing logic

**After:**
- Database write max once per minute (60s cooldown)
- Single timer for both presence and occasional DB writes
- Simple cooldown mechanism

**Impact:** ~50% reduction in database writes

### 3. Batched Queries
**Before:**
- Individual database queries for each user when checking status
- N queries for N users

**After:**
- Batch queries using `.in('user_id', [...])` 
- 1 query for multiple users

**Impact:** Significant reduction in database load when checking multiple users

### 4. Simplified Logic
**Before:**
- Complex debouncing with multiple checks
- Separate update paths for presence and database
- Redundant field updates

**After:**
- Single update path
- Presence API is primary (real-time)
- Database is fallback (calculated from last_seen_at)
- Cleaner, more maintainable code

### 5. Removed Redundant Operations
- Removed `updated_at` field (not needed)
- Removed `is_online` field (calculated from `last_seen_at`)
- Consolidated timers (one instead of two)
- Simplified app state handling

## Migration Steps

1. **Run the database migration:**
   ```sql
   -- File: supabase/migrations/20260218000002_simplify_user_activity_table.sql
   ```
   This will:
   - Drop `is_online` and `updated_at` columns
   - Update the trigger function
   - Add documentation

2. **Update email notification function:**
   - Already updated to use only `last_seen_at`
   - Removed `is_online` check

3. **Code changes:**
   - Presence service already updated
   - All references to `is_online` removed
   - Online status calculated from `last_seen_at`

## Performance Improvements

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Database writes/min | 2 | 1 | 50% reduction |
| Database columns | 4 | 2 | 50% reduction |
| Timers | 2 | 1 | 50% reduction |
| Query efficiency | N queries | 1 batch query | Nx improvement |

## How It Works Now

1. **Real-time Status (Primary):**
   - Uses Supabase Presence API
   - Updates every 20 seconds
   - Instant updates when users come online/offline

2. **Database Fallback (Secondary):**
   - Checks `last_seen_at` from `user_activity` table
   - If `last_seen_at` is within 5 minutes → user is online
   - Used when presence isn't available

3. **Database Writes:**
   - Only writes `last_seen_at` to database
   - Max once per minute (cooldown)
   - On app state changes (foreground)
   - Automatically via presence heartbeat

## Benefits

✅ **Reduced Resource Usage:**
- 50% fewer database writes
- Smaller table size
- Less network traffic

✅ **Simpler Code:**
- Single source of truth (`last_seen_at`)
- Less complex logic
- Easier to maintain

✅ **Better Performance:**
- Batched queries for multiple users
- Fewer database operations
- Faster status checks

✅ **Same Functionality:**
- Real-time presence still works
- Database fallback still works
- Email notifications still work

## Backward Compatibility

⚠️ **Breaking Changes:**
- `is_online` field no longer exists
- `updated_at` field no longer exists
- Code that references these fields needs to be updated

✅ **Compatible:**
- Presence API usage unchanged
- Subscription API unchanged
- Email notification logic updated automatically

