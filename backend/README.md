# Swellyo LLM API Backend

A FastAPI-based backend service for handling LLM chat interactions.

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Set up environment variables:
   - Copy `example.env` to `.env`
   - Add your OpenAI API key to the `.env` file

3. Run the server:
```bash
python run.py
```

The API will be available at `http://localhost:8000`

## API Endpoints

### POST /new_chat
Creates a new chat session and returns an LLM response.

**Request:**
```json
{
  "message": "Hello, how are you?"
}
```

**Response:**
```json
{
  "chat_id": "uuid-string",
  "return_message": "I'm doing well, thank you for asking!"
}
```

### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "message": "Swellyo LLM API is running"
}
```

### POST /chats/{chat_id}/continue
Continue an existing chat session with a new message.

**Request:**
```json
{
  "message": "How are you doing today?"
}
```

**Response:**
```json
{
  "return_message": "I'm doing great, thank you for asking! How can I help you further?"
}
```

### GET /chats/{chat_id}
Retrieves the chat history for a specific chat ID.

**Response:**
```json
{
  "chat_id": "uuid-string",
  "messages": [
    {"role": "user", "content": "Hello, how are you?"},
    {"role": "assistant", "content": "I'm doing well, thank you for asking!"},
    {"role": "user", "content": "How are you doing today?"},
    {"role": "assistant", "content": "I'm doing great, thank you for asking! How can I help you further?"}
  ]
}
```

## Features

- In-memory chat storage
- OpenAI GPT-3.5-turbo integration
- Automatic chat history management
- Health check endpoint
- Error handling

## Development

The server runs with auto-reload enabled for development. Any changes to the code will automatically restart the server.
