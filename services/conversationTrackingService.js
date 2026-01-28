import { logger } from '../utils/logger.js';
import { getFlowContext, getFlowProgress, updateFlowContext } from './flowContextService.js';
import { detectIntent, INTENT_TYPES } from './intentService.js';
import { getNextStepSuggestions } from './guidanceService.js';

/**
 * Conversation tracking service
 * Tracks current question and redirects users back on track when they go off-topic
 */

// Question types that the system might be asking
export const QUESTION_TYPES = {
  LINE_COUNT: 'line_count',           // "How many lines do you need?"
  ZIP_CODE: 'zip_code',               // "What's your ZIP code?"
  IMEI: 'imei',                       // "What's your device IMEI?"
  PLAN_SELECTION: 'plan_selection',   // "Which plan would you like?"
  DEVICE_SELECTION: 'device_selection', // "Which device would you like?"
  SIM_TYPE: 'sim_type',               // "eSIM or Physical SIM?"
  PROTECTION: 'protection',           // "Would you like device protection?"
  CONFIRMATION: 'confirmation',        // "Are you ready to checkout?"
  CART_ACTION: 'cart_action',         // "Would you like to clear cart or review cart?"
  SHIPPING_NAME: 'shipping_name',     // "What's your first name and last name?"
  SHIPPING_CONTACT: 'shipping_contact', // "What's your phone number and email?"
  SHIPPING_ADDRESS: 'shipping_address', // "What's your street address, city, state, and ZIP code?"
  NONE: null                          // No active question
};

/**
 * Set the current question being asked
 * @param {string} sessionId - Session ID
 * @param {string} questionType - Type of question (QUESTION_TYPES)
 * @param {string} questionText - Human-readable question text
 * @param {Object} expectedEntities - Expected entities in response (e.g., { lineCount: true, zipCode: true })
 */
export function setCurrentQuestion(sessionId, questionType, questionText, expectedEntities = {}) {
  if (!sessionId) return;
  
  const context = getFlowContext(sessionId);
  if (context) {
    context.currentQuestion = {
      type: questionType,
      text: questionText,
      expectedEntities: expectedEntities,
      askedAt: Date.now()
    };
    context.lastUpdated = Date.now();
    updateFlowContext(sessionId, { currentQuestion: context.currentQuestion });
    
    logger.info('Current question set', { sessionId, questionType, questionText });
  }
}

/**
 * Get the current question
 * @param {string} sessionId - Session ID
 * @returns {Object|null} Current question object or null
 */
export function getCurrentQuestion(sessionId) {
  if (!sessionId) return null;
  
  const context = getFlowContext(sessionId);
  return context?.currentQuestion || null;
}

/**
 * Clear the current question (when answered or flow moves on)
 * @param {string} sessionId - Session ID
 */
export function clearCurrentQuestion(sessionId) {
  if (!sessionId) return;
  
  const context = getFlowContext(sessionId);
  if (context && context.currentQuestion) {
    context.currentQuestion = null;
    updateFlowContext(sessionId, { currentQuestion: null });
    logger.info('Current question cleared', { sessionId });
  }
}

/**
 * Check if user response is on-track (answers the current question)
 * @param {string} userMessage - User's message
 * @param {string} sessionId - Session ID
 * @returns {Object} { isOnTrack: boolean, reason: string, detectedIntent: string, entities: Object }
 */
