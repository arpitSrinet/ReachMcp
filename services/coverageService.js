import { callReachAPI } from "./apiClient.js";
import { logger } from "../utils/logger.js";

/**
 * Normalize ZIP code by removing extended format (e.g., "07008-2668" -> "07008")
 */
function normalizeZipCode(zipCode) {
  if (!zipCode) return zipCode;
  // Remove extended format (everything after the dash)
  return zipCode.split('-')[0].trim();
}

export async function checkCoverage(zipCode, tenant = "reach") {
  // Normalize ZIP code (remove extended format if present)
  const normalizedZip = normalizeZipCode(zipCode);
  
  // Use the correct coverage endpoint with address format
  // API requires non-null state field, so we use a valid default
  const requestBody = {
      name: "",
      // API requires non-null address fields, so we send valid defaults
      address1: "Address",
      city: "City",
      state: "NY", // API requires non-null state, using NY as default
      country: "USA",
      zip: normalizedZip,
      street1: ""
  };
  
  try {
    const response = await callReachAPI("/apisvc/v0/network/coverage", {
    method: "POST",
      body: JSON.stringify(requestBody),
  }, tenant);

  // Check if response has a status field - only validate if it exists
  // Some API responses may not have a status field and are successful by default
  if (response.status !== undefined && response.status !== "SUCCESS") {
      // Log full error details for debugging
      logger.error("Coverage API error", {
        zipCode: normalizedZip,
        status: response.status,
        message: response.message,
        data: response.data
      });
    throw new Error(`Coverage check failed: ${response.message || "Unknown error"}`);
  }

  // The API returns data nested under keys like "mno_X" or other carrier codes
  // Extract coverage data from the first available key in response.data
  let coverageData = {};
    
    // Handle different response structures:
    // 1. Response with data field: response.data
    // 2. Response is the data directly: response itself
    // 3. Response has nested keys like "mno_X": response.mno_X or response[firstKey]
    
  if (response.data && typeof response.data === 'object') {
      // Check if data is directly in response.data (not nested)
      if (response.data.msg !== undefined || response.data.signal5g !== undefined || response.data.brandCoverage !== undefined) {
        coverageData = response.data;
      } else {
    // Find the first object key that contains coverage data
    const dataKeys = Object.keys(response.data);
    if (dataKeys.length > 0) {
      coverageData = response.data[dataKeys[0]];
        }
      }
    } else if (response.msg !== undefined || response.signal5g !== undefined || response.brandCoverage !== undefined) {
      // Response itself is the coverage data
      coverageData = response;
    } else {
      // Try to find coverage data in any nested key
      const responseKeys = Object.keys(response);
      const coverageKeys = responseKeys.filter(key => 
        key.toLowerCase().includes('mno') || 
        key.toLowerCase().includes('coverage') ||
        key.toLowerCase().includes('data')
      );
      
      if (coverageKeys.length > 0) {
        coverageData = response[coverageKeys[0]];
      } else if (responseKeys.length > 0 && typeof response[responseKeys[0]] === 'object') {
        // Use first object key as fallback
        coverageData = response[responseKeys[0]];
      } else {
        // Use response as-is if no nested structure found
        coverageData = response;
    }
  }

  // Map API response fields to expected format
  return {
    zipCode,
    isValid: coverageData.isValid !== undefined ? coverageData.isValid : (coverageData.brandCoverage !== false),
    brandCoverage: coverageData.brandCoverage || false,
    // Map coverageStrength5G/4G to signal5g/signal4g
    signal5g: coverageData.coverageStrength5G || coverageData.signal5g || null,
    signal4g: coverageData.coverageStrength4G || coverageData.signal4g || null,
    // SIM Availability
    esimAvailable: coverageData.esimAvailable !== undefined ? coverageData.esimAvailable : (response.data?.esimAvailable !== undefined ? response.data.esimAvailable : null),
    psimAvailable: coverageData.psimAvailable !== undefined ? coverageData.psimAvailable : (response.data?.psimAvailable !== undefined ? response.data.psimAvailable : null),
    // Network Compatibility
    compatibility5G: coverageData.compatibility5G !== undefined ? coverageData.compatibility5G : (coverageData.compatibility5g !== undefined ? coverageData.compatibility5g : (response.data?.compatibility5G !== undefined ? response.data.compatibility5G : (response.data?.compatibility5g !== undefined ? response.data.compatibility5g : null))),
    compatibility4G: coverageData.compatibility4G !== undefined ? coverageData.compatibility4G : (coverageData.compatibility4g !== undefined ? coverageData.compatibility4g : (coverageData.lteCompatible !== undefined ? coverageData.lteCompatible : (response.data?.compatibility4G !== undefined ? response.data.compatibility4G : (response.data?.compatibility4g !== undefined ? response.data.compatibility4g : null)))),
    volteCompatible: coverageData.volteCompatible !== undefined ? coverageData.volteCompatible : (response.data?.volteCompatible !== undefined ? response.data.volteCompatible : null),
    wfcCompatible: coverageData.wfcCompatible !== undefined ? coverageData.wfcCompatible : (response.data?.wfcCompatible !== undefined ? response.data.wfcCompatible : null),
    // Additional API fields
    errorText: coverageData.errorText || response.data?.errorText || null,
    mode: coverageData.mode || response.data?.mode || null,
    wifiCalling: coverageData.wifiCalling || response.data?.wifiCalling || null,
    cdmaLess: coverageData.cdmaLess || response.data?.cdmaLess || null,
    hdVoice: coverageData.hdVoice || response.data?.hdVoice || null,
    lostOrStolen: coverageData.lostOrStolen || response.data?.lostOrStolen || null,
    inProgress: coverageData.inProgress !== undefined ? coverageData.inProgress : (response.data?.inProgress !== undefined ? response.data.inProgress : null),
    isLocked: coverageData.isLocked || response.data?.isLocked || null,
    filteredDevice: coverageData.filteredDevice || response.data?.filteredDevice || null,
    compatibleFuture: coverageData.compatibleFuture !== undefined ? coverageData.compatibleFuture : (response.data?.compatibleFuture !== undefined ? response.data.compatibleFuture : null),
    refNumbers: coverageData.refNumbers || response.data?.refNumbers || [],
    preLoadedValid: coverageData.preLoadedValid !== undefined ? coverageData.preLoadedValid : (response.data?.preLoadedValid !== undefined ? response.data.preLoadedValid : null),
    tradeInEnable: coverageData.tradeInEnable !== undefined ? coverageData.tradeInEnable : (response.data?.tradeInEnable !== undefined ? response.data.tradeInEnable : null),
    fiberValid: coverageData.fiberValid !== undefined ? coverageData.fiberValid : (response.data?.fiberValid !== undefined ? response.data.fiberValid : null),
    msg: coverageData.msg || response.data?.msg || null,
    // Include all original data for backward compatibility
    ...response.data,
    ...coverageData,
  };
  } catch (error) {
    // Enhanced error logging
    logger.error("Coverage check failed", {
      zipCode: normalizedZip,
      error: error.message,
      statusCode: error.statusCode,
      errorType: error.errorType,
      responseBody: error.responseBody
    });
    
    // Provide more helpful error message for 403
    if (error.statusCode === 403) {
      const errorDetails = error.responseBody || {};
      const errorMessage = errorDetails.Message || errorDetails.message || error.message;
      
      // Check if it's an explicit deny policy issue
      if (errorMessage && errorMessage.includes('explicit deny')) {
        logger.error("Coverage API: Explicit deny policy detected", {
          zipCode: normalizedZip,
          errorMessage,
          endpoint: "/apisvc/v0/network/coverage",
          suggestion: "Account needs coverage endpoint permissions from Reach support"
        });
        
        throw new Error(
          `Coverage check unavailable: Your account has an explicit deny policy for the coverage endpoint. ` +
          `This is a permissions issue that needs to be resolved with Reach support. ` +
          `Please contact Reach support to request access to /apisvc/v0/network/coverage endpoint. ` +
          `In the meantime, you can proceed with plan selection without a coverage check.`
        );
      }
      
      throw new Error(
        `Coverage API access denied (403). ` +
        `This account may not have permission to access /apisvc/v0/network/coverage. ` +
        `Please verify API permissions with Reach support. Error: ${errorMessage}`
      );
    }
    
    throw error;
  }
}

