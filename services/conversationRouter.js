import { logger } from '../utils/logger.js';
import { INTENT_TYPES } from './intentService.js';
import { checkPrerequisites, getFlowContext, getFlowProgress } from './flowContextService.js';
import { getNextStepSuggestions, getCheckoutGuidance } from './guidanceService.js';

/**
 * Conversational router service
 * Implements the flowchart routing logic for non-linear conversation flows
 */

/**
 * Route intent based on flowchart logic
 * @param {string} intent - Detected intent
 * @param {Object} entities - Extracted entities
 * @param {Object} context - Flow context
 * @returns {Object} { route, action, prerequisites, guidance }
 */
export function routeIntent(intent, entities, context) {
  logger.info('Routing intent', { intent, entities, hasContext: !!context });

  switch (intent) {
    case INTENT_TYPES.COVERAGE:
      return routeCoverageFlow(entities, context);
    
    case INTENT_TYPES.PLAN:
      return routePlanFlow(entities, context);
    
    case INTENT_TYPES.DEVICE:
      return routeDeviceFlow(entities, context);
    
    case INTENT_TYPES.PROTECTION:
      return routeProtectionFlow(entities, context);
    
    case INTENT_TYPES.SIM:
      return routeSimFlow(entities, context);
    
    case INTENT_TYPES.CHECKOUT:
      return routeCheckoutFlow(entities, context);
    
    case INTENT_TYPES.EDIT:
      return routeEditFlow(entities, context);
    
    case INTENT_TYPES.LINE_COUNT:
      return routeLineCountFlow(entities, context);
    
    default:
      return {
        route: 'answer',
        action: 'answer_question',
        prerequisites: { allowed: true },
        guidance: "I'll help you with that. What would you like to know?"
      };
  }
}

/**
 * Route coverage flow (non-blocking)
 */
function routeCoverageFlow(entities, context) {
  return {
    route: 'coverage',
    action: 'check_coverage',
    prerequisites: { allowed: true }, // Coverage is always allowed
    guidance: entities.zipCode 
      ? `Checking coverage for ZIP code ${entities.zipCode}...`
      : "I can check coverage for you. What ZIP code should I check?",
    requiresZip: !entities.zipCode,
    zipCode: entities.zipCode
  };
}

/**
 * Route plan flow
 */
function routePlanFlow(entities, context) {
  const progress = context ? getFlowProgress(context.sessionId) : null;
  
  // Check if line count is known
  if (!progress || !progress.lineCount || progress.lineCount === 0) {
    return {
      route: 'plan',
      action: 'get_plans',
      prerequisites: { allowed: true },
      guidance: "I'll show you plans. First, how many lines do you need?",
      requiresLineCount: true,
      askLineCount: true
    };
  }

  // Plans can be shown
  return {
    route: 'plan',
    action: 'get_plans',
    prerequisites: { allowed: true },
    guidance: `Showing plans for ${progress.lineCount} line${progress.lineCount > 1 ? 's' : ''}. Would you like to apply the same plan to all lines, or mix & match?`,
    lineCount: progress.lineCount,
    maxPrice: entities.maxPrice || null
  };
}

/**
 * Route device flow (optional, allowed before plan)
 */
function routeDeviceFlow(entities, context) {
  const progress = context ? getFlowProgress(context.sessionId) : null;
  
  // Device browsing is allowed without plan (but plan required for checkout)
  const devicePrereq = context ? checkPrerequisites(context.sessionId, 'add_device') : { allowed: true };
  
  if (!progress || !progress.lineCount || progress.lineCount === 0) {
    return {
      route: 'device',
      action: 'get_devices',
      prerequisites: { allowed: true, warning: 'Plan required before checkout' },
      guidance: "I can show you devices. Note: You'll need to select plans before checkout. Would you like to see devices now, or select plans first?",
      askLineCount: true
    };
  }

  return {
    route: 'device',
    action: 'get_devices',
    prerequisites: devicePrereq,
    guidance: `Which line${progress.lineCount > 1 ? 's' : ''} would you like to add a device for?`,
    lineCount: progress.lineCount,
    brand: entities.brand || null
  };
}

