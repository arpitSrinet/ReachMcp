export const tenantConfig = {
  reach: {
    name: "Reach",
    // Environment variables with fallbacks for development only
    // In production/uat, environment variables are required (validated in getTenantConfig)
    accountAccessKeyId: process.env.REACH_ACCOUNT_ACCESS_KEY_ID || "BQRP633ZPD4QTLOEBAX2",
    accountAccessSecreteKey: process.env.REACH_ACCOUNT_ACCESS_SECRET_KEY || "hBv1WoCSvrrUbc8Ql7H6VVt7fT0gzHbOwllo9AVT",
    xapiKey: process.env.REACH_XAPI_KEY || "prf6kKCjty8Hicjx2hGXz5TBBW9bHRLu7G384YST",
    apiBaseUrl: process.env.REACH_API_BASE_URL || "https://api-rm-common-qa.reachmobileplatform.com",
    partnerTenantId: process.env.REACH_PARTNER_TENANT_ID || "REACH@nu",
    reachMvne: process.env.REACH_MVNE || "ATT",
    reachSrc: process.env.REACH_SRC || "web|||customer|codex|node",
    // Purchase API endpoints (configurable via environment variables)
    purchaseEndpoints: {
      quote: process.env.REACH_PURCHASE_QUOTE_ENDPOINT || '/apisvc/v0/product/quote',
      purchase: process.env.REACH_PURCHASE_ENDPOINT || '/apisvc/v0/product',
      status: process.env.REACH_PURCHASE_STATUS_ENDPOINT || '/apisvc/v0/product/status'
    },
    // Purchase defaults (configurable via environment variables)
    purchaseDefaults: {
      redirectUrl: process.env.PAYMENT_REDIRECT_URL || process.env.APP_BASE_URL || 'https://www.google.com/',
      agentId: process.env.PURCHASE_AGENT_ID || (process.env.ENVIRONMENT ? `${process.env.ENVIRONMENT}_AGENT` : 'AGENT1234'),
      shipmentType: process.env.DEFAULT_SHIPMENT_TYPE || 'usps_first_class_mail',
      paymentType: process.env.DEFAULT_PAYMENT_TYPE || 'CARD',
      acquisitionSrc: process.env.ACQUISITION_SOURCE || 'Online'
    }
  },
};

/**
 * Get tenant configuration with production validation
 * @param {string} tenant - Tenant name (defaults to "reach")
 * @returns {Object} Tenant configuration object
 * @throws {Error} If required environment variables are missing in production/uat
 */
export function getTenantConfig(tenant) {
  const config = tenantConfig[tenant] || tenantConfig.reach;
  
  // Validation logic: Check if we should enforce environment variables
  // 1. If REQUIRE_ENV_VARS is explicitly set, use that
  // 2. Otherwise, check NODE_ENV for production environments
  const requireEnvVars = process.env.REQUIRE_ENV_VARS === 'true';
  const nodeEnv = (process.env.NODE_ENV || '').toLowerCase();
  
  // Production environments that require env vars
  const productionEnvs = ['production', 'prod', 'uat', 'staging', 'staging-uat'];
  const isProduction = requireEnvVars || productionEnvs.includes(nodeEnv);
  
  // Allow fallbacks only in development
  const isDevelopment = nodeEnv === 'dev' || nodeEnv === 'development' || (!nodeEnv && !requireEnvVars);
  
  if (isProduction && !isDevelopment) {
    const missingVars = [];
    
    // Check if environment variables are actually set (not using fallbacks)
    if (!process.env.REACH_ACCOUNT_ACCESS_KEY_ID) {
      missingVars.push('REACH_ACCOUNT_ACCESS_KEY_ID');
    }
    if (!process.env.REACH_ACCOUNT_ACCESS_SECRET_KEY) {
      missingVars.push('REACH_ACCOUNT_ACCESS_SECRET_KEY');
    }
    if (!process.env.REACH_XAPI_KEY) {
      missingVars.push('REACH_XAPI_KEY');
    }
    
    if (missingVars.length > 0) {
      throw new Error(
        `Required environment variables not set: ${missingVars.join(', ')}. ` +
        `Please set these in AWS Secrets Manager or environment configuration. ` +
        `Current NODE_ENV: ${nodeEnv || 'not set'}, REQUIRE_ENV_VARS: ${process.env.REQUIRE_ENV_VARS || 'not set'}`
      );
    }
  }
  
  return config;
}
