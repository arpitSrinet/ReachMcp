import { getAuthToken } from "./authService.js";
import { getTenantConfig } from "../config/tenantConfig.js";
import { logger } from "../utils/logger.js";

// Get access to the authTokens Map from authService
// We'll need to export a function to get tokens and check expiration
let getAuthTokensMap = null;

/**
 * Set the function to access auth tokens map
 * This allows the cron to check token expiration without exposing the Map directly
 */
export function setAuthTokensAccessor(accessor) {
  getAuthTokensMap = accessor;
}

/**
 * Refresh token for a specific tenant if it's about to expire
 */
async function refreshTokenIfNeeded(tenant) {
  try {
    const tokensMap = getAuthTokensMap ? getAuthTokensMap() : null;
    if (!tokensMap) {
      logger.warn("Token refresh cron: Cannot access auth tokens map", { tenant });
      return;
    }

    const cached = tokensMap.get(tenant);
    const bufferTime = 15 * 60 * 1000; // 15 minutes buffer (refresh 15 min before expiration) - matches getAuthToken
    const now = Date.now();

    if (!cached) {
      // No token exists, try to get one
      logger.info("Token refresh cron: No token found, requesting new token", { tenant });
      await getAuthToken(tenant);
      return;
    }

    const timeUntilExpiration = cached.expiresAt - now;
    const shouldRefresh = timeUntilExpiration <= bufferTime;

    if (shouldRefresh) {
      const minutesUntilExpiration = Math.floor(timeUntilExpiration / (60 * 1000));
      logger.info("Token refresh cron: Token expiring soon, refreshing", {
        tenant,
        minutesUntilExpiration,
        expiresAt: new Date(cached.expiresAt).toISOString(),
      });
      
      await getAuthToken(tenant);
      logger.info("Token refresh cron: Token refreshed successfully", { tenant });
    } else {
      const minutesUntilExpiration = Math.floor(timeUntilExpiration / (60 * 1000));
      logger.debug("Token refresh cron: Token still valid", {
        tenant,
        minutesUntilExpiration,
        expiresAt: new Date(cached.expiresAt).toISOString(),
      });
    }
  } catch (error) {
    logger.error("Token refresh cron: Failed to refresh token", {
      tenant,
      error: error.message,
      errorType: error.errorType || error.name,
    });
  }
}

/**
 * Refresh tokens for all configured tenants
 */
async function refreshAllTokens() {
  try {
    // Get all tenants from config (currently only "reach")
    const tenants = ["reach"]; // You can expand this if you add more tenants
    
    logger.info("Token refresh cron: Starting token refresh check", {
      tenants: tenants.length,
      timestamp: new Date().toISOString(),
    });

    // Refresh tokens for all tenants in parallel
    await Promise.allSettled(
      tenants.map(tenant => refreshTokenIfNeeded(tenant))
    );

    logger.info("Token refresh cron: Token refresh check completed", {
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Token refresh cron: Error during token refresh cycle", {
      error: error.message,
      errorType: error.name,
    });
  }
}

/**
 * On-demand token refresh when user initiates conversation (tool call)
 * Checks if token exists and is valid, fetches if needed
 * @param {string} tenant - Tenant name (default: "reach")
 */
/**
 * On-demand token refresh when user initiates conversation (tool call)
 * Checks if token exists and is valid, fetches if needed
 * This ensures authentication is always ready before API calls
 * @param {string} tenant - Tenant name (default: "reach")
 */
