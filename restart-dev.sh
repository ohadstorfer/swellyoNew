#!/bin/bash
# Script to restart dev server with cleared cache

echo "Stopping any running Expo processes..."
pkill -f "expo start" || true
pkill -f "node.*expo" || true

echo "Clearing Expo cache..."
npx expo start --clear

