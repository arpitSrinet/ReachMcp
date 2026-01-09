import { logger } from '../utils/logger.js';
import { getFlowProgress, getFlowContext } from './flowContextService.js';

/**
 * Format tool response in three sections: Response, Suggestions, Next Steps
 * @param {string} response - Main response content
 * @param {string} suggestions - Suggestions about the response
 * @param {string} nextSteps - Flow-aligned next steps
 * @returns {string} Formatted three-section response
 */
export function formatThreeSectionResponse(response, suggestions, nextSteps) {
  let formatted = "";
  
  if (response && response.trim()) {
    formatted += response.trim();
  }
  
  if (suggestions && suggestions.trim()) {
    formatted += `\n\n---\n\n### 💡 About This\n${suggestions.trim()}`;
  }
  
  if (nextSteps && nextSteps.trim()) {
    formatted += `\n\n---\n\n### ⏭️ Next Steps\n${nextSteps.trim()}`;
  }
  
  return formatted;
}

/**
 * Conversational guidance service
 * Generates helpful guidance messages, next step suggestions, and nudges
 */

/**
 * Get next steps for a given intent and context (flow-aligned)
 * @param {Object} context - Flow context
 * @param {string} intent - Current intent (coverage, plan, device, protection, sim, checkout)
 * @returns {string} Next steps text
 */
export function getNextStepsForIntent(context, intent) {
  if (!context || !context.sessionId) {
    return "To get started, tell me how many lines you need (e.g., \"I need 2 lines\").";
  }
  
  const progress = getFlowProgress(context.sessionId);
  if (!progress) {
    return "To get started, tell me how many lines you need.";
  }
  
  // Normalize intent
  const intentStr = typeof intent === 'string' ? intent.toLowerCase() : String(intent || '').toLowerCase();
  
  // After coverage check - resume previous step or guide to plans
  if (intentStr === 'coverage') {
    if (context.resumeStep) {
      return "Coverage checked! Returning to where you were in the flow.";
    }
    return "Great! Now let's choose a mobile plan. Say \"Show me plans\" or \"I need a plan\".";
  }
  
  // After showing plans
  if (intentStr === 'plan') {
    if (!progress.lineCount || progress.lineCount === 0) {
      return "**Step 1:** Tell me how many lines you need (e.g., \"I need 2 lines\").\n**Step 2:** Then select a plan for each line by clicking \"Add to Cart\".";
    }
    
    const missingPlans = progress.missing?.plans || [];
    if (missingPlans.length > 0) {
      return `**Action Required:** Click \"Add to Cart\" on a plan above for ${missingPlans.length} line${missingPlans.length > 1 ? 's' : ''}.\n**Options:** You can choose the same plan for all lines or different plans per line.`;
    }
    
    // Plans complete - what's next?
    const missingSims = progress.missing?.sim || [];
    if (missingSims.length > 0) {
      return "**Mandatory Next:** Select SIM type (eSIM or Physical) for each line. Say \"Show SIM options\".\n**Optional:** Add devices before SIM selection. Say \"Show devices\".";
    }
    
    return "**Plans selected!** You can:\n• Add devices (optional): \"Show me devices\"\n• Select SIM types (required): \"Show SIM options\"\n• Review cart: \"Show my cart\"";
  }
  
  // After showing devices
  if (intentStr === 'device') {
    if (!progress.lineCount || progress.lineCount === 0) {
      return "**Step 1:** First tell me how many lines you need.\n**Step 2:** Then select devices for your lines.";
    }
    
    const missingPlans = progress.missing?.plans || [];
    if (missingPlans.length > 0) {
      return "**Note:** You can browse devices now, but you'll need to select plans before checkout.\n**Next:** Say \"Show me plans\" to select plans for your lines.";
    }
    
    return "**After adding device:**\n• Add protection (optional): \"I want device protection\"\n• Continue with plans: \"Show me plans\"\n• Select SIM types: \"Show SIM options\"";
  }
  
  // After protection
  if (intentStr === 'protection') {
    const missingSims = progress.missing?.sim || [];
    if (missingSims.length > 0) {
      return "**Next Required:** Select SIM types for your lines. Say \"Show SIM options\".";
    }
    return "**Protection added!** Ready to:\n• Review cart: \"Show my cart\"\n• Proceed to checkout: \"Checkout\"";
  }
  
  // After SIM selection
  if (intentStr === 'sim') {
    const missingSims = progress.missing?.sim || [];
    if (missingSims.length === 0) {
      return "**All prerequisites complete!**\n• Review your cart: \"Show my cart\"\n• Proceed to checkout: \"I'm ready to checkout\"";
    }
    return `Select SIM types for ${missingSims.length} more line${missingSims.length > 1 ? 's' : ''}, then proceed to checkout.`;
  }
  
  // Checkout intent
  if (intentStr === 'checkout') {
    const missingPlans = progress.missing?.plans || [];
    const missingSims = progress.missing?.sim || [];
    
    if (missingPlans.length > 0) {
      return `**Blocked:** You need to select plans for ${missingPlans.length} line${missingPlans.length > 1 ? 's' : ''} first.\n**Action:** Say \"Show me plans\" to continue.`;
    }
    
    if (missingSims.length > 0) {
      return `**Blocked:** You need to select SIM types for ${missingSims.length} line${missingSims.length > 1 ? 's' : ''}.\n**Action:** Say \"Show SIM options\" to continue.`;
    }
    
    return "**Ready for checkout!** Review your cart and proceed.";
  }
  
  // Default/other intents - provide general guidance
  return "You can:\n• Check coverage: \"What's coverage in my area?\"\n• See plans: \"Show me plans\"\n• Browse devices: \"Show me devices\"\n• Review cart: \"Show my cart\"";
}