export async function ensureTokenOnToolCall(tenant = "reach") {
  try {
    const tokensMap = getAuthTokensMap ? getAuthTokensMap() : null;
    if (!tokensMap) {
      logger.warn("Token refresh: Cannot access auth tokens map, fetching token", { tenant });
      await getAuthToken(tenant, false);
      logger.info("Authentication token created successfully (no tokens map)", { tenant });
      return;
    }

    const cached = tokensMap.get(tenant);
    const bufferTime = 20 * 60 * 1000; // 20 minutes buffer (matches TOKEN_REFRESH_BUFFER)
    const now = Date.now();

    if (!cached) {
      // No token exists, fetch one
      logger.info("Token refresh: No token found on tool call, fetching fresh token", { tenant });
      await getAuthToken(tenant, false);
      logger.info("Authentication token created successfully (was missing)", { tenant });
      return;
    }

    const timeUntilExpiration = cached.expiresAt - now;
    const shouldRefresh = timeUntilExpiration <= bufferTime;

    if (shouldRefresh) {
      const minutesUntilExpiration = Math.floor(timeUntilExpiration / (60 * 1000));
      logger.info("Token refresh: Token expiring soon on tool call, refreshing", {
        tenant,
        minutesUntilExpiration,
        expiresAt: new Date(cached.expiresAt).toISOString(),
      });
      await getAuthToken(tenant, false); // Don't force, let it use cache if still valid
      logger.info("Authentication token refreshed successfully (was expiring)", { 
        tenant,
        minutesUntilExpiration 
      });
    } else {
      const minutesUntilExpiration = Math.floor(timeUntilExpiration / (60 * 1000));
      logger.debug("Authentication token verified and valid on tool call", {
        tenant,
        minutesUntilExpiration,
        expiresAt: new Date(cached.expiresAt).toISOString(),
      });
    }
  } catch (error) {
    logger.error("Token refresh: Failed to ensure token on tool call", {
      tenant,
      error: error.message,
      errorType: error.errorType || error.name,
    });
    // Don't throw - try to continue with existing token if available
    const tokensMap = getAuthTokensMap ? getAuthTokensMap() : null;
    const cached = tokensMap?.get(tenant);
    if (cached && cached.expiresAt > Date.now()) {
      logger.warn("Using existing token despite refresh failure", { tenant });
      return;
    }
    throw error;
  }
}

let cronInterval = null;
let isRunning = false;

/**
 * Start the token refresh cron job
 * @param {number} intervalMinutes - How often to check tokens (disabled if null/0, on-demand only)
 * @param {boolean} enablePeriodic - If false, only run on-demand, no periodic intervals
 */
export function startTokenRefreshCron(intervalMinutes = null, enablePeriodic = false) {
  if (cronInterval) {
    logger.warn("Token refresh cron: Cron already running, stopping previous instance");
    stopTokenRefreshCron();
  }

  // Run initial token fetch on startup (non-blocking)
  refreshAllTokens().catch(err => {
    logger.error("Token refresh cron: Error on initial token refresh", {
      error: err.message,
    });
  });

  // Only enable periodic cron if explicitly enabled
  if (enablePeriodic && intervalMinutes) {
    const intervalMs = intervalMinutes * 60 * 1000;
    
    logger.info("Token refresh cron: Starting periodic token refresh cron", {
      intervalMinutes,
      intervalMs,
      checkInterval: `${intervalMinutes} minutes`,
    });

    // Then run periodically
    cronInterval = setInterval(() => {
      if (isRunning) {
        logger.debug("Token refresh cron: Skipping cycle, previous one still running");
        return;
      }

      isRunning = true;
      refreshAllTokens()
        .finally(() => {
          isRunning = false;
        });
    }, intervalMs);

    logger.info("Token refresh cron: Periodic token refresh cron started successfully");
  } else {
    logger.info("Token refresh cron: On-demand token refresh enabled (no periodic interval). Tokens will be checked/fetched on tool calls.");
  }
}

/**
 * Stop the token refresh cron job
 */
export function stopTokenRefreshCron() {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
    logger.info("Token refresh cron: Token refresh cron stopped");
  }
}

/**
 * Get cron status
 */
export function getCronStatus() {
  return {
    isRunning: cronInterval !== null,
    isCurrentlyRefreshing: isRunning,
  };
}

