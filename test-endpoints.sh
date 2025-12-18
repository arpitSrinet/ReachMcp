#!/bin/bash

NGROK_URL="https://sprier-sage-nonfluidly.ngrok-free.dev"

echo "=========================================="
echo "Testing POST /mcp endpoint"
echo "=========================================="
curl -k -X POST "${NGROK_URL}/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream, application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' \
  -v 2>&1 | grep -i "content-type\|HTTP/"

echo ""
echo "=========================================="
echo "Testing POST / endpoint (root)"
echo "=========================================="
curl -k -X POST "${NGROK_URL}/" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream, application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' \
  -v 2>&1 | grep -i "content-type\|HTTP/"

echo ""
echo "=========================================="
echo "Full response test for POST /mcp"
echo "=========================================="
curl -k -X POST "${NGROK_URL}/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream, application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{}}' \
  2>&1 | head -10

echo ""
echo "=========================================="
echo "Full response test for POST /"
echo "=========================================="
curl -k -X POST "${NGROK_URL}/" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream, application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/list","params":{}}' \
  2>&1 | head -10

