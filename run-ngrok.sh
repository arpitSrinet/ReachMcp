#!/bin/bash

echo "🚀 Starting ngrok tunnel for HTTPS server on port 3000..."
echo ""

# Check if server is running
echo "🔍 Checking if server is running on https://localhost:3000..."
if ! curl -k -s https://localhost:3000/mcp > /dev/null 2>&1; then
    echo "❌ ERROR: Server is NOT running on https://localhost:3000"
    echo ""
    echo "Please start your server first:"
    echo "   npm run start:https"
    echo "   OR"
    echo "   npm run dev:ui"
    echo ""
    exit 1
fi

echo "✅ Server is running and responding"
echo ""

# Test the /mcp endpoint specifically
MCP_RESPONSE=$(curl -k -s https://localhost:3000/mcp)
if [[ -z "$MCP_RESPONSE" ]]; then
    echo "⚠️  WARNING: /mcp endpoint not responding correctly"
    echo "   But continuing anyway..."
    echo ""
else
    echo "✅ /mcp endpoint is accessible"
    echo ""
fi

echo "📝 Important notes:"
echo "   1. ngrok free tier shows a browser warning page"
echo "      Users must click 'Visit Site' button to proceed"
echo "   2. For ChatGPT web, use the HTTPS URL (not HTTP)"
echo "   3. The URL format will be: https://xxxx-xx-xx-xx-xx.ngrok-free.app"
echo "   4. Make sure to use the FULL URL: https://xxxx.ngrok-free.app/mcp"
echo ""
echo "Press Ctrl+C to stop ngrok"
echo ""
echo "Starting ngrok tunnel..."
echo ""

# Start ngrok
# For HTTPS servers, explicitly specify the protocol
# ngrok will connect to your HTTPS server and serve HTTPS publicly
ngrok http https://localhost:3000

