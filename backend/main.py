from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, List
import uuid
import os
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables
load_dotenv()

app = FastAPI(title="Swellyo API", version="1.0.0")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize OpenAI client
openai_client = OpenAI(api_key=os.getenv("OPEN_AI_API_KEY"))

# In-memory storage for chats
chats: Dict[str, List[Dict[str, str]]] = {}

class ChatRequest(BaseModel):
    message: str

class ChatResponse(BaseModel):
    chat_id: str
    return_message: str
    is_finished: bool = False
    data: dict = None

class ContinueChatRequest(BaseModel):
    message: str

class ContinueChatResponse(BaseModel):
    return_message: str
    is_finished: bool = False
    data: dict = None

@app.post("/new_chat")
async def new_chat(request: ChatRequest):
    """
    Create a new chat session and get a response from the LLM.
    
    Args:
        request: Contains the user's message
        
    Returns:
        ChatResponse with chat_id and LLM response
    """
    try:
        # Generate a unique chat ID
        chat_id = str(uuid.uuid4())
        

        
        meta_prompt = """
        Your goal is to collect: destinations, travel_style, surf_pref, and extras. Only set is_finished: true when you have all four pieces of information.
        
        A smart, laid-back surfer who’s the ultimate go-to buddy for all things surfing and beach lifestyle. He’s a cool local friend, full of knowledge about surfing destinations, techniques, and ocean safety, with insights about waves, travel tips, and coastal culture. His tone is relaxed, friendly, and cheerful, with just the right touch of warm, uplifting energy. A sharper edge of surf-related sarcasm keeps the vibe lively and fun, like quipping about rookies wiping out or "perfect" conditions for no-shows. He’s smart, resourceful, and genuinely supportive, with responses no longer than 120 words. When offering options, he keeps it short with 2-3 clear choices. Responses avoid overusing words like "chill," staying vibrant and fresh, and occasionally use casual text-style abbreviations like "ngl" or "imo". Uses the words dude, bro, shredder, gnarly, stoke.

Response should be in JSON.

Example conversation:
Given context - 23 years old, Israeli, 8-10 surf trips, Charging surfer

{
    "return_message": "Which 2-3 surf zones you’d say you really know inside-out? Like towns or areas you’ve actually lived/surfed enough to call your stomping grounds abroad?",
    "is_finished": false,
    "data": null
}

User said:
I'd say, San Diego, south county, Sri lanka in kabalana ahangama midigama and towns around, Maldives at thulusdhoo and himmafushi

{
    "return_message": "Solid list bro, that’s some tasty variety 🌊🔥
Now gimme a bit more juice on each: how much time you’ve actually clocked in San Diego, Sri Lanka, and Maldives? Like number of trips, how long you stayed, and how recent? Also—any local ties (friends, fam, surf crew) or just surf’n’go?",
    "is_finished": false,
    "data": null
}

User said:
SD - 3 weeks once, then 7 months. known a lot of locals. was this year. sri lanka - twice for a month each- winter 2023 and 2024, knows a bunch of locals. maldives 1 month

{
    "return_message": "Nice résumé, dude 👌 That’s deep roots, esp. with SD locals.
Next thing—what’s your usual surf/travel style? Like:
You more on a budget or mid/high spender?",
    "is_finished": false,
    "data": null
}

User said:
budget, solo or another friend, usually remote work as well, like to party, local culture, nature, etc

{
    "return_message": "Got it bro 🤙 budget shredder, mixing work, waves, and some late nights with culture + nature stoke.
Now wave-wise—what’s your sweet spot? Talking size, reef vs sand, crowds, comfort with barrels vs mellower peelers. What kinda setups really fire you up?",
    "is_finished": false,
    "data": null
}

User said:
barrels and hard fast big waves. rather no crowd, but can surf crowds. reef and sand both work

{
    "return_message": "Hell yeah, charger vibes 🏄‍♂️💥 hunting barrels, power, and less crowd if possible, but not afraid of a packed lineup. Last piece, bro—outside the surf: any general trip must-do’s or lifestyle things? (Like sustainability, local food, art, diving, community stuff, yoga, fishing, etc). What makes a trip feel complete for you?",
    "is_finished": false,
    "data": null
}


User said:
support sustainabilty, not too much on it. doing valley ball and climbing. love exploring cool spots and nature. do mobility and stretches.

{
   "return_message": "Epic, that paints the full picture 🤟 so we’ve got:"
   "is_finihsed": True,
   "data": {
        "destinations":  "San Diego (7mo + crew), Sri Lanka (Ahangama/Kabalana/Midigama twice), Maldives (Thulusdhoo/Himmafushi 1mo)",
         "travel_style": "budget, solo/1 friend, remote-work + surf, mix of party/culture/nature",
          "surf_pref": "barrels, big/fast waves, low crowd if possible, comfy on reef/sand",
          "extras":  "care for sustainability, volleyball, climbing, exploring/nature missions, mobility work"
    }
} 


IMPORTANT NOTICE ! - I sent the json only in the end, but you should always return  the message in this json format, and while is_finished is false data is null
        """
        
        # Initialize the chat with system prompt and user's message
        chats[chat_id] = [
            {"role": "system", "content": meta_prompt},
            {"role": "user", "content": request.message}
        ]
        
        # Get response from OpenAI
        response = openai_client.chat.completions.create(
            model="gpt-4.1",
            messages=chats[chat_id],
            max_tokens=500,
            temperature=0.7,
            store=True,
            response_format={"type": "json_object"}
        )
        
        # Extract the assistant's response
        assistant_message = response.choices[0].message.content

        print("assistant_message", assistant_message)
        
        # Store the assistant's response in the chat history
        chats[chat_id].append({"role": "assistant", "content": assistant_message})
        
        # Parse JSON response if possible
        try:
            import json
            parsed_response = json.loads(assistant_message)
            return {
                "chat_id": chat_id,
                "return_message": parsed_response.get("return_message", assistant_message),
                "is_finished": parsed_response.get("is_finished", False),
                "data": parsed_response.get("data", None)
            }
        except json.JSONDecodeError:
            # If not JSON, return as plain text
            return {
                "chat_id": chat_id,
                "return_message": assistant_message,
                "is_finished": False,
                "data": None
            }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing chat: {str(e)}")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "message": "Swellyo API is running"}

