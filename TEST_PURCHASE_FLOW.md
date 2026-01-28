# How to Test the Purchase Flow (After Final Checkout)

This guide covers **three ways** to test the purchase flow: **Chat UI**, **automated script**, and **manual MCP calls**. Use whichever fits your workflow.

---

## Prerequisites

- **Server running** (HTTP or HTTPS)
- **Reach Mobile API** reachable (credentials in env)
- **Plan-only cart**: plans + eSIM only, **no devices** (`purchase_plans` is plan-only)

---

## 1. Chat UI (Recommended for end-to-end)

Use **ChatGPT Desktop** (or another MCP client) connected to your MCP server. This is the most reliable way to run the full purchase flow; the automated script can hit server-side MCP validation issues with some tools.

### Start the server

```bash
# HTTPS (e.g. for ChatGPT)
npm run start:https

# Or with dev UI
npm run dev:ui
```

### Run the flow in chat

1. **Start session**
   - e.g. *"I need 1 line"* or *"Start"*  
   - Bot calls `start_session` (and possibly `get_plans`).

2. **Add a plan**
   - *"Add Unlimited Plus 50GB"* or *"Add plan ID: M0028122398KED2591D0295B09 to line 1"*  
   - Bot calls `get_plans` (if needed) and `add_to_cart` with `itemType: "plan"`, `itemId: "<planId>"`.

3. **Collect shipping**
   - *"I need to enter my shipping address"*  
   - Provide when asked (or use the collect tool directly):
     - First name, last name, street, city, state, ZIP, country, phone, email.

4. **Checkout**
   - *"Review my cart and proceed to checkout"* or *"Get checkout data and purchase"*  
   - Bot runs `review_cart` → `collect_shipping_address` (if needed) → `get_checkout_data` → **`purchase_plans`**.

5. **Check result**
   - Success: response includes **Payment Link:** `<URL>` and `structuredContent.purchaseResult.paymentUrl`.
   - Pending / timeout: say *"retry payment"* or *"check payment status"* → `check_purchase_status` returns the payment URL when ready.

### Cart widget

- Open **Cart** template (e.g. `/dev/templates/cart` with dev server).
- **Proceed to Checkout** sends *"Review my cart and proceed to checkout"* into the chat.
- Payment link appears in the **chat response**, not in the cart UI.

---

## 2. Automated script (MCP `tools/call`)

A Node script runs the full flow by calling MCP tools over HTTP(S).

### Start the server

```bash
npm run start:https   # script uses https://localhost:3000/mcp
```

### Run the test

```bash
node test-purchase-flow.js
```

The script:

1. `start_session` with `lineCount: 1`
2. `get_plans` and uses the first plan’s `id` (or fallback from `PLAN_ID` / `carts.json`)
3. `add_to_cart` with `itemType: "plan"`, `itemId`, `lineNumber: 1`
4. `review_cart` (ensures cart is “ready” before shipping)
5. `collect_shipping_address` with test address
6. `purchase_plans` (with optional `skipPolling: true`)
7. Optionally `check_purchase_status` if no payment URL yet

It prints each step and the final result (including `paymentUrl` when present).

### Customise

- **Plan ID**: Set env `PLAN_ID=<id>` or the script uses the first plan from `get_plans`, then a fallback from `carts.json`.
- **Skip polling**: Set `SKIP_POLLING=1`; the script uses `purchase_plans` with `skipPolling: true`, then `check_purchase_status`.
- **Base URL / port**: Edit `BASE` (hostname, port) in the script if your server runs elsewhere.

### Script limitations

- The script parses **SSE** responses from the MCP HTTP transport. Plain JSON is also supported.
- You may see **"How many lines?"** from `add_to_cart` if the flow context doesn’t have `lineCount`; the plan is not added and later steps will fail.
- **`Invalid tools/call result`** can occur for some tools (e.g. `review_cart`, `collect_shipping_address`, `update_line_count`). Prefer the **Chat UI** for the full purchase flow when that happens.

---

## 3. Manual MCP `tools/call` (curl)

Use this to run individual tools or debug.

### Base request

```bash
curl -s -k -X POST "https://localhost:3000/mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "<TOOL_NAME>",
      "arguments": { ... }
    }
  }'
```

### Example sequence

**1. Start session**

```bash
curl -s -k -X POST "https://localhost:3000/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"start_session","arguments":{"lineCount":1}}}'
```

Save the **Session ID** from the response text.

**2. Add plan** (use a real `itemId` from `get_plans`)

```bash
curl -s -k -X POST "https://localhost:3000/mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":2,
    "method":"tools/call",
    "params":{
      "name":"add_to_cart",
      "arguments":{
        "sessionId":"<SESSION_ID>",
        "itemType":"plan",
        "itemId":"M0028122398KED2591D0295B09",
        "lineNumber":1
      }
    }
  }'
```

**3. Collect shipping**

```bash
curl -s -k -X POST "https://localhost:3000/mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":3,
    "method":"tools/call",
    "params":{
      "name":"collect_shipping_address",
      "arguments":{
        "sessionId":"<SESSION_ID>",
        "firstName":"Jane",
        "lastName":"Doe",
        "street":"123 Main St",
        "city":"New York",
        "state":"NY",
        "zipCode":"10001",
        "country":"US",
        "phone":"5551234567",
        "email":"jane@example.com"
      }
    }
  }'
```

**4. Purchase**

```bash
curl -s -k -X POST "https://localhost:3000/mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":4,
    "method":"tools/call",
    "params":{
      "name":"purchase_plans",
      "arguments":{"sessionId":"<SESSION_ID>"}
    }
  }'
```

**5. Check status** (if you have `transactionId` but no payment URL yet)

```bash
curl -s -k -X POST "https://localhost:3000/mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":5,
    "method":"tools/call",
    "params":{
      "name":"check_purchase_status",
      "arguments":{"sessionId":"<SESSION_ID>"}
    }
  }'
```

---

## What to verify

| Check | Where |
|-------|--------|
| Payment URL in response | `content[0].text` contains `**Payment Link:**` + URL |
| Structured result | `structuredContent.purchaseResult.paymentUrl` |
| Transaction ID | `purchaseResult.transactionId` or response text |
| Success message | `"Purchase Initiated Successfully!"` or `"Purchase already completed"` |

---

## Common failures

| Symptom | Likely cause | What to do |
|--------|----------------|------------|
| Cart empty / missing plans | No plan added or wrong session | Add plan with `add_to_cart`, use same `sessionId` |
| “Plan-only purchase cannot include devices” | Cart has devices | Use plan-only cart (no devices) |
| “Shipping address not collected” | Shipping not collected for session | Call `collect_shipping_address` before `purchase_plans` |
| No payment URL, “Payment Pending” | Status API not yet returning URL | Say *“check payment status”* or call `check_purchase_status` |
| Polling timeout | Payment URL delayed | Use `check_purchase_status` later or `skipPolling: true` + status check |
| `Invalid tools/call result` / `expected object, received undefined` | Server-side MCP validation | Prefer **Chat UI** for full flow; check server logs. Some tools may return a shape the MCP layer rejects. |

---

## Logs and debug

- **Server logs**: Quote, purchase, and status API calls; polling attempts; where `paymentUrl` was found.
- **Useful log lines**:
  - `"Purchase flow: Completed successfully"`
  - `"Purchase status API: Payment URL found"`
  - `"Payment URL not found in expected locations"` → inspect status API response shape.

See **QUICK_TEST_GUIDE.md** and **PURCHASE_PLANS_TEST_PLAN.md** for more validation steps and edge cases.
