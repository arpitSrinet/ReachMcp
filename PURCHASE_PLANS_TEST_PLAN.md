# Purchase Plans Tool - Comprehensive Test Plan

## Overview
This document outlines a comprehensive test plan for the `purchase_plans` tool to ensure it correctly generates and returns payment links in the response.

## Current Issue
The `purchase_plans` tool should generate a payment link in the end response, but it's not working correctly.

## Tool Flow
1. **Validation**: Validates cart, plans, shipping address
2. **Quote**: Calls purchase quote API
3. **Purchase**: Calls purchase product API
4. **Polling**: Polls status API until payment URL is available
5. **Response**: Returns payment URL in response

---

## Test Scenarios

### Test 1: Happy Path - Successful Purchase with Payment URL
**Objective**: Verify that a complete purchase flow returns a payment URL

**Prerequisites**:
- Cart has at least one line with a plan
- Shipping address is collected
- No devices in cart (plan-only purchase)
- API endpoints are accessible

**Steps**:
1. Add plan to cart
2. Collect shipping address
3. Call `purchase_plans` tool
4. Wait for response

**Expected Result**:
- Response contains `paymentUrl` in both `content[0].text` and `structuredContent.purchaseResult.paymentUrl`
- Payment URL is a valid URL (starts with http:// or https://)
- Response includes transaction ID, customer ID, and support URL
- Response format:
  ```json
  {
    "content": [{
      "type": "text",
      "text": "✅ **Purchase Initiated Successfully!**\n\n...\n\n**Payment Link:**\n<URL>\n\n..."
    }],
    "structuredContent": {
      "purchaseResult": {
        "success": true,
        "transactionId": "...",
        "paymentUrl": "<URL>",
        "paymentUrlExpiry": "...",
        "customerId": "...",
        "supportUrl": "...",
        "state": "COMPLETED"
      }
    }
  }
  ```

**Validation Points**:
- [ ] Payment URL is present in text response
- [ ] Payment URL is present in structuredContent
- [ ] Payment URL is a valid URL format
- [ ] Transaction ID is present
- [ ] Response indicates success

---

### Test 2: Payment URL Not Available Initially (Polling)
**Objective**: Verify that polling continues until payment URL is available

**Prerequisites**:
- Same as Test 1
- API returns PENDING status initially, then provides URL after a few polls

**Steps**:
1. Add plan to cart
2. Collect shipping address
3. Call `purchase_plans` tool
4. Monitor polling behavior

**Expected Result**:
- Tool polls status API multiple times
- Eventually returns with payment URL
- Logs show polling attempts and when URL becomes available

**Validation Points**:
- [ ] Polling occurs (check logs)
- [ ] Payment URL appears after polling
- [ ] Response includes payment URL when available
- [ ] Polling stops when URL is found or max attempts reached

---

### Test 3: Payment URL in Different Response Structures
**Objective**: Verify that payment URL is extracted from various possible API response structures

**Test Cases**:

#### 3a. Standard Structure: `response.data.link.url`
```json
{
  "data": {
    "link": {
      "url": "https://payment.example.com/...",
      "expireDate": "2026-01-29T00:00:00Z"
    }
  }
}
```

#### 3b. Alternative Structure: `response.data.paymentUrl`
```json
{
  "data": {
    "paymentUrl": "https://payment.example.com/...",
    "paymentUrlExpiry": "2026-01-29T00:00:00Z"
  }
}
```

#### 3c. Alternative Structure: `response.data.url`
```json
{
  "data": {
    "url": "https://payment.example.com/...",
    "expireDate": "2026-01-29T00:00:00Z"
  }
}
```

#### 3d. Top-level Structure: `response.link.url`
```json
{
  "link": {
    "url": "https://payment.example.com/...",
    "expireDate": "2026-01-29T00:00:00Z"
  }
}
```

**Validation Points**:
- [ ] Payment URL extracted from all tested structures
- [ ] Logs show which structure was used
- [ ] Fallback logic works correctly

---

### Test 4: Polling Timeout Scenario
**Objective**: Verify behavior when payment URL is not available after max polling attempts

**Prerequisites**:
- API returns PENDING status but never provides payment URL
- Max poll attempts (20) are reached

**Steps**:
1. Add plan to cart
2. Collect shipping address
3. Call `purchase_plans` tool
4. Wait for polling timeout

**Expected Result**:
- Response indicates purchase was initiated but payment link is pending
- Transaction ID is present
- Response suggests using `check_purchase_status` tool
- Response format:
  ```json
  {
    "content": [{
      "type": "text",
      "text": "⏳ **Purchase Initiated - Payment Link Pending**\n\n...\n\n**Next Steps:**\n• Say \"retry payment\" or \"check payment status\" to get the payment link\n..."
    }]
  }
  ```

**Validation Points**:
- [ ] Response indicates pending status
- [ ] Transaction ID is present
- [ ] User is directed to check status later
- [ ] No error is thrown

---

### Test 5: Skip Polling Option
**Objective**: Verify that `skipPolling: true` option works correctly

**Prerequisites**:
- Same as Test 1

**Steps**:
1. Add plan to cart
2. Collect shipping address
3. Call `purchase_plans` tool with `skipPolling: true`
4. Check response

**Expected Result**:
- Purchase is initiated (quote + purchase APIs called)
- Response returns immediately without polling
- Payment URL is null (expected when skipping polling)
- Response suggests using `check_purchase_status` tool

**Validation Points**:
- [ ] No polling occurs
- [ ] Purchase is initiated successfully
- [ ] Response indicates status can be checked later

---

### Test 6: Error Scenarios

#### 6a. Missing Cart
**Expected**: Error message indicating cart is empty

#### 6b. Missing Plans
**Expected**: Error message indicating plans are missing

#### 6c. Devices in Cart
**Expected**: Error message indicating plan-only purchase cannot include devices

#### 6d. Missing Shipping Address
**Expected**: Error message indicating shipping address must be collected first

#### 6e. API Errors
**Expected**: Appropriate error messages for:
- Quote API failure
- Purchase API failure
- Status API failure (404, 500, etc.)

**Validation Points**:
- [ ] Appropriate error messages for each scenario
- [ ] Error handling doesn't crash the tool
- [ ] User receives actionable error messages

---

### Test 7: Already Completed Purchase
**Objective**: Verify that calling `purchase_plans` again after successful purchase returns existing payment URL

**Prerequisites**:
- Purchase was already completed successfully
- Payment URL exists in purchase state

**Steps**:
1. Complete a purchase (from Test 1)
2. Call `purchase_plans` tool again
3. Check response

**Expected Result**:
- Response indicates purchase already completed
- Existing payment URL is returned
- No new purchase is initiated

**Validation Points**:
- [ ] Existing payment URL is returned
- [ ] No duplicate purchase is created
- [ ] Response indicates purchase is already completed

---

### Test 8: Check Purchase Status Tool
**Objective**: Verify that `check_purchase_status` tool can retrieve payment URL after purchase

**Prerequisites**:
- Purchase was initiated (may or may not have payment URL yet)

**Steps**:
1. Initiate purchase (may not have URL yet)
2. Call `check_purchase_status` tool
3. Verify payment URL retrieval

**Expected Result**:
- If payment URL is available, it's returned
- If not available, appropriate message is shown
- Status information is accurate

**Validation Points**:
- [ ] Payment URL is retrieved when available
- [ ] Status information is correct
- [ ] Tool works independently of `purchase_plans`

---

## Debugging Checklist

When payment URL is not appearing, check:

1. **API Response Structure**
   - [ ] Check logs for actual API response structure
   - [ ] Verify response.data structure matches expectations
   - [ ] Check if payment URL is in a different location

2. **Polling Behavior**
   - [ ] Verify polling is occurring (check logs)
   - [ ] Check if polling stops too early
   - [ ] Verify max poll attempts setting (default: 20)
   - [ ] Check poll interval (default: 3000ms)

3. **Payment Status**
   - [ ] Check if paymentStatus is 'PENDING' when URL should be available
   - [ ] Verify status API is returning correct data
   - [ ] Check if payment URL generation is delayed on backend

4. **Code Paths**
   - [ ] Verify payment URL extraction logic (multiple fallback paths)
   - [ ] Check if response is being properly parsed
   - [ ] Verify structuredContent is being populated correctly

5. **Logs**
   - [ ] Check for "Payment URL not found" warnings
   - [ ] Review "Status poll result" debug logs
   - [ ] Check for any API errors in logs

---

## Test Execution Steps

### Manual Testing

1. **Start the server**
   ```bash
   node server.js
   ```

2. **Set up test environment**
   - Ensure API endpoints are accessible
   - Have valid test data ready (plans, addresses)

3. **Run each test scenario**
   - Use MCP client or direct API calls
   - Monitor server logs for debugging
   - Verify responses match expected results

4. **Check logs**
   - Review purchase flow logs
   - Check for payment URL extraction logs
   - Verify polling behavior

### Automated Testing (Future)

1. Create test fixtures for API responses
2. Mock API calls with different response structures
3. Test payment URL extraction logic
4. Test polling behavior
5. Test error scenarios

---

## Key Code Locations

1. **Payment URL Extraction**: `services/purchaseService.js` line ~424-434
2. **Polling Logic**: `services/purchaseService.js` line ~558-684
3. **Tool Handler**: `server.js` line ~5734-5994
4. **Response Building**: `server.js` line ~5896-5951

---

## Expected API Response Structure

Based on code analysis, the API should return:

```json
{
  "status": "SUCCESS",
  "message": "Status retrieved",
  "data": {
    "paymentStatus": "PENDING",
    "status": "PENDING",
    "link": {
      "url": "https://payment.example.com/...",
      "expireDate": "2026-01-29T00:00:00Z"
    },
    "customerId": "...",
    "supportUrl": "...",
    "transactionId": "..."
  }
}
```

However, the code now supports multiple fallback structures.

---

## Success Criteria

The `purchase_plans` tool is working correctly when:

1. ✅ Payment URL appears in response when available
2. ✅ Payment URL is extracted from various response structures
3. ✅ Polling continues until URL is available (or timeout)
4. ✅ Appropriate messages shown when URL is not available
5. ✅ Error handling works for all failure scenarios
6. ✅ Logs provide sufficient debugging information

---

## Next Steps

1. Execute test scenarios
2. Review logs for actual API response structures
3. Adjust payment URL extraction if needed
4. Add more fallback paths if API structure differs
5. Document actual API response structure for future reference
