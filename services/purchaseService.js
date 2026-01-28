import { callReachAPI } from './apiClient.js';
import { logger } from '../utils/logger.js';
import {
  transformCheckoutDataToPurchaseRequest,
  extractClientAccountIdFromResponse,
  extractTransactionIdFromResponse,
  generateClientAccountId
} from '../utils/purchaseHelpers.js';
import {
  PAYMENT_STATUS,
  ORDER_STATUS,
  FLOW_STATE,
  LINK_TYPE,
  API_STATUS,
  DEFAULT_CONFIG
} from '../utils/purchaseConstants.js';
import { getTenantConfig } from '../config/tenantConfig.js';
import { getPlans } from './plansService.js';
import { ensureTokenOnToolCall } from './tokenRefreshCron.js';
import { getAuthToken, getAuthTokensMap } from './authService.js';

/**
 * Debug helper: Log API response structure for payment URL debugging
 * @param {Object} response - API response object
 * @param {string} context - Context string for logging
 * @returns {void}
 */
function logResponseStructureForDebugging(response, context = '') {
  if (!response) {
    logger.debug('Response structure debug: response is null/undefined', { context });
    return;
  }
  
  const structure = {
    hasData: !!response.data,
    dataKeys: response.data ? Object.keys(response.data) : [],
    hasLink: !!response.data?.link,
    linkKeys: response.data?.link ? Object.keys(response.data.link) : [],
    linkType: response.data?.link?.type,
    hasLinkUrl: !!response.data?.link?.url,
    hasPaymentUrl: !!response.data?.paymentUrl,
    hasUrl: !!response.data?.url,
    topLevelKeys: Object.keys(response),
    paymentStatus: response.data?.paymentStatus,
    status: response.data?.status
  };
  
  logger.debug('Response structure for payment URL debugging', {
    context,
    structure,
    sampleData: {
      linkUrl: response.data?.link?.url ? response.data.link.url.substring(0, 50) + '...' : null,
      paymentUrl: response.data?.paymentUrl ? response.data.paymentUrl.substring(0, 50) + '...' : null,
      url: response.data?.url ? response.data.url.substring(0, 50) + '...' : null
    }
  });
}

/**
 * Purchase Service
 * Handles purchase flow: Quote → Purchase → Status polling
 */

/**
 * Enrich cart lines with serviceCode by looking up plans
 * This is needed because older carts may not have serviceCode stored
 * @param {Object} checkoutData - Checkout data with cart
 * @param {string} tenant - Tenant name
 * @returns {Promise<Object>} Enriched checkout data
 */
async function enrichCartWithServiceCodes(checkoutData, tenant = DEFAULT_CONFIG.TENANT) {
  if (!checkoutData?.cart?.lines) {
    return checkoutData;
  }
  
  // Always enrich to ensure we have the correct plan name format for Purchase API
  // Even if displayName exists, we want to verify it's the correct format from the API
  const needsEnrichment = checkoutData.cart.lines.some(
    line => line.plan && (!line.plan.displayName && !line.plan.displayNameWeb)
  );
  
  if (!needsEnrichment) {
    logger.debug('All cart lines have displayName/displayNameWeb, but will still enrich to verify format');
    // Continue to enrichment to ensure we have the latest plan data
  }
  
  logger.info('Enriching cart lines with displayName/displayNameWeb from plans API...', {
    sessionId: checkoutData.sessionId,
    lineCount: checkoutData.cart.lines.length,
    reason: 'Purchase API requires exact plan name format from API'
  });
  
  try {
    // Fetch all plans to look up serviceCode
    const plans = await getPlans(null, tenant);
    const planMap = new Map();
    
    // Build a map of plan id/uniqueIdentifier -> plan object
    plans.forEach(plan => {
      const id = plan.id || plan.uniqueIdentifier;
      if (id) {
        planMap.set(id, plan);
        // Log first plan structure for debugging
        if (planMap.size === 1) {
          logger.debug('Sample plan structure from getPlans', {
            id: plan.id,
            uniqueIdentifier: plan.uniqueIdentifier,
            serviceCode: plan.serviceCode,
            hasServiceCode: !!plan.serviceCode,
            planKeys: Object.keys(plan).slice(0, 15),
            originalPlanKeys: plan.uniqueIdentifier ? Object.keys(plan).filter(k => !['id', 'name', 'price'].includes(k)) : []
          });
        }
      }
      if (plan.uniqueIdentifier && plan.uniqueIdentifier !== id) {
        planMap.set(plan.uniqueIdentifier, plan);
      }
    });
    
    logger.debug('Plan map built', {
      mapSize: planMap.size,
      sampleKeys: Array.from(planMap.keys()).slice(0, 3),
      samplePlan: planMap.size > 0 ? {
        id: Array.from(planMap.values())[0].id,
        uniqueIdentifier: Array.from(planMap.values())[0].uniqueIdentifier,
        serviceCode: Array.from(planMap.values())[0].serviceCode
      } : null
    });
    
    // Enrich cart lines with displayName/displayNameWeb and serviceCode
    // Always enrich to ensure we have the correct plan name format from the API
    const enrichedLines = checkoutData.cart.lines.map((line, index) => {
      if (!line.plan) {
        return line; // No plan, skip
      }
      
      // Always look up the plan to get the latest displayName/displayNameWeb from API
      // This ensures we use the exact format the Purchase API expects
      
      const planId = line.plan.id || line.plan.uniqueIdentifier;
      const plan = planMap.get(planId);
      
      if (plan) {
        // Get original displayName/displayNameWeb for Purchase API
        // Purchase API needs the original plan name format, not the transformed/stripped name
        const originalPlanName = plan.displayName || plan.displayNameWeb || plan.name;
        
        // Log plan structure for debugging
        logger.debug('Plan found in map', {
          lineIndex: index + 1,
          planId,
          hasServiceCode: !!plan.serviceCode,
          serviceCode: plan.serviceCode,
          hasDisplayName: !!plan.displayName,
          displayName: plan.displayName,
          hasDisplayNameWeb: !!plan.displayNameWeb,
          displayNameWeb: plan.displayNameWeb,
          currentName: line.plan.name,
          originalPlanName,
          planKeys: Object.keys(plan).slice(0, 10),
          planStructure: {
            id: plan.id,
            uniqueIdentifier: plan.uniqueIdentifier,
            serviceCode: plan.serviceCode,
            displayName: plan.displayName,
            displayNameWeb: plan.displayNameWeb,
            name: plan.name,
            planType: plan.planType
          }
        });
        
        // Enrich with original plan name and serviceCode if available
        const enrichedPlan = {
          ...line.plan,
          // Store original displayName/displayNameWeb for Purchase API
          displayName: plan.displayName || line.plan.displayName,
          displayNameWeb: plan.displayNameWeb || line.plan.displayNameWeb,
          // Use original name for Purchase API (fallback to current name if not available)
          name: originalPlanName || line.plan.name,
          serviceCode: plan.serviceCode || line.plan.serviceCode,
          planType: plan.planType || line.plan.planType,
          planCharging: plan.planCharging || line.plan.planCharging
        };
        
        logger.debug('Enriched line with plan details', {
          lineIndex: index + 1,
          planId,
          originalPlanName,
          serviceCode: enrichedPlan.serviceCode,
          displayName: enrichedPlan.displayName,
          displayNameWeb: enrichedPlan.displayNameWeb
        });
        
        return {
          ...line,
          plan: enrichedPlan
        };
      } else {
        logger.warn('Could not find plan in map', {
          lineIndex: index + 1,
          planId,
          availablePlanIds: Array.from(planMap.keys()).slice(0, 5),
          mapSize: planMap.size
        });
        return line; // Return unchanged if not found
      }
    });
    
    const enrichedCount = enrichedLines.filter((l, i) => {
      const original = checkoutData.cart.lines[i]?.plan;
      const enriched = l.plan;
      return enriched && (
        (enriched.displayName && enriched.displayName !== original?.displayName) ||
        (enriched.displayNameWeb && enriched.displayNameWeb !== original?.displayNameWeb) ||
        (enriched.serviceCode && enriched.serviceCode !== original?.serviceCode)
      );
    }).length;
    
    logger.info('✅ Cart lines enriched with plan details', {
      sessionId: checkoutData.sessionId,
      enrichedCount,
      enrichedLines: enrichedLines.map((l, i) => ({
        lineIndex: i + 1,
        displayName: l.plan?.displayName,
        displayNameWeb: l.plan?.displayNameWeb,
        name: l.plan?.name,
        serviceCode: l.plan?.serviceCode
      }))
    });
    
    return {
      ...checkoutData,
      cart: {
        ...checkoutData.cart,
        lines: enrichedLines
      }
    };
  } catch (error) {
    logger.error('Failed to enrich cart with serviceCode', {
      sessionId: checkoutData.sessionId,
      error: error.message
    });
    // Return original checkoutData if enrichment fails
    return checkoutData;
  }
}

