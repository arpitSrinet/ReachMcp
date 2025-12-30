import { getTenantConfig } from "../config/tenantConfig.js";
import { getAuthToken } from "./authService.js";
import { logger } from "../utils/logger.js";

export async function callReachAPI(endpoint, options = {}, tenant = "reach") {
  const config = getTenantConfig(tenant);
  
  // Get auth token (automatically handles caching and renewal)
  const authToken = await getAuthToken(tenant);
  
  const url = `${config.apiBaseUrl}${endpoint}`;
  
  const response = await fetch(url, {
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

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  return response.json();
}