/**
 * Get guidance for a specific step
 * @param {string} step - Step name
 * @param {Object} context - Flow context
 * @returns {string} Guidance message
 */
export function getGuidanceForStep(step, context) {
  const progress = getFlowProgress(context?.sessionId);
  
  switch (step) {
    case 'line_count':
      return "To get started, I need to know how many lines you'd like to set up.\n\n**How many lines do you need?**";
    
    case 'plan_selection':
      if (!progress.lineCount || progress.lineCount === 0) {
        return "First, let me know how many lines you need, then I'll show you plans.";
      }
      const missingPlans = progress.missing?.plans || [];
      if (missingPlans.length > 0) {
        return `You need to select plans for ${missingPlans.length} line${missingPlans.length > 1 ? 's' : ''} (${missingPlans.join(', ')}). Would you like to apply the same plan to all lines, or mix & match?`;
      }
      return "Great! All lines have plans. Ready to add devices or proceed to checkout?";
    
    case 'device_selection':
      if (!progress.lineCount || progress.lineCount === 0) {
        return "I can show you devices, but you'll need to select plans before checkout. Would you like to see devices now, or select plans first?";
      }
      return "Which line(s) would you like to add a device for? You can add devices for specific lines or all lines.";
    
    case 'protection_selection':
      const missingDevices = progress.missing?.devices || [];
      if (missingDevices.length > 0) {
        return `Device protection requires a device. You need devices for line${missingDevices.length > 1 ? 's' : ''} ${missingDevices.join(', ')}. Would you like to add devices first?`;
      }
      return "Would you like to add device protection? You can apply it to all lines with devices, or select per line.";
    
    case 'sim_selection':
      const missingSims = progress.missing?.sim || [];
      if (missingSims.length > 0) {
        return `You need to select SIM types for ${missingSims.length} line${missingSims.length > 1 ? 's' : ''} (${missingSims.join(', ')}). Choose eSIM or Physical SIM for each line.`;
      }
      return "All lines have SIM types selected. Ready for checkout?";
    
    case 'checkout':
      return "Reviewing your cart and checking prerequisites...";
    
    default:
      return "What would you like to do next?";
  }
}