/**
 * Custom error classes for purchase flow
 */
export class PurchaseValidationError extends Error {
  constructor(message, validationErrors = []) {
    super(message);
    this.name = 'PurchaseValidationError';
    this.validationErrors = validationErrors;
    this.errorType = 'VALIDATION_ERROR';
  }
}

export class PurchaseQuoteError extends Error {
  constructor(message, statusCode, responseBody) {
    super(message);
    this.name = 'PurchaseQuoteError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    this.errorType = 'QUOTE_ERROR';
  }
}

export class PurchaseProductError extends Error {
  constructor(message, transactionId, statusCode, responseBody) {
    super(message);
    this.name = 'PurchaseProductError';
    this.transactionId = transactionId;
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    this.errorType = 'PURCHASE_ERROR';
  }
}

export class PurchaseStatusError extends Error {
  constructor(message, transactionId, statusCode, responseBody) {
    super(message);
    this.name = 'PurchaseStatusError';
    this.transactionId = transactionId;
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    this.errorType = 'STATUS_ERROR';
  }
}

export class PurchaseFlowError extends Error {
  constructor(message, state, transactionId, errorType) {
    super(message);
    this.name = 'PurchaseFlowError';
    this.state = state;
    this.transactionId = transactionId;
    this.errorType = errorType;
  }
}

/**
 * Validate purchase data before API calls
 * @param {Object} checkoutData - Checkout data to validate
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export function validatePurchaseData(checkoutData) {
  const errors = [];
  
  if (!checkoutData) {
    errors.push('Checkout data is required');
    return { valid: false, errors };
  }
  
  // Validate shipping address
  if (!checkoutData.shippingAddress) {
    errors.push('Shipping address is required');
  } else {
    const addr = checkoutData.shippingAddress;
    const requiredFields = ['firstName', 'lastName', 'street', 'city', 'state', 'zipCode', 'phone', 'email'];
    requiredFields.forEach(field => {
      if (!addr[field] || addr[field].trim() === '') {
        errors.push(`Shipping address missing required field: ${field}`);
      }
    });
  }
  
  // Validate cart
  if (!checkoutData.cart) {
    errors.push('Cart is required');
  } else if (!checkoutData.cart.lines || !Array.isArray(checkoutData.cart.lines) || checkoutData.cart.lines.length === 0) {
    errors.push('Cart must have at least one line');
  } else {
    // Validate each line
    checkoutData.cart.lines.forEach((line, index) => {
      if (!line.plan) {
        errors.push(`Line ${index + 1} is missing a plan`);
      } else if (!line.plan.id && !line.plan.uniqueIdentifier && !line.plan.name) {
        errors.push(`Line ${index + 1} plan is missing ID, uniqueIdentifier, or name`);
      }
      
      if (!line.sim || !line.sim.simType) {
        errors.push(`Line ${index + 1} is missing SIM type`);
      }
      
      // Check for devices (should not exist for plan-only purchase)
      if (line.device) {
        errors.push(`Line ${index + 1} has a device - plan-only purchase does not allow devices`);
      }
    });
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Call purchase quote API
 * @param {Object} checkoutData - Checkout data from get_checkout_data
 * @param {string} tenant - Tenant name (default: "reach")
 * @param {Object} options - Options for transformation
 * @returns {Promise<Object>} Quote response with clientAccountId
 */
