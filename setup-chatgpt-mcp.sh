#!/bin/bash

# Setup ChatGPT MCP Configuration
echo "🔧 Setting up ChatGPT MCP Configuration..."
echo ""

# Get Node.js path
NODE_PATH=$(which node)
if [ -z "$NODE_PATH" ]; then
    NODE_PATH="/Users/arpitsingh/.nvm/versions/node/v23.11.0/bin/node"
fi

SERVER_PATH="$(pwd)/server.js"

echo "📦 Node.js: $NODE_PATH"
echo "📁 Server: $SERVER_PATH"
echo ""

# Create config for OpenAI folder
OPENAI_DIR="$HOME/Library/Application Support/OpenAI"
CHATGPT_DIR="$HOME/Library/Application Support/ChatGPT"

# Create directories if they don't exist
mkdir -p "$OPENAI_DIR"
mkdir -p "$CHATGPT_DIR"

# Create mcp.json for OpenAI
cat > "$OPENAI_DIR/mcp.json" << EOF
{
  "mcpServers": {
    "reach-mobile-mcp": {
      "command": "$NODE_PATH",
      "args": ["$SERVER_PATH"]
    }
  }
}
EOF

# Create mcp.json for ChatGPT
cat > "$CHATGPT_DIR/mcp.json" << EOF
{
  "mcpServers": {
    "reach-mobile-mcp": {
      "command": "$NODE_PATH",
      "args": ["$SERVER_PATH"]
    }
  }
}
EOF

echo "✅ Configuration created!"
echo ""
echo "📝 Files created:"
echo "   - $OPENAI_DIR/mcp.json"
echo "   - $CHATGPT_DIR/mcp.json"
echo ""
echo "🔄 Next steps:"
echo "   1. Restart ChatGPT Desktop completely (Cmd+Q)"
echo "   2. Reopen ChatGPT"
echo "   3. Check if MCP tools are available"
echo "   4. Try: 'Show me mobile plans'"
echo ""

