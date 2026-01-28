import { logger } from './logger.js';
import { DEFAULT_CONFIG } from './purchaseConstants.js';

/**
 * Purchase Helper Functions
 * Utility functions for transforming checkout data to purchase API format
 */

/**
 * Sanitize string input
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
export function sanitizeString(str) {
  if (!str || typeof str !== 'string') return '';
  
  return str
    .trim()
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .substring(0, 500); // Limit length to prevent injection
}

/**
 * Extract country code from phone number
 * @param {string} phone - Phone number string
 * @returns {string} Country code (default: "1" for US)
 */
export function extractCountryCode(phone) {
  if (!phone || typeof phone !== 'string') {
    return '1'; // Default to US
  }
  
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');
  
  // If starts with 1 and has 11 digits, country code is 1
  if (digits.length === 11 && digits[0] === '1') {
    return '1';
  }
  
  // If has 10 digits, assume US (country code 1)
  if (digits.length === 10) {
    return '1'; // Default US
  }
  
  // If has more than 10 digits, try to extract country code
  // For now, default to "1" for US
  // Could be enhanced to detect other country codes
  return '1';
}

/**
 * Extract phone number without country code
 * @param {string} phone - Phone number string
 * @returns {string} 10-digit phone number
 */
export function extractPhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') {
    return '';
  }
  
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');
  
  // If 11 digits and starts with 1, remove the 1
  if (digits.length === 11 && digits[0] === '1') {
    return digits.substring(1);
  }
  
  // If 10 digits, return as-is
  if (digits.length === 10) {
    return digits;
  }
  
  // Return last 10 digits (in case of extra formatting)
  return digits.slice(-10);
}

/**
 * Normalize state code to 2-letter uppercase format
 * @param {string} state - State name or code
 * @returns {string} 2-letter uppercase state code
 */
export function normalizeStateCode(state) {
  if (!state || typeof state !== 'string') {
    return '';
  }
  
  const normalized = state.trim().toUpperCase();
  
  // If already 2 letters, return as-is
  if (normalized.length === 2) {
    return normalized;
  }
  
  // State name to code mapping (common US states)
  const stateMap = {
    'ALABAMA': 'AL', 'ALASKA': 'AK', 'ARIZONA': 'AZ', 'ARKANSAS': 'AR',
    'CALIFORNIA': 'CA', 'COLORADO': 'CO', 'CONNECTICUT': 'CT', 'DELAWARE': 'DE',
    'FLORIDA': 'FL', 'GEORGIA': 'GA', 'HAWAII': 'HI', 'IDAHO': 'ID',
    'ILLINOIS': 'IL', 'INDIANA': 'IN', 'IOWA': 'IA', 'KANSAS': 'KS',
    'KENTUCKY': 'KY', 'LOUISIANA': 'LA', 'MAINE': 'ME', 'MARYLAND': 'MD',
    'MASSACHUSETTS': 'MA', 'MICHIGAN': 'MI', 'MINNESOTA': 'MN', 'MISSISSIPPI': 'MS',
    'MISSOURI': 'MO', 'MONTANA': 'MT', 'NEBRASKA': 'NE', 'NEVADA': 'NV',
    'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY',
    'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', 'OHIO': 'OH', 'OKLAHOMA': 'OK',
    'OREGON': 'OR', 'PENNSYLVANIA': 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
    'SOUTH DAKOTA': 'SD', 'TENNESSEE': 'TN', 'TEXAS': 'TX', 'UTAH': 'UT',
    'VERMONT': 'VT', 'VIRGINIA': 'VA', 'WASHINGTON': 'WA', 'WEST VIRGINIA': 'WV',
    'WISCONSIN': 'WI', 'WYOMING': 'WY', 'DISTRICT OF COLUMBIA': 'DC'
  };
  
  // Check if it's a full state name
  if (stateMap[normalized]) {
    return stateMap[normalized];
  }
  
  // Return normalized (uppercase) if 2 characters
  if (normalized.length === 2) {
    return normalized;
  }
  
  // Return as-is if can't normalize
  return normalized;
}

/**
 * Normalize ZIP code to 5-digit format
 * @param {string} zip - ZIP code string
 * @returns {string} 5-digit ZIP code
 */
export function normalizeZipCode(zip) {
  if (!zip || typeof zip !== 'string') {
    return '';
  }
  
  // Remove all non-digits
  const digits = zip.replace(/\D/g, '');
  
  // Extract first 5 digits
  if (digits.length >= 5) {
    return digits.substring(0, 5);
  }
  
  // If less than 5 digits, pad with zeros (or return as-is)
  return digits.padStart(5, '0');
}

/**
 * Validate and sanitize email address
 * @param {string} email - Email address
 * @returns {string} Validated and sanitized email
 * @throws {Error} If email is invalid
 */
