#!/usr/bin/env python3

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from main import app
    print("✅ Successfully imported app")
    
    # Test OpenAI client initialization
    from openai import OpenAI
    from dotenv import load_dotenv
    load_dotenv()
    
    openai_client = OpenAI(api_key=os.getenv("OPEN_AI_API_KEY"))
    print("✅ Successfully initialized OpenAI client")
    
    # Test a simple API call
    import uvicorn
    print("✅ Successfully imported uvicorn")
    
    print("🚀 Starting server...")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
    
except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
