import { getAuthToken } from './authService.js';
import { logger } from '../utils/logger.js';

/**
 * Validate ICCID format
 * ICCID is typically 19-20 digits
 * @param {string} iccid - ICCID to validate
 * @returns {boolean} True if valid format
 */
export function validateIccId(iccid) {
  if (!iccid || typeof iccid !== 'string') {
    return false;
  }
  
  // Remove any spaces or dashes
  const cleaned = iccid.replace(/[\s-]/g, '');
  
  // ICCID should be 19-20 digits
  return /^\d{19,20}$/.test(cleaned);
}

/**
 * Swap SIM card for a customer
 * @param {string} customerId - Customer ID
 * @param {string} newIccId - New ICCID
 * @param {string} simType - SIM type: 'ESIM' or 'PSIM'
 * @param {string} tenant - Tenant identifier (default: 'reach')
 * @returns {Promise<Object>} Swap result
 */
export async function swapSim(customerId, newIccId, simType = 'PSIM', tenant = 'reach') {
  if (!customerId) {
    throw new Error('Customer ID is required');
  }
  
  if (!newIccId) {
    throw new Error('New ICCID is required');
  }
  
  if (!validateIccId(newIccId)) {
    throw new Error('Invalid ICCID format. ICCID must be 19-20 digits.');
  }
  
  const validSimTypes = ['ESIM', 'PSIM'];
  if (!validSimTypes.includes(simType.toUpperCase())) {
    throw new Error(`Invalid SIM type. Must be 'ESIM' or 'PSIM'`);
  }
  
  const simTypeUpper = simType.toUpperCase();
  
  try {
    // Get auth token
    const authToken = await getAuthToken(tenant);
    
    const apiUrl = 'https://api-rm-common-qa.reachmobileplatform.com/apisvc/v0/iccid/swap';
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'authorization': authToken,
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
      },
      body: JSON.stringify({
        customerId,
        newIccId: newIccId.replace(/[\s-]/g, ''), // Clean ICCID
        simType: simTypeUpper
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SIM Swap API Error: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    const data = await response.json();
    
    logger.info('SIM swap successful', {
      customerId,
      simType: simTypeUpper,
      newIccId: newIccId.replace(/[\s-]/g, '')
    });
    
    return {
      success: true,
      customerId,
      newIccId: newIccId.replace(/[\s-]/g, ''),
      simType: simTypeUpper,
      data
    };
  } catch (error) {
    logger.error('SIM swap failed', {
      error: error.message,
      customerId,
      simType,
      newIccId
    });
    throw error;
  }
}