export function validateAndSanitizeEmail(email) {
  if (!email || typeof email !== 'string') {
    throw new Error('Email is required');
  }
  
  const trimmed = email.trim().toLowerCase();
  
  // Basic email validation regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  if (!emailRegex.test(trimmed)) {
    throw new Error(`Invalid email format: ${email}`);
  }
  
  return trimmed;
}

/**
 * Generate unique client account ID
 * Format: client_{timestamp}_{randomString}
 * @returns {string} Unique client account ID
 */
export function generateClientAccountId() {
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 10); // 8 random chars
  return `client_${timestamp}_${randomString}`;
}

/**
 * Normalize SIM type for API
 * Maps PSIM to PHYSICAL, keeps ESIM as-is
 * @param {string} simType - SIM type from cart
 * @returns {string} Normalized SIM type ("ESIM" or "PHYSICAL")
 */
export function normalizeSimType(simType) {
  if (!simType || typeof simType !== 'string') {
    return 'PHYSICAL'; // Default fallback
  }
  
  const normalized = simType.toUpperCase().trim();
  
  if (normalized === 'ESIM') {
    return 'ESIM';
  }
  
  // Map PSIM, PHYSICAL, or any other to PHYSICAL
  if (normalized === 'PSIM' || normalized === 'PHYSICAL') {
    return 'PHYSICAL';
  }
  
  // Default fallback
  return 'PHYSICAL';
}

/**
 * Normalize country code
 * Maps "US" to "USA" for API compatibility
 * @param {string} country - Country code
 * @returns {string} Normalized country code
 */
export function normalizeCountry(country) {
  if (!country || typeof country !== 'string') {
    return 'USA'; // Default
  }
  
  const normalized = country.trim().toUpperCase();
  
  // Map US to USA
  if (normalized === 'US' || normalized === 'USA') {
    return 'USA';
  }
  
  // Return as-is for other countries
  return normalized;
}

/**
 * Build addresses array for API request
 * Creates both billing and shipping addresses (can be same)
 * @param {Object} shippingAddress - Shipping address from checkout
 * @param {Object} billingAddress - Optional billing address (if different from shipping)
 * @returns {Array} Array with billing and shipping address objects
 */
export function buildAddresses(shippingAddress, billingAddress = null) {
  if (!shippingAddress) {
    throw new Error('Shipping address is required');
  }
  
  // Use billingAddress if provided, otherwise use shippingAddress for billing
  // This ensures billing and shipping can be same (as required)
  const billingSource = billingAddress || shippingAddress;
  
  // Build billing address
  const billingAddr = {
    address1: sanitizeString(billingSource.street || ''),
    address2: sanitizeString(billingSource.address2 || ''), // Use from address if provided
    city: sanitizeString(billingSource.city || ''),
    state: normalizeStateCode(billingSource.state || ''),
    zip: normalizeZipCode(billingSource.zipCode || ''),
    country: normalizeCountry(billingSource.country || 'US'),
    residential: billingSource.residential || 'true' // Default to 'true'
  };
  
  // Build shipping address
  const shippingAddr = {
    address1: sanitizeString(shippingAddress.street || ''),
    address2: sanitizeString(shippingAddress.address2 || ''), // Use from address if provided
    city: sanitizeString(shippingAddress.city || ''),
    state: normalizeStateCode(shippingAddress.state || ''),
    zip: normalizeZipCode(shippingAddress.zipCode || ''),
    country: normalizeCountry(shippingAddress.country || 'US'),
    residential: shippingAddress.residential || 'true' // Default to 'true'
  };
  
  logger.debug('Building addresses for API request', {
    hasBillingAddress: !!billingAddress,
    billingSameAsShipping: !billingAddress,
    billingAddress2: billingAddr.address2 || '(empty)',
    shippingAddress2: shippingAddr.address2 || '(empty)'
  });
  
  return [
    { ...billingAddr, type: 'billing' },
    { ...shippingAddr, type: 'shipping' }
  ];
}

/**
 * Strip data amount from plan name (e.g., "(50GB)", "50GB") while preserving capitalization
 * Example: "Unlimited Plus (50GB)" -> "Unlimited Plus"
 * @param {string} planName - Plan name that may contain data amount
 * @returns {string} Plan name without data amount
 */
function stripDataAmountFromPlanName(planName) {
  if (!planName || typeof planName !== 'string') return planName;
  
  // Remove data amounts like "(50GB)", "(50 GB)", "50GB", etc.
  // Keep original capitalization (don't convert to lowercase)
  let cleaned = planName
    .replace(/\([\d.]+[\s]*[GMK]?B\)/gi, '') // Remove (50GB), (50 GB), etc.
    .replace(/[\s]*[\d.]+[\s]*[GMK]?B/gi, '') // Remove standalone 50GB, 50 GB, etc.
    .replace(/\s+/g, ' ') // Normalize multiple spaces to single space
    .trim();
  
  return cleaned;
}

