#!/bin/bash

echo "🚀 Starting ngrok tunnel for MCP server..."
echo ""
echo "Make sure your server is running first: npm run start:https"
echo ""
echo "Starting ngrok..."
ngrok http https://localhost:3000
