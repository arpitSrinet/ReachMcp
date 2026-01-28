# Purchase API Field Mapping Guide

## Overview
This document maps fields from the current checkout data structure (`get_checkout_data`) to the Purchase API request format (Quote/Purchase endpoints).

---

## 1. Current Checkout Data Structure

### Structure from `get_checkout_data` tool:

```javascript
{
  sessionId: "session_123...",
  cart: {
    lines: [
      {
        lineNumber: 1,
        plan: {
          id: "plan-id-123",
          name: "By the Gig",
          price: 15.0,
          // ... other plan fields
        },
        device: null,  // No device for plan-only orders
        protection: null,
        sim: {
          type: "sim",
          simType: "ESIM" | "PSIM" | "PHYSICAL",
          iccId: null
        }
      }
      // ... more lines
    ],
    totals: {
      monthlyTotal: 15.0,
      deviceTotal: 0,
      protectionTotal: 0,
      handlingFee: 10.0,
      shippingFee: 0,
      oneTimeTotal: 10.0,
      totalDueToday: 10.0
    }
  },
  shippingAddress: {
    firstName: "John",
    lastName: "Doe",
    street: "104 ALLISON CV",
    city: "OXFORD",
    state: "MS",
    zipCode: "38655",
    country: "US",
    phone: "1234567890",  // Raw phone string
    email: "john@example.com"
  },
  billingAddress: { ...same as shippingAddress },
  userInfo: {
    email: "john@example.com",
    phone: "1234567890",
    name: "John Doe"
  },
  orderSummary: {
    monthlyTotal: 15.0,
    oneTimeTotal: 10.0,
    totalDueToday: 10.0,
    lineCount: 1
  },
  timestamp: 1234567890
}
```

---

## 2. Purchase API Request Format

### Structure from your curl examples:

```javascript
{
  accountInfo: {
    firstName: "zmmurgentdisas",
    lastName: "jain",
    billingPhoneCountryCode: "91",
    billingPhoneNumber: "1234567890",
    addresses: [
      {
        type: "billing",
        address1: "104 ALLISON CV",
        address2: "hibuhibu222",
        city: "OXFORD",
        state: "MS",
        zip: "38655",
        country: "USA",
        residential: "true"
      },
      {
        type: "shipping",
        address1: "104 ALLISON CV",
        address2: "hibu",
        city: "OXFORD",
        state: "MS",
        zip: "38655",
        country: "USA",
        residential: "true"
      }
    ],
    email: "zinex+9864239411@reachmobile.com",
    shipmentType: "usps_first_class_mail",
    clientAccountId: "zindis123122",
    payment: {
      paymentType: "CARD",
      collection: 10.7  // From quote response: totalOneTimeCost
    }
  },
  lines: [
    {
      firstName: "zmmurgentdisd",
      lastName: "jain",
      planId: "By the Gig",
      isPrimary: true,
      simType: "PHYSICAL"  // "ESIM" or "PHYSICAL"
    }
  ],
  meta: {
    acquisitionSrc: "Online",
    agentUniqueId: "AGENT1234"
  },
  redirectUrl: "https://www.google.com/"
}
```

---

## 3. Field-by-Field Mapping

### ✅ Direct Matches (No Transformation Needed)

| Checkout Field | API Field | Notes |
|---------------|-----------|-------|
| `shippingAddress.firstName` | `accountInfo.firstName` | ✅ Direct match |
| `shippingAddress.lastName` | `accountInfo.lastName` | ✅ Direct match |
| `shippingAddress.city` | `accountInfo.addresses[].city` | ✅ Direct match |
| `shippingAddress.state` | `accountInfo.addresses[].state` | ✅ Direct match (may need normalization) |
| `shippingAddress.email` | `accountInfo.email` | ✅ Direct match |
| `cart.lines[].plan.id` or `plan.name` | `lines[].planId` | ✅ Direct match (use id if available, fallback to name) |

---

### 🔄 Requires Transformation

