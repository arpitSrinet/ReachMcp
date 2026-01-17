#!/bin/bash

# Test script for Conversational Purchase Flow
# Make sure server is running: npm run start:https

BASE_URL="https://localhost:3000/mcp"
SESSION_ID=""

echo "🧪 Testing Conversational Purchase Flow"
echo "========================================"
echo ""

# Helper function to call MCP tool
call_tool() {
    local tool_name=$1
    local args=$2
    local id=$3
    
    response=$(curl -s -k -X POST "$BASE_URL" \
        -H "Content-Type: application/json" \
        -d "{
            \"jsonrpc\": \"2.0\",
            \"id\": $id,
            \"method\": \"tools/call\",
            \"params\": {
                \"name\": \"$tool_name\",
                \"arguments\": $args
            }
        }")
    
    echo "$response" | jq -r '.result.content[0].text // .result.content[0] // .error // .'
    
    # Extract sessionId if present
    if echo "$response" | jq -e '.result.content[0].text' > /dev/null 2>&1; then
        extracted_session=$(echo "$response" | grep -o 'Session ID: [^ ]*' | cut -d' ' -f3)
        if [ ! -z "$extracted_session" ]; then
            SESSION_ID="$extracted_session"
        fi
    fi
}

echo "1️⃣ Starting session for 2 lines..."
call_tool "start_session" '{"lineCount": 2}' 1
echo ""
sleep 1

echo "2️⃣ Getting flow status..."
if [ ! -z "$SESSION_ID" ]; then
    call_tool "get_flow_status" "{\"sessionId\": \"$SESSION_ID\"}" 2
else
    call_tool "get_flow_status" "{}" 2
fi
echo ""
sleep 1

echo "3️⃣ Checking coverage..."
call_tool "check_coverage" '{"zipCode": "90210"}' 3
echo ""
sleep 1

echo "4️⃣ Getting available plans..."
call_tool "get_plans" "{}" 4
echo ""
sleep 1

echo "5️⃣ Getting available devices..."
if [ ! -z "$SESSION_ID" ]; then
    call_tool "get_devices" "{\"sessionId\": \"$SESSION_ID\"}" 5
else
    call_tool "get_devices" "{}" 5
fi
echo ""
sleep 1

echo "6️⃣ Getting flow status again..."
if [ ! -z "$SESSION_ID" ]; then
    call_tool "get_flow_status" "{\"sessionId\": \"$SESSION_ID\"}" 6
else
    call_tool "get_flow_status" "{}" 6
fi
echo ""

echo "✅ Basic flow test completed!"
echo ""
echo "Note: To test adding items to cart, you'll need actual item IDs from the API responses above."
echo "Session ID: $SESSION_ID"

