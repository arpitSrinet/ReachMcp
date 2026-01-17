import { getTenantConfig } from "../config/tenantConfig.js";
import { logger } from "../utils/logger.js";
import { TimeoutError, NetworkError, APIError } from "./apiClient.js";

// Store auth tokens per tenant
const authTokens = new Map();

/**
 * Get the auth tokens map (for cron service to check expiration)
 */
export function getAuthTokensMap() {
  return authTokens;
}

// Auth-specific retry configuration
const AUTH_CONFIG = {
  timeout: 15000, // 15 seconds for auth (increased for reliability)
  retries: 3,     // 3 additional attempts (increased for reliability)
  retryDelay: 1000,
  retryBackoff: 2,
};

// Buffer time before expiration to refresh token (20 minutes for safety)
const TOKEN_REFRESH_BUFFER = 20 * 60 * 1000; // 20 minutes

// Track ongoing token refresh to prevent race conditions
const refreshPromises = new Map();

/**
 * Create a timeout promise that rejects after specified milliseconds
 */
function createTimeoutPromise(timeoutMs) {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new TimeoutError(`Auth request timed out after ${timeoutMs}ms`, timeoutMs));
    }, timeoutMs);
  });
}

/**
 * Make a single auth request with timeout
 */
async function makeAuthRequest(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await Promise.race([
      fetch(url, {
        ...options,
        signal: controller.signal,
      }),
      createTimeoutPromise(timeoutMs),
    ]);
    
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    
    // Handle abort (timeout)
    if (error.name === 'AbortError' || error instanceof TimeoutError) {
      throw new TimeoutError(`Auth request timed out after ${timeoutMs}ms`, timeoutMs);
    }
    
    // Handle network errors
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new NetworkError(`Network error during auth: ${error.message}`, error);
    }
    
    // Re-throw if it's already a custom error
    if (error instanceof TimeoutError || error instanceof NetworkError) {
      throw error;
    }
    
    // Wrap other errors as network errors
    throw new NetworkError(`Auth request failed: ${error.message}`, error);
  }
}

/**
 * Calculate delay for exponential backoff
 */
function calculateRetryDelay(attempt, baseDelay, backoffMultiplier) {
  return baseDelay * Math.pow(backoffMultiplier, attempt);
}

/**
 * Get auth token with intelligent caching and automatic refresh
 * @param {string} tenant - Tenant name
 * @param {boolean} forceRefresh - Force refresh even if token is valid
 * @returns {Promise<string>} Auth token
 */
export async function getAuthToken(tenant = "reach", forceRefresh = false) {
  // Check for existing refresh in progress to prevent race conditions
  const refreshKey = `refresh_${tenant}`;
  if (refreshPromises.has(refreshKey)) {
    logger.info("Token refresh already in progress, waiting for existing refresh", { tenant });
    try {
      return await refreshPromises.get(refreshKey);
    } catch (error) {
      // If existing refresh failed, continue to create new one
      logger.warn("Existing token refresh failed, creating new refresh", { tenant, error: error.message });
    }
  }

  // Check cached token if not forcing refresh
  if (!forceRefresh) {
    const cached = authTokens.get(tenant);
    const now = Date.now();
    
    if (cached) {
      const timeUntilExpiration = cached.expiresAt - now;
      const bufferTime = TOKEN_REFRESH_BUFFER;
      
      // Token is still valid with buffer time - return cached token
      if (timeUntilExpiration > bufferTime) {
        const minutesUntilExpiration = Math.floor(timeUntilExpiration / (60 * 1000));
        logger.debug("Using cached auth token", {
          tenant,
          expiresAt: new Date(cached.expiresAt).toISOString(),
          minutesUntilExpiration,
        });
        return cached.token;
      }
      
      // Token is expiring soon but still valid - refresh in background
      if (timeUntilExpiration > 0) {
        logger.info("Token expiring soon, refreshing in background", {
          tenant,
          minutesUntilExpiration: Math.floor(timeUntilExpiration / (60 * 1000)),
        });
        // Refresh in background but return current token immediately
        refreshTokenInBackground(tenant).catch(err => {
          logger.error("Background token refresh failed", { tenant, error: err.message });
        });
        return cached.token;
      }
      
      // Token expired
      logger.info("Cached token expired, fetching new token", {
        tenant,
        expiredAt: new Date(cached.expiresAt).toISOString(),
      });
    } else {
      logger.info("No cached token found, fetching new token", { tenant });
    }
  } else {
    logger.info("Force refresh requested, fetching new token", { tenant });
  }

  // Create refresh promise to prevent concurrent refreshes
  const refreshPromise = fetchNewToken(tenant);
  refreshPromises.set(refreshKey, refreshPromise);
  
  try {
    const token = await refreshPromise;
    return token;
  } finally {
    refreshPromises.delete(refreshKey);
  }
}

/**
 * Fetch a new token from the API
 */
