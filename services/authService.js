import { getTenantConfig } from "../config/tenantConfig.js";
import { logger } from "../utils/logger.js";

// Store auth tokens per tenant
const authTokens = new Map();

export async function getAuthToken(tenant = "reach") {
  // Check if we have a valid cached token
  const cached = authTokens.get(tenant);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  // Get new token
  const config = getTenantConfig(tenant);
  const url = `${config.apiBaseUrl}/apisvc/v0/account/generateauth`;

  try {
    const response = await fetch(url, {
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
    });

    if (!response.ok) {
      throw new Error(`Auth failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.status !== "SUCCESS") {
      throw new Error(`Auth failed: ${data.message || "Unknown error"}`);
    }

    const token = data.data.authorizationToken;
    const expiresAt = new Date(data.data.exipiresAt).getTime();

    // Cache the token
    authTokens.set(tenant, { token, expiresAt });

    logger.info("Authentication successful", { tenant });
    return token;
  } catch (error) {
    logger.error("Authentication failed", { error: error.message, tenant });
    throw error;
  }
}

