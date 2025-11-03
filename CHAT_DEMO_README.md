# Chat Demo for Investor Presentation

This document explains how to use the new chat feature for your investor demo.

## Features

- **Chat Interface**: Matches the design from your provided image with purple/white theme
- **API Integration**: Connects to your existing Python FastAPI backend
- **Real-time Messaging**: Send and receive messages with Swelly (your AI assistant)
- **Demo Mode**: Direct access to chat without going through onboarding

## How to Access

### Option 1: Demo Button (Recommended for Investor Demo)
1. Start the app
2. On the welcome screen, click "Demo Chat (Investor Demo)" button
3. This takes you directly to the chat interface

### Option 2: Through Onboarding Flow
1. Complete the onboarding steps (1-3)
2. After step 3, you'll automatically be taken to the chat screen

## API Configuration

The chat feature connects to your Python backend. To configure the API URL:

1. Edit `src/config/api.ts`
2. Update the `BASE_URL` to match your backend:
   - Local development: `http://localhost:8000`
   - Production: `https://your-backend-domain.com`
   - Mobile device: `http://YOUR_IP_ADDRESS:8000`

## Backend Requirements

Make sure your Python backend is running with these endpoints:
- `POST /new_chat` - Start a new chat
- `POST /chats/{chat_id}/continue` - Continue existing chat
- `GET /chats/{chat_id}` - Get chat history
- `GET /health` - Health check

## Chat Flow

1. **Initial Message**: Swelly greets the user with a welcome message
2. **Information Gathering**: Swelly asks questions to collect:
   - Destinations
   - Travel style
   - Surf preferences
   - Extras/interests
3. **Completion**: When all info is collected, chat is marked as finished

## Design Features

- **Header**: Shows Swelly's avatar, name, tagline, and progress bar
- **Messages**: Purple bubbles for user, white bubbles with purple border for Swelly
- **Input**: Text input with attach and voice recording buttons
- **Responsive**: Works on both mobile and web

## Troubleshooting

### Chat Not Working
1. Check if backend is running: `cd backend && python main.py`
2. Verify API URL in `src/config/api.ts`
3. Check browser console for errors

### CORS Issues (Web)
If you get CORS errors, add this to your FastAPI backend:
```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## Demo Tips for Investors

1. **Start with Demo Button**: Use the purple "Demo Chat" button for quick access
2. **Show the Flow**: Demonstrate how Swelly collects user information conversationally
3. **Highlight AI**: Point out how Swelly adapts responses based on user input
4. **Mobile Experience**: Show how it works on both web and mobile
5. **Real-time**: Emphasize the real-time chat experience

## Files Created/Modified

- `src/screens/ChatScreen.tsx` - Main chat interface
- `src/utils/chatService.ts` - API service for chat operations
- `src/config/api.ts` - API configuration
- `src/components/AppContent.tsx` - Added chat routing
- `src/screens/WelcomeScreen.tsx` - Added demo button
