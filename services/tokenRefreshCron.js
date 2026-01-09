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

let cronInterval = null;
let isRunning = false;

/**
 * Start the token refresh cron job
 * @param {number} intervalMinutes - How often to check tokens (default: 2 minutes for more frequent checks)
 */
export function startTokenRefreshCron(intervalMinutes = 2) {
  if (cronInterval) {
    logger.warn("Token refresh cron: Cron already running, stopping previous instance");
    stopTokenRefreshCron();
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  
  logger.info("Token refresh cron: Starting token refresh cron", {
    intervalMinutes,
    intervalMs,
    checkInterval: `${intervalMinutes} minutes`,
  });

  // Run immediately on start
  refreshAllTokens().catch(err => {
    logger.error("Token refresh cron: Error on initial token refresh", {
      error: err.message,
    });
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

  logger.info("Token refresh cron: Token refresh cron started successfully");
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

