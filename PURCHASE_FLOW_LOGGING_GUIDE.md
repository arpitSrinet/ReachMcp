# Purchase Flow Logging Guide

## Overview

Comprehensive logging has been added throughout the entire purchase flow - from billing details collection to payment URL retrieval. All logs use clear step markers (══════) and include timestamps, session IDs, and full data structures.

---

## Log Flow Steps

### STEP 1: COLLECTING SHIPPING ADDRESS
**Location:** `server.js` - `collect_shipping_address` tool

**What to look for:**
- ✅ Shipping address received from user
- ✅ Shipping address saved to flow context successfully

**Key fields logged:**
- firstName, lastName, street, city, state, zipCode, country, phone, email
- sessionId
- checkoutDataCollected flag

---

### STEP 2: BUILDING CHECKOUT DATA
**Location:** `server.js` - `get_checkout_data` tool

**What to look for:**
- ✅ Checkout data built successfully
- Cart lines with plan IDs, SIM types
- Shipping and billing addresses
- Order totals

**Key fields logged:**
- Cart line count and details
- Plan IDs per line
- SIM types
- Totals (monthly, one-time, etc.)

---

### STEP 3: PURCHASE PLANS TOOL CALLED
**Location:** `server.js` - `purchase_plans` tool entry

**What to look for:**
- ✅ Purchase plans tool invoked
- Validation checks (cart, plans, shipping address)

**Key fields logged:**
- hasContext, hasCart, cartLines
- hasShippingAddress, checkoutDataCollected

---

### STEP 4: INITIATING PURCHASE FLOW
**Location:** `server.js` - Before calling `purchasePlansFlow`

**What to look for:**
- ✅ Checkout data prepared for purchase flow
- Purchase state updated to QUOTING

**Key fields logged:**
- Complete checkout data structure
- Cart lines with plan details
- Shipping/billing addresses

---

### STEP 5: CALLING QUOTE API
**Location:** `services/purchaseService.js` - `purchaseQuote()`

**What to look for:**
- ✅ Purchase quote API call initiated
- ✅ Tenant configuration loaded
- ✅ Checkout data transformed successfully
- ✅ Quote API request body (FULL STRUCTURE)
- ✅ Quote API response received
- ✅ Purchase quote API call successful

**Key fields logged:**
- Endpoint URL
- Request body (accountInfo, lines, meta, redirectUrl)
- Response data (oneTimeCharge, estimatedMonthlyCost, totalTax, total)
- clientAccountId
- API call duration

**Error indicators:**
- ❌ Quote API returned empty response
- ❌ Purchase quote API returned non-SUCCESS status

---

### STEP 6: CALLING PURCHASE PRODUCT API
**Location:** `services/purchaseService.js` - `purchaseProduct()`

**What to look for:**
- ✅ Purchase product API call initiated
- ✅ Collection amount extracted from quote
- ✅ Checkout data transformed for purchase
- ✅ Purchase Product API request body (FULL STRUCTURE)
- ✅ Purchase Product API response received
- ✅ Purchase product API call successful

**Key fields logged:**
- Endpoint URL
- clientAccountId (reused from quote)
- collectionAmount (from quote response)
- Request body structure
- Response data (transactionId, clientAccountId)
- API call duration

**Error indicators:**
- ❌ Quote response missing oneTimeCharge data
- ❌ Purchase API returned empty response
- ❌ Purchase product API returned non-SUCCESS status
- ❌ Purchase response missing transactionId

---

### STEP 7: CALLING STATUS API (POLLING)
**Location:** `services/purchaseService.js` - `purchaseStatus()`

**What to look for:**
- ✅ Purchase status API call initiated
- ✅ Status API endpoint configured
- ✅ Status API response received
- ✅ Status API response structure
- ✅ Payment URL extraction attempts
- ✅ Payment URL found/not found

**Key fields logged:**
- Endpoint URL with transactionId
- Response structure (paymentStatus, status, link, etc.)
- Link type (0 = PENDING, 1 = SUCCESS)
- Payment URL extraction attempts (multiple fallback locations)
- Full payment URL (when found)
- API call duration

**Payment URL extraction locations checked:**
1. `response.data.link.url` (when `link.type === 1`)
2. `response.data.link.url` (when `link.type === 0` - pending)
3. `response.data.paymentUrl`
4. `response.data.url`
5. `response.link.url`
6. `response.paymentUrl`

**Error indicators:**
- ❌ Transaction ID is required
- ❌ Status API returned empty response
- ❌ Purchase status API returned non-SUCCESS status
- ❌ Payment URL not found in expected locations

---

### STEP 8: PURCHASE FLOW COMPLETED - PROCESSING RESULT
**Location:** `server.js` - After `purchasePlansFlow()` returns

