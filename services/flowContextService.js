import { save, load, loadAsync } from '../utils/storage.js';
import { logger } from '../utils/logger.js';

// Load all flow contexts from storage
const flowContexts = new Map();
let initialized = false;

/**
 * Initialize flow context service from MongoDB or JSON storage
 * Call this after MongoDB connection is established
 */
export async function initializeFlowContextService() {
  if (initialized) return;
  
  try {
    const loadedContexts = await loadAsync('flowContext');
    if (loadedContexts) {
      flowContexts.clear();
      Object.entries(loadedContexts).forEach(([sessionId, context]) => {
  flowContexts.set(sessionId, context);
});
    }
    
    initialized = true;
    logger.info('Flow context service initialized', { 
      contextCount: flowContexts.size 
    });
  } catch (error) {
    logger.warn('Error initializing flow context service, using defaults:', error.message);
    // Fallback to synchronous load if async fails
    const fallbackContexts = load('flowContext') || {};
    Object.entries(fallbackContexts).forEach(([sessionId, context]) => {
      flowContexts.set(sessionId, context);
    });
    initialized = true;
  }
}

// Helper to persist all contexts
function persist() {
  save('flowContext', Object.fromEntries(flowContexts));
}

/**
 * Get flow context for a session
 * @param {string} sessionId - Session ID
 * @returns {Object} Flow context object
 */
export function getFlowContext(sessionId) {
  if (!sessionId) {
    return null;
  }

  let context = flowContexts.get(sessionId);
  
  if (!context) {
    // Create default context with organized structure (inspired by reference model)
    // Maintains backward compatibility with existing fields
    context = {
      // Session metadata (session tracking)
      sessionId,
      flowStage: 'initial',
      resumeStep: null, // Step to return to after answering questions
      lastIntent: null, // Last detected intent (entryIntent/returnTo/lastHandledIntent)
      lastAction: null, // Last action taken
      conversationHistory: [], // Track recent actions (last 10)
      currentQuestion: null, // Current question being asked { type, text, expectedEntities, askedAt }
      lastUpdated: Date.now(),
      
      // Market/coverage data (market section)
      coverageChecked: false,
      coverageZipCode: null,
      zip: null, // General ZIP code storage (postalCode)
      
      // Bundle configuration (bundle section)
      lineCount: null, // lineTotal
      lines: [], // Array of line configurations
      planSelectionMode: 'initial', // initial | applyAll | sequential
      
      // Commerce/cart tracking (commerce section)
      cartRef: null, // Cart reference ID
      
      // Completion gates (completion section - derived but cached for performance)
      missingPrerequisites: [], // Track missing prerequisites
      
      // Global context flags (system memory) - aggregated from lines
      planSelected: false,        // true if ANY line has plan selected
      deviceSelected: false,      // true if ANY line has device selected
      protectionSelected: false,  // true if ANY line has protection selected
      simSelected: false,         // true if ANY line has SIM type selected
      linesConfigured: false      // true if lineCount is set and > 0
    };
    flowContexts.set(sessionId, context);
    persist();
  }
  
  // Ensure backward compatibility: migrate old structure if needed
  if (context && !context.hasOwnProperty('flowStage')) {
    context.flowStage = context.flowStage || 'initial';
  }
  
  // Ensure global flags exist and are up-to-date
  if (context && (!context.hasOwnProperty('planSelected') || 
                  !context.hasOwnProperty('deviceSelected') ||
                  !context.hasOwnProperty('protectionSelected') ||
                  !context.hasOwnProperty('simSelected') ||
                  !context.hasOwnProperty('linesConfigured'))) {
    updateGlobalFlags(context);
    flowContexts.set(sessionId, context);
    persist();
  } else if (context) {
    // Always recompute flags to ensure they're current
    updateGlobalFlags(context);
  }
  
  return context;
}

/**
 * Compute and update global context flags from lines array
 * @param {Object} context - Flow context object
 * @returns {Object} Updated context with global flags
 */