/**
 * Build lines array for API request
 * @param {Array} cartLines - Cart lines from checkout data
 * @param {Object} shippingAddress - Shipping address for firstName/lastName
 * @returns {Array} Lines array for API request
 */
export function buildLines(cartLines, shippingAddress) {
  if (!cartLines || !Array.isArray(cartLines) || cartLines.length === 0) {
    throw new Error('Cart lines are required');
  }
  
  if (!shippingAddress) {
    throw new Error('Shipping address is required');
  }
  
  return cartLines.map((line, index) => {
    // Validate line has plan
    if (!line.plan) {
      throw new Error(`Line ${index + 1} is missing a plan`);
    }
    
    // Get plan ID for purchase API
    // Purchase API REQUIRES plan name (displayName/displayNameWeb) as planId
    // Based on API docs example: planId: "By the Gig" (display name format)
    // Priority: displayName > displayNameWeb > name (normalized)
    // DO NOT use uniqueIdentifier/id/serviceCode - API expects plan name only
    // Strip data amounts like "(50GB)" from plan names - e.g., "Unlimited Plus (50GB)" -> "Unlimited Plus"
    const rawPlanId = line.plan.displayName || line.plan.displayNameWeb || line.plan.name;
    if (!rawPlanId) {
      throw new Error(`Line ${index + 1} plan is missing displayName, displayNameWeb, or name. Plan must be enriched with displayName/displayNameWeb from plans API before purchase.`);
    }
    
    // Remove data amounts like "(50GB)", "(50 GB)", "50GB", etc. but keep original capitalization
    const planId = stripDataAmountFromPlanName(rawPlanId);
    
    logger.debug('Plan ID extraction for purchase API', {
      lineIndex: index + 1,
      hasDisplayName: !!line.plan.displayName,
      displayName: line.plan.displayName,
      hasDisplayNameWeb: !!line.plan.displayNameWeb,
      displayNameWeb: line.plan.displayNameWeb,
      hasName: !!line.plan.name,
      planName: line.plan.name,
      rawPlanId,
      selectedPlanId: planId,
      note: 'Purchase API REQUIRES plan name (displayName/displayNameWeb) as planId - data amounts stripped (e.g., "Unlimited Plus (50GB)" -> "Unlimited Plus")'
    });
    
    // Validate SIM type
    const simType = line.sim?.simType;
    if (!simType) {
      throw new Error(`Line ${index + 1} is missing SIM type`);
    }
    
    // For multi-line orders, API requires unique first names
    // Primary line (index 0) uses original firstName
    // Secondary lines append line number to make firstName unique
    const baseFirstName = sanitizeString(shippingAddress.firstName || '');
    const firstName = index === 0 
      ? baseFirstName 
      : `${baseFirstName} ${index + 1}`.trim(); // Append line number for non-primary lines
    
    return {
      firstName: firstName,
      lastName: sanitizeString(shippingAddress.lastName || ''),
      planId: planId,
      isPrimary: index === 0, // First line is primary
      simType: normalizeSimType(simType)
    };
  });
}

/**
 * Transform checkout data to purchase API request format
 * @param {Object} checkoutData - Checkout data from get_checkout_data tool
 * @param {Object} options - Transformation options
 * @param {string} options.clientAccountId - Client account ID (if reusing from quote)
 * @param {number} options.collectionAmount - Payment collection amount (0 for quote, from quote response for purchase)
 * @param {string} options.redirectUrl - Redirect URL for payment
 * @param {string} options.shipmentType - Shipment type (default: "usps_first_class_mail")
 * @param {string} options.agentUniqueId - Agent unique ID (default from env)
 * @returns {Object} Purchase API request object
 */
