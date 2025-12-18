# Reach Mobile Apps SDK Application

This is the Apps SDK wrapper for the Reach Mobile MCP server.

## Structure

- `app.js` - Main application entry point
- `app-spec.js` - App specification and widget definitions
- `mcp-client.js` - Client to communicate with MCP server
- `widgets/` - Widget renderers for different data types

## Usage

### With Apps SDK (when available)

```javascript
import { app } from './app.js';

// Process a tool call
const result = await app.processToolCall('get_plans', { maxPrice: 30 });
console.log(result); // Returns rendered widgets
```

### Testing

```bash
npm test
```

## Integration with MCP Server

The app communicates with the MCP server via `mcp-client.js`, which:
1. Spawns the MCP server process
2. Sends JSON-RPC requests
3. Parses responses and extracts data
4. Returns JSON format (not markdown)

## Widget Types

- `planCard` - Mobile plan cards with select button
- `offerCard` - Offer/coupon cards
- `cartSummary` - Shopping cart summary

## Note

This structure is ready for Apps SDK integration. When OpenAI releases the Apps SDK, you can:
1. Install the SDK package
2. Import and use the SDK classes
3. Register this app with OpenAI
4. Deploy to ChatGPT

