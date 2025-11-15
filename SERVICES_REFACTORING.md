# Services Folder Refactoring

This document describes the reorganization of services into a well-structured `services` folder.

## New Structure

```
src/services/
├── auth/              # Authentication services
│   ├── supabaseAuthService.ts
│   ├── authService.ts
│   ├── simpleAuthService.ts
│   ├── expoAuthService.ts
│   └── index.ts
├── database/          # Database services
│   ├── databaseService.ts
│   ├── supabaseDatabaseService.ts
│   ├── webDatabase.ts
│   └── index.ts
├── chat/              # Chat services
│   ├── chatService.ts
│   └── index.ts
├── media/             # Media utilities
│   ├── imageService.ts
│   ├── videoService.ts
│   └── index.ts
├── user/              # User utilities
│   ├── userService.ts
│   └── index.ts
└── index.ts           # Central export point
```

## Migration Guide

### Old Imports → New Imports

#### Authentication Services
```typescript
// Old
import { authService } from '../utils/authService';
import { simpleAuthService } from '../utils/simpleAuthService';
import { supabaseAuthService } from '../utils/supabaseAuthService';

// New
import { authService, simpleAuthService, supabaseAuthService } from '../services/auth';
```

#### Database Services
```typescript
// Old
import { databaseService, User } from '../utils/databaseService';
import { supabaseDatabaseService } from '../utils/supabaseDatabaseService';

// New
import { databaseService, User, supabaseDatabaseService } from '../services/database';
```

#### Chat Services
```typescript
// Old
import { ChatService, ChatResponse } from '../utils/chatService';

// New
import { ChatService, ChatResponse } from '../services/chat';
```

#### Media Services
```typescript
// Old
import { getImageUrl } from '../utils/imageUtils';
import { getVideoUrl, getBackgroundVideoSource } from '../utils/videoUtils';

// New
import { getImageUrl, getVideoUrl, getBackgroundVideoSource } from '../services/media';
```

#### User Services
```typescript
// Old
import { formatUserDisplayName, getUserInitials } from '../utils/userUtils';

// New
import { formatUserDisplayName, getUserInitials } from '../services/user';
```

### Central Import (Optional)

You can also import everything from the central services index:

```typescript
import { 
  authService, 
  databaseService, 
  ChatService, 
  getImageUrl, 
  formatUserDisplayName 
} from '../services';
```

## Benefits

1. **Better Organization**: Services are grouped by functionality
2. **Easier Navigation**: Clear folder structure makes it easy to find services
3. **Scalability**: Easy to add new services in the appropriate category
4. **Clean Imports**: Index files provide clean, organized exports
5. **Best Practices**: Follows common React/TypeScript project structure patterns

## Files Updated

All imports have been updated in:
- `src/context/OnboardingContext.tsx`
- `src/screens/WelcomeScreen.tsx`
- `src/screens/ChatScreen.tsx`
- `src/screens/OnboardingStep2Screen.tsx`
- `src/screens/LoadingScreen.tsx`
- `src/components/Logo.tsx`
- `src/components/BackgroundVideo.tsx`
- `src/components/TravelExperienceSlider.tsx`
- `src/utils/__tests__/database.test.ts`

## Old Files

The old files in `src/utils/` are still present for backward compatibility during migration. They can be removed once all references are updated:

- `src/utils/authService.ts`
- `src/utils/simpleAuthService.ts`
- `src/utils/supabaseAuthService.ts`
- `src/utils/expoAuthService.ts`
- `src/utils/databaseService.ts`
- `src/utils/supabaseDatabaseService.ts`
- `src/utils/webDatabase.ts`
- `src/utils/chatService.ts`
- `src/utils/imageUtils.ts`
- `src/utils/videoUtils.ts`
- `src/utils/userUtils.ts`

## Next Steps

1. ✅ Create new services folder structure
2. ✅ Move and update all service files
3. ✅ Update all imports across the codebase
4. ⏳ Test all functionality
5. ⏳ Remove old files from `src/utils/` (optional, can keep for reference)

