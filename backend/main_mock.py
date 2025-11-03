from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Dict, List
import uuid
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = FastAPI(title="Swellyo LLM API (Mock)", version="1.0.0")

# In-memory storage for chats
chats: Dict[str, List[Dict[str, str]]] = {}

class ChatRequest(BaseModel):
    message: str

class ChatResponse(BaseModel):
    chat_id: str
    return_message: str

class ContinueChatRequest(BaseModel):
    message: str

class ContinueChatResponse(BaseModel):
    return_message: str

@app.post("/new_chat", response_model=ChatResponse)
async def new_chat(request: ChatRequest):
    """
    Create a new chat session and get a mock response from the LLM.
    
    Args:
        request: Contains the user's message
        
    Returns:
        ChatResponse with chat_id and mock LLM response
    """
    try:
        # Generate a unique chat ID
        chat_id = str(uuid.uuid4())
        
        # Initialize the chat with the user's message
        chats[chat_id] = [{"role": "user", "content": request.message}]
        
        # Mock response based on the user's message
        if "hello" in request.message.lower():
            mock_response = "Hello! I'm a mock AI assistant. How can I help you today?"
        elif "how are you" in request.message.lower():
            mock_response = "I'm doing well, thank you for asking! I'm here to help with any questions you might have."
        elif "weather" in request.message.lower():
            mock_response = "I'm a mock AI, so I can't check real weather data. But I hope you're having a great day!"
        else:
            mock_response = f"I received your message: '{request.message}'. This is a mock response from the Swellyo LLM API."
        
        # Store the assistant's response in the chat history
        chats[chat_id].append({"role": "assistant", "content": mock_response})
        
        return ChatResponse(
            chat_id=chat_id,
            return_message=mock_response
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing chat: {str(e)}")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "message": "Swellyo LLM API (Mock) is running"}

@app.post("/chats/{chat_id}/continue", response_model=ContinueChatResponse)
async def continue_chat(chat_id: str, request: ContinueChatRequest):
    """
    Continue an existing chat session with a new message.
    
    Args:
        chat_id: The unique identifier for the existing chat
        request: Contains the new user message
        
    Returns:
        ContinueChatResponse with the mock LLM response
    """
    try:
        # Check if chat exists
        if chat_id not in chats:
            raise HTTPException(status_code=404, detail="Chat not found")
        
        # Add the new user message to the chat history
        chats[chat_id].append({"role": "user", "content": request.message})
        
        # Mock response based on the user's message
        if "hello" in request.message.lower():
            mock_response = "Hello again! I'm still here to help you. What else would you like to know?"
        elif "how are you" in request.message.lower():
            mock_response = "I'm still doing well! Thanks for asking again. How can I assist you further?"
        elif "weather" in request.message.lower():
            mock_response = "I'm still a mock AI, so I can't check real weather data. But I hope you're having a great day!"
        elif "thank" in request.message.lower():
            mock_response = "You're very welcome! I'm happy to help. Is there anything else you'd like to know?"
        else:
            mock_response = f"I received your follow-up message: '{request.message}'. This is a mock response continuing our conversation."
        
        # Store the assistant's response in the chat history
        chats[chat_id].append({"role": "assistant", "content": mock_response})
        
        return ContinueChatResponse(return_message=mock_response)
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing chat: {str(e)}")

@app.get("/chats/{chat_id}")
async def get_chat_history(chat_id: str):
    """
    Get the chat history for a specific chat ID.
    
    Args:
        chat_id: The unique identifier for the chat
        
    Returns:
        List of messages in the chat
    """
    if chat_id not in chats:
        raise HTTPException(status_code=404, detail="Chat not found")
    
    return {"chat_id": chat_id, "messages": chats[chat_id]}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