| Checkout Field | API Field | Transformation Required |
|---------------|-----------|------------------------|
| `shippingAddress.street` | `accountInfo.addresses[].address1` | ✅ Rename field |
| `shippingAddress.zipCode` | `accountInfo.addresses[].zip` | ✅ Rename field |
| `shippingAddress.country` | `accountInfo.addresses[].country` | 🔄 Transform: "US" → "USA" |
| `shippingAddress.phone` | `accountInfo.billingPhoneCountryCode` | 🔄 Extract country code (e.g., "1" from "+1-555-123-4567") |
| `shippingAddress.phone` | `accountInfo.billingPhoneNumber` | 🔄 Extract phone number without country code |
| `cart.lines[].sim.simType` | `lines[].simType` | 🔄 Transform: "PSIM" → "PHYSICAL", keep "ESIM" as-is |
| `cart.lines[].plan` | `lines[].planId` | 🔄 Extract: `plan.id` or `plan.uniqueIdentifier` or `plan.name` |
| `cart.lines[].plan` | `lines[].firstName` | 🔄 Use: `shippingAddress.firstName` (per line) |
| `cart.lines[].plan` | `lines[].lastName` | 🔄 Use: `shippingAddress.lastName` (per line) |
| `cart.lines[].plan` | `lines[].isPrimary` | 🔄 Set: `true` for first line (index 0), `false` for others |

---

### ➕ Missing Fields (Need to Add/Generate)

| API Field | Source | Default/Generation |
|-----------|--------|-------------------|
| `accountInfo.addresses[].address2` | Not collected | `""` (empty string) |
| `accountInfo.addresses[].residential` | Not collected | `"true"` (default) |
| `accountInfo.addresses[].type` | Not collected | `"billing"` and `"shipping"` (create both) |
| `accountInfo.shipmentType` | Not collected | `"usps_first_class_mail"` (from env/config) |
| `accountInfo.clientAccountId` | Not collected | Generate: `client_${timestamp}_${random}` |
| `accountInfo.payment.paymentType` | Not collected | `"CARD"` (default) |
| `accountInfo.payment.collection` | Not collected | `0` for quote, `quoteResponse.data.oneTimeCharge.totalOneTimeCost` for purchase |
| `meta.acquisitionSrc` | Not collected | `"Online"` (default) |
| `meta.agentUniqueId` | Not collected | From env: `process.env.PURCHASE_AGENT_ID` or `"AGENT1234"` |
| `redirectUrl` | Not collected | From env: `process.env.PAYMENT_REDIRECT_URL` or `"https://www.google.com/"` |

---

### ❌ Not Used in API (Can Ignore)

| Checkout Field | Notes |
|---------------|-------|
| `sessionId` | Internal tracking only |
| `cart.totals.*` | Calculated fields, not sent to API |
| `billingAddress` | Duplicate of shippingAddress, API uses addresses array |
| `userInfo.*` | Redundant, data already in accountInfo |
| `orderSummary.*` | Calculated fields, not sent to API |
| `timestamp` | Internal tracking only |
| `cart.lines[].device` | Should be null for plan-only orders |
| `cart.lines[].protection` | Not used in purchase API |
| `cart.lines[].sim.iccId` | Not used in purchase API |

---

## 4. Detailed Transformation Examples

### Example 1: Phone Number Parsing

**Input (Checkout):**
```javascript
phone: "1234567890"  // or "+1-555-123-4567" or "(555) 123-4567"
```

**Output (API):**
```javascript
billingPhoneCountryCode: "1",  // Extracted or default to "1" for US
billingPhoneNumber: "1234567890"  // Cleaned 10-digit number
```

