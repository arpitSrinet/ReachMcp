# Setting Up Apps SDK Test Environment

## Current Status

The OpenAI Apps SDK is available in **preview mode** and can be tested in ChatGPT Developer Mode.

## Available Resources

1. **Apps SDK UI Library**: https://github.com/openai/apps-sdk-ui
   - React component library
   - Tailwind-integrated design tokens
   - For building ChatGPT app UIs

2. **Official Documentation**: https://developers.openai.com/apps-sdk/
   - Quickstart guide
   - Design guidelines
   - Example apps

## Setup Steps

### Option 1: Use Developer Mode in ChatGPT

1. **Enable Developer Mode**:
   - Business/Enterprise/Edu admins can enable from Workspace settings
   - Allows authorized users to develop and test internal apps

2. **Create Your App**:
   - Use the Apps SDK to define your app
   - Connect to your MCP server
   - Test widgets in ChatGPT

### Option 2: Install Apps SDK UI (for React components)

```bash
cd app
npm install @openai/apps-sdk-ui
```

This provides React components for building app UIs.

### Option 3: Use MCP Directly (Current Setup)

Your current setup already works with MCP:
- MCP server returns JSON format
- Widget renderers create Apps SDK-compatible structures
- Ready for Apps SDK integration

## Testing Your App

### 1. Test MCP Integration (Already Working ✅)

```bash
cd app
node -e "import('./app.js').then(m => m.app.processToolCall('get_plans', {}).then(console.log))"
```

### 2. Test in ChatGPT Developer Mode

1. Enable Developer Mode in ChatGPT
2. Create a new app
3. Connect to your MCP server
4. Test widget rendering

### 3. Use Apps SDK UI Components

If you want to build a React UI for testing:

```bash
npm install @openai/apps-sdk-ui
```

Then use the components in your React app.

## Next Steps

1. **Check OpenAI Developer Portal**:
   - Visit https://platform.openai.com/
   - Look for Apps SDK section
   - Check for SDK download/installation

2. **Follow Quickstart Guide**:
   - https://developers.openai.com/apps-sdk/quickstart
   - Build a simple test app
   - Connect to your MCP server

3. **Test Widget Rendering**:
   - Your widgets are already formatted correctly
   - Once SDK is available, they'll render in ChatGPT

## Current Implementation Status

✅ MCP server supports JSON format  
✅ Widget renderers implemented  
✅ Apps SDK-compatible structure  
✅ Ready for SDK integration  
⏳ Waiting for official SDK package or Developer Mode access  

## Notes

- The official `@openai/apps-sdk` npm package may not be public yet
- Apps SDK is in preview - features may change
- Developer Mode access may be limited to certain account types
- Your current structure is compatible with Apps SDK format

