/**
 * Protection Pricing Utility
 * 
 * Calculates device protection price based on device price tiers.
 */

/**
 * Calculate protection price based on device price
 * @param {number} devicePrice - The price of the device
 * @returns {number} Protection price in dollars
 */
export function calculateProtectionPrice(devicePrice) {
  // Handle invalid or missing price
  if (!devicePrice || devicePrice <= 0 || isNaN(devicePrice)) {
    // Default to lowest tier for invalid prices
    return 5;
  }

  // Pricing tiers:
  // $0 - $400: Protection price = $5
  // $401 - $800: Protection price = $9
  // $801 - $1200: Protection price = $11
  // Over $1200: Use highest tier ($11)
  
  if (devicePrice <= 400) {
    return 5;
  } else if (devicePrice <= 800) {
    return 9;
  } else if (devicePrice <= 1200) {
    return 11;
  } else {
    // For devices over $1200, use highest tier
    return 11;
  }
}

/**
 * Get protection coverage details
 * @returns {Object} Coverage information
 */
export function getProtectionCoverage() {
  return {
    coverage: 'Cracked screen repair, Battery replacement, Post-warranty malfunctions',
    highlights: [
      'Cracked screen repair',
      'Battery replacement',
      'Post-warranty malfunctions'
    ]
  };
}
