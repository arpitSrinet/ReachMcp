# Global Context Flags (System Memory)

## Overview

The system now tracks global boolean flags that aggregate the state across all lines. These flags are automatically computed and updated whenever the flow context changes.

## Implemented Flags

All flags are tracked at the **context level** (global across all lines):

| Flag | Type | Description | Implementation |
|------|------|-------------|----------------|
| `planSelected` | `boolean` | `true` if ANY line has a plan selected | ✅ Implemented |
| `deviceSelected` | `boolean` | `true` if ANY line has a device selected | ✅ Implemented |
| `protectionSelected` | `boolean` | `true` if ANY line has protection selected | ✅ Implemented |
| `simSelected` | `boolean` | `true` if ANY line has SIM type selected | ✅ Implemented |
| `linesConfigured` | `boolean` | `true` if `lineCount` is set and > 0 | ✅ Implemented |
| `coverageChecked` | `boolean` | `true` if coverage has been checked | ✅ Implemented |

## Implementation Details

### Location
- **File**: `services/flowContextService.js`
- **Context Structure**: Flags are stored in the flow context object at the root level

### Auto-Update Mechanism

The flags are automatically computed and updated:

1. **On Context Creation**: Flags are initialized to `false`
2. **On Context Retrieval**: Flags are recomputed to ensure they're current
3. **On Context Update**: Flags are recomputed when `lines` or `lineCount` changes

### Flag Computation Logic

```javascript
planSelected = context.lines.some(line => line && line.planSelected)
deviceSelected = context.lines.some(line => line && line.deviceSelected)
protectionSelected = context.lines.some(line => line && line.protectionSelected)
simSelected = context.lines.some(line => line && line.simType)
linesConfigured = context.lineCount !== null && context.lineCount > 0
coverageChecked = context.coverageChecked (directly set)
```

## Usage

### Get Global Flags

```javascript
import { getGlobalContextFlags } from './services/flowContextService.js';

const flags = getGlobalContextFlags(sessionId);
console.log(flags);
// {
//   planSelected: true,
//   deviceSelected: false,
//   protectionSelected: false,
//   simSelected: true,
//   linesConfigured: true,
//   coverageChecked: true
// }
```

### Access from Context

```javascript
import { getFlowContext } from './services/flowContextService.js';

const context = getFlowContext(sessionId);
console.log(context.planSelected);      // true/false
console.log(context.deviceSelected);     // true/false
console.log(context.protectionSelected); // true/false
console.log(context.simSelected);        // true/false
console.log(context.linesConfigured);    // true/false
console.log(context.coverageChecked);    // true/false
```

## Example Context Structure

```javascript
{
  sessionId: "session_123",
  flowStage: "configuring",
  lineCount: 2,
  lines: [
    {
      lineNumber: 1,
      planSelected: true,
      deviceSelected: true,
      protectionSelected: false,
      simType: "ESIM"
    },
    {
      lineNumber: 2,
      planSelected: true,
      deviceSelected: false,
      protectionSelected: false,
      simType: null
    }
  ],
  
  // Global flags (auto-computed)
  planSelected: true,        // Line 1 and Line 2 both have plans
  deviceSelected: true,      // Line 1 has device
  protectionSelected: false, // No lines have protection
  simSelected: true,         // Line 1 has SIM type
  linesConfigured: true,     // lineCount = 2
  coverageChecked: true      // Coverage was checked
}
```

## When Flags Update

Flags are automatically updated when:

1. **Line count is set**: `updateFlowContext(sessionId, { lineCount: 2 })`
   - `linesConfigured` → `true`

2. **Plan is added**: `updateFlowContext(sessionId, { lines: [...] })`
   - `planSelected` → `true` (if any line has plan)

3. **Device is added**: `updateFlowContext(sessionId, { lines: [...] })`
   - `deviceSelected` → `true` (if any line has device)

4. **Protection is added**: `updateFlowContext(sessionId, { lines: [...] })`
   - `protectionSelected` → `true` (if any line has protection)

5. **SIM type is selected**: `updateFlowContext(sessionId, { lines: [...] })`
   - `simSelected` → `true` (if any line has simType)

6. **Coverage is checked**: `updateFlowContext(sessionId, { coverageChecked: true })`
   - `coverageChecked` → `true`

## Benefits

1. **Quick State Checks**: No need to iterate through lines array
2. **System Memory**: Flags persist across conversation
3. **Auto-Sync**: Always up-to-date with line state
4. **Easy Access**: Available at context root level
5. **Backward Compatible**: Existing code continues to work

## Migration Notes

- Existing contexts will automatically get flags computed on first access
- Flags are computed from existing `lines` array structure
- No breaking changes to existing APIs

