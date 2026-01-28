# Hardcoded Values Analysis - Purchase API

This document identifies all hardcoded values in the purchase API codebase and recommends which should be made configurable.

## Summary

**Total Hardcoded Values Found:** 50+

**Critical (Should be Configurable):** 15
**Moderate (Consider Configuring):** 10
**Low Priority (Acceptable as Hardcoded):** 25+

---

## 🔴 Critical - Should Be Made Configurable

### 1. API Endpoints (`services/purchaseService.js`)

| Line | Value | Current | Recommendation |
|------|-------|---------|----------------|
| 230 | Quote endpoint | `'/apisvc/v0/product/quote'` | Move to `config/tenantConfig.js` or env var |
| 389 | Purchase endpoint | `'/apisvc/v0/product'` | Move to `config/tenantConfig.js` or env var |
| 498 | Status endpoint | `/apisvc/v0/product/status/${transactionId}` | Move base path to config |

**Impact:** High - API endpoints may differ between environments (dev/qa/prod)

**Recommendation:**
```javascript
// In config/tenantConfig.js
reach: {
  purchaseEndpoints: {
    quote: '/apisvc/v0/product/quote',
    purchase: '/apisvc/v0/product',
    status: '/apisvc/v0/product/status'
  }
}
```

---

### 2. Default Tenant (`services/purchaseService.js`)

| Line | Value | Current | Recommendation |
|------|-------|---------|----------------|
| 166 | Default tenant | `tenant = 'reach'` | Use from context or config |
| 312 | Default tenant | `tenant = 'reach'` | Use from context or config |
| 485 | Default tenant | `tenant = 'reach'` | Use from context or config |
| 673 | Default tenant | `tenant = 'reach'` | Use from context or config |

**Impact:** Medium - May need to support multiple tenants

**Current Status:** Already handled via context in `server.js` (line 6086), but defaults are hardcoded

---

### 3. Payment Redirect URL (`utils/purchaseHelpers.js`)

| Line | Value | Current | Recommendation |
|------|-------|---------|----------------|
| 394 | Default redirect URL | `'https://www.google.com/'` | **CRITICAL** - Should be environment-specific |

**Impact:** **CRITICAL** - Payment redirects should go to your application, not Google

**Recommendation:**
```javascript
// Already checks env var, but default is wrong
const redirectUrl = options.redirectUrl || 
  process.env.PAYMENT_REDIRECT_URL || 
  process.env.APP_BASE_URL + '/payment/redirect'; // Better default
```

---

### 4. Agent Unique ID (`utils/purchaseHelpers.js`)

| Line | Value | Current | Recommendation |
|------|-------|---------|----------------|
| 389 | Default agent ID | `'AGENT1234'` | Should be environment-specific or generated |

**Impact:** Medium - May need different agent IDs per environment

**Recommendation:**
```javascript
const agentUniqueId = options.agentUniqueId || 
  process.env.PURCHASE_AGENT_ID || 
  process.env.ENVIRONMENT + '_AGENT_' + Date.now(); // Better default
```

---

### 5. Shipment Type (`utils/purchaseHelpers.js`)

| Line | Value | Current | Recommendation |
|------|-------|---------|----------------|
| 384 | Default shipment type | `'usps_first_class_mail'` | Should be configurable |

**Impact:** Medium - May need different shipment types per order/environment

**Recommendation:**
```javascript
const shipmentType = options.shipmentType || 
  process.env.DEFAULT_SHIPMENT_TYPE || 
  'usps_first_class_mail'; // Keep as fallback
```

---

### 6. Payment Type (`utils/purchaseHelpers.js`)

| Line | Value | Current | Recommendation |
|------|-------|---------|----------------|
| 408 | Payment type | `'CARD'` | Should support other payment types |

**Impact:** Medium - May need to support other payment methods

**Recommendation:**
```javascript
payment: {
  paymentType: options.paymentType || 'CARD', // Make configurable
  collection: options.collectionAmount || 0
}
```

---

### 7. Polling Configuration (`services/purchaseService.js`)

| Line | Value | Current | Recommendation |
|------|-------|---------|----------------|
| 676 | Max poll attempts | `maxPollAttempts = 20` | Should be configurable |
| 677 | Poll interval | `pollInterval = 3000` (3 seconds) | Should be configurable |
| 678 | Initial poll delay | `initialPollDelay = 2000` (2 seconds) | Should be configurable |
| 879 | Max backoff delay | `10000` (10 seconds) | Should be configurable |

**Impact:** Medium - Different environments may need different polling strategies

**Recommendation:**
```javascript
const {
  skipPolling = false,
  maxPollAttempts = process.env.PURCHASE_MAX_POLL_ATTEMPTS || 20,
  pollInterval = process.env.PURCHASE_POLL_INTERVAL || 3000,
  initialPollDelay = process.env.PURCHASE_INITIAL_POLL_DELAY || 2000
} = options;
```