function updateGlobalFlags(context) {
  if (!context) return context;
  
  // Compute global flags from lines array
  context.planSelected = context.lines && context.lines.some(line => line && line.planSelected) || false;
  context.deviceSelected = context.lines && context.lines.some(line => line && line.deviceSelected) || false;
  context.protectionSelected = context.lines && context.lines.some(line => line && line.protectionSelected) || false;
  context.simSelected = context.lines && context.lines.some(line => line && line.simType) || false;
  context.linesConfigured = context.lineCount !== null && context.lineCount > 0;
  
  return context;
}

/**
 * Update flow context with partial updates
 * @param {string} sessionId - Session ID
 * @param {Object} updates - Partial context updates
 * @returns {Object} Updated flow context
 */
export function updateFlowContext(sessionId, updates) {
  if (!sessionId) {
    throw new Error('Session ID is required');
  }

  const context = getFlowContext(sessionId);
  
  // Merge updates
  Object.assign(context, updates, {
    lastUpdated: Date.now()
  });

  // If lineCount is being updated, ensure lines array matches
  if (updates.lineCount !== undefined && updates.lineCount !== null) {
    const newLineCount = updates.lineCount;
    const currentLineCount = context.lines.length;
    
    if (newLineCount > currentLineCount) {
      // Add new lines
      for (let i = currentLineCount + 1; i <= newLineCount; i++) {
        context.lines.push({
          lineNumber: i,
          planSelected: false,
          planId: null,
          deviceSelected: false,
          deviceId: null,
          protectionSelected: false,
          protectionId: null,
          simType: null,
          simIccId: null
        });
      }
    } else if (newLineCount < currentLineCount) {
      // Remove excess lines (keep first N lines)
      context.lines = context.lines.slice(0, newLineCount);
    }
  }
  
  // If lines array is being updated, recompute global flags
  if (updates.lines !== undefined || updates.lineCount !== undefined) {
    updateGlobalFlags(context);
  }

  flowContexts.set(sessionId, context);
  persist();
  
  logger.info('Flow context updated', { 
    sessionId, 
    updates,
    globalFlags: {
      planSelected: context.planSelected,
      deviceSelected: context.deviceSelected,
      protectionSelected: context.protectionSelected,
      simSelected: context.simSelected,
      linesConfigured: context.linesConfigured
    }
  });
  return context;
}

/**
 * Reset flow context for a session
 * @param {string} sessionId - Session ID
 */
export function resetFlowContext(sessionId) {
  if (!sessionId) {
    throw new Error('Session ID is required');
  }

  flowContexts.delete(sessionId);
  persist();
  
  logger.info('Flow context reset', { sessionId });
}

/**
 * Check prerequisites for an action (improved gate logic)
 * @param {string} sessionId - Session ID
 * @param {string} action - Action to check ('checkout', 'add_device', 'add_protection', etc.)
 * @returns {Object} { allowed: boolean, reason: string | null, missing: string[], gate: string }
 *   gate: "OK" | "NEED_LINES" | "NEED_PLANS" | "NEED_SIM" | "NEED_DEVICE" | "OTHER"
 */
