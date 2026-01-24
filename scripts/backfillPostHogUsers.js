/**
 * One-time migration script to backfill PostHog with user names
 * 
 * This script fetches all users from Supabase and identifies them in PostHog
 * with their name and email properties, so historical events show user names
 * instead of UUIDs.
 * 
 * Usage:
 *   node scripts/backfillPostHogUsers.js
 * 
 * Make sure to set your environment variables first:
 *   EXPO_PUBLIC_SUPABASE_URL
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY
 *   EXPO_PUBLIC_POSTHOG_API_KEY
 *   EXPO_PUBLIC_POSTHOG_HOST (optional, defaults to https://app.posthog.com)
 */

const { createClient } = require('@supabase/supabase-js');
const https = require('https');
const http = require('http');

// Try to load dotenv if available (optional)
try {
  require('dotenv').config();
} catch (error) {
  // dotenv not installed, will use environment variables directly
  console.log('ℹ️  dotenv not installed, using system environment variables');
}

// Configuration
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POSTHOG_API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com';

/**
 * Send identify event to PostHog using REST API
 */
function identifyUserInPostHog(userId, properties) {
  return new Promise((resolve, reject) => {
    const url = new URL('/capture/', POSTHOG_HOST);
    const protocol = url.protocol === 'https:' ? https : http;
    
    const payload = JSON.stringify({
      api_key: POSTHOG_API_KEY,
      event: '$identify',
      distinct_id: userId,
      properties: {
        $set: properties,
      },
    });
    
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    
    const req = protocol.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true });
        } else {
          reject(new Error(`PostHog API returned status ${res.statusCode}: ${data}`));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.write(payload);
    req.end();
  });
}

async function backfillPostHogUserNames() {
  console.log('🚀 Starting PostHog user backfill migration...\n');
  
  // Validate environment variables
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('❌ Missing Supabase configuration. Please set:');
    console.error('   EXPO_PUBLIC_SUPABASE_URL');
    console.error('   EXPO_PUBLIC_SUPABASE_ANON_KEY');
    console.error('\n⚠️  Note: If you get "No users found", you may need to use the service role key:');
    console.error('   SUPABASE_SERVICE_ROLE_KEY (bypasses RLS policies)');
    process.exit(1);
  }
  
  if (!POSTHOG_API_KEY) {
    console.error('❌ Missing PostHog API key. Please set:');
    console.error('   EXPO_PUBLIC_POSTHOG_API_KEY');
    process.exit(1);
  }
  
  try {
    // Initialize Supabase client
    console.log('🔌 Connecting to Supabase...');
    
    // Use service role key if available (bypasses RLS), otherwise use anon key
    const supabaseKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
    const keyType = SUPABASE_SERVICE_ROLE_KEY ? 'service role' : 'anon';
    
    const supabase = createClient(SUPABASE_URL, supabaseKey);
    console.log(`✅ Supabase connected (using ${keyType} key)\n`);
    
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      console.log('⚠️  Using anon key - may be restricted by RLS policies');
      console.log('   If you get "No users found", set SUPABASE_SERVICE_ROLE_KEY\n');
    }
    
    console.log('📊 PostHog API configured');
    console.log(`   Host: ${POSTHOG_HOST}\n`);
    
    // Fetch all users from Supabase (join with surfers table to get name)
    console.log('📥 Fetching users from Supabase...');
    const { data: users, error } = await supabase
      .from('users')
      .select(`
        id,
        email,
        surfers (
          name
        )
      `)
      .order('created_at', { ascending: true });
    
    if (error) {
      console.error('❌ Error fetching users:', error);
      throw error;
    }
    
    if (!users || users.length === 0) {
      console.log('⚠️  No users found in database\n');
      console.log('This could mean:');
      console.log('  1. There are no users in your database yet');
      console.log('  2. Row Level Security (RLS) is blocking access\n');
      console.log('💡 Solution: Set SUPABASE_SERVICE_ROLE_KEY environment variable');
      console.log('   You can find it in: Supabase Dashboard → Settings → API → service_role key\n');
      console.log('⚠️  SECURITY WARNING: The service_role key bypasses RLS.');
      console.log('   Only use it locally, never commit it to git!\n');
      return;
    }
    
    console.log(`✅ Found ${users.length} users\n`);
    console.log('🔄 Starting identification process...\n');
    
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    
    // Identify each user in PostHog
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const progress = `[${i + 1}/${users.length}]`;
      
      try {
        // Get name from surfers table if available
        const surferName = user.surfers?.[0]?.name || user.surfers?.name;
        
        // Skip users without a surfer profile (haven't completed onboarding)
        if (!surferName) {
          console.log(`${progress} ⏭️  Skipped: ${user.email} (no surfer profile yet)`);
          skippedCount++;
          continue;
        }
        
        const userName = surferName || user.email?.split('@')[0] || 'User';
        const userProperties = {
          $email: user.email,  // PostHog reserved property
          $name: userName,     // PostHog reserved property  
          email: user.email,   // Also set non-reserved for compatibility
          name: userName,      // Also set non-reserved for compatibility
        };
        
        await identifyUserInPostHog(user.id, userProperties);
        successCount++;
        
        console.log(`${progress} ✅ Updated: ${userName} (${user.email})`);
        
        // Add a small delay to avoid rate limiting (100ms between requests)
        if (i < users.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        errorCount++;
        console.error(`${progress} ❌ Failed for user ${user.id}:`, error.message);
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 Migration Summary:');
    console.log('='.repeat(60));
    console.log(`Total users:     ${users.length}`);
    console.log(`✅ Successful:   ${successCount}`);
    console.log(`⏭️  Skipped:      ${skippedCount} (no surfer profile)`);
    console.log(`❌ Failed:       ${errorCount}`);
    console.log('='.repeat(60) + '\n');
    
    if (successCount === users.length - skippedCount) {
      console.log('🎉 All users with profiles successfully identified in PostHog!');
      console.log('📝 Historical events will now show user names instead of UUIDs.\n');
      if (skippedCount > 0) {
        console.log(`ℹ️  ${skippedCount} user(s) skipped because they haven't completed onboarding yet.\n`);
      }
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

module.exports = { backfillPostHogUserNames };

