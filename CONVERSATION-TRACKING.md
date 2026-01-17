# Conversation Tracking & Redirect System

## Overview

The conversation tracking system automatically detects when users give random or unrelated answers and guides them back to the correct question. This ensures the purchase flow stays on track and users complete required steps.

## How It Works

### 1. Question Tracking

The system tracks the current question being asked using the `currentQuestion` field in flow context:

```javascript
{
  type: 'line_count',        // Question type (QUESTION_TYPES)
  text: 'How many lines?',   // Human-readable question
  expectedEntities: {        // What to expect in response
    lineCount: true
  },
  askedAt: 1234567890        // Timestamp
}
```

### 2. Off-Track Detection

When a user provides input, the system checks if their response:
- Answers the current question (on-track)
- Is unrelated to the current question (off-track)

Detection uses:
- Intent detection
- Entity extraction
- Pattern matching for expected responses

### 3. Automatic Redirect

If a user goes off-track, the system:
1. Detects the off-track response
2. Generates a friendly redirect message
3. Reminds the user of the current question
4. Provides examples of valid responses

## Question Types

The system tracks these question types:

| Type | Description | Expected Response |
|------|-------------|-------------------|
| `LINE_COUNT` | "How many lines do you need?" | Number of lines (e.g., "2 lines") |
| `ZIP_CODE` | "What's your ZIP code?" | 5-digit ZIP code |
| `IMEI` | "What's your device IMEI?" | 15-digit IMEI number |
| `PLAN_SELECTION` | "Which plan would you like?" | Plan selection or plan-related intent |
| `DEVICE_SELECTION` | "Which device would you like?" | Device selection or device-related intent |
| `SIM_TYPE` | "eSIM or Physical SIM?" | SIM type selection |
| `PROTECTION` | "Would you like protection?" | Yes/no or protection-related response |
| `CONFIRMATION` | "Are you ready to checkout?" | Yes/no confirmation |

## Usage Examples

### Example 1: User Goes Off-Track on Line Count

**Scenario:**
- System asks: "How many lines do you need?"
- User responds: "What's the weather today?"

**System Response:**
```
I appreciate your message, but I need to focus on completing your purchase setup.

**I'm still waiting for:** How many lines do you need?

Please tell me a number (e.g., "2 lines", "I need 3 lines", or "family plan for 4").

**If you have other questions, I can help with those after we complete this step.**
```

### Example 2: User Goes Off-Track on ZIP Code

**Scenario:**
- System asks: "What's your ZIP code?"
- User responds: "I want to see devices"

**System Response:**
```
I appreciate your message, but I need to focus on completing your purchase setup.

**I'm still waiting for:** Your ZIP code to check coverage.

Please provide your 5-digit ZIP code (e.g., "90210" or "My zipcode is 12345").

**If you have other questions, I can help with those after we complete this step.**
```

### Example 3: User Answers Correctly

**Scenario:**
- System asks: "How many lines do you need?"
- User responds: "I need 2 lines"

**System Response:**
- Normal flow continues
- Question is cleared
- Next step is shown

## Implementation

### Setting a Question

```javascript
import { setCurrentQuestion, QUESTION_TYPES } from './services/conversationTrackingService.js';

// When asking for line count
setCurrentQuestion(sessionId, QUESTION_TYPES.LINE_COUNT, 
  "How many lines would you like to set up?", 
  { lineCount: true }
);
```

### Checking and Redirecting

```javascript
import { checkAndRedirect } from './services/conversationTrackingService.js';

// Before processing user input
const redirectCheck = checkAndRedirect(userMessage, sessionId);

if (redirectCheck.shouldRedirect) {
  return {
    content: [{ type: "text", text: redirectCheck.redirectMessage }]
  };
}
```

### Clearing a Question

```javascript
import { clearCurrentQuestion } from './services/conversationTrackingService.js';

// When user answers correctly
clearCurrentQuestion(sessionId);
```

## Integration Points

The conversation tracking is integrated into:

1. **`start_session`** - Tracks questions about line count, ZIP code, IMEI
2. **`get_plans`** - Can track plan selection questions
3. **`get_sim_types`** - Tracks SIM type selection
4. **`check_coverage`** - Tracks ZIP code questions
5. **`validate_device`** - Tracks IMEI questions

## Benefits

1. **Keeps Flow On Track** - Users can't skip required steps
2. **Friendly Redirects** - Polite messages that don't frustrate users
3. **Context Aware** - Remembers what question was asked
4. **Flexible** - Handles various response formats
5. **Non-Intrusive** - Only redirects when truly off-track

## Configuration

The system automatically:
- Detects off-track responses using intent and entity matching
- Generates contextual redirect messages
- Preserves user intent for later use
- Logs redirect events for debugging

## Future Enhancements

Potential improvements:
- Learn from user patterns
- Allow temporary topic switches with "hold that thought"
- More sophisticated intent matching
- Multi-turn question handling
- Context-aware question prioritization