/**
 * Get next step suggestions based on current progress (following exact flow order)
 * Flow: Line Count → Plans → Devices → Protection → SIM → Checkout
 * @param {Object} context - Flow context
 * @returns {Object} { nextStep, suggestions, guidance, actionablePrompts }
 */
export function getNextStepSuggestions(context) {
  if (!context) {
    return {
      nextStep: 'line_count',
      suggestions: ['Start by telling me how many lines you need'],
      guidance: "Let's get started! How many lines would you like to set up?",
      actionablePrompts: [
        "Tell me: 'I need 2 lines' or 'family plan for 4'",
        "Say: 'Start purchase flow for 3 lines'"
      ]
    };
  }

  const progress = getFlowProgress(context.sessionId);
  const suggestions = [];
  const actionablePrompts = [];
  let nextStep = null;
  let guidance = "";

  // Flow Step 1: Line Count (foundation)
  if (!progress.lineCount || progress.lineCount === 0) {
    nextStep = 'line_count';
    guidance = "**Step 1: Line Count**\n\nFirst, I need to know how many lines you'd like to set up.";
    suggestions.push("Specify number of lines", "Tell me your line count", "Start with line count");
    actionablePrompts.push(
      "Say: 'I need 2 lines'",
      "Say: 'Start purchase flow for 3 lines'",
      "Say: 'Family plan for 4 lines'"
    );
    return { nextStep, suggestions, guidance, actionablePrompts };
  }

  // Flow Step 2: Plan Selection (mandatory for checkout)
  const missingPlans = progress.missing?.plans || [];
  if (missingPlans.length > 0) {
    nextStep = 'plan_selection';
    guidance = `**Step 2: Plan Selection**\n\nYou need to select plans for ${missingPlans.length} line${missingPlans.length > 1 ? 's' : ''} (${missingPlans.join(', ')}).`;
    suggestions.push("View available plans", "Select a plan", "Choose plan for all lines");
    actionablePrompts.push(
      "Say: 'Show me plans'",
      "Say: 'Add Essentials plan to all lines'",
      "Say: 'Mix & match plans'"
    );
    return { nextStep, suggestions, guidance, actionablePrompts };
  }

  // Flow Step 3: Device Selection (optional, but recommended)
  const missingDevices = progress.missing?.devices || [];
  const hasSomeDevices = context.lines?.some(line => line.deviceSelected) || false;
  if (!hasSomeDevices && missingDevices.length > 0) {
    // Suggest devices but don't block
    nextStep = 'device_selection';
    guidance = `**Step 3: Device Selection (Optional)**\n\nYou can add devices for ${missingDevices.length} line${missingDevices.length > 1 ? 's' : ''} (${missingDevices.join(', ')}). Devices are optional but recommended.`;
    suggestions.push("Browse devices", "Add device for a line", "Skip devices for now");
    actionablePrompts.push(
      "Say: 'Show me devices'",
      "Say: 'Add iPhone to line 1'",
      "Say: 'Skip devices' or 'No devices'"
    );
    // Don't return here - continue to check SIM
  }

  // Flow Step 4: Protection (optional, requires device)
  const linesWithDevices = context.lines?.filter(line => line.deviceSelected) || [];
  const linesNeedingProtection = context.lines?.filter(line => 
    line.deviceSelected && !line.protectionSelected
  ) || [];
  if (linesWithDevices.length > 0 && linesNeedingProtection.length > 0 && nextStep === null) {
    nextStep = 'protection_selection';
    guidance = `**Step 4: Device Protection (Optional)**\n\nYou have devices on ${linesWithDevices.length} line${linesWithDevices.length > 1 ? 's' : ''}. Would you like to add protection?`;
    suggestions.push("Add device protection", "Protect all devices", "Skip protection");
    actionablePrompts.push(
      "Say: 'Add protection to all lines'",
      "Say: 'Skip protection' or 'No protection'"
    );
    // Don't return here - continue to check SIM
  }

  // Flow Step 5: SIM Selection (mandatory for checkout)
  const missingSims = progress.missing?.sim || [];
  if (missingSims.length > 0) {
    nextStep = 'sim_selection';
    guidance = `**Step 5: SIM Type Selection**\n\nYou need to select SIM types for ${missingSims.length} line${missingSims.length > 1 ? 's' : ''} (${missingSims.join(', ')}). Choose eSIM or Physical SIM for each line.`;
    suggestions.push("Select SIM type", "Choose eSIM or Physical SIM", "Set SIM for all lines");
    actionablePrompts.push(
      "Say: 'Show SIM options'",
      "Say: 'eSIM for all lines'",
      "Say: 'Physical SIM for line 1, eSIM for line 2'"
    );
    return { nextStep, suggestions, guidance, actionablePrompts };
  }

  // Flow Step 6: Checkout (all prerequisites met)
  nextStep = 'checkout';
  guidance = "**Step 6: Ready for Checkout** ✅\n\nYour cart is complete! All required items are selected.";
  suggestions.push("Review cart", "Proceed to checkout", "Add optional items");
  actionablePrompts.push(
    "Say: 'Review my cart'",
    "Say: 'Proceed to checkout'",
    "Say: 'Show me my cart'"
  );

  return { nextStep, suggestions, guidance, actionablePrompts };
}

