/**
 * One-time migration script to backfill PostHog with user names
 * 
 * This script fetches all users from Supabase and identifies them in PostHog
 * with their name and email properties, so historical events show user names
 * instead of UUIDs.
 * 
 * Usage:
 *   npx ts-node scripts/backfillPostHogUsers.ts
 * 
 * Or if running in Node.js environment:
 *   node -r ts-node/register scripts/backfillPostHogUsers.ts
 */

import { supabase } from '../src/config/supabase';
import { analyticsService } from '../src/services/analytics/analyticsService';

interface User {
  id: string;
  email: string;
  nickname: string | null;
}

async function backfillPostHogUserNames() {
  console.log('🚀 Starting PostHog user backfill migration...\n');
  
  try {
    // Initialize analytics service
    console.log('📊 Initializing PostHog...');
    await analyticsService.initialize();
    console.log('✅ PostHog initialized\n');
    
    // Fetch all users from Supabase
    console.log('📥 Fetching users from Supabase...');
    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, nickname')
      .order('created_at', { ascending: true });
    
    if (error) {
      console.error('❌ Error fetching users:', error);
      throw error;
    }
    
    if (!users || users.length === 0) {
      console.log('⚠️  No users found in database');
      return;
    }
    
    console.log(`✅ Found ${users.length} users\n`);
    console.log('🔄 Starting identification process...\n');
    
    let successCount = 0;
    let errorCount = 0;
    
    // Identify each user in PostHog
    for (let i = 0; i < users.length; i++) {
      const user = users[i] as User;
      const progress = `[${i + 1}/${users.length}]`;
      
      try {
        const userProperties = {
          email: user.email,
          name: user.nickname || user.email?.split('@')[0] || 'User',
        };
        
        analyticsService.identify(user.id, userProperties);
        successCount++;
        
        console.log(`${progress} ✅ Updated: ${userProperties.name} (${user.email})`);
        
        // Add a small delay to avoid rate limiting (optional)
        if (i < users.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        errorCount++;
        console.error(`${progress} ❌ Failed for user ${user.id}:`, error);
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 Migration Summary:');
    console.log('='.repeat(60));
    console.log(`Total users:     ${users.length}`);
    console.log(`✅ Successful:   ${successCount}`);
    console.log(`❌ Failed:       ${errorCount}`);
    console.log('='.repeat(60) + '\n');
    
    if (successCount === users.length) {
      console.log('🎉 All users successfully identified in PostHog!');
      console.log('📝 Historical events will now show user names instead of UUIDs.\n');
    } else {
      console.log('⚠️  Some users failed to be identified. Check errors above.\n');
    }
    
  } catch (error) {
    console.error('❌ Fatal error during migration:', error);
    process.exit(1);
  }
}

// Run the migration
if (require.main === module) {
  backfillPostHogUserNames()
    .then(() => {
      console.log('✅ Migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    });
}

export { backfillPostHogUserNames };

