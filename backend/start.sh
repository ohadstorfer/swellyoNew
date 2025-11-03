#!/bin/bash

# Swellyo LLM API Startup Script

echo "Starting Swellyo LLM API..."

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install dependencies if needed
if [ ! -f "venv/pyvenv.cfg" ] || [ requirements.txt -nt venv/pyvenv.cfg ]; then
    echo "Installing dependencies..."
    pip install -r requirements.txt
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "Warning: .env file not found. Please create one from example.env"
    echo "Using mock mode..."
    python main_mock.py
else
    echo "Starting with OpenAI integration..."
    python run.py
fi
