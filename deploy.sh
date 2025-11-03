#!/bin/bash

echo "🚀 Building Swellyo for web deployment..."

# Clean previous build
rm -rf dist/

# Build the project for web
npm run build

echo "✅ Build completed successfully!"
echo "📁 Build output is in the 'dist' folder"
echo ""
echo "🌐 To deploy to Netlify:"
echo "1. Push your code to GitHub"
echo "2. Connect your repo to Netlify"
echo "3. Set build command: npm run build"
echo "4. Set publish directory: dist"
echo ""
echo "📋 Or deploy manually:"
echo "1. Run: npm run build"
echo "2. Upload the 'dist' folder contents to Netlify" 