export async function purchaseQuote(checkoutData, tenant = DEFAULT_CONFIG.TENANT, options = {}) {
  const startTime = Date.now();
  try {
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('STEP 5: CALLING QUOTE API');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('Purchase quote API call initiated', {
      tenant,
      timestamp: new Date().toISOString(),
      lineCount: checkoutData.cart?.lines?.length || 0,
      hasShippingAddress: !!checkoutData.shippingAddress,
      hasBillingAddress: !!checkoutData.billingAddress,
      hasCart: !!checkoutData.cart,
      cartLines: checkoutData.cart?.lines?.length || 0
    });
    
    // Get tenant config for endpoints
    const tenantCfg = getTenantConfig(tenant);
    const quoteEndpoint = tenantCfg.purchaseEndpoints?.quote || '/apisvc/v0/product/quote';
    
    logger.info('Tenant configuration loaded', {
      tenant,
      quoteEndpoint,
      apiBaseUrl: tenantCfg.apiBaseUrl
    });
    
    // Ensure authentication token is valid before making purchase API call
    logger.info('Verifying authentication before purchase quote API call...', {
      tenant,
      endpoint: quoteEndpoint
    });
    
    try {
      // Explicitly ensure token is valid and refresh if needed
      await ensureTokenOnToolCall(tenant);
      const tokensMap = getAuthTokensMap();
      const cached = tokensMap?.get(tenant);
      const authToken = cached?.token;
      
      if (!authToken) {
        logger.warn('No cached auth token found, fetching new token...', { tenant });
        await getAuthToken(tenant, true); // Force refresh if no token
      } else {
        logger.info('✅ Authentication token verified and valid', {
          tenant,
          hasToken: !!authToken,
          tokenPrefix: authToken ? authToken.substring(0, 20) : 'none'
        });
      }
    } catch (authError) {
      logger.error('❌ Authentication failed before purchase quote API call', {
        tenant,
        error: authError.message,
        errorType: authError.errorType || authError.name
      });
      throw new PurchaseQuoteError(
        `Authentication failed: ${authError.message}`,
        401,
        { error: 'Authentication required for purchase API' }
      );
    }
    
    // Enrich cart with displayName/displayNameWeb (required for purchase API)
    // This ensures plans have the correct plan name format for planId field
    logger.info('Enriching cart with plan displayName/displayNameWeb for purchase API...', {
      sessionId: checkoutData.sessionId,
      tenant
    });
    const enrichedCheckoutData = await enrichCartWithServiceCodes(checkoutData, tenant);
    
    // Transform checkout data to API request format
    // For quote, collection amount is 0
    logger.info('Transforming checkout data to API request format...', {
      sessionId: enrichedCheckoutData.sessionId
    });
    
    const requestBody = transformCheckoutDataToPurchaseRequest(enrichedCheckoutData, {
      ...options,
      collectionAmount: 0 // Quote always has 0 collection
    });
    
    logger.info('✅ Checkout data transformed successfully', {
      clientAccountId: requestBody.accountInfo.clientAccountId,
      lineCount: requestBody.lines.length,
      addressesCount: requestBody.accountInfo.addresses.length
    });
    
    // Log detailed request body structure for verification
    logger.info('Purchase quote API request body (FULL STRUCTURE)', {
      endpoint: quoteEndpoint,
      clientAccountId: requestBody.accountInfo.clientAccountId,
      lineCount: requestBody.lines.length,
      collectionAmount: requestBody.accountInfo.payment.collection,
      accountInfo: {
        firstName: requestBody.accountInfo.firstName,
        lastName: requestBody.accountInfo.lastName,
        email: requestBody.accountInfo.email,
        billingPhoneCountryCode: requestBody.accountInfo.billingPhoneCountryCode,
        billingPhoneNumber: requestBody.accountInfo.billingPhoneNumber,
        addressesCount: requestBody.accountInfo.addresses.length,
        billingAddress: {
          type: requestBody.accountInfo.addresses[0]?.type,
          address1: requestBody.accountInfo.addresses[0]?.address1?.substring(0, 30) + '...',
          city: requestBody.accountInfo.addresses[0]?.city,
          state: requestBody.accountInfo.addresses[0]?.state,
          zip: requestBody.accountInfo.addresses[0]?.zip,
          country: requestBody.accountInfo.addresses[0]?.country
        },
        shippingAddress: {
          type: requestBody.accountInfo.addresses[1]?.type,
          address1: requestBody.accountInfo.addresses[1]?.address1?.substring(0, 30) + '...',
          city: requestBody.accountInfo.addresses[1]?.city,
          state: requestBody.accountInfo.addresses[1]?.state,
          zip: requestBody.accountInfo.addresses[1]?.zip,
          country: requestBody.accountInfo.addresses[1]?.country
        },
        shipmentType: requestBody.accountInfo.shipmentType,
        paymentType: requestBody.accountInfo.payment.paymentType,
        collection: requestBody.accountInfo.payment.collection
      },
      lines: requestBody.lines.map(l => ({
        firstName: l.firstName,
        lastName: l.lastName,
        planId: l.planId,
        isPrimary: l.isPrimary,
        simType: l.simType
      })),
      meta: requestBody.meta,
      redirectUrl: requestBody.redirectUrl?.substring(0, 50) + '...'
    });
    
    logger.info('Making HTTP POST request to Quote API...', {
      endpoint: quoteEndpoint,
      method: 'POST',
      requestBodySize: JSON.stringify(requestBody).length,
      timestamp: new Date().toISOString()
    });
    
    // Call quote API
    const apiCallStartTime = Date.now();
    const response = await callReachAPI(
      quoteEndpoint,
      {
        method: 'POST',
        body: JSON.stringify(requestBody)
      },
      tenant
    );
    const apiCallDuration = Date.now() - apiCallStartTime;
    
    logger.info('✅ Quote API response received', {
      duration: `${apiCallDuration}ms`,
      hasResponse: !!response,
      responseStatus: response?.status,
      responseMessage: response?.message,
      hasData: !!response?.data,
      dataKeys: response?.data ? Object.keys(response.data) : []
    });

    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('QUOTE API FULL RESPONSE');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('Complete Quote API response', {
      tenant,
      endpoint: quoteEndpoint,
      duration: `${apiCallDuration}ms`,
      timestamp: new Date().toISOString(),
      fullResponse: JSON.stringify(response, null, 2),
      responseStructure: {
        status: response?.status,
        message: response?.message,
        data: response?.data ? {
          oneTimeCharge: response.data.oneTimeCharge,
          estimatedMonthlyCost: response.data.estimatedMonthlyCost,
          totalTax: response.data.totalTax,
          total: response.data.total,
          allKeys: Object.keys(response.data),
          fullData: response.data
        } : null
      }
    });
    logger.info('═══════════════════════════════════════════════════════════');
    
    // Validate response
    // Check if response has a status field - only validate if it exists
    // Some API responses may not have a status field and are successful by default
    if (!response) {
      logger.error('❌ Quote API returned empty response', {
        endpoint: quoteEndpoint,
        tenant
      });
      throw new PurchaseQuoteError(
        'Quote API returned empty response',
        null,
        null
      );
    }
    
    if (response.status !== undefined && response.status !== API_STATUS.SUCCESS) {
      logger.error('❌ Purchase quote API returned non-SUCCESS status', {
        status: response.status,
        message: response.message,
        data: response.data,
        tenant,
        fullResponse: JSON.stringify(response).substring(0, 1000)
      });
      throw new PurchaseQuoteError(
        response?.message || 'Quote API returned non-success status',
        null,
        response
      );
    }
    
    // Extract clientAccountId from request (we generated it, not from response)
    const clientAccountId = requestBody.accountInfo.clientAccountId;
    
    logger.info('✅ Purchase quote API call successful', {
      tenant,
      clientAccountId,
      totalOneTimeCost: response.data?.oneTimeCharge?.totalOneTimeCost,
      total: response.data?.total,
      estimatedMonthlyCost: response.data?.estimatedMonthlyCost,
      oneTimeCharge: response.data?.oneTimeCharge,
      totalTax: response.data?.totalTax,
      responseData: {
        oneTimeCharge: response.data?.oneTimeCharge,
        estimatedMonthlyCost: response.data?.estimatedMonthlyCost,
        totalTax: response.data?.totalTax,
        total: response.data?.total
      }
    });
    
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info(`QUOTE API COMPLETED (Duration: ${Date.now() - startTime}ms)`);
    logger.info('═══════════════════════════════════════════════════════════');
    
    return {
      success: true,
      data: response.data,
      clientAccountId: clientAccountId, // Return the generated clientAccountId
      message: response.message || 'Quote is Prepared'
    };
  } catch (error) {
    logger.error('Purchase quote API call failed', {
      tenant,
      error: error.message,
      errorType: error.errorType || error.name,
      statusCode: error.statusCode,
      responseBody: error.responseBody ? (typeof error.responseBody === 'string' ? error.responseBody.substring(0, 500) : JSON.stringify(error.responseBody).substring(0, 500)) : undefined
    });
    
    if (error instanceof PurchaseQuoteError) {
      throw error;
    }
    
    // If it's an APIError from callReachAPI, extract more details
    const statusCode = error.statusCode || null;
    const responseBody = error.responseBody || error;
    
    throw new PurchaseQuoteError(
      `Failed to get purchase quote: ${error.message}`,
      statusCode,
      responseBody
    );
  }
}

/**
 * Call purchase product API (initiate purchase)
 * @param {Object} checkoutData - Checkout data from get_checkout_data
 * @param {Object} quoteResponse - Response from purchaseQuote
 * @param {string} tenant - Tenant name (default: "reach")
 * @param {Object} options - Options for transformation
 * @returns {Promise<Object>} Purchase response with transactionId and clientAccountId
 */