**What to look for:**
- ✅ Purchase flow result received
- Final result summary

**Key fields logged:**
- success flag
- state (COMPLETED, FAILED, POLLING_TIMEOUT, etc.)
- transactionId
- paymentStatus
- hasPaymentUrl
- fullPaymentUrl
- pollAttempts

---

## Polling Loop Logs

**Location:** `services/purchaseService.js` - `purchasePlansFlow()` polling section

**What to look for:**
- POLL ATTEMPT X/Y (for each poll)
- Status poll result (paymentStatus, status, hasPaymentUrl)
- Waiting messages between polls
- Terminal state detection (SUCCESS, PENDING with URL, FAILED)

**Terminal states:**
- ✅ PURCHASE FLOW COMPLETED SUCCESSFULLY
- ✅ PURCHASE FLOW COMPLETED (PENDING WITH URL)
- ❌ PURCHASE FLOW FAILED
- ⚠️ PURCHASE FLOW: MAX POLL ATTEMPTS REACHED

---

## Error Logging

All errors include:
- Error message
- Error type
- Status code (if API error)
- Response body (truncated)
- Stack trace (for flow errors)
- Duration/timing information

---

## Log Format

All logs use this format:
```
═══════════════════════════════════════════════════════════
STEP X: DESCRIPTION
═══════════════════════════════════════════════════════════
```

Success indicators: ✅
Error indicators: ❌
Warning indicators: ⚠️

---

## Key Things to Check When Debugging

1. **Shipping Address Collection**
   - Is the address being saved correctly?
   - Are all required fields present?

2. **Checkout Data Building**
   - Are cart lines present?
   - Do all lines have plans?
   - Are shipping/billing addresses populated?

3. **Quote API**
   - Is the request body correct?
   - Does the response have `oneTimeCharge`?
   - Is `clientAccountId` generated?

4. **Purchase API**
   - Is `clientAccountId` reused from quote?
   - Is `collectionAmount` set from quote?
   - Does the response have `transactionId`?

5. **Status API**
   - What is `link.type`? (0 = pending, 1 = success)
   - Is `link.url` present?
   - What is `paymentStatus`? (PENDING, SUCCESS, APPROVED, FAILED)
   - What is `status`? (DONE, PENDING, FAILED)

6. **Payment URL Extraction**
   - Which location was the URL found in?
   - If not found, what does the response structure look like?
   - Is `link.type === 1` when URL should be available?

---

## Example Log Sequence (Success)

```
STEP 1: COLLECTING SHIPPING ADDRESS
✅ Shipping address received from user
✅ Shipping address saved to flow context successfully

STEP 2: BUILDING CHECKOUT DATA
✅ Checkout data built successfully

STEP 3: PURCHASE PLANS TOOL CALLED
✅ Purchase plans tool invoked

STEP 4: INITIATING PURCHASE FLOW
✅ Checkout data prepared for purchase flow

STEP 5: CALLING QUOTE API
✅ Purchase quote API call initiated
✅ Checkout data transformed successfully
✅ Quote API response received
✅ Purchase quote API call successful

STEP 6: CALLING PURCHASE PRODUCT API
✅ Purchase product API call initiated
✅ Collection amount extracted from quote
✅ Purchase Product API response received
✅ Purchase product API call successful
Transaction ID: abc-123-def

STEP 7: CALLING STATUS API (POLLING)
POLL ATTEMPT 1/20
✅ Status API response received
✅ Payment URL found at: response.data.link.url (type=1, SUCCESS)
✅ Purchase status API: Payment URL found successfully
Payment URL: https://payment.example.com/...

STEP 8: PURCHASE FLOW COMPLETED - PROCESSING RESULT
✅ Purchase flow result received
```

---

## Troubleshooting Tips

1. **Payment URL not found:**
   - Check `link.type` - should be `1` for success
   - Check `paymentStatus` - should be `PENDING` or `SUCCESS`
   - Check full response structure in logs
   - Verify API response format matches expectations

2. **Quote API fails:**
   - Check request body structure
   - Verify all required fields are present
   - Check API endpoint URL
   - Verify authentication/authorization

3. **Purchase API fails:**
   - Verify `clientAccountId` is reused from quote
   - Check `collectionAmount` is set correctly
   - Verify transaction ID is returned

4. **Status API keeps polling:**
   - Check `paymentStatus` value
   - Check `link.type` value
   - Verify payment URL extraction logic
   - Check if max poll attempts reached

---

## Log Levels

- `logger.info()` - Normal flow steps, success indicators
- `logger.debug()` - Detailed data structures, intermediate steps
- `logger.warn()` - Warnings, non-critical issues
- `logger.error()` - Errors, failures

All critical steps use `logger.info()` for visibility.
