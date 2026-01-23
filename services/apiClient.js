import { getTenantConfig } from "../config/tenantConfig.js";
import { getAuthToken, getAuthTokensMap } from "./authService.js";
import { ensureTokenOnToolCall } from "./tokenRefreshCron.js";
import { logger } from "../utils/logger.js";

// Default configuration
const DEFAULT_CONFIG = {
  timeout: 30000, // 30 seconds
  retries: 3,
  retryDelay: 1000, // Initial delay in ms
  retryBackoff: 2, // Exponential backoff multiplier
  retryableStatusCodes: [408, 429, 500, 502, 503, 504], // Status codes that should be retried
};

// Custom error classes for better error handling
export class APIError extends Error {
  constructor(message, statusCode, statusText, responseBody, errorType = 'API_ERROR') {
    super(message);
    this.name = 'APIError';
    this.statusCode = statusCode;
    this.statusText = statusText;
    this.responseBody = responseBody;
    this.errorType = errorType;
  }
}

export class TimeoutError extends Error {
  constructor(message, timeout) {
    super(message);
    this.name = 'TimeoutError';
    this.timeout = timeout;
    this.errorType = 'TIMEOUT';
  }
}

export class NetworkError extends Error {
  constructor(message, originalError) {
    super(message);
    this.name = 'NetworkError';
    this.originalError = originalError;
    this.errorType = 'NETWORK';
  }
}

/**
 * Create a timeout promise that rejects after specified milliseconds
 */
function createTimeoutPromise(timeoutMs) {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new TimeoutError(`Request timed out after ${timeoutMs}ms`, timeoutMs));
    }, timeoutMs);
  });
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error, statusCode) {
  // Server bugs (like modifiedDate unconversion) should not be retried
  if (error.errorType === 'SERVER_BUG') {
    return false;
  }
  
  // Network errors are always retryable
  if (error instanceof NetworkError || error instanceof TimeoutError) {
    return true;
  }
  
  // Check if status code is retryable
  if (statusCode && DEFAULT_CONFIG.retryableStatusCodes.includes(statusCode)) {
    return true;
  }
  
  // 4xx errors (except retryable ones) are not retryable
  if (statusCode >= 400 && statusCode < 500) {
    return false;
  }
  
  // 5xx errors are retryable (unless it's a known server bug)
  if (statusCode >= 500) {
    return true;
  }
  
  return false;
}

/**
 * Calculate delay for exponential backoff
 */
function calculateRetryDelay(attempt, baseDelay, backoffMultiplier) {
  return baseDelay * Math.pow(backoffMultiplier, attempt);
}

/**
 * Map HTTP status codes to error types and messages
 */
function mapError(statusCode, statusText, responseBody) {
  let errorType = 'API_ERROR';
  let message = `API Error: ${statusCode} ${statusText}`;
  
  // Try to extract error message from response body
  let errorMessage = null;
  try {
    if (typeof responseBody === 'string') {
      const parsed = JSON.parse(responseBody);
      errorMessage = parsed.message || parsed.error || parsed.errorMessage || parsed.data?.message;
    } else if (responseBody && typeof responseBody === 'object') {
      errorMessage = responseBody.message || responseBody.error || responseBody.errorMessage || responseBody.data?.message;
    }
  } catch (e) {
    // If parsing fails, use responseBody as string if available
    if (typeof responseBody === 'string') {
      errorMessage = responseBody;
    }
  }
  
  if (errorMessage) {
    message = `${message} - ${errorMessage}`;
  }
  
  // Categorize errors
  if (statusCode >= 400 && statusCode < 500) {
    if (statusCode === 401) {
      errorType = 'AUTHENTICATION_ERROR';
      message = `Authentication failed: ${errorMessage || statusText}`;
    } else if (statusCode === 403) {
      errorType = 'AUTHORIZATION_ERROR';
      message = `Access forbidden: ${errorMessage || statusText}`;
    } else if (statusCode === 404) {
      errorType = 'NOT_FOUND_ERROR';
      message = `Resource not found: ${errorMessage || statusText}`;
    } else if (statusCode === 408) {
      errorType = 'TIMEOUT_ERROR';
      message = `Request timeout: ${errorMessage || statusText}`;
    } else if (statusCode === 429) {
      errorType = 'RATE_LIMIT_ERROR';
      message = `Rate limit exceeded: ${errorMessage || statusText}`;
    } else {
      errorType = 'CLIENT_ERROR';
    }
  } else if (statusCode >= 500) {
    errorType = 'SERVER_ERROR';
    message = `Server error: ${errorMessage || statusText}`;
  }
  
  return { errorType, message };
}