**Transformation Logic:**
```javascript
function extractCountryCode(phone) {
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');
  
  // If starts with 1 and has 11 digits, country code is 1
  if (digits.length === 11 && digits[0] === '1') {
    return '1';
  }
  
  // If has 10 digits, assume US (country code 1)
  if (digits.length === 10) {
    return '1';  // Default US
  }
  
  // Otherwise, try to extract first 1-3 digits as country code
  // For now, default to "1" for US
  return '1';
}

function extractPhoneNumber(phone) {
  const digits = phone.replace(/\D/g, '');
  
  // If 11 digits and starts with 1, remove the 1
  if (digits.length === 11 && digits[0] === '1') {
    return digits.substring(1);
  }
  
  // If 10 digits, return as-is
  if (digits.length === 10) {
    return digits;
  }
  
  // Return last 10 digits
  return digits.slice(-10);
}
```

---

### Example 2: SIM Type Transformation

**Input (Checkout):**
```javascript
sim: {
  simType: "ESIM" | "PSIM" | "PHYSICAL"
}
```

**Output (API):**
```javascript
simType: "ESIM" | "PHYSICAL"  // PSIM → PHYSICAL
```

**Transformation Logic:**
```javascript
function normalizeSimType(simType) {
  if (simType === "ESIM") return "ESIM";
  if (simType === "PSIM" || simType === "PHYSICAL") return "PHYSICAL";
  // Default fallback
  return "PHYSICAL";
}
```

---

### Example 3: Address Array Construction

**Input (Checkout):**
```javascript
shippingAddress: {
  firstName: "John",
  lastName: "Doe",
  street: "104 ALLISON CV",
  city: "OXFORD",
  state: "MS",
  zipCode: "38655",
  country: "US",
  phone: "1234567890",
  email: "john@example.com"
}
```

**Output (API):**
```javascript
addresses: [
  {
    type: "billing",
    address1: "104 ALLISON CV",
    address2: "",  // Not collected, empty string
    city: "OXFORD",
    state: "MS",
    zip: "38655",  // Note: zipCode → zip
    country: "USA",  // Note: US → USA
    residential: "true"
  },
  {
    type: "shipping",
    address1: "104 ALLISON CV",
    address2: "",
    city: "OXFORD",
    state: "MS",
    zip: "38655",
    country: "USA",
    residential: "true"
  }
]
```

**Transformation Logic:**
```javascript
function buildAddresses(shippingAddress) {
  const baseAddress = {
    address1: shippingAddress.street,
    address2: "",  // Not collected
    city: shippingAddress.city,
    state: shippingAddress.state,
    zip: shippingAddress.zipCode,
    country: shippingAddress.country === "US" ? "USA" : shippingAddress.country,
    residential: "true"
  };
  
  return [
    { ...baseAddress, type: "billing" },
    { ...baseAddress, type: "shipping" }
  ];
}
```

---

### Example 4: Lines Array Construction

**Input (Checkout):**
```javascript
cart: {
  lines: [
    {
      lineNumber: 1,
      plan: {
        id: "plan-123",
        name: "By the Gig"
      },
      sim: {
        simType: "ESIM"
      }
    },
    {
      lineNumber: 2,
      plan: {
        id: "plan-456",
        name: "Unlimited"
      },
      sim: {
        simType: "PSIM"
      }
    }
  ]
}
```

**Output (API):**
```javascript
lines: [
  {
    firstName: "John",  // From shippingAddress
    lastName: "Doe",   // From shippingAddress
    planId: "plan-123",
    isPrimary: true,    // First line
    simType: "ESIM"
  },
  {
    firstName: "John",
    lastName: "Doe",
    planId: "plan-456",
    isPrimary: false,  // Not first line
    simType: "PHYSICAL"  // PSIM → PHYSICAL
  }
]
```

**Transformation Logic:**
```javascript
function buildLines(cartLines, shippingAddress) {
  return cartLines.map((line, index) => ({
    firstName: shippingAddress.firstName,
    lastName: shippingAddress.lastName,
    planId: line.plan.id || line.plan.uniqueIdentifier || line.plan.name,
    isPrimary: index === 0,
    simType: normalizeSimType(line.sim?.simType)
  }));
}
```

---

## 5. Complete Transformation Function

### Pseudocode for `transformCheckoutDataToPurchaseRequest()`

