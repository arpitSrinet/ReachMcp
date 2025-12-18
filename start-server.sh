#!/bin/bash

# Start MCP Server for ChatGPT
echo "🚀 Starting Reach Mobile MCP Server..."
echo ""

# Get Node.js path
NODE_PATH=$(which node)
if [ -z "$NODE_PATH" ]; then
    NODE_PATH="/Users/arpitsingh/.nvm/versions/node/v23.11.0/bin/node"
fi

echo "📦 Node.js: $NODE_PATH"
echo "📁 Server: $(pwd)/server.js"
echo ""

# Start server in stdio mode (for ChatGPT)
echo "✅ Server starting in STDIO mode..."
echo "   This will run in the background for ChatGPT to connect"
echo ""

$NODE_PATH server.js

