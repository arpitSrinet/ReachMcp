# Development Server

The development server allows you to test UI components locally in a browser with real API data, without needing to go through ChatGPT.

## Features

- ✅ View all UI templates in browser
- ✅ Real API data (fetched from Reach Mobile API)
- ✅ Isolated from main MCP server
- ✅ Fast iteration on UI components
- ✅ Mock prompt functions for testing interactions

## Usage

### Start Server with Dev Mode

```bash
# HTTPS mode (recommended)
npm run dev:ui

# HTTP mode
npm run dev:ui:http
```

Or manually with environment variable:

```bash
ENABLE_DEV_SERVER=true npm run start:https
```

### Access Dev Server

Once the server is running, open your browser:

- **Dev Server Index**: `http://localhost:3000/dev` (or `https://localhost:3000/dev`)
- **Direct Template Access**:
  - `http://localhost:3000/dev/templates/devices`
  - `http://localhost:3000/dev/templates/plans`
  - `http://localhost:3000/dev/templates/cart`
  - `http://localhost:3000/dev/templates/offers`
  - `http://localhost:3000/dev/templates/services`
  - `http://localhost:3000/dev/templates/sim`

## How It Works

1. **Isolated File**: All dev server code is in `devServer.js` - completely separate from main server
2. **Real API Calls**: Fetches actual data from Reach Mobile API using your existing service functions
3. **Data Injection**: Injects API data into templates via `window.openai.toolOutput` (same format as ChatGPT)
4. **Mock Functions**: Provides mock implementations of `openPromptInput` and `sendFollowUpMessage` for testing

## Template Data Sources

| Template | API Source |
|----------|-----------|
| `devices` | `fetchDevices()` from `deviceService.js` |
| `plans` | `getPlans()` from `plansService.js` |
| `cart` | `getCartMultiLine()` from `cartService.js` |
| `offers` | `fetchOffers()` from `productService.js` |
| `services` | `fetchServices()` from `productService.js` |
| `sim` | Static data (can be extended to use API) |

## Development Workflow

1. **Design/Update UI** in template files (e.g., `templates/devices.html`)
2. **Test Locally** using dev server (`npm run dev:ui`)
3. **Iterate Quickly** - see changes immediately in browser
4. **Test in ChatGPT** - once UI looks good, test through actual MCP integration

## Environment Variables

- `ENABLE_DEV_SERVER=true` - Enables dev server routes (default: disabled)
- `MCP_TRANSPORT` - Set to `http` or `https` (default: `stdio`)
- `PORT` - Server port (default: `3000`)

## Notes

- Dev server is **disabled by default** - only enabled when `ENABLE_DEV_SERVER=true`
- Requires valid API credentials to fetch real data
- All API calls use the same authentication and error handling as the main server
- Templates are served with real API data formatted exactly like ChatGPT receives it

## Troubleshooting

### "Error loading data from API"
- Check your API credentials are configured
- Verify network connectivity to Reach Mobile API
- Check server logs for detailed error messages

### Template not found
- Ensure template file exists in `templates/` directory
- Check template name matches exactly (case-sensitive)

### No data showing
- Check browser console for errors
- Verify API returned data (check server logs)
- Ensure template JavaScript is looking for correct data structure