export function checkIfOnTrack(userMessage, sessionId) {
  if (!userMessage || !sessionId) {
    return {
      isOnTrack: true, // If no question is active, consider it on-track
      reason: 'No active question',
      detectedIntent: INTENT_TYPES.OTHER,
      entities: {}
    };
  }
  
  const currentQuestion = getCurrentQuestion(sessionId);
  
  // If no question is active, user is on-track
  if (!currentQuestion) {
    return {
      isOnTrack: true,
      reason: 'No active question',
      detectedIntent: INTENT_TYPES.OTHER,
      entities: {}
    };
  }
  
  // Detect intent and entities from user message
  const intentResult = detectIntent(userMessage);
  const intent = intentResult.intent;
  const entities = intentResult.entities || {};
  const message = userMessage.toLowerCase().trim();
  
  // Check if response matches expected question type
  const questionType = currentQuestion.type;
  const expectedEntities = currentQuestion.expectedEntities || {};
  
  let isOnTrack = false;
  let reason = '';
  
  switch (questionType) {
    case QUESTION_TYPES.LINE_COUNT:
      // Expecting: line count number
      if (entities.lineCount || /^\d+\s*line/i.test(message) || /line.*\d+/i.test(message)) {
        isOnTrack = true;
        reason = 'User provided line count';
      } else if (intent === INTENT_TYPES.LINE_COUNT) {
        isOnTrack = true;
        reason = 'User intent indicates line count';
      } else {
        isOnTrack = false;
        reason = 'Expected line count but got unrelated response';
      }
      break;
      
    case QUESTION_TYPES.ZIP_CODE:
      // Expecting: ZIP code
      if (entities.zipCode || /\b\d{5}(?:-\d{4})?\b/.test(message)) {
        isOnTrack = true;
        reason = 'User provided ZIP code';
      } else if (intent === INTENT_TYPES.COVERAGE) {
        isOnTrack = true;
        reason = 'User intent indicates coverage/ZIP code';
      } else {
        isOnTrack = false;
        reason = 'Expected ZIP code but got unrelated response';
      }
      break;
      
    case QUESTION_TYPES.IMEI:
      // Expecting: IMEI number
      if (/\b\d{15}\b/.test(message)) {
        isOnTrack = true;
        reason = 'User provided IMEI';
      } else if (intent === INTENT_TYPES.DEVICE && /compatible|compatibility|imei/i.test(message)) {
        isOnTrack = true;
        reason = 'User intent indicates device compatibility';
      } else {
        isOnTrack = false;
        reason = 'Expected IMEI number but got unrelated response';
      }
      break;
      
    case QUESTION_TYPES.PLAN_SELECTION:
      // Expecting: plan selection or plan-related intent
      if (intent === INTENT_TYPES.PLAN || entities.planId || /plan/i.test(message)) {
        isOnTrack = true;
        reason = 'User response relates to plan selection';
      } else {
        isOnTrack = false;
        reason = 'Expected plan selection but got unrelated response';
      }
      break;
      
    case QUESTION_TYPES.DEVICE_SELECTION:
      // Expecting: device selection or device-related intent
      if (intent === INTENT_TYPES.DEVICE || entities.deviceId || /device|phone/i.test(message)) {
        isOnTrack = true;
        reason = 'User response relates to device selection';
      } else {
        isOnTrack = false;
        reason = 'Expected device selection but got unrelated response';
      }
      break;
      
    case QUESTION_TYPES.SIM_TYPE:
      // Expecting: SIM type selection
      if (intent === INTENT_TYPES.SIM || entities.simType || /esim|psim|physical.*sim|sim.*type/i.test(message)) {
        isOnTrack = true;
        reason = 'User response relates to SIM type';
      } else {
        isOnTrack = false;
        reason = 'Expected SIM type selection but got unrelated response';
      }
      break;
      
    case QUESTION_TYPES.PROTECTION:
      // Expecting: protection-related response
      if (intent === INTENT_TYPES.PROTECTION || /protection|insurance|warranty/i.test(message)) {
        isOnTrack = true;
        reason = 'User response relates to protection';
      } else if (/no|skip|not|don't|decline/i.test(message)) {
        isOnTrack = true;
        reason = 'User declined protection';
      } else {
        isOnTrack = false;
        reason = 'Expected protection response but got unrelated response';
      }
      break;
      
    case QUESTION_TYPES.CONFIRMATION:
      // Expecting: yes/no confirmation
      if (/yes|yeah|yep|sure|ok|okay|proceed|continue|confirm/i.test(message)) {
        isOnTrack = true;
        reason = 'User confirmed';
      } else if (/no|nope|cancel|stop|wait/i.test(message)) {
        isOnTrack = true;
        reason = 'User declined';
      } else {
        isOnTrack = false;
        reason = 'Expected yes/no confirmation but got unrelated response';
      }
      break;
      
    case QUESTION_TYPES.CART_ACTION:
      // Expecting: clear cart or review cart
      if (/clear|empty|reset|remove.*all|start.*over/i.test(message)) {
        isOnTrack = true;
        reason = 'User wants to clear cart';
      } else if (/review|show.*cart|see.*cart|view.*cart|check.*cart/i.test(message)) {
        isOnTrack = true;
        reason = 'User wants to review cart';
      } else if (intent === INTENT_TYPES.CHECKOUT || intent === INTENT_TYPES.EDIT) {
        isOnTrack = true;
        reason = 'User intent indicates cart action';
      } else {
        isOnTrack = false;
        reason = 'Expected clear cart or review cart but got unrelated response';
      }
      break;
      
    case QUESTION_TYPES.SHIPPING_NAME:
      // Expecting: first name and last name
      if (entities.firstName || entities.lastName || /^[a-z]+\s+[a-z]+/i.test(message) || 
          /first.*name|last.*name|name.*is/i.test(message)) {
        isOnTrack = true;
        reason = 'User provided name information';
      } else {
        isOnTrack = false;
        reason = 'Expected first name and last name but got unrelated response';
      }
      break;
      
    case QUESTION_TYPES.SHIPPING_CONTACT:
      // Expecting: phone number and email
      if (entities.phone || entities.email || 
          /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b|\+?\d{10,}/.test(message) ||
          /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/.test(message) ||
          /phone|email|contact/i.test(message)) {
        isOnTrack = true;
        reason = 'User provided contact information';
      } else {
        isOnTrack = false;
        reason = 'Expected phone number and email but got unrelated response';
      }
      break;
      
    case QUESTION_TYPES.SHIPPING_ADDRESS:
      // Expecting: street address, city, state, ZIP code
      if (entities.street || entities.city || entities.state || entities.zipCode ||
          /\b\d{5}(?:-\d{4})?\b/.test(message) || // ZIP code pattern
          /street|address|city|state|zip|postal/i.test(message)) {
        isOnTrack = true;
        reason = 'User provided address information';
      } else {
        isOnTrack = false;
        reason = 'Expected address details but got unrelated response';
      }
      break;
      
    default:
      // Unknown question type - assume on-track
      isOnTrack = true;
      reason = 'Unknown question type';
  }
  
  logger.info('On-track check', {
    sessionId,
    questionType,
    isOnTrack,
    reason,
    detectedIntent: intent,
    userMessage: userMessage.substring(0, 100)
  });
  
  return {
    isOnTrack,
    reason,
    detectedIntent: intent,
    entities
  };
}

