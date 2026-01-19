-- Performance optimization indexes for common query patterns
-- These indexes will significantly speed up queries on conversations, messages, and user lookups

-- Index for conversation_members lookups by user_id (used in getConversations)
CREATE INDEX IF NOT EXISTS idx_conversation_members_user_id 
ON conversation_members(user_id);

-- Index for conversation_members lookups by conversation_id (used when fetching members)
CREATE INDEX IF NOT EXISTS idx_conversation_members_conversation_id 
ON conversation_members(conversation_id);

-- Composite index for conversation_members (user_id + conversation_id) for faster lookups
CREATE INDEX IF NOT EXISTS idx_conversation_members_user_conv 
ON conversation_members(user_id, conversation_id);

-- Index for messages by conversation_id and deleted status (used in getMessages and last message queries)
CREATE INDEX IF NOT EXISTS idx_messages_conversation_deleted 
ON messages(conversation_id, deleted) 
WHERE deleted = false;

-- Index for messages by conversation_id, deleted, and created_at (for ordering and filtering)
CREATE INDEX IF NOT EXISTS idx_messages_conversation_deleted_created 
ON messages(conversation_id, deleted, created_at DESC) 
WHERE deleted = false;

-- Index for conversations by updated_at (used for ordering conversations list)
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at 
ON conversations(updated_at DESC);

-- Index for surfers by user_id (used in profile lookups and member enrichment)
CREATE INDEX IF NOT EXISTS idx_surfers_user_id 
ON surfers(user_id);

-- Index for users by id (already should exist as primary key, but ensuring it's there)
-- Note: Primary keys automatically create indexes, but this is for clarity

-- Index for conversation_members last_read_at (used in unread count calculations)
CREATE INDEX IF NOT EXISTS idx_conversation_members_last_read 
ON conversation_members(conversation_id, user_id, last_read_at);

-- Composite index for messages unread count queries (conversation_id + deleted + created_at)
-- This helps with the unread count calculation queries
CREATE INDEX IF NOT EXISTS idx_messages_unread_count 
ON messages(conversation_id, deleted, created_at) 
WHERE deleted = false;