---

### 8. Status String Constants (`services/purchaseService.js`)

| Line | Value | Current | Recommendation |
|------|-------|---------|----------------|
| 249, 408, 516 | Success status | `'SUCCESS'` | Should be constant |
| 773 | Done status | `'DONE'` | Should be constant |
| 773 | Success payment status | `'SUCCESS'` | Should be constant |
| 773 | Approved payment status | `'APPROVED'` | Should be constant |
| 802 | Pending payment status | `'PENDING'` | Should be constant |
| 830 | Failed status | `'FAILED'` | Should be constant |

**Impact:** Low-Medium - These are API response values, but should be constants for maintainability

**Recommendation:**
```javascript
// Create constants file: utils/purchaseConstants.js
export const PAYMENT_STATUS = {
  SUCCESS: 'SUCCESS',
  APPROVED: 'APPROVED',
  PENDING: 'PENDING',
  FAILED: 'FAILED'
};

export const ORDER_STATUS = {
  DONE: 'DONE',
  FAILED: 'FAILED',
  PENDING: 'PENDING'
};
```

---

## 🟡 Moderate - Consider Making Configurable

### 9. Default Country Code (`utils/purchaseHelpers.js`)

| Line | Value | Current | Recommendation |
|------|-------|---------|----------------|
| 29, 37, 42, 48 | Default country code | `'1'` (US) | Should support other countries |

**Impact:** Low-Medium - Currently US-only, may need international support

**Recommendation:**
```javascript
const DEFAULT_COUNTRY_CODE = process.env.DEFAULT_PHONE_COUNTRY_CODE || '1';
```

---

### 10. Default Country (`utils/purchaseHelpers.js`)

| Line | Value | Current | Recommendation |
|------|-------|---------|----------------|
| 216, 223 | Default country | `'USA'` | Should support other countries |
| 253, 264 | Default country fallback | `'US'` | Should support other countries |

**Impact:** Low-Medium - Currently US-only, may need international support

---

### 11. Default SIM Type (`utils/purchaseHelpers.js`)

| Line | Value | Current | Recommendation |
|------|-------|---------|----------------|
| 190, 201, 205 | Default SIM type | `'PHYSICAL'` | May need different defaults |

**Impact:** Low - Default is reasonable, but could be configurable

---

### 12. Default Residential Flag (`utils/purchaseHelpers.js`)

| Line | Value | Current | Recommendation |
|------|-------|---------|----------------|
| 254, 265 | Default residential | `'true'` | May need different defaults |

**Impact:** Low - Default is reasonable, but could be configurable

---

### 13. Acquisition Source (`utils/purchaseHelpers.js`)

| Line | Value | Current | Recommendation |
|------|-------|---------|----------------|
| 414 | Acquisition source | `'Online'` | Should be configurable per environment |

**Impact:** Low-Medium - May need different sources per channel

**Recommendation:**
```javascript
meta: {
  acquisitionSrc: options.acquisitionSrc || process.env.ACQUISITION_SOURCE || 'Online',
  agentUniqueId: agentUniqueId
}
```

---

### 14. ZIP Code Padding (`utils/purchaseHelpers.js`)

| Line | Value | Current | Recommendation |
|------|-------|---------|----------------|
| 145 | ZIP padding | `padStart(5, '0')` | May need different formats for international |

**Impact:** Low - US-specific, but acceptable

---

### 15. String Length Limits (`utils/purchaseHelpers.js`)

| Line | Value | Current | Recommendation |
|------|-------|---------|----------------|
| 19 | Max string length | `500` | Should be configurable |

**Impact:** Low - Reasonable default, but could be configurable

---

## 🟢 Low Priority - Acceptable as Hardcoded

### 16. State Code Mapping (`utils/purchaseHelpers.js`)

| Lines | Value | Current | Status |
|-------|-------|---------|--------|
| 96-110 | US state map | Complete US state mapping | ✅ Acceptable - US-specific feature |

**Impact:** None - This is a utility function for US addresses

---

### 17. Error Type Constants (`services/purchaseService.js`)

| Lines | Value | Current | Status |
|-------|-------|---------|--------|
| 60, 70, 81, 92 | Error types | `'VALIDATION_ERROR'`, `'QUOTE_ERROR'`, etc. | ✅ Acceptable - Internal constants |

**Impact:** None - These are internal error types

---

### 18. Flow State Constants (`services/purchaseService.js`)

| Lines | Value | Current | Status |
|-------|-------|---------|--------|
| 681, 688, 695, etc. | State strings | `'INITIAL'`, `'VALIDATING'`, `'QUOTING'`, etc. | ✅ Should be constants |

**Recommendation:** Extract to constants file for maintainability

---

### 19. Link Type Values (`services/purchaseService.js`)