export function transformCheckoutDataToPurchaseRequest(checkoutData, options = {}) {
  if (!checkoutData) {
    throw new Error('Checkout data is required');
  }
  
  const { shippingAddress, billingAddress, cart } = checkoutData;
  
  if (!shippingAddress) {
    throw new Error('Shipping address is required in checkout data');
  }
  
  if (!cart || !cart.lines || !Array.isArray(cart.lines) || cart.lines.length === 0) {
    throw new Error('Cart with lines is required in checkout data');
  }
  
  // Use billingAddress if provided, otherwise use shippingAddress (they should be same)
  // This ensures consistency between cart checkout data and API request
  const effectiveBillingAddress = billingAddress || shippingAddress;
  
  // Extract phone components from shipping address (used for billing phone)
  const countryCode = extractCountryCode(shippingAddress.phone);
  const phoneNumber = extractPhoneNumber(shippingAddress.phone);
  
  // Validate email
  const email = validateAndSanitizeEmail(shippingAddress.email);
  
  // Build addresses array (billing and shipping, can be same)
  const addresses = buildAddresses(shippingAddress, effectiveBillingAddress);
  
  // Build lines array
  const lines = buildLines(cart.lines, shippingAddress);
  
  // Log address mapping for debugging
  logger.debug('Address transformation for API request', {
    hasBillingAddress: !!billingAddress,
    billingSameAsShipping: !billingAddress,
    shippingStreet: shippingAddress.street?.substring(0, 30) + '...',
    billingStreet: effectiveBillingAddress.street?.substring(0, 30) + '...',
    addressesCount: addresses.length,
    billingType: addresses[0]?.type,
    shippingType: addresses[1]?.type
  });
  
  // Generate or reuse client account ID
  const clientAccountId = options.clientAccountId || generateClientAccountId();
  
  // Determine shipment type based on SIM types
  // API requires shipmentType to be null when all lines are ESIM (no physical shipping)
  const allLinesAreESIM = lines.every(line => line.simType === 'ESIM');
  const shipmentType = allLinesAreESIM 
    ? null 
    : (options.shipmentType || DEFAULT_CONFIG.SHIPMENT_TYPE);
  
  logger.debug('Shipment type determination', {
    allLinesAreESIM,
    shipmentType,
    lineSimTypes: lines.map(l => l.simType)
  });
  
  // Get agent unique ID from options or env or default
  const agentUniqueId = options.agentUniqueId || DEFAULT_CONFIG.AGENT_ID;
  
  // Get redirect URL from options or env or default
  const redirectUrl = options.redirectUrl || DEFAULT_CONFIG.REDIRECT_URL;
  
  // Build request
  const request = {
    accountInfo: {
      firstName: sanitizeString(shippingAddress.firstName),
      lastName: sanitizeString(shippingAddress.lastName),
      billingPhoneCountryCode: countryCode,
      billingPhoneNumber: phoneNumber,
      addresses: addresses,
      email: email,
      shipmentType: shipmentType,
      clientAccountId: clientAccountId,
      payment: {
        paymentType: options.paymentType || DEFAULT_CONFIG.PAYMENT_TYPE,
        collection: options.collectionAmount || 0 // 0 for quote, set from quote response for purchase
      }
    },
    lines: lines,
    meta: {
      acquisitionSrc: options.acquisitionSrc || DEFAULT_CONFIG.ACQUISITION_SOURCE,
      agentUniqueId: agentUniqueId
    },
    redirectUrl: redirectUrl
  };
  
  // Log full request structure (sanitized for security)
  logger.debug('Transformed checkout data to purchase request', {
    clientAccountId,
    lineCount: lines.length,
    hasCollectionAmount: !!options.collectionAmount,
    collectionAmount: options.collectionAmount || 0,
    addressesCount: addresses.length,
    billingAddress: {
      street: addresses[0]?.address1?.substring(0, 30) + '...',
      city: addresses[0]?.city,
      state: addresses[0]?.state,
      zip: addresses[0]?.zip
    },
    shippingAddress: {
      street: addresses[1]?.address1?.substring(0, 30) + '...',
      city: addresses[1]?.city,
      state: addresses[1]?.state,
      zip: addresses[1]?.zip
    },
    lines: lines.map(l => ({
      planId: l.planId,
      simType: l.simType,
      isPrimary: l.isPrimary
    }))
  });
  
  return request;
}

/**
 * Extract clientAccountId from purchase API response
 * Used to preserve clientAccountId between quote and purchase calls
 * @param {Object} response - API response object
 * @returns {string|null} Client account ID if found, null otherwise
 */
export function extractClientAccountIdFromResponse(response) {
  if (!response) {
    return null;
  }
  
  // Check in response.data.clientAccountId (from purchase response)
  if (response.data && response.data.clientAccountId) {
    return response.data.clientAccountId;
  }
  
  // Check in response.clientAccountId (direct)
  if (response.clientAccountId) {
    return response.clientAccountId;
  }
  
  // Not found in response (quote doesn't return it, only purchase does)
  return null;
}

/**
 * Extract transaction ID from purchase API response
 * @param {Object} response - Purchase API response
 * @returns {string|null} Transaction ID if found, null otherwise
 */
export function extractTransactionIdFromResponse(response) {
  if (!response) {
    return null;
  }
  
  // Check in response.data.transactionId (from purchase response)
  if (response.data && response.data.transactionId) {
    return response.data.transactionId;
  }
  
  // Check in response.transactionId (direct)
  if (response.transactionId) {
    return response.transactionId;
  }
  
  return null;
}