```javascript
function transformCheckoutDataToPurchaseRequest(checkoutData, options = {}) {
  const { shippingAddress, cart } = checkoutData;
  
  // Extract phone components
  const countryCode = extractCountryCode(shippingAddress.phone);
  const phoneNumber = extractPhoneNumber(shippingAddress.phone);
  
  // Build addresses array
  const addresses = buildAddresses(shippingAddress);
  
  // Build lines array
  const lines = buildLines(cart.lines, shippingAddress);
  
  // Generate client account ID (or reuse from options)
  const clientAccountId = options.clientAccountId || generateClientAccountId();
  
  // Build request
  return {
    accountInfo: {
      firstName: shippingAddress.firstName,
      lastName: shippingAddress.lastName,
      billingPhoneCountryCode: countryCode,
      billingPhoneNumber: phoneNumber,
      addresses: addresses,
      email: shippingAddress.email,
      shipmentType: options.shipmentType || process.env.DEFAULT_SHIPMENT_TYPE || "usps_first_class_mail",
      clientAccountId: clientAccountId,
      payment: {
        paymentType: "CARD",
        collection: options.collectionAmount || 0  // 0 for quote, set from quote response for purchase
      }
    },
    lines: lines,
    meta: {
      acquisitionSrc: "Online",
      agentUniqueId: options.agentUniqueId || process.env.PURCHASE_AGENT_ID || "AGENT1234"
    },
    redirectUrl: options.redirectUrl || process.env.PAYMENT_REDIRECT_URL || "https://www.google.com/"
  };
}
```

---

## 6. Key Differences Summary

### Structure Differences:
1. **Nested vs Flat**: Checkout uses flat `shippingAddress`, API uses nested `accountInfo.addresses[]`
2. **Single vs Array**: Checkout has single address, API requires both billing and shipping in array
3. **Field Names**: Some fields renamed (`street` → `address1`, `zipCode` → `zip`)
4. **Phone Format**: Checkout has single phone string, API splits into country code + number
5. **SIM Type**: Checkout allows "PSIM", API only accepts "ESIM" or "PHYSICAL"

### Missing Data:
1. **address2**: Not collected, use empty string
2. **residential**: Not collected, default to "true"
3. **shipmentType**: Not collected, use default "usps_first_class_mail"
4. **clientAccountId**: Not collected, generate unique ID
5. **payment.collection**: Set from quote response (not in checkout data)
6. **meta fields**: Not collected, use defaults/env vars

### Extra Data (Not Used):
- `sessionId`, `totals`, `orderSummary`, `timestamp` - Internal only
- `device`, `protection` - Not used in plan-only purchase
- `userInfo` - Redundant with accountInfo

---

## 7. Validation Checklist

Before transformation, validate:

- [ ] `shippingAddress` exists and has all required fields
- [ ] `cart.lines` exists and has at least one line
- [ ] Each line has `plan` with `id` or `name`
- [ ] Each line has `sim` with `simType`
- [ ] No devices in any line (for plan-only purchase)
- [ ] `phone` is valid format (can be parsed)
- [ ] `email` is valid format
- [ ] `state` is valid (2-letter code or can be normalized)
- [ ] `zipCode` is valid (5 digits or 5+4 format)
- [ ] `country` is valid (defaults to "US" if missing)

---

## 8. Quick Reference: Field Mapping Table