/**
 * Generate redirect message to bring user back on track
 * @param {string} sessionId - Session ID
 * @param {string} userMessage - User's off-track message (optional)
 * @returns {string} Redirect message
 */
export function generateRedirectMessage(sessionId, userMessage = '') {
  const currentQuestion = getCurrentQuestion(sessionId);
  const context = getFlowContext(sessionId);
  const progress = getFlowProgress(sessionId);
  
  if (!currentQuestion) {
    // No active question - use next step suggestions
    const suggestions = getNextStepSuggestions(context);
    return `I understand you might have a question, but let's continue with your purchase flow.\n\n${suggestions.guidance || 'What would you like to do next?'}`;
  }
  
  const questionType = currentQuestion.type;
  const questionText = currentQuestion.text;
  
  // Generate friendly redirect based on question type
  let redirectMessage = `I appreciate your message, but I need to focus on completing your purchase setup.\n\n`;
  
  switch (questionType) {
    case QUESTION_TYPES.LINE_COUNT:
      redirectMessage += `**I'm still waiting for:** How many lines do you need?\n\n`;
      redirectMessage += `Please tell me a number (e.g., "2 lines", "I need 3 lines", or "family plan for 4").`;
      break;
      
    case QUESTION_TYPES.ZIP_CODE:
      redirectMessage += `**I'm still waiting for:** Your ZIP code to check coverage.\n\n`;
      redirectMessage += `Please provide your 5-digit ZIP code (e.g., "90210" or "My zipcode is 12345").`;
      break;
      
    case QUESTION_TYPES.IMEI:
      redirectMessage += `**I'm still waiting for:** Your device's IMEI number.\n\n`;
      redirectMessage += `Please provide your 15-digit IMEI (you can find it by dialing *#06# on your phone).`;
      break;
      
    case QUESTION_TYPES.PLAN_SELECTION:
      redirectMessage += `**I'm still waiting for:** You to select a plan.\n\n`;
      if (progress && progress.missing?.plans) {
        redirectMessage += `You need to select plans for ${progress.missing.plans.length} line${progress.missing.plans.length > 1 ? 's' : ''}. `;
      }
      redirectMessage += `Please say "Show me plans" or click "Add to Cart" on a plan above.`;
      break;
      
    case QUESTION_TYPES.DEVICE_SELECTION:
      redirectMessage += `**I'm still waiting for:** You to select a device.\n\n`;
      redirectMessage += `Please say "Show me devices" or click "Add to Cart" on a device above.`;
      break;
      
    case QUESTION_TYPES.SIM_TYPE:
      // SIM selection removed - eSIM is automatically set when plan is added
      redirectMessage += `**Note:** SIM selection is no longer needed. eSIM is automatically set when you add a plan.`;
      break;
      
    case QUESTION_TYPES.PROTECTION:
      redirectMessage += `**I'm still waiting for:** Your decision on device protection.\n\n`;
      redirectMessage += `Please say "Yes, add protection" or "No, skip protection".`;
      break;
      
    case QUESTION_TYPES.CONFIRMATION:
      redirectMessage += `**I'm still waiting for:** Your confirmation.\n\n`;
      redirectMessage += `Please say "Yes" to proceed or "No" to cancel.`;
      break;
      
    case QUESTION_TYPES.CART_ACTION:
      redirectMessage += `**I'm still waiting for:** You to decide what to do with your existing cart.\n\n`;
      redirectMessage += `Please say "Clear cart" to start fresh or "Review cart" to see what's already added.`;
      break;
      
    case QUESTION_TYPES.SHIPPING_NAME:
      redirectMessage += `**I'm still waiting for:** Your first name and last name.\n\n`;
      redirectMessage += `Please provide your first name and last name (e.g., "John Smith" or "My name is Jane Doe").`;
      break;
      
    case QUESTION_TYPES.SHIPPING_CONTACT:
      redirectMessage += `**I'm still waiting for:** Your phone number and email address.\n\n`;
      redirectMessage += `Please provide your phone number and email (e.g., "Phone: 555-123-4567, Email: john@example.com").`;
      break;
      
    case QUESTION_TYPES.SHIPPING_ADDRESS:
      redirectMessage += `**I'm still waiting for:** Your street address, city, state, and ZIP code.\n\n`;
      redirectMessage += `📍 **Quick Option:** Turn on location services to automatically fill your address!\n\n`;
      redirectMessage += `**Or manually provide:** Your complete US address (e.g., "123 Main St, New York, NY 10001").`;
      break;
      
    default:
      redirectMessage += questionText || `Let's continue with your purchase setup.`;
  }
  
  // Add helpful context
  redirectMessage += `\n\n**If you have other questions, I can help with those after we complete this step.**`;
  
  return redirectMessage;
}

