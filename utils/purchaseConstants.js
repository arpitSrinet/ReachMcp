/**
 * Purchase API Constants
 * Centralized constants for purchase flow to avoid hardcoded values
 */

/**
 * Payment Status Values (from API responses)
 */
export const PAYMENT_STATUS = {
  SUCCESS: 'SUCCESS',
  APPROVED: 'APPROVED',
  PENDING: 'PENDING',
  FAILED: 'FAILED'
};

/**
 * Order Status Values (from API responses)
 */
export const ORDER_STATUS = {
  DONE: 'DONE',
  FAILED: 'FAILED',
  PENDING: 'PENDING'
};

/**
 * Purchase Flow State Values (internal states)
 */
export const FLOW_STATE = {
  INITIAL: 'INITIAL',
  VALIDATING: 'VALIDATING',
  QUOTING: 'QUOTING',
  QUOTED: 'QUOTED',
  PURCHASING: 'PURCHASING',
  PURCHASED: 'PURCHASED',
  POLLING: 'POLLING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  POLLING_TIMEOUT: 'POLLING_TIMEOUT'
};

/**
 * Link Type Values (from API responses)
 * 0 = PENDING (no URL yet)
 * 1 = SUCCESS (URL available)
 */
export const LINK_TYPE = {
  PENDING: 0,
  SUCCESS: 1
};

/**
 * Default Configuration Values
 * These can be overridden via environment variables
 */
export const DEFAULT_CONFIG = {
  TENANT: process.env.DEFAULT_TENANT || 'reach',
  COUNTRY_CODE: process.env.DEFAULT_PHONE_COUNTRY_CODE || '1',
  COUNTRY: process.env.DEFAULT_COUNTRY || 'USA',
  SHIPMENT_TYPE: process.env.DEFAULT_SHIPMENT_TYPE || 'usps_first_class_mail',
  PAYMENT_TYPE: process.env.DEFAULT_PAYMENT_TYPE || 'CARD',
  ACQUISITION_SOURCE: process.env.ACQUISITION_SOURCE || 'Online',
  RESIDENTIAL_DEFAULT: process.env.DEFAULT_RESIDENTIAL || 'true',
  MAX_POLL_ATTEMPTS: parseInt(process.env.PURCHASE_MAX_POLL_ATTEMPTS || '40', 10), // Increased to 40 attempts (2 minutes total)
  POLL_INTERVAL: parseInt(process.env.PURCHASE_POLL_INTERVAL || '3000', 10), // 3 seconds between polls
  INITIAL_POLL_DELAY: parseInt(process.env.PURCHASE_INITIAL_POLL_DELAY || '5000', 10), // Increased initial delay to 5 seconds
  MAX_BACKOFF_DELAY: parseInt(process.env.PURCHASE_MAX_BACKOFF_DELAY || '10000', 10),
  REDIRECT_URL: process.env.PAYMENT_REDIRECT_URL || process.env.APP_BASE_URL || 'https://www.google.com/',
  AGENT_ID: process.env.PURCHASE_AGENT_ID || process.env.ENVIRONMENT + '_AGENT' || 'AGENT1234'
};

/**
 * API Response Status Values
 */
export const API_STATUS = {
  SUCCESS: 'SUCCESS'
};