/**
 * Format multiple-choice prompt
 * @param {Array} options - Array of option objects { label, value, description }
 * @returns {string} Formatted prompt
 */
export function formatMultiChoicePrompt(options) {
  if (!options || options.length === 0) {
    return "";
  }

  let prompt = "\n\n**Options:**\n";
  
  options.forEach((option, index) => {
    const number = index + 1;
    prompt += `${number}. ${option.label}`;
    if (option.description) {
      prompt += ` - ${option.description}`;
    }
    prompt += "\n";
  });

  prompt += "\n*You can pick by number or name.*";
  
  return prompt;
}

/**
 * Generate nudge message based on context and intent (flow-aligned)
 * @param {Object} context - Flow context
 * @param {string} intent - Current intent
 * @param {Object} data - Additional data (e.g., coverage result)
 * @returns {string} Nudge message
 */
export function generateNudgeMessage(context, intent, data = {}) {
  if (!context || !context.sessionId) {
    return null;
  }
  
  const progress = getFlowProgress(context.sessionId);
  if (!progress) {
    return null;
  }

  // Normalize intent to string (handle both string and INTENT_TYPES constant)
  // INTENT_TYPES.PLAN = 'plan', INTENT_TYPES.DEVICE = 'device', etc.
  let intentStr = '';
  if (typeof intent === 'string') {
    intentStr = intent.toLowerCase();
  } else if (intent) {
    // If it's an object or something else, try to get the value
    intentStr = String(intent).toLowerCase();
  }
  
  logger.debug("generateNudgeMessage", { 
    originalIntent: intent, 
    normalizedIntent: intentStr,
    hasProgress: !!progress,
    sessionId: context.sessionId 
  });

  switch (intentStr) {
    case 'coverage':
      if (data.coverageResult && data.coverageResult.isValid) {
        const signal = data.coverageResult.signal4g || data.coverageResult.signal5g || 'good';
        if (signal === 'great' || signal === 'good') {
          return "✅ **Coverage looks great in your area!** Ready to choose a plan?";
        } else {
          return "✅ **Coverage is available in your area.** Would you like to see plan options?";
        }
      }
      return "Would you like to check coverage in another area, or proceed to plan selection?";
    
    case 'plan':
      if (progress.missing?.plans && progress.missing.plans.length > 0) {
        return `📋 **Plans added!** You still need to select plans for ${progress.missing.plans.length} more line${progress.missing.plans.length > 1 ? 's' : ''}. Would you like to continue?`;
      }
      // All plans selected - suggest next step
      const missingSims = progress.missing?.sim || [];
      if (missingSims.length > 0) {
        return "✅ **All plans selected!** Next step: Select SIM types for your lines.";
      }
      const missingDevices = progress.missing?.devices || [];
      if (missingDevices.length > 0) {
        return "✅ **Plans selected!** Next: Add devices (optional) or select SIM types.";
      }
      return "✅ **Plans selected!** Your cart is ready. Add devices (optional) or proceed to SIM selection.";
    
    case 'device':
      if (!progress.missing?.plans || progress.missing.plans.length === 0) {
        // Plans are done, suggest protection or SIM
        const linesWithDevices = context.lines?.filter(line => line.deviceSelected) || [];
        const linesNeedingProtection = context.lines?.filter(line => 
          line.deviceSelected && !line.protectionSelected
        ) || [];
        if (linesNeedingProtection.length > 0) {
          return "✅ **Device added!** Would you like to add device protection, or proceed to SIM selection?";
        }
        return "✅ **Device added!** Next: Select SIM types for your lines.";
      } else {
        return "✅ **Device added!** Remember: You'll need to select plans before checkout. Would you like to see plans now?";
      }
    
    case 'protection':
      // After protection, suggest SIM or checkout
      const missingSimsAfterProtection = progress.missing?.sim || [];
      if (missingSimsAfterProtection.length > 0) {
        return "✅ **Protection added!** Next step: Select SIM types for your lines.";
      }
      return "✅ **Protection added!** Your cart is ready. Proceed to checkout or add more items.";
    
    case 'sim':
      if (progress.missing?.sim && progress.missing.sim.length === 0) {
        return "✅ **SIM types selected!** Your cart is complete and ready for checkout!";
      }
      return "✅ **SIM type selected!** Continue selecting SIM types for remaining lines, or proceed to checkout.";
    
    default:
      return "What would you like to do next?";
  }
  
  return null;
}