export function checkPrerequisites(sessionId, action) {
  const context = getFlowContext(sessionId);
  
  if (!context) {
    return {
      allowed: false,
      reason: 'No flow context found. Please start a purchase flow first.',
      missing: [],
      gate: 'OTHER'
    };
  }

  switch (action) {
    case 'checkout':
      // Checkout gate: requires lineCount, plans for all lines, and SIM types
      if (!context.lineCount || context.lineCount === 0) {
        return {
          allowed: false,
          reason: 'Please specify the number of lines first.',
          missing: ['lineCount'],
          gate: 'NEED_LINES'
        };
      }
      
      const missingPlans = [];
      const missingSims = [];
      
      for (let i = 0; i < context.lineCount; i++) {
        const line = context.lines[i];
        if (!line || !line.planSelected) {
          missingPlans.push(`Line ${i + 1}`);
        }
        if (!line || !line.simType) {
          missingSims.push(`Line ${i + 1}`);
        }
      }
      
      if (missingPlans.length > 0) {
        return {
          allowed: false,
          reason: `Plans are required for all lines. Missing plans for: ${missingPlans.join(', ')}`,
          missing: missingPlans,
          gate: 'NEED_PLANS'
        };
      }
      
      if (missingSims.length > 0) {
        return {
          allowed: false,
          reason: `SIM types are required for all lines. Missing SIM for: ${missingSims.join(', ')}`,
          missing: missingSims,
          gate: 'NEED_SIM'
        };
      }
      
      return { allowed: true, reason: null, missing: [], gate: 'OK' };

    case 'add_device':
      // Device browsing is allowed without plans (non-blocking)
      // But plan is recommended before checkout
      return { allowed: true, reason: null, missing: [], gate: 'OK' };

    case 'add_protection':
      // Protection gate: requires device for the target line
      if (!context.lineCount || context.lineCount === 0) {
        return {
          allowed: false,
          reason: 'Please add devices first before selecting protection.',
          missing: ['devices'],
          gate: 'NEED_DEVICE'
        };
      }
      
      // Check if at least one line has a device
      const hasDevice = context.lines.some(line => line && line.deviceSelected);
      if (!hasDevice) {
        return {
          allowed: false,
          reason: 'Please add a device before selecting protection.',
          missing: ['devices'],
          gate: 'NEED_DEVICE'
        };
      }
      
      return { allowed: true, reason: null, missing: [], gate: 'OK' };

    case 'select_sim':
      // SIM selection requires plans (but not blocking for browsing)
      if (!context.lineCount || context.lineCount === 0) {
        return {
          allowed: false,
          reason: 'Please select plans first.',
          missing: ['plans'],
          gate: 'NEED_PLANS'
        };
      }
      
      return { allowed: true, reason: null, missing: [], gate: 'OK' };

    default:
      return { allowed: true, reason: null, missing: [], gate: 'OK' };
  }
}

/**
 * Get flow progress summary
 * @param {string} sessionId - Session ID
 * @returns {Object} Progress summary
 */
export function getFlowProgress(sessionId) {
  const context = getFlowContext(sessionId);
  
  if (!context || !context.lineCount) {
    return {
      lineCount: 0,
      completedLines: 0,
      progress: 0,
      missing: {
        lineCount: true,
        plans: [],
        devices: [],
        protection: [],
        sim: []
      }
    };
  }

  const completedLines = context.lines.filter(line => 
    line && line.planSelected
  ).length;

  const missing = {
    lineCount: false,
    plans: [],
    devices: [],
    protection: [],
    sim: []
  };

  for (let i = 0; i < context.lineCount; i++) {
    const line = context.lines[i];
    if (!line) continue;
    
    if (!line.planSelected) {
      missing.plans.push(i + 1);
    }
    if (!line.deviceSelected) {
      missing.devices.push(i + 1);
    }
    if (!line.protectionSelected && line.deviceSelected) {
      missing.protection.push(i + 1);
    }
    if (!line.simType) {
      missing.sim.push(i + 1);
    }
  }

  const totalSteps = context.lineCount * 4; // plan, device, protection, sim per line
  const completedSteps = 
    context.lines.reduce((sum, line) => {
      if (!line) return sum;
      return sum + 
        (line.planSelected ? 1 : 0) +
        (line.deviceSelected ? 1 : 0) +
        (line.protectionSelected ? 1 : 0) +
        (line.simType ? 1 : 0);
    }, 0);

  const progress = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  return {
    lineCount: context.lineCount,
    completedLines,
    progress: Math.round(progress),
    missing
  };
}

/**
 * Set resume step for a session
 * @param {string} sessionId - Session ID
 * @param {string} step - Step name to resume to (e.g., 'plan_selection', 'device_selection')
 * @returns {Object} Updated flow context
 */
export function setResumeStep(sessionId, step) {
  if (!sessionId) {
    throw new Error('Session ID is required');
  }

  const context = getFlowContext(sessionId);
  if (context) {
    context.resumeStep = step;
    context.lastUpdated = Date.now();
    flowContexts.set(sessionId, context);
    persist();
    
    logger.info('Resume step set', { sessionId, step });
  }
  
  return context;
}

