# Advice Role Implementation

## Overview
This implementation adds support for tracking "adv_giver" and "adv_seeker" roles in conversations created through trip planning recommendations.

## Database Changes

### SQL Migration
Run the following SQL in your Supabase dashboard:

```sql
-- File: supabase/migrations/add_adv_role_to_conversation_members.sql

ALTER TABLE public.conversation_members 
ADD COLUMN IF NOT EXISTS adv_role VARCHAR(20) CHECK (adv_role IN ('adv_giver', 'adv_seeker'));

COMMENT ON COLUMN public.conversation_members.adv_role IS 
'Role in trip planning context: adv_giver (recommended user) or adv_seeker (initiating user). NULL for non-trip-planning conversations.';
```

### Column Details
- **Column Name**: `adv_role`
- **Type**: `VARCHAR(20)`
- **Values**: 
  - `'adv_giver'`: The user who was recommended (receives the message)
  - `'adv_seeker'`: The user who initiated contact (sends the message)
  - `NULL`: For group chats or conversations not created through trip planning
- **Constraint**: CHECK constraint ensures only valid values are allowed

## Implementation Flow

### 1. When a User Clicks "Send Message" on a Matched User Card
- Location: `src/components/MatchedUserCard.tsx`
- Action: Calls `onSendMessage(user.user_id)` which triggers `handleStartConversation` in `AppContent.tsx`

### 2. Setting the Flag in AppContent
- Location: `src/components/AppContent.tsx`
- Function: `handleStartConversation(userId: string)`
- Action: Sets `fromTripPlanning: true` in the `selectedConversation` state when creating a pending conversation from trip planning

### 3. Passing the Flag to DirectMessageScreen
- Location: `src/components/AppContent.tsx`
- Action: Passes `fromTripPlanning={selectedConversation.fromTripPlanning || false}` as a prop to `DirectMessageScreen`

### 4. Creating the Conversation
- Location: `src/screens/DirectMessageScreen.tsx`
- Function: `sendMessage()`
- Action: When the first message is sent, calls `messagingService.createDirectConversation(otherUserId, fromTripPlanning)`

### 5. Setting the Roles in Database
- Location: `src/services/messaging/messagingService.ts`
- Function: `createDirectConversation(otherUserId: string, fromTripPlanning: boolean = false)`
- Logic:
  - If `fromTripPlanning === true`:
    - Current user (who clicked "Send Message") → `adv_role: 'adv_seeker'`
    - Other user (who was recommended) → `adv_role: 'adv_giver'`
  - If `fromTripPlanning === false`:
    - Both users → `adv_role: null`

## Code Changes Summary

### Files Modified

1. **`supabase/migrations/add_adv_role_to_conversation_members.sql`** (NEW)
   - SQL migration to add the `adv_role` column

2. **`src/services/messaging/messagingService.ts`**
   - Updated `ConversationMember` interface to include `adv_role?: 'adv_giver' | 'adv_seeker' | null`
   - Updated `createDirectConversation()` to accept `fromTripPlanning` parameter
   - Sets `adv_role` when inserting conversation members

3. **`src/screens/DirectMessageScreen.tsx`**
   - Added `fromTripPlanning?: boolean` to `DirectMessageScreenProps`
   - Passes `fromTripPlanning` to `createDirectConversation()`

4. **`src/components/AppContent.tsx`**
   - Added `fromTripPlanning?: boolean` to `selectedConversation` state type
   - Sets `fromTripPlanning: true` in `handleStartConversation()` when conversation is from trip planning
   - Passes `fromTripPlanning` prop to `DirectMessageScreen`

## Usage Notes

1. **Only for Private Chats**: This feature only applies to direct conversations between 2 users. Group chats will have `adv_role: null` for all members.

2. **Existing Conversations**: Conversations created before this implementation will have `adv_role: null` for all members.

3. **Manual Conversations**: Conversations started from the conversations list (not from trip planning) will have `adv_role: null`.

4. **Querying**: You can query conversations by advice role:
   ```sql
   -- Find all conversations where current user is seeking advice
   SELECT * FROM conversation_members 
   WHERE user_id = 'current_user_id' AND adv_role = 'adv_seeker';
   
   -- Find all conversations where current user is giving advice
   SELECT * FROM conversation_members 
   WHERE user_id = 'current_user_id' AND adv_role = 'adv_giver';
   ```

## Testing

To test the implementation:

1. Run the SQL migration in Supabase dashboard
2. Go through trip planning flow
3. Click "Send Message" on a matched user
4. Send the first message
5. Check the `conversation_members` table:
   - Your user should have `adv_role = 'adv_seeker'`
   - The matched user should have `adv_role = 'adv_giver'`