/**
 * Route protection flow (requires device)
 */
function routeProtectionFlow(entities, context) {
  if (!context) {
    return {
      route: 'protection',
      action: 'get_protection_plan',
      prerequisites: { allowed: false, reason: 'Please add devices first' },
      guidance: "Device protection requires a device. Would you like to add a device first?",
      redirectTo: 'device'
    };
  }

  const protectionPrereq = checkPrerequisites(context.sessionId, 'add_protection');
  
  if (!protectionPrereq.allowed) {
    return {
      route: 'protection',
      action: 'get_protection_plan',
      prerequisites: protectionPrereq,
      guidance: protectionPrereq.reason + " Would you like to add devices first?",
      redirectTo: 'device'
    };
  }

  const progress = getFlowProgress(context.sessionId);
  const linesWithDevices = context.lines?.filter(line => line.deviceSelected) || [];
  
  return {
    route: 'protection',
    action: 'get_protection_plan',
    prerequisites: protectionPrereq,
    guidance: `You have devices on ${linesWithDevices.length} line${linesWithDevices.length > 1 ? 's' : ''}. Would you like to add protection for all, or select per line?`,
    eligibleLines: linesWithDevices.map(line => line.lineNumber)
  };
}

/**
 * Route SIM flow
 */
function routeSimFlow(entities, context) {
  if (!context) {
    return {
      route: 'sim',
      action: 'get_sim_types',
      prerequisites: { allowed: false, reason: 'Please select plans first' },
      guidance: "SIM selection requires plans. Would you like to select plans first?",
      redirectTo: 'plan'
    };
  }

  const simPrereq = checkPrerequisites(context.sessionId, 'select_sim');
  const progress = getFlowProgress(context.sessionId);
  
  if (!simPrereq.allowed) {
    return {
      route: 'sim',
      action: 'get_sim_types',
      prerequisites: simPrereq,
      guidance: simPrereq.reason,
      redirectTo: 'plan'
    };
  }

  const missingSims = progress.missing?.sim || [];
  
  return {
    route: 'sim',
    action: 'get_sim_types',
    prerequisites: simPrereq,
    guidance: missingSims.length > 0
      ? `Select SIM type for line${missingSims.length > 1 ? 's' : ''} ${missingSims.join(', ')}. Choose eSIM or Physical SIM.`
      : "All lines have SIM types. Ready for checkout?",
    lineNumber: entities.lineNumber || null
  };
}

/**
 * Route checkout flow (enforces prerequisites)
 */
function routeCheckoutFlow(entities, context) {
  if (!context) {
    return {
      route: 'checkout',
      action: 'review_cart',
      prerequisites: { allowed: false, reason: 'Please start a purchase flow first' },
      guidance: "Let's get started! How many lines would you like to set up?",
      redirectTo: 'line_count'
    };
  }

  const checkoutGuidance = getCheckoutGuidance(context);
  
  if (!checkoutGuidance.ready) {
    // Route to first missing prerequisite
    let redirectTo = 'line_count';
    if (!checkoutGuidance.missing.includes('line_count')) {
      if (checkoutGuidance.missing.includes('plans')) {
        redirectTo = 'plan';
      } else if (checkoutGuidance.missing.includes('sim')) {
        redirectTo = 'sim';
      }
    }

    return {
      route: 'checkout',
      action: 'review_cart',
      prerequisites: { allowed: false, reason: checkoutGuidance.guidance },
      guidance: checkoutGuidance.guidance,
      redirectTo,
      missing: checkoutGuidance.missing
    };
  }

  return {
    route: 'checkout',
    action: 'review_cart',
    prerequisites: { allowed: true },
    guidance: "Reviewing your cart... All prerequisites are met!",
    ready: true
  };
}

/**
 * Route edit flow
 */
