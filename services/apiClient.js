import { getTenantConfig } from "../config/tenantConfig.js";
import { getAuthToken, clearAuthToken } from "./authService.js";
import { logger } from "../utils/logger.js";

export async function callReachAPI(endpoint, options = {}, tenant = "reach") {
  const config = getTenantConfig(tenant);
  
  // Get auth token (automatically handles caching and renewal)
  let authToken = await getAuthToken(tenant);
  
  const url = `${config.apiBaseUrl}${endpoint}`;
  
  let response = await fetch(url, {
    ...options,
    headers: {
      "accept": "*/*",
      "content-type": "application/json",
      "authorization": authToken,
      "x-api-key": config.xapiKey,
      "origin": "https://api.reachplatform.com",
      "referer": "https://api.reachplatform.com/",
      "user-agent": "Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
      ...options.headers,
    },
  });

  // Handle 403 Forbidden - token expired or unauthorized
  if (response.status === 403) {
    logger.warn("403 Forbidden received - clearing token and retrying", { 
      endpoint,
      tenant 
    });
    
    // Clear the expired/invalid token
    clearAuthToken(tenant);
    
    // Get a fresh token
    authToken = await getAuthToken(tenant);
    
    // Retry the request with new token
    response = await fetch(url, {
      ...options,
      headers: {
        "accept": "*/*",
        "content-type": "application/json",
        "authorization": authToken,
        "x-api-key": config.xapiKey,
        "origin": "https://api.reachplatform.com",
        "referer": "https://api.reachplatform.com/",
        "user-agent": "Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
        ...options.headers,
      },
    });
  }

  // Also handle 401 Unauthorized (for completeness)
  if (response.status === 401) {
    logger.warn("401 Unauthorized received - clearing token and retrying", { 
      endpoint,
      tenant 
    });
    
    // Clear the expired token
    clearAuthToken(tenant);
    
    // Get a fresh token
    authToken = await getAuthToken(tenant);
    
    // Retry the request with new token
    response = await fetch(url, {
      ...options,
      headers: {
        "accept": "*/*",
        "content-type": "application/json",
        "authorization": authToken,
        "x-api-key": config.xapiKey,
        "origin": "https://api.reachplatform.com",
        "referer": "https://api.reachplatform.com/",
        "user-agent": "Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
        ...options.headers,
      },
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  return response.json();
}