async function fetchNewToken(tenant) {
  const config = getTenantConfig(tenant);
  const url = `${config.apiBaseUrl}/apisvc/v0/account/generateauth`;

  logger.info("Requesting new auth token", {
    tenant,
    apiBaseUrl: config.apiBaseUrl,
    hasAccessKey: !!config.accountAccessKeyId,
    hasSecretKey: !!config.accountAccessSecreteKey,
    hasXApiKey: !!config.xapiKey,
  });

  const requestOptions = {
    method: "POST",
    headers: {
      "accept": "*/*",
      "content-type": "application/json",
      "x-api-key": config.xapiKey,
      "origin": "https://api.reachplatform.com",
      "referer": "https://api.reachplatform.com/",
      "user-agent": "Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
    },
    body: JSON.stringify({
      accountAccessKeyId: config.accountAccessKeyId,
      accountAccessSecreteKey: config.accountAccessSecreteKey,
    }),
  };

  let lastError;
  
  // Retry loop
  for (let attempt = 0; attempt <= AUTH_CONFIG.retries; attempt++) {
    try {
      const response = await makeAuthRequest(url, requestOptions, AUTH_CONFIG.timeout);

      // Read response body
      let responseBody;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        try {
          responseBody = await response.json();
        } catch (e) {
          responseBody = await response.text();
        }
      } else {
        responseBody = await response.text();
      }

      if (!response.ok) {
        const errorMessage = typeof responseBody === 'object' 
          ? (responseBody.message || responseBody.error || JSON.stringify(responseBody))
          : responseBody;
        
        // Log full auth failure details once per response
        logger.error("Auth HTTP error from generateauth", {
          tenant,
          url,
          statusCode: response.status,
          statusText: response.statusText,
          responseBody,
        });

        const isAuthStatus = response.status === 401 || response.status === 403;
        const error = new APIError(
          isAuthStatus
            ? `Auth failed (${response.status}). Please verify accountAccessKeyId, accountAccessSecreteKey, x-api-key, and apiBaseUrl match your working Postman/cURL request. Upstream message: ${errorMessage}`
            : `Auth failed: ${response.status} ${response.statusText} - ${errorMessage}`,
          response.status,
          response.statusText,
          responseBody,
          response.status === 401 ? 'AUTHENTICATION_ERROR' : (isAuthStatus ? 'AUTHORIZATION_ERROR' : 'API_ERROR')
        );
        
        // Retry on server errors or rate limits
        if (attempt < AUTH_CONFIG.retries && (response.status >= 500 || response.status === 429)) {
          const delay = calculateRetryDelay(attempt, AUTH_CONFIG.retryDelay, AUTH_CONFIG.retryBackoff);
          logger.warn("Auth request failed, retrying...", {
            tenant,
            attempt: attempt + 1,
            maxRetries: AUTH_CONFIG.retries,
            delay,
            statusCode: response.status,
          });
          
          await new Promise(resolve => setTimeout(resolve, delay));
          lastError = error;
          continue;
        }
        
        // Don't retry on client errors (4xx except 429)
        throw error;
      }

      // Parse response
      const data = typeof responseBody === 'string' ? JSON.parse(responseBody) : responseBody;
      
      if (data.status !== "SUCCESS") {
        logger.error("Auth logical error from generateauth", {
          tenant,
          url,
          statusCode: response.status,
          statusText: response.statusText,
          responseBody: data,
        });

        const error = new APIError(
          `Auth failed: ${data.message || "Unknown error from generateauth"}`,
          response.status,
          response.statusText,
          data,
          'AUTHENTICATION_ERROR'
        );
        
        // Don't retry on authentication failures
        throw error;
      }

      // Fix typo: exipiresAt -> expiresAt (try both for backward compatibility)
      const expiresAtStr = data.data.expiresAt || data.data.exipiresAt;
      if (!expiresAtStr) {
        throw new APIError(
          "Auth response missing expiration time",
          response.status,
          response.statusText,
          data,
          'AUTHENTICATION_ERROR'
        );
      }

      const token = data.data.authorizationToken;
      const expiresAt = new Date(expiresAtStr).getTime();

      // Validate token and expiration
      if (!token) {
        throw new APIError(
          "Auth response missing token",
          response.status,
          response.statusText,
          data,
          'AUTHENTICATION_ERROR'
        );
      }

      if (isNaN(expiresAt) || expiresAt <= Date.now()) {
        throw new APIError(
          "Auth response has invalid or expired expiration time",
          response.status,
          response.statusText,
          data,
          'AUTHENTICATION_ERROR'
        );
      }

      // Cache the token
      authTokens.set(tenant, { token, expiresAt });

      logger.info("Authentication successful", { 
        tenant,
        expiresAt: new Date(expiresAt).toISOString(),
        minutesUntilExpiration: Math.floor((expiresAt - Date.now()) / (60 * 1000))
      });
      
      return token;
      
    } catch (error) {
      lastError = error;
      
      // Retry on network/timeout errors
      if (attempt < AUTH_CONFIG.retries && 
          (error instanceof NetworkError || error instanceof TimeoutError)) {
        const delay = calculateRetryDelay(attempt, AUTH_CONFIG.retryDelay, AUTH_CONFIG.retryBackoff);
        logger.warn("Auth request failed, retrying...", {
          tenant,
          attempt: attempt + 1,
          maxRetries: AUTH_CONFIG.retries,
          delay,
          errorType: error.errorType || error.name,
          errorMessage: error.message,
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // Out of retries or not retryable
      logger.error("Authentication failed", {
        error: error.message,
        tenant,
        attempts: attempt + 1,
        errorType: error.errorType || error.name,
      });
      
      throw error;
    }
  }
  
  throw lastError || new Error('Unknown authentication error');
}

/**
 * Refresh token in background (non-blocking)
 */
async function refreshTokenInBackground(tenant) {
  try {
    await fetchNewToken(tenant);
    logger.info("Background token refresh completed", { tenant });
  } catch (error) {
    logger.error("Background token refresh failed", { tenant, error: error.message });
    // Don't throw - this is background refresh
  }
}

