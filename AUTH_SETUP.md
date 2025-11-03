# Google OAuth Authentication Setup

This document describes the Google OAuth authentication implementation for the Swellyo app.

## Features Implemented

1. **Google OAuth Integration**: Users can sign in with their Google account
2. **SQLite Database**: User data (email, nickname, Google ID) is stored locally
3. **Context Management**: User state is managed through React Context
4. **Persistent Storage**: User data persists across app sessions

## Files Added/Modified

### New Files
- `src/utils/database.ts` - SQLite database service for user storage
- `src/utils/authService.ts` - Google OAuth authentication service
- `src/utils/userUtils.ts` - Utility functions for user data
- `src/utils/__tests__/database.test.ts` - Database service tests

### Modified Files
- `src/context/OnboardingContext.tsx` - Added user state management
- `src/screens/WelcomeScreen.tsx` - Replaced "Get Started" with Google Sign-In button
- `package.json` - Added Google Sign-In and SQLite dependencies

## Database Schema

The `users` table stores:
- `id` (INTEGER, PRIMARY KEY)
- `email` (TEXT, UNIQUE, NOT NULL)
- `nickname` (TEXT, NOT NULL)
- `googleId` (TEXT, UNIQUE, NOT NULL)
- `createdAt` (DATETIME)
- `updatedAt` (DATETIME)

## Usage

1. User clicks "Sign in with Google" button on welcome screen
2. Google OAuth flow is initiated
3. Upon successful authentication, user data is saved to SQLite
4. User is redirected to onboarding flow
5. User data is available throughout the app via context

## Configuration

The Google OAuth client is configured with:
- Redirect URI: `http://localhost:8081` (for development)
- Credentials stored in `secret/client_secret_*.json`

## Testing

Run the database tests:
```bash
npm test src/utils/__tests__/database.test.ts
```

## Next Steps

- Add error handling for network issues
- Implement user profile management
- Add sign-out functionality
- Consider adding user avatar display