/**
 * Check if user response is off-track and generate redirect if needed
 * This is the main function to call when processing user input
 * Enhanced with resume step logic
 * @param {string} userMessage - User's message
 * @param {string} sessionId - Session ID
 * @returns {Object} { isOffTrack: boolean, redirectMessage: string|null, shouldRedirect: boolean }
 */
export function checkAndRedirect(userMessage, sessionId) {
  try {
    const context = getFlowContext(sessionId);
    const resumeStep = context?.resumeStep;
    const currentQuestion = getCurrentQuestion(sessionId);
    
    // If no active question but there's a resume step, check if user wants to resume
    if (!currentQuestion && resumeStep) {
      const intentResult = detectIntent(userMessage);
      const intent = intentResult.intent;
      
      // Map resume steps to expected intents
      const resumeStepIntentMap = {
        'plan_selection': INTENT_TYPES.PLAN,
        'device_selection': INTENT_TYPES.DEVICE,
        // 'sim_selection': INTENT_TYPES.SIM, // Removed - SIM selection no longer needed
        'protection_selection': INTENT_TYPES.PROTECTION,
        'coverage_check': INTENT_TYPES.COVERAGE
      };
      
      const expectedIntent = resumeStepIntentMap[resumeStep];
      if (expectedIntent && intent === expectedIntent) {
        // User is resuming - clear resume step and allow
        clearResumeStep(sessionId);
        logger.info('User resuming previous step', { sessionId, resumeStep, intent });
        return {
          isOffTrack: false,
          redirectMessage: null,
          shouldRedirect: false,
          detectedIntent: intent,
          entities: intentResult.entities,
          resuming: true
        };
      }
    }
    
    // Original on-track check
    const onTrackCheck = checkIfOnTrack(userMessage, sessionId);
    
    if (!onTrackCheck.isOnTrack) {
      const redirectMessage = generateRedirectMessage(sessionId, userMessage);
      
      // If there's a resume step, mention it in redirect
      if (resumeStep && !currentQuestion) {
        const resumeStepMessages = {
          'plan_selection': 'You were selecting plans. Would you like to continue?',
          'device_selection': 'You were browsing devices. Would you like to continue?',
          // 'sim_selection': 'SIM selection is no longer needed - eSIM is automatically set when plans are added.',
          'protection_selection': 'You were considering device protection. Would you like to continue?',
          'coverage_check': 'You were checking coverage. Would you like to continue?'
        };
        
        const resumeMessage = resumeStepMessages[resumeStep];
        if (resumeMessage) {
          redirectMessage += `\n\n**Previous Step:** ${resumeMessage}`;
        }
      }
      
      logger.info('User went off-track, redirecting', {
        sessionId,
        reason: onTrackCheck.reason,
        redirectGenerated: true,
        resumeStep
      });
      
      return {
        isOffTrack: true,
        redirectMessage,
        shouldRedirect: true,
        detectedIntent: onTrackCheck.detectedIntent,
        entities: onTrackCheck.entities
      };
    }
    
    return {
      isOffTrack: false,
      redirectMessage: null,
      shouldRedirect: false,
      detectedIntent: onTrackCheck.detectedIntent,
      entities: onTrackCheck.entities
    };
  } catch (error) {
    logger.error('Error in checkAndRedirect', { error: error.message, sessionId });
    // Fallback: Don't block user, allow them to continue
    return {
      isOffTrack: false,
      redirectMessage: null,
      shouldRedirect: false,
      detectedIntent: INTENT_TYPES.OTHER,
      entities: {}
    };
  }
}