export async function purchaseProduct(checkoutData, quoteResponse, tenant = DEFAULT_CONFIG.TENANT, options = {}) {
  const startTime = Date.now();
  try {
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('STEP 6: CALLING PURCHASE PRODUCT API');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('Purchase product API call initiated', {
      tenant,
      timestamp: new Date().toISOString(),
      clientAccountId: quoteResponse.clientAccountId,
      collectionAmount: quoteResponse.data?.oneTimeCharge?.totalOneTimeCost,
      quoteResponseData: {
        oneTimeCharge: quoteResponse.data?.oneTimeCharge,
        estimatedMonthlyCost: quoteResponse.data?.estimatedMonthlyCost,
        totalTax: quoteResponse.data?.totalTax,
        total: quoteResponse.data?.total
      }
    });
    
    // Get tenant config for endpoints
    const tenantCfg = getTenantConfig(tenant);
    const purchaseEndpoint = tenantCfg.purchaseEndpoints?.purchase || '/apisvc/v0/product';
    
    logger.info('Tenant configuration loaded for purchase', {
      tenant,
      purchaseEndpoint,
      apiBaseUrl: tenantCfg.apiBaseUrl
    });
    
    // Ensure authentication token is valid before making purchase API call
    logger.info('Verifying authentication before purchase product API call...', {
      tenant,
      endpoint: purchaseEndpoint
    });
    
    try {
      // Explicitly ensure token is valid and refresh if needed
      await ensureTokenOnToolCall(tenant);
      const tokensMap = getAuthTokensMap();
      const cached = tokensMap?.get(tenant);
      const authToken = cached?.token;
      
      if (!authToken) {
        logger.warn('No cached auth token found, fetching new token...', { tenant });
        await getAuthToken(tenant, true); // Force refresh if no token
      } else {
        logger.info('✅ Authentication token verified and valid', {
          tenant,
          hasToken: !!authToken,
          tokenPrefix: authToken ? authToken.substring(0, 20) : 'none'
        });
      }
    } catch (authError) {
      logger.error('❌ Authentication failed before purchase product API call', {
        tenant,
        error: authError.message,
        errorType: authError.errorType || authError.name
      });
      throw new PurchaseProductError(
        `Authentication failed: ${authError.message}`,
        401,
        null,
        null,
        { error: 'Authentication required for purchase API' }
      );
    }
    
    // Validate quote response has required data
    if (!quoteResponse.data || !quoteResponse.data.oneTimeCharge) {
      logger.error('❌ Quote response missing oneTimeCharge data', {
        hasData: !!quoteResponse.data,
        hasOneTimeCharge: !!quoteResponse.data?.oneTimeCharge,
        quoteResponseKeys: quoteResponse.data ? Object.keys(quoteResponse.data) : [],
        fullQuoteResponse: JSON.stringify(quoteResponse).substring(0, 1000)
      });
      throw new PurchaseProductError(
        'Quote response missing oneTimeCharge data',
        null,
        null,
        quoteResponse
      );
    }
    
    const collectionAmount = quoteResponse.data.oneTimeCharge.totalOneTimeCost;
    
    logger.info('Collection amount extracted from quote', {
      collectionAmount,
      oneTimeCharge: quoteResponse.data.oneTimeCharge
    });
    
    // Enrich cart with serviceCode if missing (for older carts)
    const enrichedCheckoutData = await enrichCartWithServiceCodes(checkoutData, tenant);
    
    // Transform checkout data to API request format
    // For purchase, use collection amount from quote response
    // Reuse clientAccountId from quote
    logger.info('Transforming checkout data for purchase API...', {
      sessionId: enrichedCheckoutData.sessionId,
      reusingClientAccountId: quoteResponse.clientAccountId
    });
    
    const requestBody = transformCheckoutDataToPurchaseRequest(enrichedCheckoutData, {
      ...options,
      clientAccountId: quoteResponse.clientAccountId, // Reuse from quote
      collectionAmount: collectionAmount // Set from quote response
    });
    
    logger.info('✅ Checkout data transformed for purchase', {
      clientAccountId: requestBody.accountInfo.clientAccountId,
      collectionAmount: requestBody.accountInfo.payment.collection,
      lineCount: requestBody.lines.length
    });
    
    // Log detailed request body structure for verification
    logger.info('Purchase product API request body (FULL STRUCTURE)', {
      endpoint: purchaseEndpoint,
      clientAccountId: requestBody.accountInfo.clientAccountId,
      reusedClientAccountId: requestBody.accountInfo.clientAccountId === quoteResponse.clientAccountId,
      lineCount: requestBody.lines.length,
      collectionAmount: requestBody.accountInfo.payment.collection,
      collectionFromQuote: collectionAmount,
      accountInfo: {
        firstName: requestBody.accountInfo.firstName,
        lastName: requestBody.accountInfo.lastName,
        email: requestBody.accountInfo.email,
        billingPhoneCountryCode: requestBody.accountInfo.billingPhoneCountryCode,
        billingPhoneNumber: requestBody.accountInfo.billingPhoneNumber,
        addressesCount: requestBody.accountInfo.addresses.length,
        billingAddress: {
          type: requestBody.accountInfo.addresses[0]?.type,
          address1: requestBody.accountInfo.addresses[0]?.address1?.substring(0, 30) + '...',
          city: requestBody.accountInfo.addresses[0]?.city,
          state: requestBody.accountInfo.addresses[0]?.state,
          zip: requestBody.accountInfo.addresses[0]?.zip,
          country: requestBody.accountInfo.addresses[0]?.country
        },
        shippingAddress: {
          type: requestBody.accountInfo.addresses[1]?.type,
          address1: requestBody.accountInfo.addresses[1]?.address1?.substring(0, 30) + '...',
          city: requestBody.accountInfo.addresses[1]?.city,
          state: requestBody.accountInfo.addresses[1]?.state,
          zip: requestBody.accountInfo.addresses[1]?.zip,
          country: requestBody.accountInfo.addresses[1]?.country
        },
        shipmentType: requestBody.accountInfo.shipmentType,
        paymentType: requestBody.accountInfo.payment.paymentType,
        collection: requestBody.accountInfo.payment.collection
      },
      lines: requestBody.lines.map(l => ({
        firstName: l.firstName,
        lastName: l.lastName,
        planId: l.planId,
        isPrimary: l.isPrimary,
        simType: l.simType
      })),
      meta: requestBody.meta,
      redirectUrl: requestBody.redirectUrl?.substring(0, 50) + '...'
    });
    
    logger.info('Making HTTP POST request to Purchase Product API...', {
      endpoint: purchaseEndpoint,
      method: 'POST',
      requestBodySize: JSON.stringify(requestBody).length,
      timestamp: new Date().toISOString()
    });
    
    // Call purchase API (different endpoint from quote)
    const apiCallStartTime = Date.now();
    const response = await callReachAPI(
      purchaseEndpoint,
      {
        method: 'POST',
        body: JSON.stringify(requestBody)
      },
      tenant
    );
    const apiCallDuration = Date.now() - apiCallStartTime;
    
    logger.info('✅ Purchase Product API response received', {
      duration: `${apiCallDuration}ms`,
      hasResponse: !!response,
      responseStatus: response?.status,
      responseMessage: response?.message,
      hasData: !!response?.data,
      dataKeys: response?.data ? Object.keys(response.data) : []
    });

    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('PURCHASE PRODUCT API FULL RESPONSE');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('Complete Purchase Product API response', {
      tenant,
      endpoint: purchaseEndpoint,
      duration: `${apiCallDuration}ms`,
      timestamp: new Date().toISOString(),
      fullResponse: JSON.stringify(response, null, 2),
      responseStructure: {
        status: response?.status,
        message: response?.message,
        data: response?.data ? {
          transactionId: response.data.transactionId,
          clientAccountId: response.data.clientAccountId,
          allKeys: Object.keys(response.data),
          fullData: response.data
        } : null
      }
    });
    logger.info('═══════════════════════════════════════════════════════════');
    
    // Validate response
    // Check if response has a status field - only validate if it exists
    if (!response) {
      logger.error('❌ Purchase API returned empty response', {
        endpoint: purchaseEndpoint,
        tenant
      });
      throw new PurchaseProductError(
        'Purchase API returned empty response',
        null,
        null,
        null
      );
    }
    
    if (response.status !== undefined && response.status !== API_STATUS.SUCCESS) {
      const transactionId = extractTransactionIdFromResponse(response);
      logger.error('❌ Purchase product API returned non-SUCCESS status', {
        status: response.status,
        message: response.message,
        transactionId,
        data: response.data,
        tenant,
        fullResponse: JSON.stringify(response).substring(0, 1000)
      });
      throw new PurchaseProductError(
        response?.message || 'Purchase API returned non-success status',
        transactionId,
        null,
        response
      );
    }
    
    // Extract transaction ID and clientAccountId from response
    const transactionId = extractTransactionIdFromResponse(response);
    const clientAccountId = extractClientAccountIdFromResponse(response) || requestBody.accountInfo.clientAccountId;
    
    logger.info('Extracted transaction details from response', {
      transactionId,
      clientAccountId,
      responseData: response.data
    });
    
    if (!transactionId) {
      logger.error('❌ Purchase response missing transactionId', {
        responseData: response.data,
        responseKeys: response.data ? Object.keys(response.data) : [],
        fullResponse: JSON.stringify(response).substring(0, 1000)
      });
      throw new PurchaseProductError(
        'Purchase response missing transactionId',
        null,
        null,
        response
      );
    }
    
    logger.info('✅ Purchase product API call successful', {
      tenant,
      transactionId,
      clientAccountId,
      responseData: {
        transactionId: response.data?.transactionId,
        clientAccountId: response.data?.clientAccountId,
        message: response.message
      }
    });
    
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info(`PURCHASE PRODUCT API COMPLETED (Duration: ${Date.now() - startTime}ms)`);
    logger.info(`Transaction ID: ${transactionId}`);
    logger.info('═══════════════════════════════════════════════════════════');
    
    return {
      success: true,
      transactionId: transactionId,
      clientAccountId: clientAccountId,
      data: response.data,
      message: response.message || 'Order is in Progress'
    };
  } catch (error) {
    logger.error('Purchase product API call failed', {
      tenant,
      error: error.message,
      errorType: error.errorType || error.name,
      statusCode: error.statusCode,
      transactionId: error.transactionId,
      responseBody: error.responseBody ? (typeof error.responseBody === 'string' ? error.responseBody.substring(0, 500) : JSON.stringify(error.responseBody).substring(0, 500)) : undefined
    });
    
    if (error instanceof PurchaseProductError) {
      throw error;
    }
    
    // If it's an APIError from callReachAPI, extract more details
    const statusCode = error.statusCode || null;
    const responseBody = error.responseBody || error;
    const transactionId = error.transactionId || extractTransactionIdFromResponse(responseBody) || null;
    
    // Parse response body to check for specific error cases
    let errorMessage = error.message;
    try {
      let parsedBody = responseBody;
      if (typeof responseBody === 'string') {
        parsedBody = JSON.parse(responseBody);
      }
      
      // Check for email already exists error
      if (parsedBody?.meta?.Email) {
        const emailError = parsedBody.meta.Email;
        if (emailError.toLowerCase().includes('already exist') || emailError.toLowerCase().includes('already exists')) {
          // Extract email from error message if present
          const emailMatch = emailError.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
          const email = emailMatch ? emailMatch[1] : 'this email';
          errorMessage = `Email address ${email} is already registered. Please use a different email address or sign in with your existing account.`;
          logger.warn('Email already exists error detected', {
            tenant,
            email,
            originalError: emailError
          });
        }
      }
    } catch (parseError) {
      // If parsing fails, use original error message
      logger.debug('Failed to parse error response body', {
        parseError: parseError.message,
        responseBodyType: typeof responseBody
      });
    }
    
    throw new PurchaseProductError(
      `Failed to initiate purchase: ${errorMessage}`,
      transactionId,
      statusCode,
      responseBody
    );
  }
}