/**
 * Generate conversational response with next steps (flow-aligned)
 * @param {string} message - Main message
 * @param {Object} context - Flow context
 * @param {string} intent - Current intent
 * @param {Object} actionData - Action data
 * @returns {string} Complete conversational response
 */
export function generateConversationalResponse(message, context, intent, actionData = {}) {
  if (!context || !context.sessionId) {
    logger.debug("generateConversationalResponse: No context or sessionId", { 
      hasContext: !!context, 
      hasSessionId: !!(context && context.sessionId) 
    });
    return message || "";
  }

  let response = message || "";

  // Add nudge if applicable
  if (intent && context) {
    try {
      const nudge = generateNudgeMessage(context, intent, actionData);
      if (nudge && nudge.trim().length > 0) {
        response += (response ? `\n\n${nudge}` : nudge);
        logger.debug("Added nudge message", { intent, nudgeLength: nudge.length });
      } else {
        logger.debug("No nudge generated", { intent, hasContext: !!context });
      }
    } catch (error) {
      logger.error("Error generating nudge message", { error: error.message, intent });
    }
  }

  // Add next step suggestions with actionable prompts
  try {
    const nextSteps = getNextStepSuggestions(context);
    if (nextSteps) {
      const { suggestions, guidance, actionablePrompts, nextStep } = nextSteps;
      
      if (guidance && guidance.trim().length > 0) {
        response += (response ? `\n\n${guidance}` : guidance);
        logger.debug("Added guidance", { nextStep, guidanceLength: guidance.length });
      }
      
      if (actionablePrompts && actionablePrompts.length > 0) {
        response += `\n\n**What you can say:**`;
        actionablePrompts.slice(0, 3).forEach((prompt, index) => {
          response += `\n• ${prompt}`;
        });
        logger.debug("Added actionable prompts", { count: actionablePrompts.length });
      } else if (suggestions && suggestions.length > 0) {
        response += `\n\n**Next Steps:**`;
        suggestions.slice(0, 3).forEach((suggestion, index) => {
          response += `\n${index + 1}. ${suggestion}`;
        });
        logger.debug("Added suggestions", { count: suggestions.length });
      }
    } else {
      logger.warn("getNextStepSuggestions returned null/undefined", { hasContext: !!context });
    }
  } catch (error) {
    logger.error("Error generating next step suggestions", { 
      error: error.message, 
      context: !!context,
      stack: error.stack 
    });
    // Fallback: at least return the nudge if we have it
  }

  const finalResponse = response.trim();
  logger.debug("generateConversationalResponse result", { 
    intent, 
    responseLength: finalResponse.length,
    hasNudge: response.includes("✅"),
    hasGuidance: response.includes("Step")
  });

  return finalResponse || "";
}