| Line | Value | Current | Status |
|------|-------|---------|--------|
| 545 | Link type success | `linkType === 1` | ✅ Acceptable - API contract |
| 549 | Link type pending | `linkType === 0` | ✅ Acceptable - API contract |

**Impact:** None - These are API response values

---

### 20. HTTP Methods (`services/purchaseService.js`)

| Lines | Value | Current | Status |
|-------|---------|---------|--------|
| 232, 391, 500 | HTTP methods | `'POST'`, `'GET'` | ✅ Acceptable - Standard HTTP |

**Impact:** None - Standard HTTP methods

---

## 📋 Recommended Actions

### Immediate (Critical)

1. **Fix Payment Redirect URL** - Change default from `'https://www.google.com/'` to environment-specific URL
2. **Move API Endpoints to Config** - Extract all API endpoints to `config/tenantConfig.js`
3. **Make Polling Configurable** - Add environment variables for polling configuration

### Short Term (Moderate)

4. **Create Constants File** - Extract all status strings and state strings to `utils/purchaseConstants.js`
5. **Make Agent ID Configurable** - Remove hardcoded `'AGENT1234'` default
6. **Support Multiple Countries** - Make country code and country defaults configurable

### Long Term (Nice to Have)

7. **Extract State Mapping** - Move US state mapping to separate config file
8. **Add Payment Type Support** - Make payment type configurable per order
9. **International Support** - Add support for non-US addresses and phone numbers

---

## 🔧 Implementation Example

### Create `utils/purchaseConstants.js`:

```javascript
// Purchase API Constants
export const PAYMENT_STATUS = {
  SUCCESS: 'SUCCESS',
  APPROVED: 'APPROVED',
  PENDING: 'PENDING',
  FAILED: 'FAILED'
};

export const ORDER_STATUS = {
  DONE: 'DONE',
  FAILED: 'FAILED',
  PENDING: 'PENDING'
};

export const FLOW_STATE = {
  INITIAL: 'INITIAL',
  VALIDATING: 'VALIDATING',
  QUOTING: 'QUOTING',
  QUOTED: 'QUOTED',
  PURCHASING: 'PURCHASING',
  PURCHASED: 'PURCHASED',
  POLLING: 'POLLING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  POLLING_TIMEOUT: 'POLLING_TIMEOUT'
};

export const LINK_TYPE = {
  PENDING: 0,
  SUCCESS: 1
};

export const DEFAULT_CONFIG = {
  TENANT: process.env.DEFAULT_TENANT || 'reach',
  COUNTRY_CODE: process.env.DEFAULT_PHONE_COUNTRY_CODE || '1',
  COUNTRY: process.env.DEFAULT_COUNTRY || 'USA',
  SHIPMENT_TYPE: process.env.DEFAULT_SHIPMENT_TYPE || 'usps_first_class_mail',
  PAYMENT_TYPE: process.env.DEFAULT_PAYMENT_TYPE || 'CARD',
  ACQUISITION_SOURCE: process.env.ACQUISITION_SOURCE || 'Online',
  RESIDENTIAL_DEFAULT: process.env.DEFAULT_RESIDENTIAL || 'true',
  MAX_POLL_ATTEMPTS: parseInt(process.env.PURCHASE_MAX_POLL_ATTEMPTS || '20', 10),
  POLL_INTERVAL: parseInt(process.env.PURCHASE_POLL_INTERVAL || '3000', 10),
  INITIAL_POLL_DELAY: parseInt(process.env.PURCHASE_INITIAL_POLL_DELAY || '2000', 10),
  MAX_BACKOFF_DELAY: parseInt(process.env.PURCHASE_MAX_BACKOFF_DELAY || '10000', 10)
};
```

### Update `config/tenantConfig.js`:

```javascript
export const tenantConfig = {
  reach: {
    // ... existing config ...
    purchaseEndpoints: {
      quote: process.env.REACH_PURCHASE_QUOTE_ENDPOINT || '/apisvc/v0/product/quote',
      purchase: process.env.REACH_PURCHASE_ENDPOINT || '/apisvc/v0/product',
      status: process.env.REACH_PURCHASE_STATUS_ENDPOINT || '/apisvc/v0/product/status'
    },
    purchaseDefaults: {
      redirectUrl: process.env.PAYMENT_REDIRECT_URL || process.env.APP_BASE_URL + '/payment/redirect',
      agentId: process.env.PURCHASE_AGENT_ID || process.env.ENVIRONMENT + '_AGENT',
      shipmentType: process.env.DEFAULT_SHIPMENT_TYPE || 'usps_first_class_mail'
    }
  }
};
```

---

## ✅ Checklist

- [ ] Fix payment redirect URL default
- [ ] Move API endpoints to config
- [ ] Create constants file for status/state strings
- [ ] Make polling configuration environment-aware
- [ ] Remove hardcoded agent ID
- [ ] Add environment variable documentation
- [ ] Update `.env.example` with new variables
- [ ] Add validation for required environment variables