/**
 * Check purchase status
 * @param {string} transactionId - Transaction ID from purchase
 * @param {string} tenant - Tenant name (default: "reach")
 * @returns {Promise<Object>} Status response
 */
export async function purchaseStatus(transactionId, tenant = DEFAULT_CONFIG.TENANT) {
  const startTime = Date.now();
  try {
    if (!transactionId) {
      logger.error('❌ Transaction ID is required for status check');
      throw new PurchaseStatusError('Transaction ID is required', null, null, null);
    }
    
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('STEP 7: CALLING STATUS API (POLLING)');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('Purchase status API call initiated', {
      tenant,
      transactionId,
      timestamp: new Date().toISOString()
    });
    
    // Get tenant config for endpoints
    const tenantCfg = getTenantConfig(tenant);
    const statusEndpointBase = tenantCfg.purchaseEndpoints?.status || '/apisvc/v0/product/status';
    const statusEndpoint = `${statusEndpointBase}/${transactionId}`;
    
    logger.info('Status API endpoint configured', {
      tenant,
      transactionId,
      endpoint: statusEndpoint,
      apiBaseUrl: tenantCfg.apiBaseUrl
    });
    
    // Call status API
    logger.info('Making HTTP GET request to Status API...', {
      endpoint: statusEndpoint,
      method: 'GET',
      timestamp: new Date().toISOString()
    });
    
    const apiCallStartTime = Date.now();
    const response = await callReachAPI(
      statusEndpoint,
      {
        method: 'GET'
      },
      tenant
    );
    const apiCallDuration = Date.now() - apiCallStartTime;
    
    logger.info('✅ Status API response received', {
      duration: `${apiCallDuration}ms`,
      hasResponse: !!response,
      responseStatus: response?.status,
      responseMessage: response?.message,
      hasData: !!response?.data,
      dataKeys: response?.data ? Object.keys(response.data) : []
    });

    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('STATUS API FULL RESPONSE');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('Complete Status API response', {
      tenant,
      endpoint: statusEndpoint,
      transactionId,
      duration: `${apiCallDuration}ms`,
      timestamp: new Date().toISOString(),
      fullResponse: JSON.stringify(response, null, 2),
      responseStructure: {
        status: response?.status,
        message: response?.message,
        data: response?.data ? {
          clientAccountId: response.data.clientAccountId,
          onBoardingStatus: response.data.onBoardingStatus,
          paymentStatus: response.data.paymentStatus,
          customerId: response.data.customerId,
          supportUrl: response.data.supportUrl,
          shipmentStatus: response.data.shipmentStatus,
          miaStatus: response.data.miaStatus,
          amount: response.data.amount,
          totalAmount: response.data.totalAmount,
          totalTax: response.data.totalTax,
          status: response.data.status,
          link: response.data.link ? {
            type: response.data.link.type,
            url: response.data.link.url,
            createdDate: response.data.link.createdDate,
            expireDate: response.data.link.expireDate,
            typeName: response.data.link.typeName,
            allKeys: Object.keys(response.data.link)
          } : null,
          meta: response.data.meta,
          allKeys: Object.keys(response.data)
        } : null
      }
    });
    logger.info('═══════════════════════════════════════════════════════════');
    
    // Validate response
    // Check if response has a status field - only validate if it exists
    if (!response) {
      logger.error('❌ Status API returned empty response', {
        endpoint: statusEndpoint,
        transactionId,
        tenant
      });
      throw new PurchaseStatusError(
        'Status API returned empty response',
        transactionId,
        null,
        null
      );
    }
    
    if (response.status !== undefined && response.status !== API_STATUS.SUCCESS) {
      logger.error('❌ Purchase status API returned non-SUCCESS status', {
        status: response.status,
        message: response.message,
        transactionId,
        data: response.data,
        tenant,
        fullResponse: JSON.stringify(response).substring(0, 1000)
      });
      throw new PurchaseStatusError(
        response?.message || 'Status API returned non-success status',
        transactionId,
        null,
        response
      );
    }
    
    // Log response structure for debugging (always, to understand API structure)
    logResponseStructureForDebugging(response, `purchaseStatus-${transactionId}`);
    
    logger.info('Status API response structure', {
      transactionId,
      paymentStatus: response.data?.paymentStatus,
      orderStatus: response.data?.status,
      onBoardingStatus: response.data?.onBoardingStatus,
      shipmentStatus: response.data?.shipmentStatus,
      hasLink: !!response.data?.link,
      linkType: response.data?.link?.type,
      hasLinkUrl: !!response.data?.link?.url,
      linkUrl: response.data?.link?.url ? response.data.link.url.substring(0, 100) + '...' : null,
      customerId: response.data?.customerId,
      supportUrl: response.data?.supportUrl,
      amount: response.data?.amount,
      totalAmount: response.data?.totalAmount,
      totalTax: response.data?.totalTax
    });
    
    // Enhanced payment URL extraction with fallbacks
    let paymentUrl = null;
    let paymentUrlExpiry = null;
    
    // Check link type: type 0 = no URL yet (PENDING), type 1 = URL available (SUCCESS)
    const linkType = response.data?.link?.type;
    const hasLinkUrl = response.data?.link?.url;
    
    logger.info('Extracting payment URL from response...', {
      transactionId,
      linkType,
      hasLinkUrl,
      linkTypeMeaning: linkType === LINK_TYPE.SUCCESS ? 'SUCCESS (URL available)' : linkType === LINK_TYPE.PENDING ? 'PENDING (no URL yet)' : 'UNKNOWN'
    });
    
    // Try multiple possible locations for payment URL
    // Priority: response.data.link.url (when link.type === 1)
    if (hasLinkUrl && linkType === LINK_TYPE.SUCCESS) {
      paymentUrl = response.data.link.url;
      paymentUrlExpiry = response.data.link.expireDate || null;
      logger.info('✅ Payment URL found at: response.data.link.url (type=1, SUCCESS)', { 
        tenant, 
        transactionId,
        paymentUrl: paymentUrl.substring(0, 100) + '...',
        hasExpiry: !!paymentUrlExpiry,
        expiryDate: paymentUrlExpiry
      });
    } else if (hasLinkUrl) {
      // URL exists but type is 0 (pending) - EXTRACT IT ANYWAY - API may return URL before type changes to 1
      paymentUrl = response.data.link.url;
      paymentUrlExpiry = response.data.link.expireDate || null;
      logger.info('✅ Payment URL found at: response.data.link.url (type=0, PENDING - extracting URL anyway)', { 
        tenant, 
        transactionId,
        paymentUrl: paymentUrl.substring(0, 100) + '...',
        fullPaymentUrl: paymentUrl, // Log full URL for debugging
        hasExpiry: !!paymentUrlExpiry,
        expiryDate: paymentUrlExpiry,
        note: 'API returned URL with type=0 (pending), but URL is available - using it'
      });
    } else if (response.data?.paymentUrl) {
      paymentUrl = response.data.paymentUrl;
      paymentUrlExpiry = response.data.paymentUrlExpiry || null;
      logger.info('✅ Payment URL found at: response.data.paymentUrl', { 
        tenant, 
        transactionId,
        paymentUrl: paymentUrl.substring(0, 100) + '...',
        hasExpiry: !!paymentUrlExpiry
      });
    } else if (response.data?.url) {
      paymentUrl = response.data.url;
      paymentUrlExpiry = response.data.expireDate || response.data.expiryDate || null;
      logger.info('✅ Payment URL found at: response.data.url', { 
        tenant, 
        transactionId,
        paymentUrl: paymentUrl.substring(0, 100) + '...',
        hasExpiry: !!paymentUrlExpiry
      });
    } else if (response.link?.url) {
      paymentUrl = response.link.url;
      paymentUrlExpiry = response.link.expireDate || null;
      logger.info('✅ Payment URL found at: response.link.url', { 
        tenant, 
        transactionId,
        paymentUrl: paymentUrl.substring(0, 100) + '...',
        hasExpiry: !!paymentUrlExpiry
      });
    } else if (response.paymentUrl) {
      paymentUrl = response.paymentUrl;
      paymentUrlExpiry = response.paymentUrlExpiry || null;
      logger.info('✅ Payment URL found at: response.paymentUrl', { 
        tenant, 
        transactionId,
        paymentUrl: paymentUrl.substring(0, 100) + '...',
        hasExpiry: !!paymentUrlExpiry
      });
    }
    
    // Log link type for debugging
    if (response.data?.link) {
      logger.info('Purchase status link info', {
        tenant,
        transactionId,
        linkType: linkType,
        linkTypeMeaning: linkType === LINK_TYPE.SUCCESS ? 'SUCCESS (1)' : linkType === LINK_TYPE.PENDING ? 'PENDING (0)' : 'UNKNOWN',
        hasUrl: !!hasLinkUrl,
        paymentStatus: response.data?.paymentStatus,
        linkObject: {
          type: response.data.link.type,
          url: response.data.link.url ? response.data.link.url.substring(0, 100) + '...' : null,
          createdDate: response.data.link.createdDate,
          expireDate: response.data.link.expireDate,
          typeName: response.data.link.typeName
        }
      });
    }
    
    // Log the full response structure for debugging if payment URL is missing
    if (!paymentUrl) {
      logger.warn('❌ Purchase status API: Payment URL not found in expected locations', {
        tenant,
        transactionId,
        paymentStatus: response.data?.paymentStatus,
        status: response.data?.status,
        linkType: linkType,
        hasLink: !!response.data?.link,
        hasLinkUrl: !!hasLinkUrl,
        responseKeys: response.data ? Object.keys(response.data) : [],
        responseStructure: JSON.stringify(response).substring(0, 2000) // First 2000 chars for debugging
      });
    } else {
      logger.info('✅ Purchase status API: Payment URL found successfully', {
        tenant,
        transactionId,
        paymentUrl: paymentUrl.substring(0, 100) + '...', // Log partial URL for security
        fullPaymentUrl: paymentUrl, // Log full URL for debugging
        hasExpiry: !!paymentUrlExpiry,
        expiryDate: paymentUrlExpiry,
        paymentStatus: response.data?.paymentStatus,
        status: response.data?.status,
        linkType: linkType
      });
    }
    
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info(`STATUS API COMPLETED (Duration: ${Date.now() - startTime}ms)`);
    logger.info(`Transaction ID: ${transactionId}`);
    logger.info(`Payment URL: ${paymentUrl ? 'FOUND ✅' : 'NOT FOUND ❌'}`);
    if (paymentUrl) {
      logger.info(`Payment URL: ${paymentUrl}`);
    }
    logger.info('═══════════════════════════════════════════════════════════');
    
    return {
      success: true,
      data: response.data,
      paymentStatus: response.data?.paymentStatus,
      status: response.data?.status,
      paymentUrl: paymentUrl,
      paymentUrlExpiry: paymentUrlExpiry,
      customerId: response.data?.customerId || null,
      supportUrl: response.data?.supportUrl || null,
      message: response.message || 'Status retrieved'
    };
  } catch (error) {
    logger.error('Purchase status API call failed', {
      tenant,
      transactionId,
      error: error.message,
      errorType: error.errorType || error.name,
      statusCode: error.statusCode,
      responseBody: error.responseBody ? (typeof error.responseBody === 'string' ? error.responseBody.substring(0, 500) : JSON.stringify(error.responseBody).substring(0, 500)) : undefined
    });
    
    if (error instanceof PurchaseStatusError) {
      throw error;
    }
    
    // If it's an APIError from callReachAPI, extract more details
    const statusCode = error.statusCode || null;
    const responseBody = error.responseBody || error;
    
    // Handle 404 (transaction not found)
    if (statusCode === 404) {
      throw new PurchaseStatusError(
        `Transaction not found: ${transactionId}`,
        transactionId,
        404,
        responseBody
      );
    }
    
    throw new PurchaseStatusError(
      `Failed to check purchase status: ${error.message}`,
      transactionId,
      statusCode,
      responseBody
    );
  }
}