| Checkout Path | API Path | Transform | Required |
|--------------|----------|-----------|----------|
| `shippingAddress.firstName` | `accountInfo.firstName` | None | ✅ |
| `shippingAddress.lastName` | `accountInfo.lastName` | None | ✅ |
| `shippingAddress.street` | `accountInfo.addresses[].address1` | Rename | ✅ |
| `shippingAddress.city` | `accountInfo.addresses[].city` | None | ✅ |
| `shippingAddress.state` | `accountInfo.addresses[].state` | Normalize | ✅ |
| `shippingAddress.zipCode` | `accountInfo.addresses[].zip` | Rename | ✅ |
| `shippingAddress.country` | `accountInfo.addresses[].country` | "US"→"USA" | ✅ |
| `shippingAddress.phone` | `accountInfo.billingPhoneCountryCode` | Extract | ✅ |
| `shippingAddress.phone` | `accountInfo.billingPhoneNumber` | Extract | ✅ |
| `shippingAddress.email` | `accountInfo.email` | None | ✅ |
| `cart.lines[].plan.id` | `lines[].planId` | Extract | ✅ |
| `cart.lines[].sim.simType` | `lines[].simType` | Normalize | ✅ |
| `shippingAddress.firstName` | `lines[].firstName` | Copy | ✅ |
| `shippingAddress.lastName` | `lines[].lastName` | Copy | ✅ |
| N/A | `accountInfo.addresses[].address2` | Default "" | ❌ |
| N/A | `accountInfo.addresses[].residential` | Default "true" | ❌ |
| N/A | `accountInfo.addresses[].type` | Generate | ✅ |
| N/A | `accountInfo.shipmentType` | Default/env | ❌ |
| N/A | `accountInfo.clientAccountId` | Generate | ✅ |
| N/A | `accountInfo.payment.paymentType` | Default "CARD" | ❌ |
| N/A | `accountInfo.payment.collection` | From quote | ✅ |
| N/A | `lines[].isPrimary` | Generate | ✅ |
| N/A | `meta.acquisitionSrc` | Default "Online" | ❌ |
| N/A | `meta.agentUniqueId` | Env/default | ❌ |
| N/A | `redirectUrl` | Env/default | ❌ |

---

## 9. Implementation Notes

1. **Quote vs Purchase**: Same structure, but `payment.collection` differs:
   - Quote: `collection: 0`
   - Purchase: `collection: quoteResponse.data.oneTimeCharge.totalOneTimeCost`

2. **Client Account ID**: Generate once during quote, reuse in purchase

3. **Address Duplication**: API requires both billing and shipping addresses (can be same)

4. **Phone Parsing**: Handle various formats gracefully, default to US (+1)

5. **SIM Type**: Normalize "PSIM" to "PHYSICAL" for API compatibility

6. **Error Handling**: Validate all required fields before transformation

---

## 10. Example: Complete Transformation

### Input (Checkout Data):
```javascript
{
  sessionId: "session_123",
  cart: {
    lines: [{
      lineNumber: 1,
      plan: { id: "plan-123", name: "By the Gig" },
      sim: { simType: "ESIM" }
    }]
  },
  shippingAddress: {
    firstName: "John",
    lastName: "Doe",
    street: "123 Main St",
    city: "New York",
    state: "NY",
    zipCode: "10001",
    country: "US",
    phone: "5551234567",
    email: "john@example.com"
  }
}
```

### Output (API Request):
```javascript
{
  accountInfo: {
    firstName: "John",
    lastName: "Doe",
    billingPhoneCountryCode: "1",
    billingPhoneNumber: "5551234567",
    addresses: [
      {
        type: "billing",
        address1: "123 Main St",
        address2: "",
        city: "New York",
        state: "NY",
        zip: "10001",
        country: "USA",
        residential: "true"
      },
      {
        type: "shipping",
        address1: "123 Main St",
        address2: "",
        city: "New York",
        state: "NY",
        zip: "10001",
        country: "USA",
        residential: "true"
      }
    ],
    email: "john@example.com",
    shipmentType: "usps_first_class_mail",
    clientAccountId: "client_1234567890_abc123",
    payment: {
      paymentType: "CARD",
      collection: 0  // For quote, will be set from quote response for purchase
    }
  },
  lines: [{
    firstName: "John",
    lastName: "Doe",
    planId: "plan-123",
    isPrimary: true,
    simType: "ESIM"
  }],
  meta: {
    acquisitionSrc: "Online",
    agentUniqueId: "AGENT1234"
  },
  redirectUrl: "https://www.google.com/"
}
```

---

This mapping guide should help you implement the transformation logic in `utils/purchaseHelpers.js` and `services/purchaseService.js`.