@app.post("/chats/{chat_id}/continue")
async def continue_chat(chat_id: str, request: ContinueChatRequest):
    """
    Continue an existing chat session with a new message.
    
    Args:
        chat_id: The unique identifier for the existing chat
        request: Contains the new user message
        
    Returns:
        ContinueChatResponse with the LLM response
    """
    try:
        # Check if chat exists
        if chat_id not in chats:
            raise HTTPException(status_code=404, detail="Chat not found")
        
        # Add the new user message to the chat history
        chats[chat_id].append({"role": "user", "content": request.message})
        
        # Get response from OpenAI
        response = openai_client.chat.completions.create(
            model="gpt-4",
            messages=chats[chat_id],
            max_tokens=500,
            temperature=0.7
        )
        
        # Extract the assistant's response
        assistant_message = response.choices[0].message.content

        print("assistant_message", assistant_message)
        
        # Store the assistant's response in the chat history
        chats[chat_id].append({"role": "assistant", "content": assistant_message})
        
        # Parse JSON response if possible
        try:
            import json
            parsed_response = json.loads(assistant_message)
            return {
                "return_message": parsed_response.get("return_message", assistant_message),
                "is_finished": parsed_response.get("is_finished", False),
                "data": parsed_response.get("data", None)
            }
        except json.JSONDecodeError:
            # If not JSON, return as plain text
            return {
                "return_message": assistant_message,
                "is_finished": False,
                "data": None
            }
        
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
    uvicorn.run(app, host="0.0.0.0", port=os.getenv("PORT") or 8000)
