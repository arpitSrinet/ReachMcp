#!/bin/bash

# Setup ChatGPT MCP Configuration for HTTPS
echo "🔧 Setting up ChatGPT MCP Configuration for HTTPS..."
echo ""

PORT=${PORT:-3000}
HTTPS_URL="https://localhost:${PORT}/mcp"

echo "📦 HTTPS URL: $HTTPS_URL"
echo ""

# Create config for OpenAI folder
OPENAI_DIR="$HOME/Library/Application Support/OpenAI"
CHATGPT_DIR="$HOME/Library/Application Support/ChatGPT"

# Create directories if they don't exist
mkdir -p "$OPENAI_DIR"
mkdir -p "$CHATGPT_DIR"

# Create mcp.json for OpenAI (HTTPS)
cat > "$OPENAI_DIR/mcp.json" << EOF
{
  "mcpServers": {
    "reach-mobile-mcp": {
      "url": "$HTTPS_URL"
    }
  }
}
EOF

# Create mcp.json for ChatGPT (HTTPS)
cat > "$CHATGPT_DIR/mcp.json" << EOF
{
  "mcpServers": {
    "reach-mobile-mcp": {
      "url": "$HTTPS_URL"
    }
  }
}
EOF

echo "✅ HTTPS Configuration created!"
echo ""
echo "📝 Files created:"
echo "   - $OPENAI_DIR/mcp.json"
echo "   - $CHATGPT_DIR/mcp.json"
echo ""
echo "🔗 Using URL: $HTTPS_URL"
echo ""
echo "🔄 Next steps:"
echo "   1. Start HTTPS server: npm run start:https"
echo "   2. Restart ChatGPT Desktop completely (Cmd+Q)"
echo "   3. Reopen ChatGPT"
echo "   4. Accept SSL certificate warning (self-signed cert)"
echo "   5. Check if MCP tools are available"
echo "   6. Try: 'Show me mobile plans'"
echo ""

