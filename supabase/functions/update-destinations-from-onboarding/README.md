# Update Destinations from Onboarding

This edge function extracts `destinations_array` from onboarding chat history and updates the user's profile in the `surfers` table.

## What It Does

During onboarding, users tell Swelly about places they've surfed. GPT extracts this information and stores it in the chat messages as JSON. This function:

1. Finds the user's onboarding chat
2. Searches through chat messages to find the completed onboarding data
3. Extracts the `destinations_array` from the final message
4. Updates the user's profile in the `surfers` table

## Usage

### 1. Deploy the Function

```bash
npx supabase functions deploy update-destinations-from-onboarding
```

### 2. Call the Function

#### From JavaScript/TypeScript:

```typescript
const { data, error } = await supabase.functions.invoke(
  'update-destinations-from-onboarding',
  {
    body: {
      user_id: 'your-user-uuid-here',
    },
  }
)

console.log(data)
// {
//   success: true,
//   user_id: "abc-123",
//   chat_id: "xyz-789",
//   destinations_count: 3,
//   destinations_array: [
//     {
//       country: "Australia",
//       area: ["Gold Coast"],
//       time_in_days: 912,
//       time_in_text: "2.5 years"
//     }
//   ],
//   message: "Successfully updated destinations_array from onboarding chat"
// }
```

#### From cURL:

```bash
curl -L -X POST 'https://your-project.supabase.co/functions/v1/update-destinations-from-onboarding' \
  -H 'Authorization: Bearer YOUR_ANON_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "user_id": "your-user-uuid-here"
  }'
```

#### From Supabase SQL Editor:

```sql
SELECT extensions.http((
  'POST',
  'https://your-project.supabase.co/functions/v1/update-destinations-from-onboarding',
  ARRAY[
    extensions.http_header('Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'),
    extensions.http_header('Content-Type', 'application/json')
  ],
  'application/json',
  '{"user_id": "your-user-uuid-here"}'
)::extensions.http_request);
```

### 3. Batch Update Multiple Users

Create a helper function to update all users:

```typescript
async function updateAllUsersDestinations() {
  // Get all users with onboarding chats
  const { data: chats } = await supabase
    .from('swelly_chat_history')
    .select('user_id')
    .eq('conversation_type', 'onboarding')

  const uniqueUserIds = [...new Set(chats?.map(c => c.user_id) || [])]

  console.log(`Found ${uniqueUserIds.length} users to update`)

  const results = []
  for (const userId of uniqueUserIds) {
    const { data, error } = await supabase.functions.invoke(
      'update-destinations-from-onboarding',
      { body: { user_id: userId } }
    )
    
    results.push({ userId, success: data?.success, error })
    console.log(`${data?.success ? '✅' : '❌'} ${userId}`)
  }

  return results
}

// Run it
const results = await updateAllUsersDestinations()
console.log('Summary:', results.filter(r => r.success).length, 'successful')
```

## Response Format

### Success Response:

```json
{
  "success": true,
  "user_id": "abc-123-def-456",
  "chat_id": "xyz-789",
  "destinations_count": 2,
  "destinations_array": [
    {
      "country": "Australia",
      "area": ["Gold Coast"],
      "time_in_days": 912,
      "time_in_text": "2.5 years"
    },
    {
      "country": "Sri Lanka",
      "area": ["Ahangama", "Kabalana"],
      "time_in_days": 60,
      "time_in_text": "2 months"
    }
  ],
  "message": "Successfully updated destinations_array from onboarding chat"
}
```

### Error Responses:

**No chat found:**
```json
{
  "success": false,
  "error": "No onboarding chat found for this user",
  "user_id": "abc-123"
}
```

**No destinations found:**
```json
{
  "success": false,
  "error": "No finished message with destinations_array found in chat history",
  "messages_checked": 12
}
```

**User not in surfers table:**
```json
{
  "success": false,
  "error": "User not found in surfers table",
  "user_id": "abc-123"
}
```

## When to Use

✅ **Use this function when:**
- A user completed onboarding but their `destinations_array` is empty
- You need to recover destinations from old chat logs
- You're migrating data or fixing missing destination data
- Testing or debugging destination extraction

❌ **Don't need it when:**
- The normal onboarding flow is working (it saves destinations automatically)
- User hasn't completed onboarding yet (`is_finished: false`)

## Testing

Test with a known user ID:

```bash
# Get a test user ID from your database
supabase db query "SELECT user_id FROM swelly_chat_history WHERE conversation_type = 'onboarding' LIMIT 1"

# Test the function
curl -L -X POST 'http://localhost:54321/functions/v1/update-destinations-from-onboarding' \
  -H 'Authorization: Bearer YOUR_ANON_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"user_id": "paste-user-id-here"}'
```

## Logs

The function outputs detailed logs:
- 🔍 User being processed
- ✅ Chat found
- 📝 Number of messages
- 📍 Extracted destinations
- ✅ Success confirmation

View logs in Supabase Dashboard → Edge Functions → update-destinations-from-onboarding → Logs



