import { logger } from '../utils/logger.js';

/**
 * Smart line assignment service
 * Intelligently matches items to lines based on context
 */

/**
 * Determine optimal line assignment with smart matching
 * @param {Object} flowContext - Flow context
 * @param {string} itemType - 'device', 'plan', 'protection', 'sim'
 * @param {number} requestedLineNumber - User-specified line number (optional)
 * @returns {Object} { targetLineNumber, suggestion, needsConfirmation, reason }
 */
export function determineOptimalLineAssignment(flowContext, itemType, requestedLineNumber = null) {
  try {
    // Safety: Always return valid line number
    if (!flowContext || !flowContext.lineCount || flowContext.lineCount === 0) {
      return {
        targetLineNumber: 1,
        suggestion: "I'll add this to Line 1. You may want to set up your line count first.",
        needsConfirmation: false,
        reason: 'no_context'
      };
    }

    const lines = flowContext.lines || [];
    const lineCount = flowContext.lineCount;
    let targetLineNumber = null;
    let suggestion = null;
    let needsConfirmation = false;
    let reason = 'auto_assigned';

    // If user specified a line, validate and use it
    if (requestedLineNumber) {
      if (requestedLineNumber < 1) {
        targetLineNumber = 1;
        suggestion = `Line numbers start at 1. I'll add this to Line 1 instead.`;
        needsConfirmation = false;
        reason = 'invalid_line_corrected';
      } else if (requestedLineNumber > lineCount) {
        targetLineNumber = lineCount;
        suggestion = `You specified Line ${requestedLineNumber}, but you only have ${lineCount} line${lineCount > 1 ? 's' : ''}. I'll add this to Line ${lineCount} instead.`;
        needsConfirmation = false;
        reason = 'line_exceeded_corrected';
      } else {
        targetLineNumber = requestedLineNumber;
        reason = 'user_specified';
      }
    } else {
      // Smart auto-assignment based on item type
      switch (itemType) {
        case 'plan':
          // Priority: Lines without plans
          const lineWithoutPlan = lines.findIndex((l, idx) => 
            idx < lineCount && (!l || !l.planSelected)
          );
          if (lineWithoutPlan >= 0) {
            targetLineNumber = lineWithoutPlan + 1;
            suggestion = `I'll add this plan to Line ${targetLineNumber} which needs a plan.`;
          } else {
            // All lines have plans, add to first line or create new
            targetLineNumber = lines.length < lineCount ? lines.length + 1 : 1;
            suggestion = `All lines have plans. I'll add this to Line ${targetLineNumber}.`;
            needsConfirmation = true;
          }
          break;

        case 'device':
          // Priority 1: Lines with plans but no devices (best match)
          const lineWithPlanButNoDevice = lines.findIndex((l, idx) => 
            idx < lineCount && l && l.planSelected && !l.deviceSelected
          );
          
          if (lineWithPlanButNoDevice >= 0) {
            targetLineNumber = lineWithPlanButNoDevice + 1;
            suggestion = `I'll add this device to Line ${targetLineNumber} which has a plan but no device yet.`;
            reason = 'matched_to_plan';
          } else {
            // Priority 2: Any line without device
            const lineWithoutDevice = lines.findIndex((l, idx) => 
              idx < lineCount && (!l || !l.deviceSelected)
            );
            
            if (lineWithoutDevice >= 0) {
              targetLineNumber = lineWithoutDevice + 1;
              const targetLine = lines[targetLineNumber - 1];
              
              if (!targetLine || !targetLine.planSelected) {
                suggestion = `I'll add this device to Line ${targetLineNumber}. Note: You'll need to add a plan to this line before checkout.`;
                needsConfirmation = false; // Don't block, just inform
              } else {
                suggestion = `I'll add this device to Line ${targetLineNumber}.`;
              }
            } else {
              // All lines have devices, add to first available or line 1
              targetLineNumber = lines.length < lineCount ? lines.length + 1 : 1;
              suggestion = `I'll add this device to Line ${targetLineNumber}.`;
            }
          }
          break;

        case 'protection':
          // Only lines with devices can have protection
          const lineWithDeviceButNoProtection = lines.findIndex((l, idx) => 
            idx < lineCount && l && l.deviceSelected && !l.protectionSelected
          );
          
          if (lineWithDeviceButNoProtection >= 0) {
            targetLineNumber = lineWithDeviceButNoProtection + 1;
            suggestion = `I'll add protection to Line ${targetLineNumber} which has a device.`;
            reason = 'matched_to_device';
          } else {
            // No eligible lines - return error state
            return {
              targetLineNumber: null,
              suggestion: `Device protection requires a device. You need to add a device first before adding protection.`,
              needsConfirmation: false,
              reason: 'no_device_for_protection'
            };
          }
          break;

        case 'sim':
          // SIM selection removed - eSIM is automatically set when plan is added
          // This case should not be used, but kept for backward compatibility
          // If somehow called, just return first line with a note
          targetLineNumber = 1;
          suggestion = `Note: SIM selection is no longer needed. eSIM is automatically set when you add a plan.`;
          reason = 'sim_auto_set';
          break;

        default:
          // Fallback: First available line
          targetLineNumber = lines.length < lineCount ? lines.length + 1 : 1;
          suggestion = `I'll add this to Line ${targetLineNumber}.`;
      }
    }

    // Final safety: Ensure we always have a valid line number
    if (!targetLineNumber || targetLineNumber < 1) {
      targetLineNumber = 1;
      suggestion = "I'll add this to Line 1.";
      reason = 'fallback_to_line_1';
    }

    if (targetLineNumber > lineCount) {
      targetLineNumber = lineCount;
      suggestion = `I'll add this to Line ${lineCount} (your last line).`;
      reason = 'capped_to_max_line';
    }

    return {
      targetLineNumber,
      suggestion: suggestion || `I'll add this to Line ${targetLineNumber}.`,
      needsConfirmation,
      reason
    };
  } catch (error) {
    logger.error('Error in determineOptimalLineAssignment', { error: error.message, itemType });
    // Ultimate fallback
    return {
      targetLineNumber: 1,
      suggestion: "I'll add this to Line 1.",
      needsConfirmation: false,
      reason: 'error_fallback'
    };
  }
}

/**
 * Get line assignment summary for user
 * @param {Object} flowContext - Flow context
 * @returns {string} Summary of line assignments
 */
export function getLineAssignmentSummary(flowContext) {
  if (!flowContext || !flowContext.lineCount) {
    return "No lines configured yet.";
  }

  const lines = flowContext.lines || [];
  const summary = [];
  
  for (let i = 1; i <= flowContext.lineCount; i++) {
    const line = lines[i - 1];
    const status = [];
    
    if (line?.planSelected) status.push('Plan');
    if (line?.deviceSelected) status.push('Device');
    if (line?.protectionSelected) status.push('Protection');
    if (line?.simType) status.push('SIM');
    
    summary.push(`Line ${i}: ${status.length > 0 ? status.join(', ') : 'Empty'}`);
  }
  
  return summary.join('\n');
}