/**
 * Get guidance for checkout prerequisites (flow-aligned)
 * @param {Object} context - Flow context
 * @returns {Object} { ready, missing, guidance, actionablePrompts }
 */
export function getCheckoutGuidance(context) {
  if (!context) {
    return {
      ready: false,
      missing: ['line_count'],
      guidance: "**Step 1: Start Purchase Flow**\n\nPlease start a purchase flow first.",
      actionablePrompts: ["Say: 'Start purchase flow for 2 lines'", "Say: 'I need 3 lines'"]
    };
  }

  const progress = getFlowProgress(context.sessionId);
  const missing = [];
  const actionablePrompts = [];

  if (!progress.lineCount || progress.lineCount === 0) {
    missing.push('line_count');
  }

  const missingPlans = progress.missing?.plans || [];
  if (missingPlans.length > 0) {
    missing.push('plans');
  }

  const missingSims = progress.missing?.sim || [];
  if (missingSims.length > 0) {
    missing.push('sim');
  }

  if (missing.length > 0) {
    let guidance = "**Before checkout, complete these steps:**\n\n";
    if (missing.includes('line_count')) {
      guidance += "1. ❌ **Specify the number of lines**\n";
      actionablePrompts.push("Say: 'I need 2 lines'");
    } else {
      guidance += "1. ✅ Line count set\n";
    }
    
    if (missing.includes('plans')) {
      guidance += `2. ❌ **Select plans for ${missingPlans.length} line${missingPlans.length > 1 ? 's' : ''}** (${missingPlans.join(', ')})\n`;
      actionablePrompts.push("Say: 'Show me plans'");
    } else {
      guidance += "2. ✅ Plans selected\n";
    }
    
    if (missing.includes('sim')) {
      guidance += `3. ❌ **Select SIM types for ${missingSims.length} line${missingSims.length > 1 ? 's' : ''}** (${missingSims.join(', ')})\n`;
      actionablePrompts.push("Say: 'Show SIM options'");
    } else {
      guidance += "3. ✅ SIM types selected\n";
    }

    return {
      ready: false,
      missing,
      guidance,
      actionablePrompts
    };
  }

  return {
    ready: true,
    missing: [],
    guidance: "✅ **Your cart is ready for checkout!**\n\nAll required items are selected:\n1. ✅ Line count set\n2. ✅ Plans selected\n3. ✅ SIM types selected",
    actionablePrompts: ["Say: 'Review my cart'", "Say: 'Proceed to checkout'"]
  };
}

/**
 * Format missing prerequisites in a user-friendly way
 * @param {Object} progress - Flow progress object
 * @returns {string} Formatted missing prerequisites message
 */
export function formatMissingPrerequisites(progress) {
  if (!progress || !progress.missing) {
    return "";
  }

  const missing = [];
  const { missing: missingItems } = progress;

  if (progress.lineCount === 0 || !progress.lineCount) {
    missing.push("Line count");
  }

  if (missingItems.plans && missingItems.plans.length > 0) {
    missing.push(`Plans for line${missingItems.plans.length > 1 ? 's' : ''} ${missingItems.plans.join(', ')}`);
  }

  if (missingItems.sim && missingItems.sim.length > 0) {
    missing.push(`SIM types for line${missingItems.sim.length > 1 ? 's' : ''} ${missingItems.sim.join(', ')}`);
  }

  if (missing.length === 0) {
    return "✅ All required items are complete!";
  }

  return `**Missing:** ${missing.join(', ')}`;
}


