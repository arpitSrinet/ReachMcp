# Hardcoded Values - Fixes Applied

## Summary

All critical hardcoded values in the purchase API have been replaced with configurable constants and environment variables.

---

## ✅ Changes Made

### 1. Created Constants File (`utils/purchaseConstants.js`)

**New file created** with:
- `PAYMENT_STATUS` - Payment status constants (SUCCESS, APPROVED, PENDING, FAILED)
- `ORDER_STATUS` - Order status constants (DONE, FAILED, PENDING)
- `FLOW_STATE` - Purchase flow state constants (INITIAL, VALIDATING, QUOTING, etc.)
- `LINK_TYPE` - Link type constants (PENDING: 0, SUCCESS: 1)
- `API_STATUS` - API response status constants
- `DEFAULT_CONFIG` - Default configuration values from environment variables

### 2. Updated Tenant Config (`config/tenantConfig.js`)

**Added purchase configuration:**
- `purchaseEndpoints` - API endpoints (quote, purchase, status)
- `purchaseDefaults` - Default values (redirectUrl, agentId, shipmentType, paymentType, acquisitionSrc)

**Environment Variables Supported:**
- `REACH_PURCHASE_QUOTE_ENDPOINT`
- `REACH_PURCHASE_ENDPOINT`
- `REACH_PURCHASE_STATUS_ENDPOINT`
- `PAYMENT_REDIRECT_URL`
- `APP_BASE_URL`
- `PURCHASE_AGENT_ID`
- `ENVIRONMENT`
- `DEFAULT_SHIPMENT_TYPE`
- `DEFAULT_PAYMENT_TYPE`
- `ACQUISITION_SOURCE`

### 3. Updated Purchase Helpers (`utils/purchaseHelpers.js`)

**Replaced hardcoded values:**
- ✅ Default shipment type → `DEFAULT_CONFIG.SHIPMENT_TYPE`
- ✅ Default agent ID → `DEFAULT_CONFIG.AGENT_ID`
- ✅ Default redirect URL → `DEFAULT_CONFIG.REDIRECT_URL`
- ✅ Payment type → `DEFAULT_CONFIG.PAYMENT_TYPE` (configurable via options)
- ✅ Acquisition source → `DEFAULT_CONFIG.ACQUISITION_SOURCE` (configurable via options)

### 4. Updated Purchase Service (`services/purchaseService.js`)

**Replaced hardcoded values:**
- ✅ Default tenant → `DEFAULT_CONFIG.TENANT`
- ✅ API endpoints → From `getTenantConfig(tenant).purchaseEndpoints`
- ✅ Status checks → Using `API_STATUS.SUCCESS`, `PAYMENT_STATUS.*`, `ORDER_STATUS.*`
- ✅ Flow states → Using `FLOW_STATE.*` constants
- ✅ Link type checks → Using `LINK_TYPE.SUCCESS`, `LINK_TYPE.PENDING`
- ✅ Polling configuration → `DEFAULT_CONFIG.MAX_POLL_ATTEMPTS`, `DEFAULT_CONFIG.POLL_INTERVAL`, etc.
- ✅ Max backoff delay → `DEFAULT_CONFIG.MAX_BACKOFF_DELAY`

---

## 📋 Environment Variables Reference

### Purchase API Endpoints
```bash
REACH_PURCHASE_QUOTE_ENDPOINT=/apisvc/v0/product/quote
REACH_PURCHASE_ENDPOINT=/apisvc/v0/product
REACH_PURCHASE_STATUS_ENDPOINT=/apisvc/v0/product/status
```

### Purchase Defaults
```bash
PAYMENT_REDIRECT_URL=https://your-app.com/payment/redirect
APP_BASE_URL=https://your-app.com
PURCHASE_AGENT_ID=prod_agent_123
ENVIRONMENT=production
DEFAULT_SHIPMENT_TYPE=usps_first_class_mail
DEFAULT_PAYMENT_TYPE=CARD
ACQUISITION_SOURCE=Online
```

### Polling Configuration
```bash
PURCHASE_MAX_POLL_ATTEMPTS=20
PURCHASE_POLL_INTERVAL=3000
PURCHASE_INITIAL_POLL_DELAY=2000
PURCHASE_MAX_BACKOFF_DELAY=10000
```

### Other Defaults
```bash
DEFAULT_TENANT=reach
DEFAULT_PHONE_COUNTRY_CODE=1
DEFAULT_COUNTRY=USA
DEFAULT_RESIDENTIAL=true
```

---

## 🔍 Remaining Hardcoded Values (Acceptable)

These values are acceptable as hardcoded because they are:
- API contract values (must match API specification)
- Internal constants (error types, HTTP methods)
- Utility defaults (US state mapping, ZIP code format)

### API Contract Values
- `linkType === 0` / `linkType === 1` - API response values
- `'POST'`, `'GET'` - Standard HTTP methods
- `'SUCCESS'`, `'PENDING'`, etc. - API response status values (now constants)

### Internal Constants
- Error type strings (`'VALIDATION_ERROR'`, `'QUOTE_ERROR'`, etc.)
- US state code mapping (utility function)

### Utility Defaults
- ZIP code padding (`padStart(5, '0')`)
- String length limit (`500`)
- Default country code (`'1'`) - Can be overridden via env var

---

## 🎯 Benefits

1. **Environment-Specific Configuration** - Different endpoints/values per environment
2. **Maintainability** - Constants in one place, easier to update
3. **Type Safety** - Using constants reduces typos
4. **Flexibility** - Easy to add new tenants or environments
5. **Security** - Sensitive values (like redirect URLs) can be environment-specific

---

## 📝 Next Steps

1. **Update `.env.example`** - Add all new environment variables
2. **Set Production Values** - Configure environment variables in production
3. **Update Documentation** - Document new environment variables
4. **Test** - Verify all configurations work correctly

---

## ⚠️ Important Notes

1. **Payment Redirect URL** - The default is still `'https://www.google.com/'` but now checks `PAYMENT_REDIRECT_URL` or `APP_BASE_URL` first. **You should set this in production!**

2. **Agent ID** - Defaults to `'AGENT1234'` if `PURCHASE_AGENT_ID` and `ENVIRONMENT` are not set. Consider setting these.

3. **API Endpoints** - Defaults are provided, but you can override them per environment if needed.

4. **Backward Compatibility** - All changes maintain backward compatibility with existing code.
