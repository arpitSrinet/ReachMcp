# Initialize Session Tool

## Overview

The `initialize_session` tool is the **first tool that should be called** when a user starts a conversation. It automatically:
1. Creates a new session
2. Initializes an empty cart
3. Detects user intent from their prompt
4. Provides contextual guidance based on the detected intent

## Tool Definition

```javascript
{
  name: "initialize_session",
  description: "FIRST TOOL TO CALL: This is the initial routing tool that MUST be called first when a user starts a conversation. It takes the user's initial prompt, detects their intent, automatically creates a session, initializes the cart, and provides contextual guidance.",
  inputSchema: {
    type: "object",
    properties: {
      userPrompt: {
        type: "string",
        description: "The user's initial message or prompt"
      }
    },
    required: ["userPrompt"]
  }
}
```

## Behavior

### 1. Session & Cart Initialization
- **Automatically generates** a unique session ID
- **Initializes an empty cart** for the session (without calling cart/purchase tools)
- **Creates flow context** with initial state
- **Updates most recent session** for tracking

### 2. Intent Detection

The tool uses the `intentService` to detect user intent from their prompt:

#### Intent Types:
- **PLAN** - User is asking about plans
- **DEVICE** - User wants to browse devices
- **COVERAGE** - User wants to check coverage
- **Device Compatibility** - User wants to validate device (IMEI check)
- **OTHER** - General inquiry

### 3. Contextual Responses

Based on detected intent, the tool provides tailored guidance:

#### If Intent = PLANS
```
Response: Asks user how many lines they need
Suggestion: "Please tell me how many lines you need, then I'll show plans using get_plans tool"
```

#### If Intent = DEVICES
```
Response: Offers to show devices, notes that plans are required before checkout
Suggestion: "I'll use the get_devices tool to show available devices"
```

#### If Intent = COVERAGE
- **If ZIP code provided:** "I'll check coverage for [ZIP] using check_coverage tool"
- **If no ZIP code:** "Please provide your ZIP code (e.g., 'My zipcode is 90210')"

#### If Intent = Device Compatibility (IMEI)
- **If IMEI provided:** "I'll validate device with IMEI [number] using validate_device tool"
- **If no IMEI:** "Please provide your device's IMEI number (15 digits)"

#### If Intent = GENERAL/OTHER
```
Response: Welcome message with overview of services
Suggestion: General suggestions to explore plans, coverage, devices, etc.
```

## Example Usage

### Example 1: User asks about plans
```javascript
// Tool call
{
  name: "initialize_session",
  arguments: {
    userPrompt: "I want to see your mobile plans"
  }
}

// Response
{
  sessionId: "session_1234567890_abc123",
  intent: "plan",
  message: "Welcome! How many lines would you like to set up?",
  suggestedTool: "get_plans"
}
```

### Example 2: User asks about coverage
```javascript
// Tool call
{
  name: "initialize_session",
  arguments: {
    userPrompt: "My zipcode is 90210"
  }
}

// Response
{
  sessionId: "session_1234567890_abc123",
  intent: "coverage",
  message: "I'll check coverage for ZIP 90210",
  suggestedTool: "check_coverage",
  entities: { zipCode: "90210" }
}
```

### Example 3: User asks about device compatibility
```javascript
// Tool call
{
  name: "initialize_session",
  arguments: {
    userPrompt: "Is my device compatible? My IMEI is 123456789012345"
  }
}

// Response
{
  sessionId: "session_1234567890_abc123",
  intent: "device",
  message: "I'll validate device with IMEI 123456789012345",
  suggestedTool: "validate_device",
  entities: { imei: "123456789012345" }
}
```

### Example 4: General inquiry
```javascript
// Tool call
{
  name: "initialize_session",
  arguments: {
    userPrompt: "Hello, what services do you offer?"
  }
}

// Response
{
  sessionId: "session_1234567890_abc123",
  intent: "other",
  message: "Welcome! Here's what I can help you with: [overview]",
  suggestedTool: null
}
```

## Response Format

The tool returns:
```javascript
{
  content: [
    {
      type: "text",
      text: "[Contextual welcome message and guidance]"
    }
  ],
  _meta: {
    sessionId: "session_xxx",
    intent: "plan|device|coverage|other",
    suggestedTool: "get_plans|get_devices|check_coverage|validate_device|null"
  }
}
```

## Key Features

1. **Automatic Session Creation** - No need to call separate session creation tools
2. **Cart Initialization** - Empty cart is ready without calling cart tools
3. **Intent Detection** - Smart detection from natural language
4. **Entity Extraction** - Automatically extracts ZIP codes, IMEI numbers, etc.
5. **Contextual Guidance** - Provides next steps based on user intent
6. **No Authentication Required** - Fast response without API calls

## Integration with Other Tools

After `initialize_session` is called:
- **Session ID** is available in `_meta.sessionId`
- **Suggested tool** is provided in `_meta.suggestedTool`
- **Cart is initialized** and ready for items
- **Flow context** is created and ready for updates

## Notes

- This tool **does NOT require authentication** (skips auth for faster response)
- Cart is initialized as **empty** - no items added
- Session is **persisted** automatically
- Flow context is created with **initial state**
- Most recent session is **tracked** for subsequent calls

## Usage in ChatGPT

When ChatGPT receives a user's first message:
1. **Call `initialize_session`** with the user's prompt
2. **Read the response** to understand intent and get session ID
3. **Use suggested tool** if provided, or follow the guidance
4. **Pass sessionId** to subsequent tool calls for continuity

Example flow:
```
User: "I want to see plans"
→ initialize_session(userPrompt: "I want to see plans")
→ Response: "How many lines? Session: session_xxx"
→ get_plans(sessionId: "session_xxx")
```

