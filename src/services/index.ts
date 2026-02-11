/**
 * Services
 * 
 * Central export point for all services.
 * Organized by category:
 * - auth: Authentication services
 * - database: Database services
 * - chat: Chat services (legacy - use swelly for new code)
 * - swelly: Swelly conversation services (Step 5)
 * - onboarding: Onboarding services (Steps 1-4)
 * - media: Media utilities (images, videos)
 * - user: User utilities
 */

// Auth services
export { supabaseAuthService } from './auth/supabaseAuthService';
export type { User as SupabaseAuthUser } from './auth/supabaseAuthService';
export { authService } from './auth/authService';
export type { GoogleUser } from './auth/authService';
// Deprecated: simpleAuthService and expoAuthService removed - use authService or supabaseAuthService instead

// Database services
export { databaseService } from './database/databaseService';
export type { User } from './database/databaseService';
export { supabaseDatabaseService } from './database/supabaseDatabaseService';
export type { SupabaseUser, SupabaseSurfer } from './database/supabaseDatabaseService';
export { webDatabaseService } from './database/webDatabase';

// Chat services (legacy - use swelly for new code)
export { ChatService } from './chat/chatService';
export type { ChatRequest, ChatResponse, ContinueChatRequest, ContinueChatResponse } from './chat/chatService';

// Swelly services (Step 5 - conversation)
export { swellyService } from './swelly/swellyService';
export type { SwellyChatRequest, SwellyChatResponse, SwellyContinueChatRequest, SwellyContinueChatResponse } from './swelly/swellyService';

// Onboarding services (Steps 1-4)
export { onboardingService } from './onboarding/onboardingService';
export type { OnboardingStepData } from './onboarding/onboardingService';

// Media services
export { getImageUrl } from './media/imageService';
export { getVideoUrl, getBackgroundVideoSource } from './media/videoService';

// User services
export { formatUserDisplayName, getUserInitials, isUserSignedIn } from './user/userService';

// Messaging services
export { messagingService } from './messaging/messagingService';
export type { Conversation, ConversationMember, Message, MessageReaction } from './messaging/messagingService';

