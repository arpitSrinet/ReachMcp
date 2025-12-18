# Testing with Apps SDK UI

## ✅ Status: Apps SDK UI Installed

The `@openai/apps-sdk-ui` package (v0.2.1) is now installed and ready to use!

## What's Available

### 1. Apps SDK UI Package
- **Package**: `@openai/apps-sdk-ui@0.2.1`
- **Purpose**: Design system for building apps for ChatGPT
- **Includes**: React components, hooks, theme, CSS

### 2. Your Widget System
- ✅ MCP server returns JSON format
- ✅ Widget renderers create Apps SDK-compatible structures
- ✅ All tools tested and working

## Testing Your Widgets

### Run Widget Tests

```bash
cd app
npm run test:widgets
```

This will test:
- ✅ Get Plans (renders as widgets)
- ✅ Get Offers (renders as widgets)
- ✅ Get Cart (renders as widget)
- ✅ Add to Cart (works with widgets)

### Test Individual Tools

```bash
# Test plans
node -e "import('./app.js').then(m => m.app.processToolCall('get_plans', {}).then(console.log))"

# Test offers
node -e "import('./app.js').then(m => m.app.processToolCall('get_offers', {}).then(console.log))"

# Test cart
node -e "import('./app.js').then(m => m.app.processToolCall('get_cart', {}).then(console.log))"
```

## Using Apps SDK UI Components

The package provides React components for building UIs. To use them:

### 1. Import Components

```javascript
import '@openai/apps-sdk-ui/css';
import { Button, Card } from '@openai/apps-sdk-ui/components/button';
```

### 2. Use in React App

```jsx
import { Card } from '@openai/apps-sdk-ui/components/card';

function PlanCard({ plan }) {
  return (
    <Card>
      <Card.Header>{plan.title}</Card.Header>
      <Card.Body>
        <p>Price: {plan.price}</p>
        <Button onClick={() => addToCart(plan.id)}>
          Select Plan
        </Button>
      </Card.Body>
    </Card>
  );
}
```

## Next Steps

### Option 1: Test in ChatGPT Developer Mode

1. **Enable Developer Mode**:
   - Go to ChatGPT settings
   - Enable Developer Mode (if available for your account)
   - Create a new app

2. **Connect Your MCP Server**:
   - Use your MCP server endpoint
   - Test widget rendering in ChatGPT

3. **Deploy Your App**:
   - Follow OpenAI's deployment guide
   - Test widgets in real ChatGPT environment

### Option 2: Build React Test UI

Create a React app to test widgets visually:

```bash
npx create-react-app test-ui
cd test-ui
npm install @openai/apps-sdk-ui
# Use your widget renderers
```

### Option 3: Use Current Structure

Your current structure is ready:
- ✅ Widgets are formatted correctly
- ✅ MCP integration works
- ✅ All tools tested
- ⏳ Ready for ChatGPT integration

## Available Components

Check the Apps SDK UI package for available components:

```bash
cd app
ls node_modules/@openai/apps-sdk-ui/dist/es/components/
```

Common components:
- Buttons
- Cards
- Forms
- Lists
- And more...

## Documentation

- **Apps SDK UI**: https://github.com/openai/apps-sdk-ui
- **Apps SDK Docs**: https://developers.openai.com/apps-sdk/
- **Quickstart**: https://developers.openai.com/apps-sdk/quickstart

## Current Test Results

✅ **All widgets working correctly:**
- Plans: 4 plans rendered as widgets
- Offers: 3 offers rendered as widgets
- Cart: Cart widget working
- Add to Cart: Successfully adds items

Your app is ready for Apps SDK integration! 🎉