/**
 * Main purchase flow orchestrator
 * Quote → Purchase → Status polling
 * @param {Object} checkoutData - Checkout data from get_checkout_data
 * @param {string} tenant - Tenant name (default: "reach")
 * @param {Object} options - Flow options
 * @param {string} options.redirectUrl - Redirect URL
 * @param {boolean} options.skipPolling - Skip status polling (default: false)
 * @param {number} options.maxPollAttempts - Max poll attempts (default: 20)
 * @param {number} options.pollInterval - Poll interval in ms (default: 3000)
 * @param {number} options.initialPollDelay - Initial delay before first poll in ms (default: 2000)
 * @returns {Promise<Object>} Final purchase result
 */
export async function purchasePlansFlow(checkoutData, tenant = DEFAULT_CONFIG.TENANT, options = {}) {
  const flowStartTime = Date.now();
  const {
    skipPolling = false,
    maxPollAttempts = DEFAULT_CONFIG.MAX_POLL_ATTEMPTS,
    pollInterval = DEFAULT_CONFIG.POLL_INTERVAL,
    initialPollDelay = DEFAULT_CONFIG.INITIAL_POLL_DELAY
  } = options;
  
  let state = FLOW_STATE.INITIAL;
  let transactionId = null;
  let clientAccountId = null;
  let quoteResponse = null;
  
  logger.info('═══════════════════════════════════════════════════════════');
  logger.info('PURCHASE FLOW ORCHESTRATOR STARTED');
  logger.info('═══════════════════════════════════════════════════════════');
  logger.info('Purchase flow configuration', {
    sessionId: checkoutData.sessionId,
    tenant,
    skipPolling,
    maxPollAttempts,
    pollInterval,
    initialPollDelay,
    timestamp: new Date().toISOString()
  });
  
  try {
    // Step 1: Validate data
    state = FLOW_STATE.VALIDATING;
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('FLOW STEP 1: VALIDATING PURCHASE DATA');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('Validating checkout data...', {
      sessionId: checkoutData.sessionId,
      hasShippingAddress: !!checkoutData.shippingAddress,
      hasCart: !!checkoutData.cart,
      cartLines: checkoutData.cart?.lines?.length || 0
    });
    
    const validation = validatePurchaseData(checkoutData);
    if (!validation.valid) {
      logger.error('❌ Purchase data validation failed', {
        sessionId: checkoutData.sessionId,
        errors: validation.errors
      });
      throw new PurchaseValidationError('Purchase data validation failed', validation.errors);
    }
    
    logger.info('✅ Purchase data validation passed', {
      sessionId: checkoutData.sessionId
    });
    
    // Step 2: Get quote
    state = FLOW_STATE.QUOTING;
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('FLOW STEP 2: GETTING QUOTE');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('Calling purchaseQuote...', { tenant, sessionId: checkoutData.sessionId });
    
    quoteResponse = await purchaseQuote(checkoutData, tenant, options);
    clientAccountId = quoteResponse.clientAccountId;
    state = FLOW_STATE.QUOTED;
    
    logger.info('✅ Quote received successfully', {
      clientAccountId,
      totalOneTimeCost: quoteResponse.data?.oneTimeCharge?.totalOneTimeCost
    });
    
    // Step 3: Initiate purchase
    state = FLOW_STATE.PURCHASING;
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('FLOW STEP 3: INITIATING PURCHASE');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('Calling purchaseProduct...', { tenant, clientAccountId, sessionId: checkoutData.sessionId });
    
    const purchaseResponse = await purchaseProduct(checkoutData, quoteResponse, tenant, options);
    transactionId = purchaseResponse.transactionId;
    clientAccountId = purchaseResponse.clientAccountId;
    state = FLOW_STATE.PURCHASED;
    
    logger.info('✅ Purchase initiated successfully', {
      transactionId,
      clientAccountId
    });
    
    // Step 4: Poll status (if not skipped)
    if (skipPolling) {
      logger.info('═══════════════════════════════════════════════════════════');
      logger.info('FLOW STEP 4: SKIPPING STATUS POLLING');
      logger.info('═══════════════════════════════════════════════════════════');
      logger.info('Purchase flow: Skipping status polling', { tenant, transactionId });
      logger.info('═══════════════════════════════════════════════════════════');
      logger.info(`PURCHASE FLOW COMPLETED (Duration: ${Date.now() - flowStartTime}ms)`);
      logger.info(`Transaction ID: ${transactionId}`);
      logger.info('═══════════════════════════════════════════════════════════');
      
      return {
        success: true,
        state: FLOW_STATE.PURCHASED,
        transactionId,
        clientAccountId,
        paymentStatus: null,
        status: null,
        paymentUrl: null,
        paymentUrlExpiry: null,
        customerId: null,
        supportUrl: null,
        quote: quoteResponse.data,
        error: null,
        polled: false,
        pollAttempts: 0
      };
    }
    
    // Poll status
    state = FLOW_STATE.POLLING;
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('FLOW STEP 4: STARTING STATUS POLLING');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('Purchase flow: Starting status polling - WAITING FOR PAYMENT URL', {
      tenant,
      transactionId,
      maxAttempts: maxPollAttempts,
      pollInterval,
      initialPollDelay,
      note: 'Will continue polling until payment URL is found or max attempts reached'
    });
    
    // Wait initial delay before first poll
    logger.info(`⏳ Loading: Waiting ${initialPollDelay}ms before first poll...`, {
      transactionId,
      initialPollDelay,
      status: 'LOADING - Payment URL generation in progress'
    });
    await new Promise(resolve => setTimeout(resolve, initialPollDelay));
    
    let pollAttempts = 0;
    let lastStatus = null;
    let lastError = null;
    
    while (pollAttempts < maxPollAttempts) {
      try {
        pollAttempts++;
        logger.info('═══════════════════════════════════════════════════════════');
        logger.info(`POLL ATTEMPT ${pollAttempts}/${maxPollAttempts}`);
        logger.info('═══════════════════════════════════════════════════════════');
        logger.info('Purchase flow: Status poll attempt', {
          tenant,
          transactionId,
          attempt: pollAttempts,
          maxAttempts: maxPollAttempts,
          timestamp: new Date().toISOString()
        });
        
        const statusResponse = await purchaseStatus(transactionId, tenant);
        lastStatus = statusResponse;
        
        const { paymentStatus, status, paymentUrl } = statusResponse;
        
        // Log payment URL status for debugging
        logger.info('Purchase flow: Status poll result', {
          tenant,
          transactionId,
          attempt: pollAttempts,
          paymentStatus,
          status,
          hasPaymentUrl: !!paymentUrl,
          paymentUrlPreview: paymentUrl ? paymentUrl.substring(0, 100) + '...' : null,
          fullPaymentUrl: paymentUrl || null,
          loadingState: paymentUrl ? 'COMPLETE - Payment URL found' : `LOADING - Checking payment status (${pollAttempts}/${maxPollAttempts})`
        });
        
        // Check for terminal states
        if (status === ORDER_STATUS.DONE || paymentStatus === PAYMENT_STATUS.SUCCESS || paymentStatus === PAYMENT_STATUS.APPROVED) {
          logger.info('═══════════════════════════════════════════════════════════');
          logger.info('✅ PURCHASE FLOW COMPLETED SUCCESSFULLY');
          logger.info('═══════════════════════════════════════════════════════════');
          logger.info('Purchase flow: Completed successfully', {
            tenant,
            transactionId,
            paymentStatus,
            status,
            pollAttempts,
            paymentUrl: statusResponse.paymentUrl ? statusResponse.paymentUrl.substring(0, 100) + '...' : null,
            fullPaymentUrl: statusResponse.paymentUrl || null,
            totalDuration: `${Date.now() - flowStartTime}ms`
          });
          
          state = FLOW_STATE.COMPLETED;
          logger.info('═══════════════════════════════════════════════════════════');
          logger.info(`FINAL RESULT: SUCCESS (Duration: ${Date.now() - flowStartTime}ms)`);
          logger.info(`Transaction ID: ${transactionId}`);
          logger.info(`Payment URL: ${statusResponse.paymentUrl || 'N/A'}`);
          logger.info('═══════════════════════════════════════════════════════════');
          
          return {
            success: true,
            state,
            transactionId,
            clientAccountId,
            paymentStatus,
            status,
            paymentUrl: statusResponse.paymentUrl,
            paymentUrlExpiry: statusResponse.paymentUrlExpiry,
            customerId: statusResponse.customerId,
            supportUrl: statusResponse.supportUrl,
            quote: quoteResponse.data,
            error: null,
            polled: true,
            pollAttempts
          };
        }
        
        // If pending and has payment URL, return with pending status
        // ALSO: If we have ANY payment URL (regardless of status), return it immediately
        if (paymentUrl) {
          logger.info('═══════════════════════════════════════════════════════════');
          logger.info('✅ PURCHASE FLOW COMPLETED (PAYMENT URL FOUND)');
          logger.info('═══════════════════════════════════════════════════════════');
          logger.info('Purchase flow: Payment URL found - returning immediately', {
            tenant,
            transactionId,
            paymentStatus,
            status,
            paymentUrl: paymentUrl.substring(0, 100) + '...',
            fullPaymentUrl: paymentUrl,
            pollAttempts,
            totalDuration: `${Date.now() - flowStartTime}ms`
          });
          
          state = FLOW_STATE.COMPLETED;
          logger.info('═══════════════════════════════════════════════════════════');
          logger.info(`FINAL RESULT: PAYMENT URL FOUND (Duration: ${Date.now() - flowStartTime}ms)`);
          logger.info(`Transaction ID: ${transactionId}`);
          logger.info(`Payment Status: ${paymentStatus}`);
          logger.info(`Order Status: ${status}`);
          logger.info(`Payment URL: ${paymentUrl}`);
          logger.info('═══════════════════════════════════════════════════════════');
          
          return {
            success: true,
            state,
            transactionId,
            clientAccountId,
            paymentStatus: paymentStatus || PAYMENT_STATUS.PENDING,
            status: status || 'PENDING',
            paymentUrl,
            paymentUrlExpiry: statusResponse.paymentUrlExpiry,
            customerId: statusResponse.customerId,
            supportUrl: statusResponse.supportUrl,
            quote: quoteResponse.data,
            error: null,
            polled: true,
            pollAttempts
          };
        }
        
        // If failed, return error
        if (status === ORDER_STATUS.FAILED || paymentStatus === PAYMENT_STATUS.FAILED) {
          logger.warn('═══════════════════════════════════════════════════════════');
          logger.warn('❌ PURCHASE FLOW FAILED');
          logger.warn('═══════════════════════════════════════════════════════════');
          logger.warn('Purchase flow: Purchase failed', {
            tenant,
            transactionId,
            paymentStatus,
            status,
            pollAttempts,
            totalDuration: `${Date.now() - flowStartTime}ms`
          });
          
          state = FLOW_STATE.FAILED;
          logger.info('═══════════════════════════════════════════════════════════');
          logger.info(`FINAL RESULT: FAILED (Duration: ${Date.now() - flowStartTime}ms)`);
          logger.info(`Transaction ID: ${transactionId}`);
          logger.info('═══════════════════════════════════════════════════════════');
          
          return {
            success: false,
            state,
            transactionId,
            clientAccountId,
            paymentStatus,
            status,
            paymentUrl: null,
            paymentUrlExpiry: null,
            customerId: statusResponse.customerId,
            supportUrl: statusResponse.supportUrl,
            quote: quoteResponse.data,
            error: 'Purchase failed',
            polled: true,
            pollAttempts
          };
        }
        
        // Continue polling - Payment URL not found yet, keep waiting
        if (pollAttempts < maxPollAttempts) {
          logger.info(`⏳ Loading: Waiting ${pollInterval}ms before next poll attempt...`, {
            transactionId,
            nextAttempt: pollAttempts + 1,
            maxAttempts: maxPollAttempts,
            status: `LOADING - Payment URL still being generated (attempt ${pollAttempts}/${maxPollAttempts})`
          });
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
      } catch (error) {
        lastError = error;
        logger.warn('Purchase flow: Status poll error', {
          tenant,
          transactionId,
          attempt: pollAttempts,
          error: error.message,
          errorType: error.errorType || error.name
        });
        
        // If 404, transaction doesn't exist - this is a fatal error
        if (error.statusCode === 404) {
          throw error;
        }
        
        // For other errors, continue polling with exponential backoff
        if (pollAttempts < maxPollAttempts) {
          const backoffDelay = Math.min(pollInterval * Math.pow(2, pollAttempts - 1), DEFAULT_CONFIG.MAX_BACKOFF_DELAY);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }
      }
    }
    
    // Max attempts reached - Payment URL still not found after all polling attempts
    logger.warn('═══════════════════════════════════════════════════════════');
    logger.warn('⚠️ PURCHASE FLOW: MAX POLL ATTEMPTS REACHED');
    logger.warn('═══════════════════════════════════════════════════════════');
    logger.warn('Purchase flow: Max poll attempts reached - Payment URL not found', {
      tenant,
      transactionId,
      pollAttempts,
      maxAttempts: maxPollAttempts,
      lastStatus: lastStatus?.paymentStatus,
      lastError: lastError?.message,
      totalDuration: `${Date.now() - flowStartTime}ms`,
      note: 'Polling completed but payment URL was not found. User should check status manually.'
    });
    
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info(`FINAL RESULT: TIMEOUT - Payment URL not found after ${pollAttempts} attempts (Duration: ${Date.now() - flowStartTime}ms)`);
    logger.info(`Transaction ID: ${transactionId}`);
    logger.info(`Payment URL: ${lastStatus?.paymentUrl || 'NOT FOUND'}`);
    logger.info(`Last Payment Status: ${lastStatus?.paymentStatus || 'N/A'}`);
    logger.info(`Last Order Status: ${lastStatus?.status || 'N/A'}`);
    logger.info('═══════════════════════════════════════════════════════════');
    
    // Return last known status - Payment URL not found after all polling attempts
    // This means we waited in loading state but payment URL wasn't ready yet
    return {
      success: lastStatus ? true : false,
      state: FLOW_STATE.POLLING_TIMEOUT,
      transactionId,
      clientAccountId,
      paymentStatus: lastStatus?.paymentStatus || null,
      status: lastStatus?.status || null,
      paymentUrl: lastStatus?.paymentUrl || null, // null - not found after polling
      paymentUrlExpiry: lastStatus?.paymentUrlExpiry || null,
      customerId: lastStatus?.customerId || null,
      supportUrl: lastStatus?.supportUrl || null,
      quote: quoteResponse.data,
      error: lastError ? `Polling timeout: ${lastError.message}` : `Polling timeout: Payment URL not found after ${pollAttempts} attempts (waited ~${Math.round((Date.now() - flowStartTime) / 1000)} seconds)`,
      polled: true,
      pollAttempts
    };
  } catch (error) {
    logger.error('═══════════════════════════════════════════════════════════');
    logger.error('❌ PURCHASE FLOW ERROR');
    logger.error('═══════════════════════════════════════════════════════════');
    logger.error('Purchase flow: Error occurred', {
      tenant,
      state,
      transactionId,
      error: error.message,
      errorType: error.errorType || error.name || error.name,
      errorStack: error.stack,
      totalDuration: `${Date.now() - flowStartTime}ms`
    });
    
    state = FLOW_STATE.FAILED;
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info(`FINAL RESULT: ERROR (Duration: ${Date.now() - flowStartTime}ms)`);
    logger.info(`Failed at state: ${state}`);
    logger.info(`Error: ${error.message}`);
    logger.info('═══════════════════════════════════════════════════════════');
    
    throw new PurchaseFlowError(
      `Purchase flow failed at ${state}: ${error.message}`,
      state,
      transactionId,
      error.errorType || error.name
    );
  }
}