/**
 * Make a single API request with timeout
 */
async function makeRequest(url, options, timeoutMs) {
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
      throw new TimeoutError(`Request timed out after ${timeoutMs}ms`, timeoutMs);
    }
    
    // Handle network errors
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new NetworkError(`Network error: ${error.message}`, error);
    }
    
    // Re-throw if it's already a custom error
    if (error instanceof TimeoutError || error instanceof NetworkError) {
      throw error;
    }
    
    // Wrap other errors as network errors
    throw new NetworkError(`Request failed: ${error.message}`, error);
  }
}

/**
 * Call Reach API with retry logic, timeout, and error mapping
 * @param {string} endpoint - API endpoint
 * @param {Object} options - Fetch options
 * @param {string} tenant - Tenant name
 * @param {Object} config - Override default retry/timeout config
 */
export async function callReachAPI(endpoint, options = {}, tenant = "reach", config = {}) {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const config_tenant = getTenantConfig(tenant);
  
  // Get auth token - use cached token if valid, only refresh if needed
  // DO NOT force refresh - let getAuthToken handle caching intelligently
  let authToken;

  
  
  try {
    // Use ensureTokenOnToolCall to check/refresh token before API call
    await ensureTokenOnToolCall(tenant);
    const tokensMap = getAuthTokensMap();
    const cached = tokensMap?.get(tenant);
    authToken = cached?.token;
    
    if (!authToken) {
      // If no token after ensure, fetch one (but don't force refresh)
      authToken = await getAuthToken(tenant, false);
    }
  } catch (error) {
    logger.error("Failed to get auth token for API call", {
      endpoint,
      tenant,
      error: error.message,
      errorType: error.errorType || error.name
    });
    throw error;
  }
  
  const url = endpoint && endpoint.startsWith("http")
    ? endpoint
    : `${config_tenant.apiBaseUrl}${endpoint}`;
  
  // Ensure authorization header has Bearer prefix if not already present
  let authHeader = authToken;
  if (authToken && !authToken.startsWith('Bearer ')) {
    authHeader = `Bearer ${authToken}`;
  }
  
  logger.debug("API call authorization header", {
    endpoint,
    hasToken: !!authToken,
    tokenPrefix: authToken ? authToken.substring(0, 20) : "none",
  });


  
  const requestOptions = {
    ...options,
    headers: {
      "accept": "*/*",
      "accept-language": "en-GB,en-US;q=0.9,en;q=0.8,hi;q=0.7",
      "content-type": "application/json",
      "authorization": authHeader,
      "x-api-key": config_tenant.xapiKey,
      "origin": "https://api.reachplatform.com",
      "referer": "https://api.reachplatform.com/",
      "user-agent": "Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
      ...options.headers,
    },
  };
  
  let lastError;
  let lastStatusCode;
  let lastResponseBody;
  
  // Retry loop
  for (let attempt = 0; attempt <= finalConfig.retries; attempt++) {
    try {
      // Make request with timeout
      const response = await makeRequest(url, requestOptions, finalConfig.timeout);
      
      // Try to read response body (for error handling)
      let responseBody;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        try {
          responseBody = await response.json();
        } catch (e) {
          // If JSON parsing fails, try text
          responseBody = await response.text();
        }
      } else {
        responseBody = await response.text();
      }
      
      // Auto-refresh token on 401 and retry once
      if (response.status === 401 && attempt === 0) {
        logger.warn("Received 401 Unauthorized, refreshing token and retrying", {
          endpoint,
          attempt: attempt + 1
        });
        
        try {
          // Clear cached token and fetch new one
          const tokensMap = getAuthTokensMap();
          tokensMap?.delete(tenant);
          authToken = await getAuthToken(tenant, true); // Force refresh on 401
          
          // Update auth header with new token
          authHeader = authToken;
          if (authToken && !authToken.startsWith('Bearer ')) {
            authHeader = `Bearer ${authToken}`;
          }
          
          // Update request options with new auth header
          requestOptions.headers.authorization = authHeader;
          
          // Retry immediately with new token
          continue;
        } catch (refreshError) {
          logger.error("Failed to refresh token after 401", {
            endpoint,
            error: refreshError.message
          });
          // Continue to normal error handling
        }
      }
      
      // Log 403 errors with full details for debugging permissions issues
      if (response.status === 403) {
        logger.error("403 Forbidden - Authorization/Permissions Issue", {
          endpoint,
          url,
          statusCode: response.status,
          statusText: response.statusText,
          responseBody: typeof responseBody === 'string' ? responseBody.substring(0, 500) : JSON.stringify(responseBody).substring(0, 500),
          authHeaderPrefix: authHeader ? authHeader.substring(0, 30) : "none",
          hasXApiKey: !!config_tenant.xapiKey,
          xApiKeyPrefix: config_tenant.xapiKey ? config_tenant.xapiKey.substring(0, 10) : "none",
          attempt: attempt + 1
        });
      }
      
      // Check if response is OK
      if (!response.ok) {
        lastStatusCode = response.status;
        lastResponseBody = responseBody;
        
        // Check for specific server-side bugs that shouldn't be retried
        const responseBodyStr = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
        const responseBodyLower = responseBodyStr.toLowerCase();
        
        // Map error first to check the message too
        const { errorType, message } = mapError(response.status, response.statusText, responseBody);
        const messageLower = message.toLowerCase();
        
        // Detect modifiedDate unconversion errors (server-side bug, not retryable)
        const isModifiedDateError = response.status === 500 && 
                                    (responseBodyLower.includes('modifieddate') || 
                                     responseBodyLower.includes('modified_date') ||
                                     responseBodyLower.includes('reachplandto') ||
                                     messageLower.includes('modifieddate') ||
                                     (messageLower.includes('unconvert') && (messageLower.includes('reachplandto') || messageLower.includes('modified'))));
        
        // If it's the modifiedDate error, don't retry - it's a server-side bug
        if (isModifiedDateError) {
          logger.error("Server-side bug detected (modifiedDate unconversion error) - not retrying", {
            endpoint,
            statusCode: response.status,
            errorMessage: message,
            responseBodyPreview: responseBodyStr.substring(0, 300),
            attempt: attempt + 1
          });
          throw new APIError(
            `Server error: The Reach API has a server-side bug with the modifiedDate field. This is not a transient error and retrying won't help. Please contact Reach support. Original error: ${message}`,
            response.status,
            response.statusText,
            responseBody,
            'SERVER_BUG'
          );
        }
        
        const error = new APIError(message, response.status, response.statusText, responseBody, errorType);
        
        // Check if we should retry
        if (attempt < finalConfig.retries && isRetryableError(error, response.status)) {
          const delay = calculateRetryDelay(attempt, finalConfig.retryDelay, finalConfig.retryBackoff);
          logger.warn(`API request failed, retrying...`, {
            endpoint,
            attempt: attempt + 1,
            maxRetries: finalConfig.retries,
            delay,
            statusCode: response.status,
            errorType,
          });
          
          await new Promise(resolve => setTimeout(resolve, delay));
          lastError = error;
          continue;
        }
        
        // Not retryable or out of retries
        throw error;
      }
      
      // Success - return parsed JSON if it was JSON, otherwise return text
      if (typeof responseBody === 'string') {
        try {
          return JSON.parse(responseBody);
        } catch (e) {
          return responseBody;
        }
      }
      return responseBody;
      
    } catch (error) {
      lastError = error;
      
      // Check if we should retry
      if (attempt < finalConfig.retries && isRetryableError(error, lastStatusCode)) {
        const delay = calculateRetryDelay(attempt, finalConfig.retryDelay, finalConfig.retryBackoff);
        logger.warn(`API request failed, retrying...`, {
          endpoint,
          attempt: attempt + 1,
          maxRetries: finalConfig.retries,
          delay,
          errorType: error.errorType || error.name,
          errorMessage: error.message,
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // Out of retries or not retryable - throw the error
      logger.error(`API request failed after ${attempt + 1} attempt(s)`, {
        endpoint,
        attempts: attempt + 1,
        errorType: error.errorType || error.name,
        errorMessage: error.message,
        statusCode: lastStatusCode,
      });
      
      throw error;
    }
  }
  
  // This should never be reached, but just in case
  throw lastError || new Error('Unknown error occurred');
}
