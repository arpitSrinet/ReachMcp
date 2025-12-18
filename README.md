# Reach Mobile MCP Server

MCP server for Reach Mobile conversational commerce.

## Setup

```bash
npm install
```

## Start Server

```bash
npm start
```

## Available Tools

- `get_plans` - Get available mobile plans
- `get_offers` - Get available offers/coupons
- `get_services` - Get available services (shipping, top-up, etc.)
- `check_coverage` - Check network coverage by ZIP code
- `validate_device` - Validate device compatibility by IMEI
- `add_to_cart` - Add plan or device to shopping cart
- `get_cart` - Get shopping cart contents

## Configuration

For ChatGPT Desktop, add to `~/Library/Application Support/ChatGPT/mcp.json`:

```json
{
  "mcpServers": {
    "reach-mobile-mcp": {
      "command": "/path/to/node",
      "args": ["/path/to/server.js"]
    }
  }
}
```

**Note**: Requires ChatGPT Plus subscription and Developer Mode enabled.

