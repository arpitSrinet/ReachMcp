import { logger } from './logger.js';

/**
 * Geocoding Service
 * Provides address autocomplete and geocoding functionality
 * 
 * To use a real geocoding API, replace the geocodeAddress function implementation
 * with calls to:
 * - Google Maps Geocoding API: https://developers.google.com/maps/documentation/geocoding
 * - Mapbox Geocoding API: https://docs.mapbox.com/api/search/geocoding/
 * - SmartyStreets US Address API: https://www.smartystreets.com/docs/api/us-street-api
 * - USPS Address API: https://www.usps.com/business/web-tools-apis/
 */

/**
 * Geocode a street address to get city, state, and ZIP code
 * @param {string} streetAddress - Street address (e.g., "123 Main St")
 * @param {string} country - Country code (default: "US")
 * @returns {Promise<Object|null>} Address object with street, city, state, zipCode, or null if not found
 */
export async function geocodeAddress(streetAddress, country = 'US') {
  if (!streetAddress || typeof streetAddress !== 'string') {
    logger.warn('Geocoding called with invalid street address', { streetAddress });
    return null;
  }

  const trimmedStreet = streetAddress.trim();
  if (!trimmedStreet) {
    return null;
  }

  logger.debug('Geocoding address', { streetAddress: trimmedStreet, country });

  // TODO: Replace this with actual geocoding API call
  // Example implementations:
  
  // Option 1: Google Maps Geocoding API
  // const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  // const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(trimmedStreet + ', ' + country)}&key=${apiKey}`;
  // const response = await fetch(url);
  // const data = await response.json();
  // if (data.results && data.results.length > 0) {
  //   const result = data.results[0];
  //   const components = result.address_components;
  //   // Parse components to extract city, state, zipCode
  //   ...
  // }

  // Option 2: Mapbox Geocoding API
  // const accessToken = process.env.MAPBOX_ACCESS_TOKEN;
  // const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(trimmedStreet + ', ' + country)}.json?access_token=${accessToken}`;
  // const response = await fetch(url);
  // const data = await response.json();
  // if (data.features && data.features.length > 0) {
  //   const feature = data.features[0];
  //   // Parse context to extract city, state, zipCode
  //   ...
  // }

  // Option 3: SmartyStreets US Address API
  // const authId = process.env.SMARTYSTREETS_AUTH_ID;
  // const authToken = process.env.SMARTYSTREETS_AUTH_TOKEN;
  // const url = 'https://us-street.api.smartystreets.com/street-address';
  // const response = await fetch(url, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify([{ street: trimmedStreet, country: country }])
  // });
  // const data = await response.json();
  // if (data && data.length > 0) {
  //   const result = data[0];
  //   return {
  //     street: result.delivery_line_1,
  //     city: result.components.city_name,
  //     state: result.components.state_abbreviation,
  //     zipCode: result.components.zipcode
  //   };
  // }

  // For now, return null to indicate geocoding is not available
  // This will allow the system to fall back to manual entry
  logger.info('Geocoding not implemented - using fallback', { streetAddress: trimmedStreet });
  return null;
}

/**
 * Validate and normalize address components from geocoding result
 * @param {Object} geocodeResult - Result from geocoding API
 * @returns {Object|null} Normalized address object or null if invalid
 */
export function normalizeGeocodeResult(geocodeResult) {
  if (!geocodeResult || typeof geocodeResult !== 'object') {
    return null;
  }

  const normalized = {
    street: geocodeResult.street || geocodeResult.address1 || geocodeResult.address || '',
    city: geocodeResult.city || '',
    state: geocodeResult.state || '',
    zipCode: geocodeResult.zipCode || geocodeResult.zip || geocodeResult.postalCode || ''
  };

  // Validate that we have at least city, state, and ZIP
  if (!normalized.city || !normalized.state || !normalized.zipCode) {
    logger.warn('Geocode result missing required fields', { normalized });
    return null;
  }

  // Normalize state to 2-letter uppercase code
  if (normalized.state.length > 2) {
    // If state is full name, try to convert to code (simplified - would need full mapping)
    normalized.state = normalized.state.substring(0, 2).toUpperCase();
  } else {
    normalized.state = normalized.state.toUpperCase();
  }

  // Normalize ZIP code (remove any non-digits except hyphen)
  normalized.zipCode = normalized.zipCode.replace(/[^\d-]/g, '');

  return normalized;
}

/**
 * Check if geocoding service is available
 * @returns {boolean} True if geocoding API is configured
 */
export function isGeocodingAvailable() {
  // Check if any geocoding API keys are configured
  return !!(
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.MAPBOX_ACCESS_TOKEN ||
    process.env.SMARTYSTREETS_AUTH_ID ||
    process.env.USPS_API_KEY
  );
}
