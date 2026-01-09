import { logger } from './logger.js';

/**
 * Problem types matching the reference model
 */
export const PROBLEM_TYPES = {
  BAD_INPUT: 'BAD_INPUT',
  MISSING: 'MISSING',
  NOT_ELIGIBLE: 'NOT_ELIGIBLE',
  NO_STOCK: 'NO_STOCK',
  PRICE_UPDATED: 'PRICE_UPDATED',
  THROTTLED: 'THROTTLED',
  TIMEOUT: 'TIMEOUT',
  UNAVAILABLE: 'UNAVAILABLE',
  CART_MISMATCH: 'CART_MISMATCH',
  OTHER: 'OTHER'
};

/**
 * Create a Problem object for error responses
 * @param {string} type - Problem type (from PROBLEM_TYPES)
 * @param {string} message - Human-readable error message
 * @param {boolean} retryable - Whether the error is retryable
 * @param {Object|null} info - Additional error information
 * @returns {Object} Problem object
 */
export function createProblem(type, message, retryable = false, info = null) {
  return {
    type,
    message,
    retryable,
    info
  };
}

/**
 * Map common errors to Problem types
 * @param {Error} error - Error object
 * @returns {Object} Problem object
 */
export function mapErrorToProblem(error) {
  const errorMessage = error.message || String(error);
  const errorType = error.errorType || error.name;
  
  // Timeout errors
  if (errorMessage.includes('timeout') || errorMessage.includes('timed out') || errorType === 'AbortError') {
    return createProblem(PROBLEM_TYPES.TIMEOUT, errorMessage, true);
  }
  
  // 403/401 - Not eligible or missing permissions
  if (errorMessage.includes('forbidden') || errorMessage.includes('403') || errorMessage.includes('401')) {
    return createProblem(PROBLEM_TYPES.NOT_ELIGIBLE, errorMessage, false);
  }
  
  // 404 - Missing resource
  if (errorMessage.includes('not found') || errorMessage.includes('404')) {
    return createProblem(PROBLEM_TYPES.MISSING, errorMessage, false);
  }
  
  // 400 - Bad input
  if (errorMessage.includes('bad request') || errorMessage.includes('400') || errorMessage.includes('invalid')) {
    return createProblem(PROBLEM_TYPES.BAD_INPUT, errorMessage, false);
  }
  
  // 503/502 - Unavailable
  if (errorMessage.includes('unavailable') || errorMessage.includes('503') || errorMessage.includes('502')) {
    return createProblem(PROBLEM_TYPES.UNAVAILABLE, errorMessage, true);
  }
  
  // Stock issues
  if (errorMessage.includes('stock') || errorMessage.includes('out of stock') || errorMessage.includes('unavailable')) {
    return createProblem(PROBLEM_TYPES.NO_STOCK, errorMessage, false);
  }
  
  // Server-side bugs (modifiedDate, etc.) - not retryable
  if (errorMessage.includes('modifiedDate') || errorMessage.includes('unconvert') || errorMessage.includes('ReachPlanDTO')) {
    return createProblem(PROBLEM_TYPES.OTHER, errorMessage, false, { serverBug: true });
  }
  
  // Default: other error
  return createProblem(PROBLEM_TYPES.OTHER, errorMessage, false);
}

/**
 * Create a tool response with error status
 * @param {Error} error - Error object
 * @param {string} toolName - Name of the tool that failed
 * @returns {Object} Tool response with FAIL status
 */
export function createErrorResponse(error, toolName = 'unknown') {
  const problem = mapErrorToProblem(error);
  
  logger.error(`Tool error: ${toolName}`, {
    error: error.message,
    problemType: problem.type,
    retryable: problem.retryable
  });
  
  return {
    status: 'FAIL',
    problem,
    error: error.message
  };
}

/**
 * Handle error recovery based on problem type
 * @param {Object} problem - Problem object
 * @param {Function} retryFn - Function to retry (if retryable)
 * @returns {Object} Recovery options
 */
export function getRecoveryOptions(problem) {
  const options = [];
  
  switch (problem.type) {
    case PROBLEM_TYPES.BAD_INPUT:
      options.push('Ask user for corrected input');
      options.push('Validate input format');
      break;
      
    case PROBLEM_TYPES.NOT_ELIGIBLE:
      options.push('Explain eligibility requirements');
      options.push('Show alternative options');
      break;
      
    case PROBLEM_TYPES.NO_STOCK:
      options.push('Show similar devices');
      options.push('Suggest alternative products');
      break;
      
    case PROBLEM_TYPES.PRICE_UPDATED:
      options.push('Refresh cart view');
      options.push('Ask user to confirm new totals');
      break;
      
    case PROBLEM_TYPES.TIMEOUT:
    case PROBLEM_TYPES.UNAVAILABLE:
      options.push('Retry once with safe parameters');
      options.push('Offer to try again later');
      break;
      
    case PROBLEM_TYPES.CART_MISMATCH:
      options.push('Reconcile cart with flow context');
      options.push('Refresh cart view');
      break;
      
    default:
      options.push('Contact support if issue persists');
      options.push('Try again in a few moments');
  }
  
  return {
    retryable: problem.retryable,
    options,
    problem
  };
}

