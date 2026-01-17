#!/bin/bash

echo "🔍 Troubleshooting ngrok 503 Error"
echo "=================================="
echo ""

# Check 1: Is the server running?
echo "1️⃣  Checking if server is running..."
if curl -k -s https://localhost:3000/mcp > /dev/null 2>&1; then
    echo "   ✅ Server is running on https://localhost:3000"
    MCP_RESPONSE=$(curl -k -s https://localhost:3000/mcp)
    echo "   Response: ${MCP_RESPONSE:0:100}..."
else
    echo "   ❌ Server is NOT running!"
    echo "   Start it with: npm run start:https"
    exit 1
fi
echo ""

# Check 2: Is ngrok running?
echo "2️⃣  Checking if ngrok is running..."
if pgrep -f "ngrok" > /dev/null; then
    echo "   ✅ ngrok process is running"
    NGROK_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | grep -o '"public_url":"[^"]*' | head -1 | cut -d'"' -f4)
    if [[ -n "$NGROK_URL" ]]; then
        echo "   Public URL: $NGROK_URL"
        echo "   Full MCP URL: ${NGROK_URL}/mcp"
    fi
else
    echo "   ⚠️  ngrok is NOT running"
    echo "   Start it with: ./run-ngrok.sh"
fi
echo ""

# Check 3: Test ngrok URL if available
if [[ -n "$NGROK_URL" ]]; then
    echo "3️⃣  Testing ngrok public URL..."
    NGROK_MCP_URL="${NGROK_URL}/mcp"
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$NGROK_MCP_URL" 2>/dev/null)
    if [[ "$HTTP_CODE" == "200" ]] || [[ "$HTTP_CODE" == "405" ]]; then
        echo "   ✅ ngrok URL is accessible (HTTP $HTTP_CODE)"
    elif [[ "$HTTP_CODE" == "503" ]]; then
        echo "   ❌ 503 Service Unavailable - Server might not be reachable through ngrok"
        echo "   Possible causes:"
        echo "      - Server crashed when accessed through ngrok"
        echo "      - Firewall blocking ngrok"
        echo "      - ngrok configuration issue"
    else
        echo "   ⚠️  Unexpected HTTP code: $HTTP_CODE"
    fi
    echo ""
fi

# Check 4: Server logs
echo "4️⃣  Check server logs for errors"
echo "   Look for any error messages in your server terminal"
echo ""

# Check 5: ngrok web interface
echo "5️⃣  Access ngrok web interface:"
echo "   http://localhost:4040"
echo "   This shows request details and errors"
echo ""

echo "💡 Common fixes:"
echo "   1. Restart the server: npm run start:https"
echo "   2. Restart ngrok: ./run-ngrok.sh"
echo "   3. Check server logs for errors"
echo "   4. Make sure you're using the FULL URL: https://xxxx.ngrok-free.app/mcp"
echo "   5. For ChatGPT web, you may need to click 'Visit Site' on ngrok warning page"
echo ""