function routeEditFlow(entities, context) {
  if (!context) {
    return {
      route: 'edit',
      action: 'edit_cart_item',
      prerequisites: { allowed: false, reason: 'No active cart to edit' },
      guidance: "You don't have an active cart yet. Would you like to start shopping?",
      redirectTo: 'plan'
    };
  }

  const { action, itemType, lineNumber } = entities;

  if (!action || !itemType) {
    return {
      route: 'edit',
      action: 'edit_cart_item',
      prerequisites: { allowed: false, reason: 'Please specify what you want to edit (plan, device, protection, or sim) and the action (change, remove)' },
      guidance: "What would you like to edit? For example: 'change plan on line 2' or 'remove device from line 1'."
    };
  }

  return {
    route: 'edit',
    action: 'edit_cart_item',
    prerequisites: { allowed: true },
    guidance: `I'll ${action} the ${itemType}${lineNumber ? ` on line ${lineNumber}` : ''}.`,
    editData: {
      action,
      itemType,
      lineNumber: lineNumber || null
    }
  };
}

/**
 * Route line count flow
 */
function routeLineCountFlow(entities, context) {
  const lineCount = entities.lineCount;
  
  if (!lineCount || lineCount < 1) {
    return {
      route: 'line_count',
      action: 'start_purchase_flow',
      prerequisites: { allowed: true },
      guidance: "How many lines do you need? (e.g., '2 lines' or 'family plan for 4')",
      requiresLineCount: true
    };
  }

  return {
    route: 'line_count',
    action: 'start_purchase_flow',
    prerequisites: { allowed: true },
    guidance: `Setting up ${lineCount} line${lineCount > 1 ? 's' : ''}. Next: Select plans.`,
    lineCount
  };
}

/**
 * Check prerequisites for a specific intent
 * @param {string} intent - Intent name
 * @param {Object} context - Flow context
 * @returns {Object} Prerequisites check result
 */
export function checkPrerequisitesForIntent(intent, context) {
  if (!context) {
    // Some intents don't require context
    if (intent === INTENT_TYPES.COVERAGE || intent === INTENT_TYPES.PLAN || intent === INTENT_TYPES.DEVICE) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'Please start a purchase flow first' };
  }

  switch (intent) {
    case INTENT_TYPES.COVERAGE:
      return { allowed: true };
    
    case INTENT_TYPES.PLAN:
    case INTENT_TYPES.DEVICE:
      return { allowed: true }; // Allowed, but may show warnings
    
    case INTENT_TYPES.PROTECTION:
      return checkPrerequisites(context.sessionId, 'add_protection');
    
    case INTENT_TYPES.SIM:
      return checkPrerequisites(context.sessionId, 'select_sim');
    
    case INTENT_TYPES.CHECKOUT:
      return checkPrerequisites(context.sessionId, 'checkout');
    
    default:
      return { allowed: true };
  }
}

/**
 * Get next step based on current context
 * @param {Object} context - Flow context
 * @param {string} currentIntent - Current intent (optional)
 * @returns {Object} Next step information
 */
export function getNextStep(context, currentIntent) {
  if (!context) {
    return {
      step: 'line_count',
      action: 'start_purchase_flow',
      guidance: "Let's get started! How many lines would you like to set up?"
    };
  }

  const suggestions = getNextStepSuggestions(context);
  
  return {
    step: suggestions.nextStep,
    action: getActionForStep(suggestions.nextStep),
    guidance: suggestions.guidance,
    suggestions: suggestions.suggestions
  };
}

/**
 * Get action name for a step
 * @param {string} step - Step name
 * @returns {string} Action name
 */
function getActionForStep(step) {
  const stepActionMap = {
    'line_count': 'start_purchase_flow',
    'plan_selection': 'get_plans',
    'device_selection': 'get_devices',
    'protection_selection': 'get_protection_plan',
    'sim_selection': 'get_sim_types',
    'checkout': 'review_cart'
  };

  return stepActionMap[step] || 'get_flow_status';
}