/**
 * Get resume step for a session
 * @param {string} sessionId - Session ID
 * @returns {string|null} Resume step name or null
 */
export function getResumeStep(sessionId) {
  const context = getFlowContext(sessionId);
  return context ? context.resumeStep : null;
}

/**
 * Clear resume step for a session
 * @param {string} sessionId - Session ID
 */
export function clearResumeStep(sessionId) {
  if (!sessionId) return;
  
  const context = getFlowContext(sessionId);
  if (context) {
    context.resumeStep = null;
    context.lastUpdated = Date.now();
    flowContexts.set(sessionId, context);
    persist();
  }
}

/**
 * Update last intent and action
 * @param {string} sessionId - Session ID
 * @param {string} intent - Intent name
 * @param {string} action - Action name
 */
export function updateLastIntent(sessionId, intent, action) {
  if (!sessionId) return;
  
  const context = getFlowContext(sessionId);
  if (context) {
    context.lastIntent = intent;
    context.lastAction = action;
    context.lastUpdated = Date.now();
    flowContexts.set(sessionId, context);
    persist();
  }
}

/**
 * Add entry to conversation history
 * @param {string} sessionId - Session ID
 * @param {Object} entry - History entry { intent, action, timestamp, data }
 */
export function addConversationHistory(sessionId, entry) {
  if (!sessionId) return;
  
  const context = getFlowContext(sessionId);
  if (context) {
    if (!context.conversationHistory) {
      context.conversationHistory = [];
    }
    
    const historyEntry = {
      intent: entry.intent || null,
      action: entry.action || null,
      timestamp: entry.timestamp || Date.now(),
      data: entry.data || {}
    };
    
    context.conversationHistory.push(historyEntry);
    
    // Keep only last 10 entries
    if (context.conversationHistory.length > 10) {
      context.conversationHistory = context.conversationHistory.slice(-10);
    }
    
    context.lastUpdated = Date.now();
    flowContexts.set(sessionId, context);
    persist();
  }
}

/**
 * Get conversation history
 * @param {string} sessionId - Session ID
 * @param {number} limit - Maximum number of entries to return (default: 10)
 * @returns {Array} Conversation history entries
 */
export function getConversationHistory(sessionId, limit = 10) {
  const context = getFlowContext(sessionId);
  if (!context || !context.conversationHistory) {
    return [];
  }
  
  return context.conversationHistory.slice(-limit);
}

/**
 * Update missing prerequisites
 * @param {string} sessionId - Session ID
 * @param {Array} missing - Array of missing prerequisite names
 */
export function updateMissingPrerequisites(sessionId, missing) {
  if (!sessionId) return;
  
  const context = getFlowContext(sessionId);
  if (context) {
    context.missingPrerequisites = missing || [];
    context.lastUpdated = Date.now();
    flowContexts.set(sessionId, context);
    persist();
  }
}

/**
 * Get global context flags (system memory)
 * Returns aggregated boolean flags from all lines
 * @param {string} sessionId - Session ID
 * @returns {Object} Global context flags
 *   {
 *     planSelected: boolean,
 *     deviceSelected: boolean,
 *     protectionSelected: boolean,
 *     simSelected: boolean,
 *     linesConfigured: boolean,
 *     coverageChecked: boolean
 *   }
 */
export function getGlobalContextFlags(sessionId) {
  const context = getFlowContext(sessionId);
  
  if (!context) {
    return {
      planSelected: false,
      deviceSelected: false,
      protectionSelected: false,
      simSelected: false,
      linesConfigured: false,
      coverageChecked: false
    };
  }
  
  // Ensure flags are up-to-date
  updateGlobalFlags(context);
  
  return {
    planSelected: context.planSelected || false,
    deviceSelected: context.deviceSelected || false,
    protectionSelected: context.protectionSelected || false,
    simSelected: context.simSelected || false,
    linesConfigured: context.linesConfigured || false,
    coverageChecked: context.coverageChecked || false
  };
}
