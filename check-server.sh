#!/bin/bash

echo "🔍 Checking server status..."
echo ""

# Check if server is running on port 3000
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "✅ Port 3000 is in use (server likely running)"
else
    echo "❌ Port 3000 is NOT in use - server is not running!"
    echo "   Start server with: npm run start:https"
    exit 1
fi

# Try to connect to HTTPS server
echo ""
echo "🔍 Testing HTTPS connection to localhost:3000..."
if curl -k -s -o /dev/null -w "%{http_code}" https://localhost:3000/ | grep -q "200\|404\|405"; then
    echo "✅ Server is responding on https://localhost:3000"
    
    # Test the /mcp endpoint
    echo ""
    echo "🔍 Testing /mcp endpoint..."
    MCP_RESPONSE=$(curl -k -s https://localhost:3000/mcp)
    if echo "$MCP_RESPONSE" | grep -q "reach-mobile-mcp-server"; then
        echo "✅ /mcp endpoint is responding"
    else
        echo "⚠️  /mcp endpoint returned unexpected response"
        echo "   Response: $MCP_RESPONSE"
    fi
else
    echo "❌ Server is NOT responding on https://localhost:3000"
    echo "   Make sure server is running with: npm run start:https"
    exit 1
fi

# Check if ngrok is running
echo ""
echo "🔍 Checking if ngrok is running..."
if pgrep -x "ngrok" > /dev/null; then
    echo "✅ ngrok process is running"
    echo ""
    echo "📋 ngrok status:"
    curl -s http://localhost:4040/api/tunnels | python3 -m json.tool 2>/dev/null || echo "   (ngrok web interface not accessible)"
else
    echo "ℹ️  ngrok is not running"
    echo "   Start it with: ./run-ngrok.sh"
fi

echo ""
echo "✅ All checks passed! Server is ready for ngrok."

