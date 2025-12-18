#!/bin/bash

# Generate self-signed SSL certificates for HTTPS MCP server
echo "🔐 Generating SSL certificates for HTTPS..."
echo ""

CERT_DIR="certs"
mkdir -p "$CERT_DIR"

# Generate self-signed certificate
openssl req -x509 -newkey rsa:4096 \
  -keyout "$CERT_DIR/key.pem" \
  -out "$CERT_DIR/cert.pem" \
  -days 365 \
  -nodes \
  -subj "/C=US/ST=California/L=San Francisco/O=Reach Mobile/CN=localhost" \
  2>/dev/null

if [ $? -eq 0 ]; then
  echo "✅ SSL certificates generated successfully!"
  echo ""
  echo "📁 Certificates created:"
  echo "   - $CERT_DIR/key.pem"
  echo "   - $CERT_DIR/cert.pem"
  echo ""
  echo "⚠️  Note: These are self-signed certificates for testing."
  echo "   ChatGPT may show a security warning - you can accept it."
  echo ""
  echo "🚀 Next steps:"
  echo "   1. Start server: MCP_TRANSPORT=https PORT=3000 node server.js"
  echo "   2. Update ChatGPT config to use: https://localhost:3000/mcp"
else
  echo "❌ Error generating certificates"
  echo "   Make sure OpenSSL is installed: brew install openssl"
  exit 1
fi

