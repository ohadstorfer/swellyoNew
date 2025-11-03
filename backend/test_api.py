#!/usr/bin/env python3
"""
Test script for the Swellyo LLM API
"""
import requests
import json

def test_health():
    """Test the health endpoint"""
    try:
        response = requests.get("http://localhost:8001/health")
        print(f"Health check: {response.status_code}")
        print(f"Response: {response.json()}")
        return response.status_code == 200
    except Exception as e:
        print(f"Health check failed: {e}")
        return False

def test_new_chat():
    """Test the new_chat endpoint"""
    try:
        payload = {"message": "Hello, how are you?"}
        response = requests.post(
            "http://localhost:8001/new_chat",
            headers={"Content-Type": "application/json"},
            data=json.dumps(payload)
        )
        print(f"New chat: {response.status_code}")
        print(f"Response: {response.json()}")
        return response.status_code == 200
    except Exception as e:
        print(f"New chat test failed: {e}")
        return False

def test_continue_chat():
    """Test continuing an existing chat"""
    try:
        # First create a chat
        payload = {"message": "Hello, this is a test"}
        response = requests.post(
            "http://localhost:8001/new_chat",
            headers={"Content-Type": "application/json"},
            data=json.dumps(payload)
        )
        
        if response.status_code == 200:
            chat_data = response.json()
            chat_id = chat_data.get("chat_id")
            
            # Then continue the chat with a new message
            continue_payload = {"message": "How are you doing?"}
            continue_response = requests.post(
                f"http://localhost:8001/chats/{chat_id}/continue",
                headers={"Content-Type": "application/json"},
                data=json.dumps(continue_payload)
            )
            print(f"Continue chat: {continue_response.status_code}")
            print(f"Response: {continue_response.json()}")
            return continue_response.status_code == 200
        else:
            print(f"Failed to create chat for continue test: {response.json()}")
            return False
    except Exception as e:
        print(f"Continue chat test failed: {e}")
        return False

def test_get_chat():
    """Test getting chat history"""
    try:
        # First create a chat
        payload = {"message": "Test message"}
        response = requests.post(
            "http://localhost:8001/new_chat",
            headers={"Content-Type": "application/json"},
            data=json.dumps(payload)
        )
        
        if response.status_code == 200:
            chat_data = response.json()
            chat_id = chat_data.get("chat_id")
            
            # Then get the chat history
            history_response = requests.get(f"http://localhost:8001/chats/{chat_id}")
            print(f"Get chat history: {history_response.status_code}")
            print(f"Response: {history_response.json()}")
            return history_response.status_code == 200
        else:
            print(f"Failed to create chat for history test: {response.json()}")
            return False
    except Exception as e:
        print(f"Get chat test failed: {e}")
        return False

if __name__ == "__main__":
    print("Testing Swellyo LLM API...")
    print("=" * 50)
    
    health_ok = test_health()
    print()
    
    if health_ok:
        chat_ok = test_new_chat()
        print()
        
        if chat_ok:
            continue_ok = test_continue_chat()
            print()
            
            history_ok = test_get_chat()
            print()
            
            print("=" * 50)
            print(f"Health: {'✓' if health_ok else '✗'}")
            print(f"New Chat: {'✓' if chat_ok else '✗'}")
            print(f"Continue Chat: {'✓' if continue_ok else '✗'}")
            print(f"Get Chat: {'✓' if history_ok else '✗'}")
        else:
            print("Skipping continue chat and history tests due to new_chat failure")
    else:
        print("API is not running or not accessible")
