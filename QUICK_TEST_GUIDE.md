# Quick Test Guide - Purchase Plans Tool

## Quick Test Steps

### 1. Prerequisites Check
- [ ] Server is running
- [ ] API endpoints are accessible
- [ ] You have a valid plan ID to test with

### 2. Test Purchase Flow

#### Step 1: Add Plan to Cart
```
Use: add_plan_to_cart or similar tool
Verify: Plan appears in cart
```

#### Step 2: Collect Shipping Address
```
Use: collect_shipping_address tool
Provide:
  - firstName: "John"
  - lastName: "Doe"
  - street: "123 Main St"
  - city: "New York"
  - state: "NY"
  - zipCode: "10001"
  - phone: "5551234567"
  - email: "test@example.com"
```

#### Step 3: Call Purchase Plans Tool
```
Tool: purchase_plans
Parameters: {} (or { skipPolling: false })
```

#### Step 4: Check Response
Look for:
- ✅ Payment URL in response text
- ✅ `structuredContent.purchaseResult.paymentUrl` exists
- ✅ Transaction ID is present
- ✅ Response indicates success

### 3. Check Logs

Look for these log messages:

**Success Indicators:**
```
✅ "Purchase status API: Payment URL found"
✅ "Payment URL found at: response.data.link.url" (or similar)
✅ "Purchase flow: Completed successfully"
```

**Debugging Info:**
```
🔍 "Response structure for payment URL debugging"
🔍 "Purchase flow: Status poll result"
```

**Warning Signs:**
```
⚠️ "Purchase status API: Payment URL not found in expected locations"
⚠️ "Purchase flow: Max poll attempts reached"
```

### 4. Verify Payment URL

The payment URL should:
- Start with `http://` or `https://`
- Be a complete, valid URL
- Appear in both:
  - Response text: `**Payment Link:**\n<URL>`
  - Structured content: `structuredContent.purchaseResult.paymentUrl`

## Common Issues & Solutions

### Issue: Payment URL Not in Response

**Check:**
1. Look at logs for "Payment URL not found" message
2. Check "Response structure" logs to see actual API structure
3. Verify API is returning payment URLs
4. Check if polling completed successfully

**Solution:**
- Review logs to identify actual response structure
- Add fallback path if URL is in different location
- Check if payment URL generation is delayed on backend

### Issue: Polling Timeout

**Check:**
1. Look for "Max poll attempts reached" in logs
2. Verify transaction ID is present
3. Check if status API is accessible

**Solution:**
- Use `check_purchase_status` tool with transaction ID
- Wait a few seconds and retry
- Check backend logs for payment URL generation

### Issue: Response Structure Different

**Check:**
1. Review "Response structure for payment URL debugging" logs
2. Compare with expected structures in test plan
3. Identify where payment URL actually appears

**Solution:**
- Add new fallback path in `purchaseStatus()` function
- Update extraction logic to match actual API structure

## Test Checklist

- [ ] Payment URL appears in response
- [ ] Payment URL is valid (starts with http/https)
- [ ] Transaction ID is present
- [ ] Response indicates success
- [ ] Logs show payment URL was found
- [ ] No errors in logs
- [ ] Polling completed successfully (or timed out gracefully)

## Quick Debug Commands

### Check Purchase Status
```
Tool: check_purchase_status
Parameters: { transactionId: "<from previous response>" }
```

### View Logs
```bash
# If using file logging, check log files
# If using console logging, check server console output
```

### Test with Skip Polling
```
Tool: purchase_plans
Parameters: { skipPolling: true }
```
Then use `check_purchase_status` separately to get payment URL.

## Success Criteria

✅ **Working correctly when:**
- Payment URL appears in response
- Payment URL is extracted from API response
- Polling finds URL when available
- Appropriate messages shown when URL not available
- Logs provide debugging information

## Next Steps After Testing

1. If working: Document actual API response structure
2. If not working: Review logs and add additional fallback paths
3. Update test plan with actual findings
4. Document any API-specific quirks
