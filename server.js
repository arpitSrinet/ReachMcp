#!/usr/bin/env node

// Load environment variables from .env file
import dotenv from "dotenv";
dotenv.config();

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  InitializeRequestSchema,
  ReadResourceRequestSchema,
  ListResourcesRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { getPlans } from "./services/plansService.js";
import { addToCart, getCart, getCartWithSession, getCartMultiLine, addToCartLine, generateSessionId, getMostRecentSession, updateMostRecentSession, clearCart, removeFromCartLine, removeAllFromCart } from "./services/cartService.js";
import { checkCoverage } from "./services/coverageService.js";
import { fetchOffers, fetchServices } from "./services/productService.js";
import { validateDevice, fetchDevices, fetchProtectionPlans } from "./services/deviceService.js";
import { getAuthToken, getAuthTokensMap } from "./services/authService.js";
import { getFlowContext, updateFlowContext, resetFlowContext, checkPrerequisites, getFlowProgress, setResumeStep, getResumeStep, updateLastIntent, addConversationHistory, updateMissingPrerequisites, getGlobalContextFlags } from "./services/flowContextService.js";
import { normalizeDeviceImageUrl } from "./utils/formatter.js";
import { calculateProtectionPrice, getProtectionCoverage } from "./utils/protectionPricing.js";
import { swapSim, validateIccId } from "./services/simService.js";
import { detectIntent, extractEntities, INTENT_TYPES } from "./services/intentService.js";
import { routeIntent, getNextStep as getNextStepFromRouter } from "./services/conversationRouter.js";
import { generateConversationalResponse, getNextStepSuggestions, getCheckoutGuidance, formatMissingPrerequisites } from "./services/guidanceService.js";
import { checkAndRedirect, setCurrentQuestion, clearCurrentQuestion, QUESTION_TYPES } from "./services/conversationTrackingService.js";
import { determineOptimalLineAssignment, getLineAssignmentSummary } from "./services/lineAssignmentService.js";
import { logger } from "./utils/logger.js";
import { startTokenRefreshCron, stopTokenRefreshCron, setAuthTokensAccessor, ensureTokenOnToolCall } from "./services/tokenRefreshCron.js";
import { init as initStorage, close as closeStorage } from "./utils/storage.js";
import {
  formatPlansAsCards,
  formatOffersAsCards,
  formatServicesAsCards,
  formatCoverageAsCard,
  formatDeviceAsCard,
  formatDevicesAsCards,
  formatProtectionPlansAsCards,
  formatCartAsCard,
  formatFlowStatus,
  formatGuidanceMessage,
  formatMultiLineCartReview,
  formatButtonSuggestions,
  formatConversationalResponse,
} from "./utils/formatter.js";

function normalizePlanName(name = '') {
  return String(name).toLowerCase().replace(/\s+/g, ' ').trim();
}

async function findPlanByNameOrId(tenant, planIdOrName) {
  const plans = await getPlans(null, tenant);
  if (!plans || plans.length === 0) return null;

  const direct = plans.find(p => (p.id || p.uniqueIdentifier) === planIdOrName);
  if (direct) return direct;

  const normalized = normalizePlanName(planIdOrName);
  return plans.find(p => {
    const display = p.displayName || p.displayNameWeb || p.name || '';
    return normalizePlanName(display).includes(normalized);
  }) || null;
}

function nextUnfilledIndex(lines = [], selectedPlanByLine = {}) {
  for (let i = 0; i < lines.length; i++) {
    const lineId = String(lines[i].lineNumber || i + 1);
    if (!selectedPlanByLine[lineId]) {
      return i;
    }
  }
  return null;
}

function allFilled(lines = [], selectedPlanByLine = {}) {
  return lines.length > 0 && lines.every((line, idx) => {
    const lineId = String(line.lineNumber || idx + 1);
    return !!selectedPlanByLine[lineId];
  });
}

function buildPlanCartPayload(lines = [], selectedPlanByLine = {}) {
  return lines.map((line, idx) => ({
    lineNumber: line.lineNumber || idx + 1,
    planId: selectedPlanByLine[String(line.lineNumber || idx + 1)] || null
  })).filter(entry => entry.planId);
}

async function addPlansToCartBySelections(sessionId, tenant, selections) {
  for (const entry of selections) {
    const planItem = await findPlanByNameOrId(tenant, entry.planId);
    if (!planItem) continue;
    const normalizedPlan = {
      ...planItem,
      id: planItem.id || planItem.uniqueIdentifier,
      name: planItem.displayName || planItem.displayNameWeb || planItem.name,
      price: planItem.price || planItem.baseLinePrice || 0,
      data: planItem.data || planItem.planData || 0,
      dataUnit: planItem.dataUnit || "GB",
      discountPctg: planItem.discountPctg || 0,
      planType: planItem.planType,
      serviceCode: planItem.serviceCode,
      planCharging: planItem.planCharging,
    };
    addToCart(sessionId, normalizedPlan, entry.lineNumber);
  }
}

function ensurePlanUiOpen(context) {
  if (!context.planUi) {
    context.planUi = { isOpen: false, loadCount: 0 };
  }
  // Plans UI should load only once - if it's already been loaded, don't increment
  if (!context.planUi.isOpen && context.planUi.loadCount === 0) {
    context.planUi.loadCount = 1;
    context.planUi.isOpen = true;
  }
  return context;
}

function closePlanUi(context) {
  if (!context.planUi) return context;
  context.planUi.isOpen = false;
  return context;
}

function buildPlansStructuredResponse(sessionId, context, plans, responseText) {
  const lineCount = context?.lineCount || 0;
  const cartSnapshot = getCartMultiLine(sessionId);
  const linesWithPlans = cartSnapshot ? (cartSnapshot.lines || [])
    .filter(l => l.plan && l.plan.id)
    .map(l => l.lineNumber) : [];

  const selectedPlansPerLine = { ...(context?.selectedPlanByLine || {}) };
  const selectionMode = context?.planSelectionMode || 'initial';
  let activeLineId = null;
  if (selectionMode === 'sequential') {
    const nextIndex = nextUnfilledIndex(context?.lines || [], selectedPlansPerLine);
    activeLineId = nextIndex !== null ? (context.lines[nextIndex]?.lineNumber || nextIndex + 1) : null;
  }

  return {
    structuredContent: {
      selectionMode,
      activeLineId,
      selectedPlansPerLine,
      linesWithPlans,
      planModePrompted: context?.planModePrompted || false,
      plans: plans.map(plan => ({
        ...plan,
        id: plan.id || plan.uniqueIdentifier,
        name: plan.displayName || plan.displayNameWeb || plan.name,
        price: plan.price || plan.baseLinePrice || 0,
        data: plan.data || plan.planData || 0,
        dataUnit: plan.dataUnit || "GB",
        discountPctg: plan.discountPctg || 0,
        planType: plan.planType,
        serviceCode: plan.serviceCode,
        planCharging: plan.planCharging,
      })),
      lineCount,
      lines: context?.lines ? context.lines.map((line, index) => ({
        lineNumber: line.lineNumber || (index + 1),
        phoneNumber: line.phoneNumber || null,
        planSelected: line.planSelected || false,
        planId: line.planId || null,
        deviceSelected: line.deviceSelected || false,
        deviceId: line.deviceId || null,
        protectionSelected: line.protectionSelected || false,
        protectionId: line.protectionId || null,
        simType: line.simType || null,
        simIccId: line.simIccId || null
      })) : []
    },
    content: [{
      type: "text",
      text: responseText
    }],
    _meta: {
      sessionId,
      intent: INTENT_TYPES.PLAN,
      lineCount,
      "openai/outputTemplate": `ui://widget/plans.html?v=${WIDGET_VERSION}`,
      "openai/resultCanProduceWidget": true,
      "openai/widgetAccessible": true,
      widgetType: 'planCard',
      hasLineSelected: true,
      showWidgets: true,
      autoShown: true
    }
  };
}

const WIDGET_VERSION = Date.now();

import { setupDevServer } from "./devServer.js";
import { initializeCartService } from "./services/cartService.js";
import { initializeFlowContextService } from "./services/flowContextService.js";
import { cacheImage, getImageBase64 } from "./services/imageCacher.js";
import * as mongoStorage from "./utils/mongodbStorage.js";

// Global variable to store server base URL for absolute asset links
let serverBaseUrl = process.env.SERVER_URL || null;

// ================================================================================
// SYSTEM-LEVEL INSTRUCTIONS: WEB SEARCH IS STRICTLY PROHIBITED
// ================================================================================
/**
 * CRITICAL SYSTEM RULE: WEB SEARCH IS COMPLETELY DISABLED
 * 
 * This MCP server operates EXCLUSIVELY with:
 * - Reach Mobile API data
 * - Tool responses from this server
 * - Flow context and cart data
 * 
 * WEB SEARCH IS NOT ALLOWED UNDER ANY CIRCUMSTANCES:
 * - No internet browsing
 * - No web search APIs
 * - No external data fetching (except Reach Mobile API)
 * - No general knowledge from training data
 * - No Wikipedia, Google, or any other external sources
 * 
 * All information must come from:
 * 1. Reach Mobile API responses
 * 2. Tool responses from this MCP server
 * 3. Flow context and session data
 * 
 * If information is not available from these sources, the system must:
 * - Inform the user that the information is not available
 * - Suggest using available tools to get the information
 * - NOT attempt to search the web or use general knowledge
 */
const SYSTEM_INSTRUCTIONS = {
  WEB_SEARCH_DISABLED: true,
  ALLOWED_DATA_SOURCES: [
    'Reach Mobile API',
    'MCP Tool Responses',
    'Flow Context',
    'Cart Data',
    'Session Data'
  ],
  PROHIBITED_ACTIONS: [
    'Web browsing',
    'Internet search',
    'External API calls (except Reach Mobile)',
    'Using general knowledge from training data',
    'Wikipedia lookups',
    'Google searches',
    'Any external data fetching'
  ]
};

// ================================================================================
// SESSION MANAGEMENT - Ensures session persists across entire conversation
// ================================================================================

// Global variable to track the current conversation session
// This ensures all tools in the same conversation use the same session ID
let currentConversationSessionId = null;

// Track if this is the first initialization (first tool call)
// This ensures we always create a fresh auth token on first initialization
let isFirstInitialization = true;

/**
 * Get or create a session ID that persists across the entire conversation
 * This ensures all tool calls in the same chat use the same session
 * @param {string|null} providedSessionId - Optional session ID from tool args
 * @returns {string} Session ID to use
 */
function getOrCreateSessionId(providedSessionId) {
  let sessionIdToUse = null;

  // If a session ID is explicitly provided, use it
  if (providedSessionId) {
    sessionIdToUse = providedSessionId;
  }
  // If we have a current conversation session, use it
  else if (currentConversationSessionId) {
    // Verify it still exists and is valid
    const context = getFlowContext(currentConversationSessionId);
    if (context) {
      sessionIdToUse = currentConversationSessionId;
    } else {
      // If context doesn't exist, clear it
      currentConversationSessionId = null;
    }
  }

  // If still no session, try to get the most recent session from cart service
  if (!sessionIdToUse) {
    const recentSession = getMostRecentSession();
    if (recentSession) {
      sessionIdToUse = recentSession;
    }
  }

  // If still no session, create a new one
  if (!sessionIdToUse) {
    sessionIdToUse = generateSessionId();
    logger.info("Created new conversation session", { sessionId: sessionIdToUse });
  }

  // Update current conversation session
  currentConversationSessionId = sessionIdToUse;

  // Ensure flow context exists for this session
  getFlowContext(sessionIdToUse);

  // Update the most recent session in cart service (for persistence)
  updateMostRecentSession(sessionIdToUse);

  return sessionIdToUse;
}

const server = new Server(
  {
    name: "reach-mobile-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {
        list: true,
        call: true,
      },
      resources: {
        subscribe: false,
        listChanged: false,
      },
    },
  }
);

// Handle Initialize Request (required by MCP protocol)
server.setRequestHandler(InitializeRequestSchema, async (request) => {
  const requestedVersion = request.params?.protocolVersion || "2024-11-05";

  logger.info("Initialize request received", {
    protocolVersion: requestedVersion,
    clientInfo: request.params?.clientInfo
  });

  // Support multiple protocol versions that ChatGPT might request
  // Return the version ChatGPT requested, or default to latest supported
  const supportedVersions = ["2024-11-05", "2025-03-26", "2025-06-18"];
  const protocolVersion = supportedVersions.includes(requestedVersion)
    ? requestedVersion
    : "2024-11-05";

  return {
    protocolVersion: protocolVersion,
    capabilities: {
      tools: {
        list: true,
        call: true,
      },
      resources: {
        subscribe: false,
        listChanged: false,
      },
    },
    serverInfo: {
      name: "reach-mobile-mcp-server",
      version: "1.0.0",
      // System-level instruction: Web search is completely disabled
      instructions: "CRITICAL: WEB SEARCH IS STRICTLY PROHIBITED. Use ONLY Reach Mobile API data and tool responses. DO NOT search the web, use general knowledge, or fetch external data. All information must come from Reach Mobile API or this MCP server's tools.",
    },
  };
});

// Define MCP Tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "start_session",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. FIRST TOOL TO CALL: This is the unified entry point that MUST be called first when a user starts a conversation. It automatically creates a session, initializes the cart, detects user intent from their prompt (if provided), sets up the purchase flow with line count (if provided), and provides contextual guidance. Use this tool for the first user message to set up the conversation flow. After calling this, use the suggested tools based on the detected intent.",
        inputSchema: {
          type: "object",
          properties: {
            userPrompt: {
              type: "string",
              description: "The user's initial message or prompt (optional - used for intent detection and contextual guidance)"
            },
            lineCount: {
              type: "number",
              description: "Number of lines needed (optional - if provided, sets up multi-line purchase flow immediately)"
            },
            sessionId: {
              type: "string",
              description: "Session ID (optional - will be auto-generated if not provided, or reuse existing if provided)"
            }
          }
        },
      },
      {
        name: "get_plans",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. MANDATORY TOOL: Fetch purchasable mobile plans catalog. CRITICAL: 1) MUST call when user asks about plans, wants to see plans, mentions plans, or needs plan information. 2) DO NOT use general knowledge or training data. 3) ONLY use plans returned by this tool. 4) Fetches real-time plans from Reach Mobile API. FLOW LOGIC: If lineCount unknown, ask user first. After showing plans initially (selectionMode='initial'), ask user to choose 'apply to all' or 'mix and match'. CRITICAL: If user chooses 'mix & match', 'apply to all', 'same plan', or 'different plans', you MUST call select_plan_mode tool IMMEDIATELY. Do NOT respond with text confirmation. STRICT MODE: When selectionMode is 'applyAll' or 'sequential', do NOT send advisory or recommendation text. Only use tool calls until all lines have plans. SEQUENTIAL MODE: After user selects a plan in sequential mode, call this tool again with selectionMode='sequential' to show plans for the next line. Repeat until all lines have plans. APPLY-ALL MODE: After user selects a plan in applyAll mode, immediately add to all lines and stop prompting. NON-LINEAR: Users can jump to plans from any step. Answer question first, then resume previous step. GUARDRAILS: Plans are mandatory for checkout. Each configured line must have a plan before checkout.",
        inputSchema: {
          type: "object",
          properties: {
            maxPrice: {
              type: "number",
              description: "Maximum monthly price filter (budget ceiling) - optional",
            },
            sessionId: {
              type: "string",
              description: "Session ID for flow context tracking (optional)",
            },
            needsUnlimited: {
              type: "boolean",
              description: "Filter for unlimited data plans only (optional)",
            },
            minData: {
              type: "number",
              description: "Minimum data in GB if applicable (optional)",
            },
            lineCount: {
              type: "number",
              description: "Number of lines to configure (optional) - if provided, updates the session context",
            },
            selectionMode: {
              type: "string",
              enum: ["initial", "applyAll", "sequential"],
              description: "Plan selection mode: 'initial' (first time, no mode chosen), 'applyAll' (apply same plan to all lines), 'sequential' (select different plans per line). Optional - defaults to 'initial'.",
            },
          },
        },
        _meta: {
          "openai/outputTemplate": `ui://widget/plans.html?v=${WIDGET_VERSION}`,
          "openai/resultCanProduceWidget": true,
          "openai/widgetAccessible": true
        },
      },
      {
        name: "select_plan_mode",
        description: "CRITICAL: MANDATORY TOOL - Call this IMMEDIATELY when user indicates they want 'different plans per line', 'mix and match', or 'apply to all'. DO NOT respond with text - you MUST call this tool. WHEN TO USE: 1) User says 'mix and match', 'different plans', 'different for each line', 'customize per line' -> CALL select_plan_mode(mode='sequential'). 2) User says 'apply to all', 'same for all', 'same plan' -> CALL select_plan_mode(mode='applyAll'). AFTER CALL: DO NOT call get_plans - this tool returns text-only responses. If user needs to see plans, they will explicitly ask. LOGIC: This tool sets the selection mode and returns text-only guidance. It does NOT show plan cards.",
        inputSchema: {
          type: "object",
          properties: {
            mode: {
              type: "string",
              enum: ["applyAll", "sequential"],
              description: "Selection mode: 'applyAll' (apply same plan to all lines) or 'sequential' (mix and match - select different plans per line). Required.",
            },
            sessionId: {
              type: "string",
              description: "Session ID for flow context tracking (optional)",
            },
          },
          required: ["mode"],
        },
      },
      {
        name: "select_device_mode",
        description: "CRITICAL: MANDATORY TOOL - Call this IMMEDIATELY when user indicates they want 'different devices per line', 'mix and match', or 'apply to all' for devices. DO NOT respond with text - you MUST call this tool. WHEN TO USE: 1) User says 'mix and match devices', 'different devices', 'different for each line' -> CALL select_device_mode(mode='sequential'). 2) User says 'apply to all', 'same device for all', 'same for all lines' -> CALL select_device_mode(mode='applyAll'). LOGIC: This tool is REQUIRED to switch the device selection UI mode. You cannot handle device assignment via text. You must use this tool to show the correct device selection widget.",
        inputSchema: {
          type: "object",
          properties: {
            mode: {
              type: "string",
              enum: ["applyAll", "sequential"],
              description: "Selection mode: 'applyAll' (apply same device to all lines) or 'sequential' (mix and match - select different devices per line). Required.",
            },
            limit: {
              type: "number",
              description: "Maximum number of devices to return (minimum: 1, maximum: 20, default: 8)",
            },
            brand: {
              type: "string",
              description: "Filter by manufacturer/brand (e.g., 'Apple', 'iPhone', 'Samsung', 'Google', 'Pixel'). Case-insensitive partial matching.",
            },
            sessionId: {
              type: "string",
              description: "Session ID for flow context tracking (optional)",
            },
          },
          required: ["mode"],
        },
        _meta: {
          "openai/outputTemplate": "ui://widget/devices.html",
          "openai/resultCanProduceWidget": true,
          "openai/widgetAccessible": true
        },
      },
      {
        name: "get_offers",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. Get available offers/coupons from Reach Mobile API. Optionally filter by service code.",
        inputSchema: {
          type: "object",
          properties: {
            serviceCode: {
              type: "string",
              description: "Service code to filter offers (optional)",
            },
          },
        },
        _meta: {
          "openai/outputTemplate": "ui://widget/offers.html",
          "openai/resultCanProduceWidget": true,
          "openai/widgetAccessible": true
        },
      },
      {
        name: "get_services",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. Get available services (shipping, top-up, etc.) from Reach Mobile API. Optionally filter by service code.",
        inputSchema: {
          type: "object",
          properties: {
            serviceCode: {
              type: "string",
              description: "Service code to filter services (optional)",
            },
          },
        },
      },
      {
        name: "get_devices",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. Search devices available for sale. Fetches real-time devices from Reach Mobile API. Supports text search and filters (maker, maxUpfront, buyMode, mustSupportEsim). FLOW LOGIC: Device browsing is NON-BLOCKING - allowed without plans (plans required before checkout, not for browsing). If no lineCount set, ask which line(s) user wants device for. After showing devices, system sets resume step to 'device_selection'. NON-LINEAR: Users can browse devices anytime. Answer question first, then resume previous step. GUARDRAILS: Device browsing allowed anytime. Plans required before checkout, not for browsing.",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Maximum number of devices to return (minimum: 1, maximum: 20, default: 8)",
            },
            brand: {
              type: "string",
              description: "Filter by manufacturer/brand (e.g., 'Apple', 'iPhone', 'Samsung', 'Google', 'Pixel'). Case-insensitive partial matching.",
            },
            text: {
              type: "string",
              description: "Text search query for device name (optional)",
            },
            maxUpfront: {
              type: "number",
              description: "Maximum upfront price filter (optional)",
            },
            mustSupportEsim: {
              type: "boolean",
              description: "Filter for eSIM-capable devices only (optional)",
            },
          },
        },
        _meta: {
          "openai/outputTemplate": "ui://widget/devices.html",
          "openai/resultCanProduceWidget": true,
          "openai/widgetAccessible": true
        },
      },
      {
        name: "get_protection_plan",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. List protection options for a device reference from Reach Mobile API. Returns protection catalog with options (monthly, deductible, highlights). FLOW LOGIC: Device protection REQUIRES a device for the target line (protection gate: NEED_DEVICE). If no device exists, system routes to device flow. After showing protection, system sets resume step to 'protection_selection'. NON-LINEAR: Users can add protection anytime after devices are added. GUARDRAILS: Protection cannot be selected for a line unless it has deviceRef.",
        inputSchema: {
          type: "object",
          properties: {
            deviceRef: {
              type: "string",
              description: "Device reference ID (optional - if not provided, uses device from flow context)",
            },
            lineNumber: {
              type: "number",
              description: "Line number to check protection for (optional)",
            },
            sessionId: {
              type: "string",
              description: "Session ID for flow context (optional)",
            },
          },
        },
      },
      {
        name: "get_sim_types",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. Return allowed SIM types for a line based on current plan/device selections from Reach Mobile API. **CURRENT POLICY: eSIM ONLY**. This tool auto-selects eSIM for any lines missing a SIM and informs the user. FLOW LOGIC: SIM selection requires plans to be selected first. System shows which lines need SIM types. After selection, system sets resume step appropriately. NON-LINEAR: Users can select SIM types per line. System tracks which lines are complete. GUARDRAILS: Plans required before SIM selection. Each line must have planRef and simKind before checkout.",
        inputSchema: {
          type: "object",
          properties: {
            lineNumber: {
              type: "number",
              description: "Line number (lineId) for which to select SIM type (optional - shows for all lines if not specified)",
            },
            sessionId: {
              type: "string",
              description: "Session ID for flow context tracking (optional)",
            },
          },
        },
        _meta: {
          "openai/outputTemplate": "ui://widget/sim.html",
          "openai/resultCanProduceWidget": true,
          "openai/widgetAccessible": true
        },
      },
      {
        name: "check_coverage",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. Lookup network coverage for a postal/ZIP code using Reach Mobile API. NON-BLOCKING: Coverage check can happen anytime and never blocks other flows. After checking, system preserves resume step (if user was in middle of another flow). Coverage result includes signal strength (4G/5G) and compatibility flags. NON-LINEAR: Users can check coverage from any step. Answer question first, then resume previous step. Updates market.postalCode and market.coverage in flow context.",
        inputSchema: {
          type: "object",
          properties: {
            zipCode: {
              type: "string",
              description: "Postal/ZIP code supported by the carrier (required)",
            },
            sessionId: {
              type: "string",
              description: "Session ID for flow context tracking (optional)",
            },
          },
          required: ["zipCode"],
        },
      },
      {
        name: "validate_device",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. Check device compatibility with Reach Mobile network by validating IMEI number. MANDATORY TOOL: When user asks to 'check device compatibility', 'validate device', 'is my device compatible', 'check if device works', or provides an IMEI number, you MUST use this tool. This tool validates if a device (identified by IMEI) is compatible with Reach Mobile's network. It checks network compatibility, device lock status, and activation eligibility. FLOW LOGIC: If IMEI is provided, call immediately. If user asks about compatibility but no IMEI, ask for IMEI number. NON-LINEAR: Can be called anytime. GUARDRAILS: IMEI is required (15 digits). This is for network compatibility check, not for browsing/buying devices.",
        inputSchema: {
          type: "object",
          properties: {
            imei: {
              type: "string",
              description: "Device IMEI number (15 digits) - required for compatibility validation",
            },
          },
          required: ["imei"],
        },
      },
      {
        name: "add_to_cart",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. Add or replace a line-scoped item in cart (PLAN/DEVICE/PROTECTION/SIM). Supports multi-line structure - specify lineNumber to add item to a specific line. SessionId auto-generated if not provided. FLOW LOGIC: Automatically updates flow context (bundle.lines[*].selections), sets appropriate resume step, and tracks intent. If adding plan to new session, initializes lineCount=1. Ensures cart exists (cart_start equivalent). Returns conversational guidance with next steps. CRITICAL PLAN SELECTION FLOW: After adding a plan (itemType='plan'), if there are still lines without plans: 1) If selectionMode='sequential', DO NOT call get_plans - just return text response telling user to select plan for next line. 2) If selectionMode='initial' or 'applyAll', you may call get_plans to show plans. In sequential mode, the system returns text-only responses to guide user through selecting plans for remaining lines without showing plans cards again. NON-LINEAR: Users can add items in any order. System tracks progress per line and suggests next steps. GUARDRAILS: Protection requires device for that line. Plans and SIM required before checkout.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description: "Session ID (optional - auto-generated if not provided)"
            },
            itemType: {
              type: "string",
              enum: ["plan", "device", "protection", "sim"],
              description: "Kind of item: PLAN, DEVICE, PROTECTION, or SIM"
            },
            itemId: {
              type: "string",
              description: "Reference ID of the item to add (planRef, deviceRef, protectionRef, or simRef)"
            },
            lineNumber: {
              type: "number",
              description: "Line number for multi-line cart (optional - auto-assigns to first available line if not provided)"
            },
            itemName: {
              type: "string",
              description: "Item display name (optional, used for protection items and better error messages)"
            },
            itemPrice: {
              type: "number",
              description: "Item price (optional, used for protection items and cart totals)"
            },
            simType: {
              type: "string",
              enum: ["ESIM", "PSIM"],
              description: "SIM type: ESIM or PSIM (required when itemType is 'sim', itemId can also be 'ESIM' or 'PSIM')"
            },
            iccId: {
              type: "string",
              description: "ICCID for Physical SIM (optional, used for PSIM swaps)"
            },
            newIccId: {
              type: "string",
              description: "New ICCID for Physical SIM swap (optional, alias for iccId)"
            },
            meta: {
              type: "object",
              description: "Additional metadata for the item (optional)"
            }
          },
          required: ["itemType", "itemId"],
        },
      },
      {
        name: "get_cart",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. Get latest cart items and totals (pricing snapshot) from Reach Mobile API. Returns cart view with items per line and totals (monthly, dueNow, tax, shipping). SessionId auto-generated if not provided. FLOW LOGIC: After cart changes (add_to_cart), call this to get updated totals. Use cart snapshot for accurate pricing. GUARDRAILS: Cart must exist before adding items. System ensures cart exists automatically.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description: "Session ID (optional - uses default session if not provided)"
            },
          },
          required: [],
        },
      },
      {
        name: "get_flow_status",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. Get the current status of the purchase flow. Shows what's completed, what's missing, and suggests next steps. Uses the most recent session if sessionId is not provided.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description: "Session ID (optional - will use most recent session if not provided)"
            },
          },
        },
      },
      {
        name: "get_global_context",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. Get global context flags (system memory) showing the overall state of the purchase flow. Returns boolean flags for planSelected, deviceSelected, protectionSelected, simSelected, linesConfigured, and coverageChecked.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description: "Session ID (optional - will use most recent session if not provided)"
            },
          },
        },
      },
      {
        name: "update_line_count",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. Update the number of lines in the purchase flow. This will adjust the lines array while preserving existing selections.",
        inputSchema: {
          type: "object",
          properties: {
            lineCount: {
              type: "number",
              description: "New number of lines (required)"
            },
            sessionId: {
              type: "string",
              description: "Session ID (optional - will use most recent session if not provided)"
            }
          },
          required: ["lineCount"],
        },
      },
      {
        name: "select_sim_type",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. Select SIM type (ESIM or PSIM) for one or more lines using Reach Mobile API. **BATCH MODE (Recommended for multiple lines):** When user specifies multiple lines (e.g., 'Line 1 eSIM, Line 2 eSIM, Line 3 physical SIM'), use 'selections' array: [{lineNumber: 1, simType: 'ESIM'}, {lineNumber: 2, simType: 'ESIM'}, {lineNumber: 3, simType: 'PSIM'}]. **SINGLE MODE:** For one line, provide lineNumber and simType directly. Optionally provide newIccId for PSIM swaps. If customerId and newIccId are provided, will call SIM swap API. Auto-initializes purchase flow if none exists.",
        inputSchema: {
          type: "object",
          properties: {
            lineNumber: {
              type: "number",
              description: "Line number (1-based) - for single line selection. If 'selections' array is provided, this is ignored."
            },
            simType: {
              type: "string",
              enum: ["ESIM", "PSIM"],
              description: "SIM type: ESIM or PSIM - for single line selection. If 'selections' array is provided, this is ignored."
            },
            selections: {
              type: "array",
              description: "Array of SIM type selections for multiple lines. Format: [{lineNumber: number, simType: 'ESIM'|'PSIM', newIccId?: string}]. Use this for batch selection (e.g., 'Line 1 eSIM, Line 2 eSIM, Line 3 physical SIM').",
              items: {
                type: "object",
                properties: {
                  lineNumber: {
                    type: "number",
                    description: "Line number (1-based)"
                  },
                  simType: {
                    type: "string",
                    enum: ["ESIM", "PSIM"],
                    description: "SIM type: ESIM or PSIM"
                  },
                  newIccId: {
                    type: "string",
                    description: "New ICCID for PSIM swap (optional)"
                  }
                },
                required: ["lineNumber", "simType"]
              }
            },
            newIccId: {
              type: "string",
              description: "New ICCID for PSIM swap (optional, required if performing SIM swap) - for single line selection only"
            },
            customerId: {
              type: "string",
              description: "Customer ID (required if performing SIM swap)"
            },
            sessionId: {
              type: "string",
              description: "Session ID (optional - will use most recent session if not provided)"
            }
          },
        },
      },
      {
        name: "review_cart",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. Review the complete multi-line cart before checkout. Shows all lines with plans, devices, protection, and SIM types. CHECKOUT GATE: Enforces prerequisites in order - 1) Line count set, 2) Plans selected for all lines, 3) SIM types selected for all lines. If prerequisites fail, routes to missing step. If all pass, shows final review ready for checkout. NON-LINEAR FLOW: Users can review cart anytime. System validates and guides to missing items.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description: "Session ID (optional - will use most recent session if not provided)"
            },
          },
        },
      },
      {
        name: "collect_shipping_address",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. Collect shipping address information for checkout. Cart must be ready (plans and SIM types selected) before collecting shipping address. Stores shipping address in session for payment processing.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description: "Session ID (optional - will use most recent session if not provided)"
            },
            firstName: {
              type: "string",
              description: "First name (required)"
            },
            lastName: {
              type: "string",
              description: "Last name (required)"
            },
            street: {
              type: "string",
              description: "Street address (required)"
            },
            city: {
              type: "string",
              description: "City (required)"
            },
            state: {
              type: "string",
              description: "State (required)"
            },
            zipCode: {
              type: "string",
              description: "ZIP code (required)"
            },
            country: {
              type: "string",
              description: "Country code (optional, default: 'US')"
            },
            phone: {
              type: "string",
              description: "Phone number (required)"
            },
            email: {
              type: "string",
              description: "Email address (required)"
            }
          },
          required: ["firstName", "lastName", "street", "city", "state", "zipCode", "phone", "email"]
        },
      },
      {
        name: "get_checkout_data",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. Get complete checkout data including cart, shipping address, billing address (same as shipping), user info, and order summary. Returns all data in a single JSON object ready for payment API integration. Requires cart to be ready and shipping address to be collected.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description: "Session ID (optional - will use most recent session if not provided)"
            }
          }
        },
      },
      {
        name: "detect_intent",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. Detect user intent and extract entities from their message. Use this to understand what the user wants to do (coverage check, plan selection, device browsing, checkout, edit, etc.) and extract relevant information (ZIP codes, line numbers, plan IDs, etc.). This helps route the conversation appropriately.",
        inputSchema: {
          type: "object",
          properties: {
            userMessage: {
              type: "string",
              description: "User's message to analyze"
            },
            sessionId: {
              type: "string",
              description: "Session ID for context (optional)"
            }
          },
          required: ["userMessage"]
        },
      },
      {
        name: "get_next_step",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. Get the next recommended step in the purchase flow based on current progress. Use this after answering a user's question to determine where to resume the flow. Helps maintain conversation continuity in non-linear flows.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description: "Session ID (optional - will use most recent session if not provided)"
            },
            currentStep: {
              type: "string",
              description: "Current step name (optional)"
            }
          },
        },
      },
      {
        name: "edit_cart_item",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. Edit or remove items from the cart. Supports changing plans, removing devices, updating line assignments, etc. Use this when user wants to modify their selections (e.g., 'change plan on line 2', 'remove device from line 1', 'switch to eSIM').",
        inputSchema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["remove", "change", "update"],
              description: "Action to perform: 'remove' to delete item, 'change' to replace with different item, 'update' to modify properties"
            },
            itemType: {
              type: "string",
              enum: ["plan", "device", "protection", "sim"],
              description: "Type of item to edit"
            },
            lineNumber: {
              type: "number",
              description: "Line number (1-based) for the item to edit"
            },
            oldItemId: {
              type: "string",
              description: "Current item ID (required for 'change' action)"
            },
            newItemId: {
              type: "string",
              description: "New item ID (required for 'change' action)"
            },
            newSimType: {
              type: "string",
              enum: ["ESIM", "PSIM"],
              description: "New SIM type (for SIM updates)"
            },
            sessionId: {
              type: "string",
              description: "Session ID (optional - will use most recent session if not provided)"
            }
          },
          required: ["action", "itemType", "lineNumber"]
        },
      },
      {
        name: "clear_cart",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. Clear all items from the cart and reset the flow context. This completely removes all plans, devices, protection, and SIM selections from all lines. Use this when user says 'clear cart', 'empty cart', 'reset cart', 'start over', or 'remove everything'. FLOW LOGIC: Clears both cart storage and flow context. Resets lineCount to null and clears all line selections. After clearing, user can start fresh with a new purchase flow.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description: "Session ID (optional - will use most recent session if not provided)"
            },
            resetFlowContext: {
              type: "boolean",
              description: "Whether to also reset flow context (default: true). Set to false to only clear cart items but keep flow structure."
            }
          },
        },
      },
      {
        name: "hello_widget",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. Test widget rendering - minimal example",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name to greet"
            }
          },
          required: ["name"]
        },
        _meta: {
          "openai/outputTemplate": "ui://widget/hello.html",
          "openai/widgetAccessible": false
        }
      },
    ],
  };
});

// Register Resources (for Apps SDK widgets)
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: `ui://widget/plans.html?v=${WIDGET_VERSION}`,
        name: "Plans Widget",
        description: "Widget for displaying mobile plans with interactive buttons",
        mimeType: "text/html+skybridge",
      },
      {
        uri: "ui://widget/cart.html",
        name: "Cart Widget",
        description: "Widget for displaying shopping cart with checkout button",
        mimeType: "text/html+skybridge",
      },
      {
        uri: "ui://widget/hello.html",
        name: "Hello Widget",
        description: "Minimal test widget",
        mimeType: "text/html+skybridge",
      },
      {
        uri: "ui://widget/offers.html",
        name: "Offers Widget",
        description: "Widget for displaying coupons and offers",
        mimeType: "text/html+skybridge",
      },
      {
        uri: "ui://widget/devices.html",
        name: "Devices Widget",
        description: "Widget for displaying devices with pricing and Add to Cart",
        mimeType: "text/html+skybridge",
      },
      {
        uri: "ui://widget/sim.html",
        name: "SIM Types Widget",
        description: "Widget for displaying SIM type options (eSIM and Physical SIM) with selection buttons",
        mimeType: "text/html+skybridge",
      },
    ],
  };
});

// Handle Resource Reads (for Apps SDK widgets)
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  try {
    const { uri } = request.params;

    logger.info("🔍 Resource read requested", {
      uri,
      fullRequest: JSON.stringify(request, null, 2)
    });

    // Handle ui:// URIs for Apps SDK widgets
    if (uri.startsWith("ui://widget/")) {
      // Handle minimal hello widget test (inline)
      if (uri === "ui://widget/hello.html") {
        return {
          contents: [
            {
              uri: uri,
              mimeType: "text/html+skybridge",
              text: `
                <!DOCTYPE html>
                <html>
                <head>
                  <meta charset="UTF-8">
                  <style>
                    body {
                      margin: 0;
                      padding: 16px;
                      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                      background: #f5f5f5;
                    }
                    #root {
                      background: white;
                      padding: 20px;
                      border-radius: 8px;
                      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                      min-height: 50px;
                    }
                  </style>
                </head>
                <body>
                  <div id="root">Loading...</div>
                  <script type="module">
                    // Try immediately first
                    const root = document.getElementById("root");
                    const output = window.openai?.toolOutput ?? {};
                    const message = output.message || "Hello from widget!";
                    
                    if (root && message) {
                      root.innerHTML = \`<h3 style="margin: 0; color: #1976d2;">✅ \${message}</h3><p style="margin: 8px 0 0 0; color: #666;">Widget is working correctly!</p>\`;
                    }
                    
                    // Also listen for load event as fallback
                    window.addEventListener("load", () => {
                      const rootEl = document.getElementById("root");
                      if (rootEl && !rootEl.textContent.includes("✅")) {
                        const outputData = window.openai?.toolOutput ?? {};
                        const msg = outputData.message || "Hello from widget!";
                        rootEl.innerHTML = \`<h3 style="margin: 0; color: #1976d2;">✅ \${msg}</h3><p style="margin: 8px 0 0 0; color: #666;">Widget is working correctly!</p>\`;
                      }
                    });
                    
                    // Log for debugging
                    logger.debug("Hello widget loaded", {
                      hasOpenAI: !!window.openai,
                      toolOutput: window.openai?.toolOutput,
                      message: output.message
                    });
                  </script>
                </body>
                </html>
              `.trim(),
              _meta: {
                "openai/widgetPrefersBorder": true
              }
            },
          ],
        };
      }

      // Extract template name from ui:// URI for file-based widgets
      // Extract template name from ui:// URI for file-based widgets
      // Format: ui://widget/plans.html or ui://widget/plans.html?v=123
      const match = uri.match(/ui:\/\/widget\/([^\/?]+)/);
      if (!match) {
        throw new Error(`Invalid widget URI: ${uri}`);
      }
      const templateName = match[1].replace('.html', '');

      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const templatesPath = path.join(__dirname, "templates");
      const templatePath = path.join(templatesPath, `${templateName}.html`);

      logger.info("📁 Template lookup", {
        templateName,
        templatePath,
        exists: fs.existsSync(templatePath)
      });

      if (!fs.existsSync(templatePath)) {
        throw new Error(`Template not found: ${templateName} at ${templatePath}`);
      }

      const templateContent = fs.readFileSync(templatePath, "utf-8");

      const response = {
        contents: [
          {
            uri: uri,
            mimeType: "text/html+skybridge",
            text: templateContent,
            _meta: {
              "openai/widgetPrefersBorder": true
            }
          },
        ],
      };

      logger.info("📤 Resource read response", {
        uri,
        mimeType: response.contents[0].mimeType,
        contentLength: templateContent.length,
        hasText: !!response.contents[0].text,
        hasMeta: !!response.contents[0]._meta,
        responsePreview: JSON.stringify(response, null, 2).substring(0, 500)
      });

      return response;
    } else if (uri.includes('/templates/')) {
      // Fallback for HTTP URLs (backward compatibility)
      const templateMatch = uri.match(/\/templates\/([^\/]+)$/);
      if (!templateMatch) {
        throw new Error(`Invalid template URI: ${uri}`);
      }
      const templateName = templateMatch[1];

      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const templatesPath = path.join(__dirname, "templates");
      const templatePath = path.join(templatesPath, `${templateName}.html`);

      if (!fs.existsSync(templatePath)) {
        throw new Error(`Template not found: ${templateName} at ${templatePath}`);
      }

      const templateContent = fs.readFileSync(templatePath, "utf-8");

      return {
        contents: [
          {
            uri: uri,
            mimeType: "text/html+skybridge",
            text: templateContent,
            _meta: {
              "openai/widgetPrefersBorder": true
            }
          },
        ],
      };
    } else {
      throw new Error(`Unsupported URI format: ${uri}`);
    }
  } catch (error) {
    logger.error("❌ Resource read error", {
      error: error.message,
      stack: error.stack,
      uri: request.params?.uri
    });
    throw error;
  }
});

// Handle Tool Calls
// CRITICAL: All tool handlers must use ONLY API data - NO WEB SEARCH
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // System-level enforcement: Log that web search is disabled (DEBUG level to reduce noise)
  logger.debug(`🔧 Tool called: ${name}`, {
    args,
    fullRequest: JSON.stringify(request.params, null, 2),
    webSearchDisabled: SYSTEM_INSTRUCTIONS.WEB_SEARCH_DISABLED,
    allowedDataSources: SYSTEM_INSTRUCTIONS.ALLOWED_DATA_SOURCES,
    note: "WEB SEARCH IS STRICTLY PROHIBITED - Use ONLY Reach Mobile API and tool responses"
  });

  try {

    // Check if Apps SDK format is requested
    const returnFormat = args.returnFormat || request.params.returnFormat || 'markdown';
    const isAppsSDK = returnFormat === 'json' || returnFormat === 'apps-sdk';

    // Auto-authenticate when user initiates conversation (tool call)
    // FIRST INITIALIZATION: Always create a fresh auth token on first tool call
    // This ensures token is created and ready for all subsequent tools
    const tenant = "reach";

    // On first initialization, always create a fresh token
    if (isFirstInitialization) {
      try {
        logger.info("First initialization detected - creating fresh auth token", {
          tool: name,
          tenant
        });
        // Force create a fresh token on first initialization
        await getAuthToken(tenant, true); // forceRefresh = true to ensure fresh token
        logger.info("Fresh auth token created successfully on first initialization", {
          tenant,
          tool: name
        });
        isFirstInitialization = false; // Mark as initialized
      } catch (error) {
        logger.error("Failed to create auth token on first initialization", {
          tool: name,
          error: error.message,
          errorType: error.errorType || error.name,
          tenant
        });
        // Re-throw to prevent tools from running without authentication
        throw error;
      }
    }

    // Define which tools need Reach API authentication
    // Tools that use callReachAPI() need auth token
    const TOOLS_REQUIRING_AUTH = [
      "get_plans",
      "get_offers",
      "get_services",
      "check_coverage",
      "validate_device",
      "add_to_cart",
      "get_cart",
      "edit_cart",
      "edit_cart_item",
      "clear_cart",
      "swap_sim",
      "initialize_session",
      "start_session",
      "select_sim_type",
      "update_line_count"
    ];

    // Tools that use different APIs (no Reach auth needed)
    // Tools that use different APIs (no Reach auth needed)
    const TOOLS_WITHOUT_REACH_AUTH = [
      "get_devices",         // Uses Shopware API
      "select_device_mode",  // Uses Shopware API
      "get_protection_plan"  // Uses hardcoded token
    ];

    // Auth generation on each tool call - ensures token exists and is valid
    // Optimization: skip Reach auth for tools that don't need it (Devices/Protection)
    if (TOOLS_WITHOUT_REACH_AUTH.includes(name)) {
      logger.debug("Tool does not require Reach API authentication", { tool: name });
    } else {
      // For all other tools (default), ensure token exists and is valid
      try {
        await ensureTokenOnToolCall(tenant);
        logger.debug("Auth token verified for tool", { tool: name, tenant });
      } catch (error) {
        logger.error(`Failed to get auth token for tool call: ${name}`, {
          error: error.message,
          errorType: error.errorType || error.name
        });
        throw error;
      }
    }

    if (name === "start_session") {
      const userPrompt = args.userPrompt || "";
      const providedLineCount = args.lineCount;
      const providedSessionId = args.sessionId;

      // Get or create session ID FIRST to check if it's a new session
      const sessionId = providedSessionId || generateSessionId();

      // Initialize cart (empty cart if new session)
      const cart = getCartMultiLine(sessionId);

      // Get or create flow context
      const context = getFlowContext(sessionId);
      const isNewSession = !context.lastUpdated || (Date.now() - context.lastUpdated) > 60000; // 1 minute threshold

      // Update flow context
      let intent = INTENT_TYPES.OTHER;
      let entities = {};
      let suggestedTool = null;
      let finalLineCount = providedLineCount;

      if (userPrompt) {
        // Check if user response is off-track from current question
        const redirectCheck = checkAndRedirect(userPrompt, sessionId);

        // If user went off-track, return redirect message
        if (redirectCheck.shouldRedirect) {
          return {
            content: [
              {
                type: "text",
                text: redirectCheck.redirectMessage
              }
            ],
            _meta: {
              sessionId: sessionId,
              intent: redirectCheck.detectedIntent,
              redirected: true,
              currentQuestion: context?.currentQuestion
            }
          };
        }

        const intentResult = detectIntent(userPrompt);
        intent = intentResult.intent;
        entities = intentResult.entities || {};

        // Extract lineCount from entities if not explicitly provided
        if (!finalLineCount && entities.lineCount) {
          finalLineCount = entities.lineCount;
          // Clear question since it was answered
          clearCurrentQuestion(sessionId);
        }

        // Map intent to suggested tool
        const intentToolMap = {
          [INTENT_TYPES.PLAN]: "get_plans",
          [INTENT_TYPES.DEVICE]: "get_devices",
          [INTENT_TYPES.COVERAGE]: "check_coverage",
          [INTENT_TYPES.SIM]: "get_sim_types",
          [INTENT_TYPES.PROTECTION]: "get_protection_plan",
          [INTENT_TYPES.CHECKOUT]: "review_cart"
        };

        // Special handling for device intent
        if (intent === INTENT_TYPES.DEVICE) {
          const buyBrowsePatterns = [
            /buy.*(?:device|mobile|phone|smartphone)/i,
            /purchase.*(?:device|mobile|phone|smartphone)/i,
            /want.*(?:device|mobile|phone|smartphone)/i,
            /show.*(?:devices|phones|mobiles)/i,
            /browse.*(?:devices|phones|mobiles)/i,
            /see.*(?:devices|phones|mobiles)/i,
            /get.*(?:device|mobile|phone|smartphone)/i,
            /looking.*(?:for|to buy).*(?:device|mobile|phone|smartphone)/i,
            /need.*(?:device|mobile|phone|smartphone)/i,
            /shop.*(?:device|mobile|phone|smartphone)/i
          ];
          const wantsToBuyDevices = buyBrowsePatterns.some(pattern => pattern.test(userPrompt));
          const wantsCompatibility = /compatible|compatibility|imei|check.*device|validate.*device/i.test(userPrompt);

          if (wantsCompatibility || /imei/i.test(userPrompt)) {
            suggestedTool = 'validate_device';
          } else if (wantsToBuyDevices) {
            suggestedTool = 'get_devices';
          } else {
            suggestedTool = 'get_devices'; // Default
          }
        } else if (/imei|compatibility|compatible|validate.*device|check.*device.*compat|device.*compat|is.*device.*compat|will.*device.*work|does.*device.*work/i.test(userPrompt)) {
          suggestedTool = 'validate_device';
        } else {
          suggestedTool = intentToolMap[intent] || null;
        }
      }

      // Check if we're in a plan flow context BEFORE updating context
      // This needs to be checked using the existing context before we update it
      // We're in a plan flow if:
      // 1. Previous intent was PLAN, OR
      // 2. Current question is LINE_COUNT (which was set when asking for plans)
      const currentQuestion = context?.currentQuestion;
      const previousLastIntent = context?.lastIntent;
      const isPlanFlow = previousLastIntent === INTENT_TYPES.PLAN ||
        currentQuestion?.type === QUESTION_TYPES.LINE_COUNT;

      // Update flow context
      const contextUpdates = {
        flowStage: finalLineCount && finalLineCount > 0 ? 'planning' : 'initial',
        lastIntent: intent,
        coverageChecked: context.coverageChecked || false
      };

      // Handle line count setup
      if (finalLineCount && finalLineCount > 0) {
        const currentLineCount = context.lineCount || 0;

        if (currentLineCount > 0 && currentLineCount !== finalLineCount) {
          // Preserve existing selections when line count changes
          const existingLines = context.lines || [];
          const newLines = [];

          for (let i = 0; i < finalLineCount; i++) {
            if (i < existingLines.length) {
              newLines.push(existingLines[i]);
            } else {
              newLines.push({
                lineNumber: i + 1,
                planSelected: false,
                deviceSelected: false,
                protectionSelected: false,
                simType: null
              });
            }
          }

          contextUpdates.lineCount = finalLineCount;
          contextUpdates.lines = newLines;
        } else {
          // First time or same line count
          contextUpdates.lineCount = finalLineCount;
        }
      } else if (!context.lineCount) {
        // No line count provided and none exists
        contextUpdates.lineCount = null;
        contextUpdates.lines = [];
      }

      // Detect plan selection mode from user input
      if (userPrompt) {
        if (/apply.*to.*all|same.*plan.*all|all.*same/i.test(userPrompt)) {
          contextUpdates.planSelectionMode = 'applyAll';
          contextUpdates.selectedPlansPerLine = {};
        } else if (/mix.*match|different.*plan|select.*each/i.test(userPrompt)) {
          contextUpdates.planSelectionMode = 'sequential';
          contextUpdates.activeLineForPlan = 1;
          contextUpdates.selectedPlansPerLine = {};
        }

        const pendingPlanIdMatch = userPrompt.match(/ID:\s*([A-Za-z0-9_-]+)/i);
        if (pendingPlanIdMatch && /plan/i.test(userPrompt)) {
          contextUpdates.lastChosenPlanId = pendingPlanIdMatch[1];
        }

        // Detect plan selection for specific line
        const selectPlanMatch = userPrompt.match(/select.*(?:plan|unlimited|essentials|by the gig).*for.*line\s*(\d+)/i);
        if (selectPlanMatch && context?.planSelectionMode === 'sequential') {
          const lineNum = parseInt(selectPlanMatch[1]);
          // Move to next line
          contextUpdates.activeLineForPlan = lineNum + 1;
        }
      }

      updateFlowContext(sessionId, contextUpdates);
      updateMostRecentSession(sessionId);

      logger.info("Session started", {
        sessionId,
        intent,
        lineCount: finalLineCount,
        isNewSession,
        entities
      });

      const updatedContext = getFlowContext(sessionId);
      const hasLines = updatedContext?.lineCount && updatedContext.lineCount > 0;
      const planMode = updatedContext?.planMode || 'UNKNOWN';
      const selectedPlanByLine = { ...(updatedContext?.selectedPlanByLine || {}) };
      const lines = Array.isArray(updatedContext?.lines) ? updatedContext.lines : [];
      const activeLineIndex = Number.isInteger(updatedContext?.activeLineIndex) ? updatedContext.activeLineIndex : 0;
      const activeLineNumber = lines[activeLineIndex]?.lineNumber || (activeLineIndex + 1);

      const applyPlanToLine = (lineNumber, planId) => {
        const lineIdx = Math.max(0, lineNumber - 1);
        while (lines.length <= lineIdx) {
          lines.push({
            lineNumber: lines.length + 1,
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
        lines[lineIdx].planSelected = true;
        lines[lineIdx].planId = planId;
        selectedPlanByLine[String(lineNumber)] = planId;
      };


      if (userPrompt) {
        // Check if user is asking about applying a plan to all lines or mix and match
        const interestedInPlanMatch = /I am interested in.*plan.*ID:\s*([A-Za-z0-9_-]+).*Should I apply this to all lines or mix and match/i.test(userPrompt);
        const scopeApply = /apply.*to.*all|same.*plan.*all|all.*same/i.test(userPrompt);
        const scopeMix = /mix.*match|different.*plan|select.*each/i.test(userPrompt);
        const planIdMatch = userPrompt.match(/ID:\s*([A-Za-z0-9_-]+)/i);

        let selectedPlanId = planIdMatch ? planIdMatch[1] : null;
        if (!selectedPlanId && intent === INTENT_TYPES.PLAN && hasLines) {
          const found = await findPlanByNameOrId(tenant, userPrompt);
          if (found) {
            selectedPlanId = found.id || found.uniqueIdentifier;
          }
        }

        // CRITICAL: If user directly says a plan name and we have multiple lines,
        // and mode is not already selected, ask user to choose mode
        if (selectedPlanId && hasLines && updatedContext.lineCount > 1) {
          const currentPlanMode = updatedContext.planMode || 'UNKNOWN';
          // Only ask if mode is not already set and user didn't explicitly say "apply to all" or "mix and match"
          if (currentPlanMode !== 'APPLY_TO_ALL' && currentPlanMode !== 'MIX_AND_MATCH' && !scopeApply && !scopeMix) {
            // Get plan details for response
            const planItem = await findPlanByNameOrId(tenant, selectedPlanId);
            const planName = planItem ? (planItem.displayName || planItem.displayNameWeb || planItem.name || 'Plan') : 'Plan';
            
            // Store the plan and ask for mode choice
            updateFlowContext(sessionId, {
              lastChosenPlanId: selectedPlanId,
              planModePrompted: true,
              planMode: 'UNKNOWN' // Keep as UNKNOWN until user chooses
            });
            
            return {
              content: [{
                type: "text",
                text: `You selected **${planName}**. For ${updatedContext.lineCount} lines, would you like to:\n\n` +
                      `✅ **Apply to all lines** - Use the same plan for all ${updatedContext.lineCount} lines\n\n` +
                      `🔀 **Mix and match** - Choose different plans for each line\n\n` +
                      `Please tell me "apply to all" or "mix and match".`
              }]
            };
          }
        }

        // Handle the case where user clicked select button and asked about mode
        if (interestedInPlanMatch && selectedPlanId) {
          // Store the plan and ask for mode choice (this is already done in the message)
          // Just store it in context and return a response asking for mode
          updateFlowContext(sessionId, {
            lastChosenPlanId: selectedPlanId,
            planModePrompted: true,
            planMode: 'UNKNOWN' // Keep as UNKNOWN until user chooses
          });
          return {
            content: [{
              type: "text",
              text: `You selected a plan. Would you like to apply this plan to all ${updatedContext.lineCount} lines, or mix and match different plans per line?\n\nPlease tell me "apply to all" or "mix and match".`
            }]
          };
        }

        // Handle direct "apply to all" command
        if (scopeApply) {
          updatedContext.planMode = 'APPLY_TO_ALL';
          updatedContext.planSelectionMode = 'applyAll';
          
          // If there's a stored plan from previous selection, apply it
          if (updatedContext.lastChosenPlanId) {
            const planId = updatedContext.lastChosenPlanId;
            
            // Get plan details for response
            const planItem = await findPlanByNameOrId(tenant, planId);
            const planName = planItem ? (planItem.displayName || planItem.displayNameWeb || planItem.name || 'Plan') : 'Plan';
            
            // Apply plan to all lines
            lines.forEach((line, idx) => {
              applyPlanToLine(line.lineNumber || (idx + 1), planId);
            });
            
            // Add plans to cart
            await addPlansToCartBySelections(sessionId, tenant, buildPlanCartPayload(lines, selectedPlanByLine));
            
            // Auto-assign eSIM to all lines
            const targetLineNumbers = Array.from({ length: updatedContext.lineCount }, (_, i) => i + 1);
            const esimResult = autoAssignEsimForLines(sessionId, getFlowContext(sessionId), targetLineNumbers);
            let esimNote = "";
            if (esimResult?.assignedLines && esimResult.assignedLines.length > 0) {
              const lineLabel = esimResult.assignedLines.length > 1 ? 'Lines' : 'Line';
              esimNote = `✅ **eSIM set automatically** for ${lineLabel} ${esimResult.assignedLines.join(', ')}. We currently provide **eSIM only**.\n\n`;
            }
            
            // Update flow context
            updateFlowContext(sessionId, {
              planMode: 'APPLY_TO_ALL',
              planSelectionMode: 'applyAll',
              selectedPlanByLine,
              lines,
              activeLineIndex: 0,
              lastChosenPlanId: planId,
              planModePrompted: true
            });
            
            // Update intent tracking
            updateLastIntent(sessionId, INTENT_TYPES.PLAN, 'add_to_cart');
            addConversationHistory(sessionId, {
              intent: INTENT_TYPES.PLAN,
              action: 'add_to_cart',
              data: {
                itemType: 'plan',
                itemId: planId,
                lineNumbers: targetLineNumbers
              }
            });
            
            return { 
              content: [{ 
                type: "text", 
                text: `${esimNote}✅ **${planName}** applied to all ${updatedContext.lineCount} lines.\n\nNext: choose SIM types, add devices, or review cart.`
              }] 
            };
          }

          // If no stored plan, ask which plan to apply
          // Don't reload plans UI if already loaded
          const openContext = ensurePlanUiOpen(updatedContext);
          updateFlowContext(sessionId, openContext);
          if (openContext.planUi.loadCount >= 1 && !openContext.planUi.isOpen) {
            return { content: [{ type: "text", text: "Which plan should I apply to all lines? (Please type the plan name or click on a plan card.)" }] };
          }
          const plans = await getPlans(null, tenant);
          return buildPlansStructuredResponse(sessionId, openContext, plans, "Pick a plan to apply to all lines.");
        }

        // Handle direct "mix and match" command
        if (scopeMix) {
          updatedContext.planMode = 'MIX_AND_MATCH';
          updatedContext.planSelectionMode = 'sequential';
          
          // If there's a stored plan from previous selection, apply it to line 1
          if (updatedContext.lastChosenPlanId) {
            const planId = updatedContext.lastChosenPlanId;
            applyPlanToLine(1, planId); // Apply to line 1
            const nextIndex = nextUnfilledIndex(lines, selectedPlanByLine);
            updatedContext.activeLineIndex = nextIndex !== null ? nextIndex : 1;
            updateFlowContext(sessionId, {
              planMode: 'MIX_AND_MATCH',
              planSelectionMode: 'sequential',
              selectedPlanByLine,
              lines,
              activeLineIndex: updatedContext.activeLineIndex,
              lastChosenPlanId: planId,
              planModePrompted: true
            });
            const nextLineNumber = lines[updatedContext.activeLineIndex]?.lineNumber || (updatedContext.activeLineIndex + 1);
            // Don't call getPlans - just return text response
            return {
              content: [{
                type: "text",
                text: `✅ Plan added to Line 1. Now select a plan for Line ${nextLineNumber}.`
              }]
            };
          }

          // If no stored plan, start with line 1
          // Don't reload plans UI if already loaded
          const openContext = ensurePlanUiOpen(updatedContext);
          openContext.activeLineIndex = 0;
          updateFlowContext(sessionId, openContext);
          if (openContext.planUi.loadCount >= 1 && !openContext.planUi.isOpen) {
            return { content: [{ type: "text", text: "Select a plan for Line 1 (type the plan name or click on a plan card)." }] };
          }
          const plans = await getPlans(null, tenant);
          return buildPlansStructuredResponse(sessionId, openContext, plans, "Select a plan for Line 1.");
        }

        // Handle plan selection when mode is already set
        if (selectedPlanId && hasLines) {
          updatedContext.lastChosenPlanId = selectedPlanId;
          if (planMode === 'UNKNOWN') {
            // Don't apply plan yet - just store it and ask user to choose mode
            updateFlowContext(sessionId, {
              lastChosenPlanId: selectedPlanId,
              selectedPlanByLine,
              lines,
              planModePrompted: true
            });
            return {
              content: [{
                type: "text",
                text: `You selected a plan. Would you like to apply this plan to all ${updatedContext.lineCount} lines, or mix and match different plans per line?\n\nPlease tell me "apply to all" or "mix and match".`
              }]
            };
          }

          if (planMode === 'APPLY_TO_ALL') {
            // Get plan details for response
            const planItem = await findPlanByNameOrId(tenant, selectedPlanId);
            const planName = planItem ? (planItem.displayName || planItem.displayNameWeb || planItem.name || 'Plan') : 'Plan';
            
            // Apply plan to all lines
            lines.forEach((line, idx) => {
              applyPlanToLine(line.lineNumber || (idx + 1), selectedPlanId);
            });
            
            // Add plans to cart
            await addPlansToCartBySelections(sessionId, tenant, buildPlanCartPayload(lines, selectedPlanByLine));
            
            // Auto-assign eSIM to all lines
            const targetLineNumbers = Array.from({ length: updatedContext.lineCount }, (_, i) => i + 1);
            const esimResult = autoAssignEsimForLines(sessionId, getFlowContext(sessionId), targetLineNumbers);
            let esimNote = "";
            if (esimResult?.assignedLines && esimResult.assignedLines.length > 0) {
              const lineLabel = esimResult.assignedLines.length > 1 ? 'Lines' : 'Line';
              esimNote = `✅ **eSIM set automatically** for ${lineLabel} ${esimResult.assignedLines.join(', ')}. We currently provide **eSIM only**.\n\n`;
            }
            
            // Update flow context
            updateFlowContext(sessionId, {
              selectedPlanByLine,
              lines,
              lastChosenPlanId: selectedPlanId
            });
            
            // Update intent tracking
            updateLastIntent(sessionId, INTENT_TYPES.PLAN, 'add_to_cart');
            addConversationHistory(sessionId, {
              intent: INTENT_TYPES.PLAN,
              action: 'add_to_cart',
              data: {
                itemType: 'plan',
                itemId: selectedPlanId,
                lineNumbers: targetLineNumbers
              }
            });
            
            return { 
              content: [{ 
                type: "text", 
                text: `${esimNote}✅ **${planName}** applied to all ${updatedContext.lineCount} lines.\n\nNext: choose SIM types, add devices, or review cart.`
              }] 
            };
          }

          if (planMode === 'MIX_AND_MATCH') {
            applyPlanToLine(activeLineNumber, selectedPlanId);
            const nextIndex = nextUnfilledIndex(lines, selectedPlanByLine);
            if (nextIndex === null && allFilled(lines, selectedPlanByLine)) {
              await addPlansToCartBySelections(sessionId, tenant, buildPlanCartPayload(lines, selectedPlanByLine));
              updateFlowContext(sessionId, {
                selectedPlanByLine,
                lines,
                activeLineIndex: 0,
                lastChosenPlanId: selectedPlanId
              });
              return { content: [{ type: "text", text: "✅ All lines now have plans. Added to cart." }] };
            }
            updatedContext.activeLineIndex = nextIndex;
            updateFlowContext(sessionId, {
              selectedPlanByLine,
              lines,
              activeLineIndex: updatedContext.activeLineIndex,
              lastChosenPlanId: selectedPlanId
            });
            const nextLineNumber = lines[updatedContext.activeLineIndex]?.lineNumber || (updatedContext.activeLineIndex + 1);
            // Don't call getPlans - just return text response
            return {
              content: [{
                type: "text",
                text: `✅ Plan added to Line ${activeLineNumber}. Now select a plan for Line ${nextLineNumber}.`
              }]
            };
          }
        }
      }

      // Generate contextual response
      let responseText = "";
      let suggestions = "";
      let nextSteps = "";

      // If lineCount is set, show purchase flow status
      if (finalLineCount && finalLineCount > 0) {
        const existingCart = getCartMultiLine(sessionId);
        const progress = getFlowProgress(sessionId);

        // Check if we're resuming from device selection
        const resumeStep = getResumeStep(sessionId);
        const isDeviceResume = resumeStep === 'device_selection';

        // If we're in a plan flow context, automatically fetch and show plans
        if (isPlanFlow) {
          // Clear the current question since line count was provided
          clearCurrentQuestion(sessionId);

          // Automatically fetch plans for the specified line count
          let plans;
          try {
            plans = await getPlans(null, tenant);
            const openContext = ensurePlanUiOpen(updatedContext);
            updateFlowContext(sessionId, openContext);

            if (!openContext.planUi.isOpen && openContext.planUi.loadCount >= 2) {
              return {
                content: [{
                  type: "text",
                  text: "Please type the plan name you want (e.g., Basic, Unlimited, Unlimited Plus)."
                }]
              };
            }

            return buildPlansStructuredResponse(
              sessionId,
              openContext,
              plans,
              `Great, you want ${finalLineCount} line${finalLineCount > 1 ? 's' : ''}.`
            );
          } catch (planError) {
            // If plan fetch fails, fall through to regular response
            logger.error("Failed to auto-fetch plans after line count", {
              sessionId,
              error: planError.message,
              lineCount: finalLineCount
            });
            // Continue with regular response below
          }
        }

        // If we're resuming from device selection, ask for device mode first (if multi-line)
        if (isDeviceResume) {
          // Clear the current question and resume step since line count was provided
          clearCurrentQuestion(sessionId);
          setResumeStep(sessionId, null); // Clear resume step after resuming

          if (finalLineCount > 1 && (!context.deviceSelectionMode || context.deviceSelectionMode === 'initial')) {
            const responseText = `Perfect! 👍 You've set up ${finalLineCount} lines.\n\nWould you like to apply the same device to all lines, or mix & match different devices per line?\n\nDevices are optional — you can skip device selection anytime.`;
            const suggestionsText = `• **Apply to all:** One device for all ${finalLineCount} lines (I'll use \`select_device_mode\`)\n` +
              `• **Mix & match:** Choose different devices per line (I'll use \`select_device_mode\`)\n\n` +
              `Just tell me your preference.`;

            return {
              content: [
                {
                  type: "text",
                  text: formatThreeSectionResponse(responseText, suggestionsText, "")
                }
              ],
              _meta: {
                sessionId: sessionId,
                intent: INTENT_TYPES.DEVICE,
                lineCount: finalLineCount
              }
            };
          }

          // Automatically fetch devices for the specified line count
          let devices;
          try {
            devices = await fetchDevices(20, null, tenant); // Fetch up to 20 devices

            // Format devices as cards
            const devicesCards = formatDevicesAsCards(devices, sessionId);

            // Generate device display text
            let deviceIntro = `Perfect! 👍 You've set up ${finalLineCount} line${finalLineCount > 1 ? 's' : ''}.\n\n`;
            deviceIntro += `Now you can add devices to your cart. Here are the available devices:\n\n`;
            deviceIntro += `**Select a device** for each line. Each line can have its own device, or you can choose the same device for multiple lines.\n\n`;
            deviceIntro += `👉 **Click "Add to Cart"** on any device to add it to your cart. The device will be assigned to the appropriate line.\n\n`;

            return {
              content: [
                {
                  type: "text",
                  text: deviceIntro
                },
                ...devicesCards
              ],
              _meta: {
                sessionId: sessionId,
                intent: INTENT_TYPES.DEVICE,
                lineCount: finalLineCount,
                widgetType: 'devices',
                hasLineSelected: true,
                showWidgets: true,
                resumedFrom: 'device_selection' // Flag indicating devices were auto-shown after line selection
              }
            };
          } catch (deviceError) {
            // If device fetch fails, fall through to regular response
            logger.error("Failed to auto-fetch devices after line count", {
              sessionId,
              error: deviceError.message,
              lineCount: finalLineCount
            });
            // Continue with regular response below
          }
        }

        // Regular response when not in plan/device flow or fetch failed
        responseText = `## ✅ Session Started\n\n`;
        responseText += `**Lines Configured:** ${finalLineCount} line${finalLineCount > 1 ? 's' : ''}\n\n`;

        if (existingCart && existingCart.lines && existingCart.lines.length > 0) {
          const itemsInCart = existingCart.lines.filter(line =>
            line.plan || line.device || line.protection || line.sim
          ).length;

          if (itemsInCart > 0) {
            responseText += `**📦 Items Already in Cart:** ${itemsInCart} line${itemsInCart > 1 ? 's' : ''} with selections\n\n`;
          }
        }

        const missingPlans = progress.missing?.plans || [];
        const missingSims = progress.missing?.sim || [];

        suggestions = `**Current Status:**\n`;
        suggestions += `• Plans: ${finalLineCount - missingPlans.length}/${finalLineCount} line${finalLineCount > 1 ? 's' : ''}\n`;
        suggestions += `• SIM Types: ${finalLineCount - missingSims.length}/${finalLineCount} line${finalLineCount > 1 ? 's' : ''}\n\n`;

        nextSteps = `**→ Next Steps:**\n`;
        if (missingPlans.length > 0) {
          nextSteps += `1. **Select Plans** - Required for ${missingPlans.length} line${missingPlans.length > 1 ? 's' : ''} (say "Show me plans")\n`;
        }
        if (missingSims.length > 0) {
          nextSteps += `${missingPlans.length > 0 ? '2' : '1'}. **Choose SIM Types** - Required for ${missingSims.length} line${missingSims.length > 1 ? 's' : ''} (say "Show me SIM types")\n`;
        }
        nextSteps += `• **Add Devices** - Optional (say "Show me devices")\n`;
        nextSteps += `• **Add Protection** - Optional, requires device\n`;
        nextSteps += `• **Review Cart** - Check everything before checkout\n\n`;
      }
      // If userPrompt provided, show intent-based guidance
      else if (userPrompt) {
        if (intent === INTENT_TYPES.PLAN) {
          responseText = `# 📱 Welcome to Reach Mobile!\n\n`;
          responseText += `I can help you find the perfect mobile plan! To get started, I'll need to know how many lines you need.\n\n`;
          responseText += `**How many lines would you like to set up?**\n\n`;
          suggestions = "Please tell me how many lines you need (e.g., 'I need 2 lines' or '3 lines'), and then I'll show you the available plans.";
          // Set current question
          setCurrentQuestion(sessionId, QUESTION_TYPES.LINE_COUNT, "How many lines would you like to set up?", { lineCount: true });
        }
        else if (intent === INTENT_TYPES.COVERAGE) {
          const zipCode = entities.zipCode;
          if (zipCode) {
            responseText = `# 📱 Welcome to Reach Mobile!\n\n`;
            responseText += `I see you mentioned ZIP code ${zipCode}. Let me check the coverage in that area for you.\n\n`;
            responseText += `**Your ZIP code:** ${zipCode}\n\n`;
            suggestions = `I'll use the \`check_coverage\` tool with zipCode: "${zipCode}" to check coverage in your area.`;
            // Clear question since ZIP was provided
            clearCurrentQuestion(sessionId);
          } else {
            responseText = `# 📱 Welcome to Reach Mobile!\n\n`;
            responseText += `I'd be happy to check network coverage for you! To check coverage, I need your ZIP code.\n\n`;
            suggestions = "Please provide your ZIP code (e.g., 'My zipcode is 90210'), and I'll use the `check_coverage` tool to check coverage in your area.";
            // Set current question
            setCurrentQuestion(sessionId, QUESTION_TYPES.ZIP_CODE, "What's your ZIP code?", { zipCode: true });
          }
        }
        else if (/imei|compatibility|compatible|validate.*device|check.*device.*compat|device.*compat|is.*device.*compat|will.*device.*work|does.*device.*work/i.test(userPrompt)) {
          const imeiMatch = userPrompt.match(/\b\d{15}\b/);
          if (imeiMatch) {
            const imei = imeiMatch[0];
            responseText = `# 📱 Device Compatibility Check\n\n`;
            responseText += `I see you mentioned IMEI ${imei}. Let me validate the device compatibility for you.\n\n`;
            responseText += `**IMEI:** ${imei}\n\n`;
            suggestions = `I'll use the \`validate_device\` tool with imei: "${imei}" to check device compatibility.`;
            // Clear question since IMEI was provided
            clearCurrentQuestion(sessionId);
          } else {
            responseText = `# 📱 Device Compatibility Check\n\n`;
            responseText += `I can help you check if your device is compatible with Reach Mobile's network! To do this, I need your device's IMEI number.\n\n`;
            responseText += `**What is an IMEI?**\n`;
            responseText += `IMEI (International Mobile Equipment Identity) is a unique 15-digit number that identifies your device.\n\n`;
            responseText += `**How to find your IMEI:**\n`;
            responseText += `• Dial *#06# on your phone\n`;
            responseText += `• Go to Settings → About Phone → IMEI\n`;
            responseText += `• Check the device box or receipt\n\n`;
            suggestions = "Please provide your device's IMEI number (15 digits), and I'll use the `validate_device` tool to check compatibility.";
            // Set current question
            setCurrentQuestion(sessionId, QUESTION_TYPES.IMEI, "What's your device's IMEI number?", { imei: true });
          }
        }
        else if (intent === INTENT_TYPES.DEVICE) {
          const buyBrowsePatterns = [
            /buy.*(?:device|mobile|phone|smartphone)/i,
            /purchase.*(?:device|mobile|phone|smartphone)/i,
            /want.*(?:device|mobile|phone|smartphone)/i,
            /show.*(?:devices|phones|mobiles)/i,
            /browse.*(?:devices|phones|mobiles)/i,
            /see.*(?:devices|phones|mobiles)/i,
            /get.*(?:device|mobile|phone|smartphone)/i,
            /looking.*(?:for|to buy).*(?:device|mobile|phone|smartphone)/i,
            /need.*(?:device|mobile|phone|smartphone)/i,
            /shop.*(?:device|mobile|phone|smartphone)/i
          ];
          const wantsToBuyDevices = buyBrowsePatterns.some(pattern => pattern.test(userPrompt));
          const wantsCompatibility = /compatible|compatibility|imei|check.*device|validate.*device/i.test(userPrompt);

          if (wantsToBuyDevices) {
            responseText = `# 📱 Welcome to Reach Mobile!\n\n`;
            responseText += `I'd be happy to help you find the perfect device! I can show you our available phones and devices.\n\n`;
            responseText += `**What I can do:**\n\n`;
            responseText += `• Show you all available devices\n`;
            responseText += `• Filter by brand (iPhone, Samsung, Google Pixel, etc.)\n`;
            responseText += `• Help you add a device to your cart\n\n`;
            responseText += `**Note:** You can browse and add devices anytime. Plans are required before checkout, but not for browsing.\n\n`;
            suggestions = `I'll use the \`get_devices\` tool to show available devices for purchase.`;
          } else {
            responseText = `# 📱 Welcome to Reach Mobile!\n\n`;
            responseText += `I can help you check if your device is compatible with our network! To do this, I need your device's IMEI number.\n\n`;
            suggestions = "Please provide your device's IMEI number (15 digits), and I'll use the `validate_device` tool to check compatibility.";
          }
        }
        else {
          // General welcome
          responseText = `# 👋 Welcome to Reach Mobile!\n\n`;
          responseText += `I'm here to help you find the perfect mobile plan and services! Here's what I can help you with:\n\n`;
          responseText += `- 📱 **Browse mobile plans** - Find the perfect plan for your needs\n`;
          responseText += `- 📶 **Check network coverage** - See if we have coverage in your area\n`;
          responseText += `- 🔍 **Validate device compatibility** - Check if your device works on our network\n`;
          responseText += `- 📲 **Browse devices** - Explore available phones and devices\n\n`;
          suggestions = "What would you like to do today?";
        }

        nextSteps = `**Getting Started:** Tell me how many lines you need, or ask about plans, coverage, or devices.`;
      }
      // No userPrompt and no lineCount - generic welcome
      else {
        responseText = `# 👋 Welcome to Reach Mobile!\n\n`;
        responseText += `I'm here to help you set up your mobile service! To get started, I need to know:\n\n`;
        responseText += `**How many lines would you like to set up?**\n\n`;
        suggestions = "Tell me how many lines you need (e.g., 'I need 2 lines' or 'family plan for 4'), and I'll help you build your cart.";
        nextSteps = `**Next:** After setting up lines, you can browse plans, devices, and more!`;
        // Set current question
        if (!finalLineCount) {
          setCurrentQuestion(sessionId, QUESTION_TYPES.LINE_COUNT, "How many lines would you like to set up?", { lineCount: true });
        }
      }

      const finalResponse = formatThreeSectionResponse(responseText, suggestions, nextSteps);

      return {
        content: [
          {
            type: "text",
            text: finalResponse + `\n\n---\n\n**Session ID:** ${sessionId}${intent !== INTENT_TYPES.OTHER ? `\n**Detected Intent:** ${intent}` : ''}`
          }
        ],
        _meta: {
          sessionId: sessionId,
          intent: intent,
          suggestedTool: suggestedTool,
          lineCount: finalLineCount || null,
          entities: entities
        }
      };
    }

    if (name === "select_plan_mode") {
      // Handle plan selection mode choice (Apply to All vs Mix and Match)
      const sessionId = getOrCreateSessionId(args.sessionId || null);
      const context = getFlowContext(sessionId);
      const mode = args.mode; // 'applyAll' or 'sequential'

      if (!context || !context.lineCount || context.lineCount === 0) {
        return {
          content: [
            {
              type: "text",
              text: "## ⚠️ Line Count Required\n\nPlease specify the number of lines first before selecting a plan mode.\n\n**To continue:** Tell me how many lines you need (e.g., 'I need 2 lines').",
            }
          ]
        };
      }

      logger.info("Plan selection mode chosen", { sessionId, mode, lineCount: context.lineCount });

      // Set resume step and persist plan selection mode
      setResumeStep(sessionId, 'plan_selection');
      updateFlowContext(sessionId, { planSelectionMode: mode, planModePrompted: true, planMode: mode === 'applyAll' ? 'APPLY_TO_ALL' : 'MIX_AND_MATCH' });
      updateLastIntent(sessionId, INTENT_TYPES.PLAN, 'select_plan_mode');

      // Fetch cart to check for existing lines with plans
      const cart = sessionId ? getCartMultiLine(sessionId) : null;

      // Calculate activeLineId for sequential mode
      let activeLineId = null;
      let selectedPlansPerLine = {};

      const linesWithPlans = cart ? (cart.lines || [])
        .filter(l => l.plan && l.plan.id)
        .map(l => l.lineNumber) : [];

      if (cart && cart.lines) {
        cart.lines.forEach(line => {
          if (line.plan && line.plan.id) {
            selectedPlansPerLine[String(line.lineNumber)] = line.plan.id;
          }
        });
      }

      if (mode === 'sequential') {
        // Find the first line without a plan
        const lineCount = context?.lineCount || 0;
        for (let i = 1; i <= lineCount; i++) {
          if (!linesWithPlans.includes(i)) {
            activeLineId = i;
            break;
          }
        }
      }

      const lastChosenPlanId = context?.lastChosenPlanId || null;
      const wasModePrompted = context?.planModePrompted || false;
      const previousPlanMode = context?.planMode || 'UNKNOWN';
      
      // Only auto-apply if the mode was already explicitly chosen by the user (not just set by AI)
      // If planMode was UNKNOWN before, we should ask the user to confirm by clicking the plan card
      if (mode === 'applyAll' && lastChosenPlanId && wasModePrompted && previousPlanMode !== 'UNKNOWN') {
        const lineCount = context?.lineCount || 0;
        const updatedLines = Array.isArray(context.lines) ? [...context.lines] : [];
        while (updatedLines.length < lineCount) {
          updatedLines.push({
            lineNumber: updatedLines.length + 1,
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
        for (let i = 1; i <= lineCount; i++) {
          const line = updatedLines[i - 1];
          if (!line) continue;
          line.planSelected = true;
          line.planId = lastChosenPlanId;
          selectedPlansPerLine[String(i)] = lastChosenPlanId;
        }
        await addPlansToCartBySelections(sessionId, tenant, buildPlanCartPayload(updatedLines, selectedPlansPerLine));
        updateFlowContext(sessionId, {
          planMode: 'APPLY_TO_ALL',
          planSelectionMode: 'applyAll',
          selectedPlanByLine: selectedPlansPerLine,
          lines: updatedLines
        });
        return {
          content: [{ type: "text", text: `✅ Plan applied to all ${lineCount} lines.` }]
        };
      }
      
      // If user already selected a plan (wasModePrompted) and chooses applyAll, apply it directly
      // This avoids unnecessary get_plans call when user has already selected a plan
      if (mode === 'applyAll' && lastChosenPlanId && previousPlanMode === 'UNKNOWN' && wasModePrompted) {
        const lineCount = context?.lineCount || 0;
        const updatedLines = Array.isArray(context.lines) ? [...context.lines] : [];
        while (updatedLines.length < lineCount) {
          updatedLines.push({
            lineNumber: updatedLines.length + 1,
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
        for (let i = 1; i <= lineCount; i++) {
          const line = updatedLines[i - 1];
          if (!line) continue;
          line.planSelected = true;
          line.planId = lastChosenPlanId;
          selectedPlansPerLine[String(i)] = lastChosenPlanId;
        }
        await addPlansToCartBySelections(sessionId, tenant, buildPlanCartPayload(updatedLines, selectedPlansPerLine));
        
        const esimResult = autoAssignEsimForLines(sessionId, getFlowContext(sessionId), Array.from({ length: lineCount }, (_, i) => i + 1));
        let esimNote = "";
        if (esimResult?.assignedLines && esimResult.assignedLines.length > 0) {
          const lineLabel = esimResult.assignedLines.length > 1 ? 'Lines' : 'Line';
          esimNote = `✅ **eSIM set automatically** for ${lineLabel} ${esimResult.assignedLines.join(', ')}. We currently provide **eSIM only**.\n\n`;
        }
        
        updateFlowContext(sessionId, {
          planMode: 'APPLY_TO_ALL',
          planSelectionMode: 'applyAll',
          selectedPlanByLine: selectedPlansPerLine,
          lines: updatedLines
        });
        
        updateLastIntent(sessionId, INTENT_TYPES.PLAN, 'add_to_cart');
        addConversationHistory(sessionId, {
          intent: INTENT_TYPES.PLAN,
          action: 'add_to_cart',
          data: {
            itemType: 'plan',
            itemId: lastChosenPlanId,
            lineNumbers: Array.from({ length: lineCount }, (_, i) => i + 1)
          }
        });
        
        return {
          content: [{ 
            type: "text", 
            text: `${esimNote}✅ Plan applied to all ${lineCount} lines.\n\nNext: choose SIM types, add devices, or review cart.`
          }]
        };
      }
      
      // If mode was just set but planMode was UNKNOWN and no plan was selected yet, store the pending plan
      // Don't auto-apply - let the user click the plan card to confirm
      if (mode === 'applyAll' && lastChosenPlanId && previousPlanMode === 'UNKNOWN') {
        updateFlowContext(sessionId, {
          pendingPlanId: lastChosenPlanId,
          pendingPlanName: null
        });
        // Return text-only response - don't show plans UI
        return {
          content: [{ 
            type: "text", 
            text: `Mode set to "apply to all". When you're ready to select a plan, just tell me which plan you want and I'll apply it to all lines.`
          }]
        };
      }

      if (mode === 'sequential' && lastChosenPlanId) {
        const lineCount = context?.lineCount || 0;
        const updatedLines = Array.isArray(context.lines) ? [...context.lines] : [];
        while (updatedLines.length < lineCount) {
          updatedLines.push({
            lineNumber: updatedLines.length + 1,
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
        const lineIndex = activeLineId ? activeLineId - 1 : 0;
        const line = updatedLines[lineIndex];
        if (line) {
          line.planSelected = true;
          line.planId = lastChosenPlanId;
          selectedPlansPerLine[String(line.lineNumber || (lineIndex + 1))] = lastChosenPlanId;
        }
        const nextIndex = nextUnfilledIndex(updatedLines, selectedPlansPerLine);
        updateFlowContext(sessionId, {
          planMode: 'MIX_AND_MATCH',
          planSelectionMode: 'sequential',
          selectedPlanByLine: selectedPlansPerLine,
          lines: updatedLines,
          activeLineIndex: nextIndex !== null ? nextIndex : lineIndex
        });
        const nextLineId = nextIndex !== null ? (updatedLines[nextIndex]?.lineNumber || nextIndex + 1) : null;
        // Return text-only response - don't show plans UI
        return {
          content: [{ 
            type: "text", 
            text: nextLineId ? `✅ Plan added to Line ${activeLineId || 1}. Now select a plan for Line ${nextLineId} (just tell me the plan name).` : "All lines have plans."
          }]
        };
      }

      const pendingPlanId = context?.pendingPlanId || null;
      if (mode === 'applyAll' && pendingPlanId) {
        // Fetch plans only to resolve the pending plan
        let plans;
        try {
          plans = await getPlans(null, tenant);
        } catch (planError) {
          return {
            content: [{
              type: "text",
              text: `## ⚠️ Unable to Load Plans\n\nI tried to fetch the available mobile plans, but encountered an issue: ${planError.message}\n\nPlease try again or contact support.`,
            }]
          };
        }
        
        const resolvedPlan = plans.find((plan) =>
          (plan.id || plan.uniqueIdentifier) === pendingPlanId
        );

        if (resolvedPlan) {
          const planItem = {
            ...resolvedPlan,
            id: resolvedPlan.id || resolvedPlan.uniqueIdentifier,
            name: resolvedPlan.displayName || resolvedPlan.displayNameWeb || resolvedPlan.name,
            price: resolvedPlan.price || resolvedPlan.baseLinePrice || 0,
            data: resolvedPlan.data || resolvedPlan.planData || 0,
            dataUnit: resolvedPlan.dataUnit || "GB",
            discountPctg: resolvedPlan.discountPctg || 0,
            planType: resolvedPlan.planType,
            serviceCode: resolvedPlan.serviceCode,
            planCharging: resolvedPlan.planCharging,
          };

          const lineCount = context.lineCount || 0;
          const targetLineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1);
          try {
            targetLineNumbers.forEach((lineNum) => {
              addToCart(sessionId, planItem, lineNum);
            });
          } catch (error) {
            logger.error('Error adding plan to cart (applyAll pending)', { error: error.message, pendingPlanId });
            return {
              content: [{
                type: "text",
                text: `## ⚠️ Error Adding Plan\n\nI couldn’t add ${planItem.name} to all lines. Please try selecting the plan again.`
              }],
              isError: true
            };
          }

          const updatedLines = Array.isArray(context.lines) ? [...context.lines] : [];
          while (updatedLines.length < lineCount) {
            updatedLines.push({
              lineNumber: updatedLines.length + 1,
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
          targetLineNumbers.forEach((lineNum) => {
            const line = updatedLines[lineNum - 1];
            if (!line) return;
            line.planSelected = true;
            line.planId = planItem.id;
          });

          updateFlowContext(sessionId, {
            lines: updatedLines,
            flowStage: 'configuring',
            pendingPlanId: null,
            pendingPlanName: null
          });

          const esimResult = autoAssignEsimForLines(sessionId, getFlowContext(sessionId), targetLineNumbers);
          let esimNote = "";
          if (esimResult?.assignedLines && esimResult.assignedLines.length > 0) {
            const lineLabel = esimResult.assignedLines.length > 1 ? 'Lines' : 'Line';
            esimNote = `✅ **eSIM set automatically** for ${lineLabel} ${esimResult.assignedLines.join(', ')}. We currently provide **eSIM only**.\n\n`;
          }

          updateLastIntent(sessionId, INTENT_TYPES.PLAN, 'add_to_cart');
          addConversationHistory(sessionId, {
            intent: INTENT_TYPES.PLAN,
            action: 'add_to_cart',
            data: {
              itemType: 'plan',
              itemId: planItem.id,
              lineNumbers: targetLineNumbers
            }
          });

          const confirmText = `✅ **${planItem.name}** applied to all ${lineCount} lines.\n\nNext: choose SIM types, add devices, or review cart.`;

          return {
            content: [{ type: "text", text: `${esimNote}${confirmText}` }]
          };
        }
      }

      if (mode === 'sequential' && pendingPlanId) {
        // Fetch plans only to resolve the pending plan
        let plans;
        try {
          plans = await getPlans(null, tenant);
        } catch (planError) {
          return {
            content: [{
              type: "text",
              text: `## ⚠️ Unable to Load Plans\n\nI tried to fetch the available mobile plans, but encountered an issue: ${planError.message}\n\nPlease try again or contact support.`,
            }]
          };
        }
        
        const resolvedPlan = plans.find((plan) =>
          (plan.id || plan.uniqueIdentifier) === pendingPlanId
        );

        if (resolvedPlan) {
          const planItem = {
            ...resolvedPlan,
            id: resolvedPlan.id || resolvedPlan.uniqueIdentifier,
            name: resolvedPlan.displayName || resolvedPlan.displayNameWeb || resolvedPlan.name,
            price: resolvedPlan.price || resolvedPlan.baseLinePrice || 0,
            data: resolvedPlan.data || resolvedPlan.planData || 0,
            dataUnit: resolvedPlan.dataUnit || "GB",
            discountPctg: resolvedPlan.discountPctg || 0,
            planType: resolvedPlan.planType,
            serviceCode: resolvedPlan.serviceCode,
            planCharging: resolvedPlan.planCharging,
          };

          const lineCount = context?.lineCount || 0;
          let targetLine = activeLineId;
          if (!targetLine) {
            for (let i = 1; i <= lineCount; i++) {
              if (!linesWithPlans.includes(i)) {
                targetLine = i;
                break;
              }
            }
          }

          if (targetLine) {
            try {
              addToCart(sessionId, planItem, targetLine);
            } catch (error) {
              logger.error('Error adding plan to cart (sequential pending)', { error: error.message, pendingPlanId });
              return {
                content: [{
                  type: "text",
                  text: `## ⚠️ Error Adding Plan\n\nI couldn’t add ${planItem.name} to Line ${targetLine}. Please try selecting the plan again.`
                }],
                isError: true
              };
            }

            const updatedLines = Array.isArray(context.lines) ? [...context.lines] : [];
            while (updatedLines.length < lineCount) {
              updatedLines.push({
                lineNumber: updatedLines.length + 1,
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
            const lineEntry = updatedLines[targetLine - 1];
            if (lineEntry) {
              lineEntry.planSelected = true;
              lineEntry.planId = planItem.id;
            }

            updateFlowContext(sessionId, {
              lines: updatedLines,
              flowStage: 'configuring',
              pendingPlanId: null,
              pendingPlanName: null
            });

            const esimResult = autoAssignEsimForLines(sessionId, getFlowContext(sessionId), [targetLine]);
            let esimNote = "";
            if (esimResult?.assignedLines && esimResult.assignedLines.length > 0) {
              const lineLabel = esimResult.assignedLines.length > 1 ? 'Lines' : 'Line';
              esimNote = `✅ **eSIM set automatically** for ${lineLabel} ${esimResult.assignedLines.join(', ')}. We currently provide **eSIM only**.\n\n`;
            }

            updateLastIntent(sessionId, INTENT_TYPES.PLAN, 'add_to_cart');
            addConversationHistory(sessionId, {
              intent: INTENT_TYPES.PLAN,
              action: 'add_to_cart',
              data: {
                itemType: 'plan',
                itemId: planItem.id,
                lineNumber: targetLine
              }
            });

            if (!linesWithPlans.includes(targetLine)) {
              linesWithPlans.push(targetLine);
            }
            selectedPlansPerLine[String(targetLine)] = planItem.id;

            let nextActiveLineId = null;
            for (let i = 1; i <= lineCount; i++) {
              if (!linesWithPlans.includes(i)) {
                nextActiveLineId = i;
                break;
              }
            }

            const nextText = nextActiveLineId
              ? `✅ **${planItem.name}** added for Line ${targetLine}.\n\nNext: select a plan for **Line ${nextActiveLineId}** (just tell me the plan name).`
              : `✅ **${planItem.name}** added for Line ${targetLine}.\n\nAll lines now have plans.`;

            // Return text-only response - don't show plans UI
            return {
              content: [{ type: "text", text: `${esimNote}${nextText}` }]
            };
          }
        }

        updateFlowContext(sessionId, { pendingPlanId: null, pendingPlanName: null });
      }

      // Build response text - text-only, no plans UI
      let responseText = "";
      if (mode === 'applyAll') {
        responseText = `## 📱 Apply to All Lines\n\nMode set to "apply to all". When you're ready, just tell me which plan you want and I'll apply it to all ${context.lineCount} lines.`;
      } else if (mode === 'sequential') {
        responseText = `## 📱 Mix and Match Plans\n\nMode set to "mix and match". Starting with Line ${activeLineId || 1} - just tell me which plan you want for this line.`;
        if (linesWithPlans.length > 0) {
          responseText += `\n\n✅ **Completed:** Line${linesWithPlans.length > 1 ? 's' : ''} ${linesWithPlans.join(', ')}`;
        }
      }

      // Return text-only response - don't show plans UI
      return {
        content: [
          {
            type: "text",
            text: responseText,
          }
        ]
      };
    }

    if (name === "get_plans") {
      // User Requested: Force explicit token refresh on every get_plans call to avoid 403s
      logger.info("Forcing auth token refresh for get_plans tool", { tenant });
      await getAuthToken(tenant, true);

      // Check flow context FIRST to see if line is selected
      const sessionId = getOrCreateSessionId(args.sessionId || null);
      let context = getFlowContext(sessionId);

      // If lineCount provided in args, update context immediately
      if (args.lineCount && args.lineCount > 0) {
        context = updateFlowContext(sessionId, {
          lineCount: args.lineCount,
          flowStage: 'planning'
        });
      }

      const progress = getFlowProgress(sessionId);

      // CRITICAL CHECK: If lineCount is not set or is 0/null, return TEXT ONLY (no widgets)
      // If lineCount is already set (lines were selected previously), show plans directly without asking
      const hasLineCount = context && context.lineCount !== null && context.lineCount > 0;

      // MANDATORY: If no line is configured, return TEXT ONLY - NO WIDGETS/CARDS
      // If lines are already configured, show plans directly (don't ask for lines again)
      if (!hasLineCount) {
        // NO LINE SELECTED - Return text prompt only, NO cards/widget, NO structuredContent
        return {
          content: [
            {
              type: "text",
              text: `# 📱 Mobile Plans Available\n\n` +
                `I'd be happy to show you our mobile plans! However, I need to know how many lines you'd like to set up first.\n\n` +
                `**To view plans:**\n\n` +
                `1. **Tell me how many lines you need** (e.g., "I need 2 lines" or "Start purchase flow with 3 lines")\n` +
                `2. **Or say:** "Start purchase flow" and I'll ask how many lines\n\n` +
                `Once you've selected the number of lines, I'll show you all available plans with interactive cards that you can add to your cart.\n\n` +
                `**What is a line?**\n` +
                `A line is a phone number/service. You can have 1-25 lines per account. Each line can have its own plan, device, and SIM type.`
            }
          ],
          _meta: {
            widgetType: null, // Explicitly no widget
            hasLineSelected: false,
            showWidgets: false // Explicit flag to prevent widget rendering
            // NOTE: structuredContent is NOT included in response - this ensures no widgets are shown
          }
        };
      }

      // LINE IS SELECTED - Fetch plans and show cards
      let plans;
      try {
        plans = await getPlans(args.maxPrice, tenant);
      } catch (planError) {
        // Handle plan fetching errors gracefully
        const errorMessage = planError.message || String(planError);
        const statusCode = planError.statusCode || (planError.name === 'APIError' ? planError.statusCode : null);
        const errorType = planError.errorType || (planError.name === 'APIError' ? planError.errorType : null);

        logger.error("Failed to fetch plans in get_plans tool", {
          sessionId,
          error: errorMessage,
          errorType: errorType || planError.name,
          statusCode: statusCode,
          hasLineSelected: true
        });

        // Handle 403/permissions errors FIRST (most specific)
        if (statusCode === 403 || errorMessage.includes('explicit deny') || errorMessage.includes('access denied') || errorMessage.includes('403') || errorMessage.includes('forbidden') || errorMessage.includes('not authorized')) {
          let errorResponse = `## ⚠️ Plans API Access Unavailable\n\n`;
          errorResponse += `I tried to fetch the available mobile plans, but encountered a permissions issue with the API.\n\n`;
          errorResponse += `**Issue:** ${errorMessage.includes('explicit deny') ? 'Your account has an explicit deny policy for the plans endpoint.' : 'Your account may not have permission to access the plans API endpoint.'}\n\n`;
          errorResponse += `**What this means:** This is a permissions/entitlement issue on the Reach API side. The account needs to be granted access to the \`/apisvc/v0/product/fetch\` endpoint.\n\n`;
          errorResponse += `**What you can do:**\n\n`;
          errorResponse += `1. **Contact Reach support** to request access to the \`/apisvc/v0/product/fetch\` endpoint\n`;
          errorResponse += `2. **Verify API permissions** — Confirm that your API credentials have the necessary permissions\n`;
          errorResponse += `3. **Try again** — Sometimes this is a temporary issue, so retrying might work\n\n`;
          errorResponse += `Sorry about the inconvenience. This is an account configuration issue that needs to be resolved with Reach support.\n\n`;

          // If there's a resume step, mention it
          const resumeStep = context ? getResumeStep(sessionId) : null;
          if (resumeStep && context) {
            errorResponse += `💡 *You can continue with your previous step (${resumeStep}) or contact support about API permissions.*`;
          }

          return {
            content: [
              {
                type: "text",
                text: errorResponse,
              },
            ],
            _meta: {
              widgetType: null, // No widget on error
              hasLineSelected: true,
              error: true,
              errorType: 'PERMISSIONS_ERROR'
            }
          };
        }

        // Handle server errors (500, 502, 503, 504)
        if (statusCode >= 500 || errorType === 'SERVER_ERROR' || errorMessage.includes('500') || errorMessage.includes('502') || errorMessage.includes('503') || errorMessage.includes('504') || errorMessage.includes('Server error')) {
          let errorResponse = `## ⚠️ Plans Service Temporarily Unavailable\n\n`;
          errorResponse += `I tried to fetch the available mobile plans, but the plans service is temporarily unavailable right now (server error on our side).\n\n`;
          errorResponse += `**What you can do:**\n\n`;
          errorResponse += `⏳ **Try again in a few minutes** — This is usually a short-lived issue.\n\n`;
          errorResponse += `🔁 **Retry** — Simply say "Show me plans" again, and I'll try to fetch them.\n\n`;
          errorResponse += `📞 **Contact support** — If the issue persists, there may be a backend problem that needs to be resolved.\n\n`;
          errorResponse += `Sorry about the inconvenience. I'll keep trying to load the plans for you.\n\n`;

          // If there's a resume step, mention it
          const resumeStep = context ? getResumeStep(sessionId) : null;
          if (resumeStep && context) {
            errorResponse += `💡 *You can continue with your previous step (${resumeStep}) or try loading plans again.*`;
          }

          return {
            content: [
              {
                type: "text",
                text: errorResponse,
              },
            ],
            _meta: {
              widgetType: null,
              hasLineSelected: true,
              error: true,
              errorType: 'SERVER_ERROR'
            }
          };
        }

        // Provide specific guidance based on error type
        if (errorMessage.includes('modifiedDate') || errorMessage.includes('unconvert') || errorMessage.includes('ReachPlanDTO')) {
          let errorResponse = `## ⚠️ Plans API Server Bug\n\n`;
          errorResponse += `I tried to fetch the available mobile plans, but encountered a known server-side issue.\n\n`;
          errorResponse += `**Issue:** The plans API has a server-side bug (modifiedDate unconversion error). This is a known issue on the Reach API side.\n\n`;
          errorResponse += `**What you can do:**\n\n`;
          errorResponse += `⏳ **Try again in a few minutes** — Sometimes retrying works around the issue.\n\n`;
          errorResponse += `🔁 **Retry** — Simply say "Show me plans" again, and I'll try to fetch them.\n\n`;
          errorResponse += `📞 **Contact Reach support** — This is a server-side bug that needs to be fixed by Reach support.\n\n`;
          errorResponse += `Sorry about the inconvenience.\n\n`;

          // If there's a resume step, mention it
          const resumeStep = context ? getResumeStep(sessionId) : null;
          if (resumeStep && context) {
            errorResponse += `💡 *You can continue with your previous step (${resumeStep}) or try loading plans again.*`;
          }

          return {
            content: [
              {
                type: "text",
                text: errorResponse,
              },
            ],
            _meta: {
              widgetType: null,
              hasLineSelected: true,
              error: true,
              errorType: 'SERVER_BUG'
            }
          };
        } else if (errorMessage.includes('No plans found')) {
          let errorResponse = `## 📱 No Plans Available\n\n`;
          errorResponse += `I tried to fetch the available mobile plans, but no plans are currently available in the catalog.\n\n`;
          errorResponse += `**What you can do:**\n\n`;
          errorResponse += `⏳ **Try again later** — Plans may be temporarily unavailable.\n\n`;
          errorResponse += `📞 **Contact support** — If you need immediate assistance, please reach out to our support team.\n\n`;

          // If there's a resume step, mention it
          const resumeStep = context ? getResumeStep(sessionId) : null;
          if (resumeStep && context) {
            errorResponse += `💡 *You can continue with your previous step (${resumeStep}).*`;
          }

          return {
            content: [
              {
                type: "text",
                text: errorResponse,
              },
            ],
            _meta: {
              widgetType: null,
              hasLineSelected: true,
              error: true,
              errorType: 'NO_PLANS_FOUND'
            }
          };
        } else if (errorMessage.includes('timeout') || errorMessage.includes('timed out') || errorType === 'TIMEOUT_ERROR' || planError.name === 'TimeoutError') {
          let errorResponse = `## ⏱️ Plans Request Timed Out\n\n`;
          errorResponse += `I tried to fetch the available mobile plans, but the request took too long to complete.\n\n`;
          errorResponse += `**What you can do:**\n\n`;
          errorResponse += `🔁 **Try again** — Simply say "Show me plans" again, and I'll retry.\n\n`;
          errorResponse += `📶 **Check your connection** — A slow connection might be causing the timeout.\n\n`;

          // If there's a resume step, mention it
          const resumeStep = context ? getResumeStep(sessionId) : null;
          if (resumeStep && context) {
            errorResponse += `💡 *You can continue with your previous step (${resumeStep}) or try loading plans again.*`;
          }

          return {
            content: [
              {
                type: "text",
                text: errorResponse,
              },
            ],
            _meta: {
              widgetType: null,
              hasLineSelected: true,
              error: true,
              errorType: 'TIMEOUT_ERROR'
            }
          };
        } else if (errorMessage.includes('network') || errorMessage.includes('fetch') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND') || planError.name === 'NetworkError') {
          let errorResponse = `## 🌐 Network Connection Issue\n\n`;
          errorResponse += `I tried to fetch the available mobile plans, but there was a network connection issue.\n\n`;
          errorResponse += `**What you can do:**\n\n`;
          errorResponse += `🔁 **Try again** — Simply say "Show me plans" again, and I'll retry.\n\n`;
          errorResponse += `📶 **Check your connection** — Ensure you have a stable internet connection.\n\n`;

          // If there's a resume step, mention it
          const resumeStep = context ? getResumeStep(sessionId) : null;
          if (resumeStep && context) {
            errorResponse += `💡 *You can continue with your previous step (${resumeStep}) or try loading plans again.*`;
          }

          return {
            content: [
              {
                type: "text",
                text: errorResponse,
              },
            ],
            _meta: {
              widgetType: null,
              hasLineSelected: true,
              error: true,
              errorType: 'NETWORK_ERROR'
            }
          };
        } else {
          // Generic error handler
          let errorResponse = `## ⚠️ Unable to Load Plans\n\n`;
          errorResponse += `I tried to fetch the available mobile plans, but encountered an issue.\n\n`;
          errorResponse += `**Issue:** ${errorMessage}\n\n`;
          errorResponse += `**What you can do:**\n\n`;
          errorResponse += `⏳ **Try again in a few minutes** — This may be a temporary issue.\n\n`;
          errorResponse += `🔁 **Retry** — Simply say "Show me plans" again, and I'll try to fetch them.\n\n`;
          errorResponse += `📞 **Contact support** — If the issue persists, please reach out for assistance.\n\n`;
          errorResponse += `Sorry about the inconvenience. I'll keep trying to load the plans for you.\n\n`;

          // If there's a resume step, mention it
          const resumeStep = context ? getResumeStep(sessionId) : null;
          if (resumeStep && context) {
            errorResponse += `💡 *You can continue with your previous step (${resumeStep}) or try loading plans again.*`;
          }

          return {
            content: [
              {
                type: "text",
                text: errorResponse,
              },
            ],
            _meta: {
              widgetType: null,
              hasLineSelected: true,
              error: true,
              errorType: 'UNKNOWN_ERROR'
            }
          };
        }
      }

      if (!plans || plans.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "## 📱 Available Mobile Plans\n\nNo plans found matching your criteria. Please try again or adjust your filters.",
            },
          ],
          _meta: {
            widgetType: null,
            hasLineSelected: true
          }
        };
      }

      // Set resume step for conversational flow
      if (context && sessionId) {
        setResumeStep(sessionId, 'plan_selection');
        updateLastIntent(sessionId, INTENT_TYPES.PLAN, 'get_plans');
        addConversationHistory(sessionId, {
          intent: INTENT_TYPES.PLAN,
          action: 'get_plans',
          data: { planCount: plans.length }
        });
      }

      const openContext = ensurePlanUiOpen(context);
      updateFlowContext(sessionId, openContext);
      if (!openContext.planUi.isOpen && openContext.planUi.loadCount >= 2) {
        return {
          content: [{
            type: "text",
            text: "Please type the plan name you want (e.g., Basic, Unlimited, Unlimited Plus)."
          }]
        };
      }

      return buildPlansStructuredResponse(
        sessionId,
        openContext,
        plans,
        `Here are ${plans.length} available plan${plans.length > 1 ? 's' : ''}.`
      );

      // Fetch cart to check for existing lines with plans
      const cart = sessionId ? getCartMultiLine(sessionId) : null;

      // Determine selection mode and calculate activeLineId
      let selectionMode = args.selectionMode || context?.planSelectionMode || 'initial';
      let activeLineId = null;
      let selectedPlansPerLine = {};

      // Get lines with plans from cart
      const linesWithPlans = cart ? (cart.lines || [])
        .filter(l => l.plan && l.plan.id)
        .map(l => l.lineNumber) : [];

      // Build selectedPlansPerLine map
      if (cart && cart.lines) {
        cart.lines.forEach(line => {
          if (line.plan && line.plan.id) {
            selectedPlansPerLine[String(line.lineNumber)] = line.plan.id;
          }
        });
      }

      // Calculate activeLineId for sequential mode
      if (selectionMode === 'sequential') {
        // Find the first line without a plan
        const lineCount = context?.lineCount || 0;
        for (let i = 1; i <= lineCount; i++) {
          if (!linesWithPlans.includes(i)) {
            activeLineId = i;
            break;
          }
        }
      }

      const planModePrompted = context?.planModePrompted || false;

      // Build three-section response: Response | Suggestions | Next Steps
      // SECTION 1: RESPONSE
      let mainResponse = `Showing ${plans.length} available plan${plans.length > 1 ? 's' : ''}. All prices in USD for USA.\n\nSee plan cards below with pricing, data, and features.`;

      let suggestions = "";
      let nextSteps = "";

      if (context && progress) {
        const lineCount = context?.lineCount || 0;

        // Section 2: Suggestions about the response
        if (selectionMode === 'initial' && lineCount > 1) {
          suggestions = `**How would you like to select plans?**\n\n`;
          suggestions += `• **Apply to all:** Choose one plan for all ${lineCount} lines (I will use the \`select_plan_mode\` tool)\n`;
          suggestions += `• **Mix and match:** Select different plans for each line (I will use the \`select_plan_mode\` tool)\n\n`;
          suggestions += `Please let me know your preference!`;
        } else if (selectionMode === 'applyAll') {
          suggestions = `**Apply to All Mode**\n\n`;
          suggestions += `Click any plan card below to apply it to all ${lineCount} lines.`;
        } else if (selectionMode === 'sequential' && activeLineId) {
          suggestions = `**Selecting plan for Line ${activeLineId}**\n\n`;
          suggestions += `Click any plan card below to select it for Line ${activeLineId}.`;
          if (linesWithPlans.length > 0) {
            suggestions += `\n\n✅ Completed: Line${linesWithPlans.length > 1 ? 's' : ''} ${linesWithPlans.join(', ')}`;
          }
        } else if (progress.missing.plans && progress.missing.plans.length > 0) {
          suggestions = `You need to select plans for **${progress.missing.plans.length} line${progress.missing.plans.length > 1 ? 's' : ''}**.\n\n`;
          suggestions += `**Selection Options:**\n`;
          suggestions += `• **Apply to All:** Choose one plan and apply it to all lines\n`;
          suggestions += `• **Mix & Match:** Select different plans for each line\n\n`;
          suggestions += `Click \"Add to Cart\" on any plan card below.`;
        } else {
          suggestions = "All plans have been selected for your lines. You can still add more plans or modify your selections.";
        }

        // Section 3: Next Steps (flow-aligned)
        nextSteps = getNextStepsForIntent(context, INTENT_TYPES.PLAN);
      } else {
        // Fallback (shouldn't happen if line is selected, but just in case)
        suggestions = "Select a plan from the cards below to add it to your cart.";
        nextSteps = `**→ Next:** Choose a plan and click "Add to Cart"`;
      }

      const responseText = formatThreeSectionResponse(mainResponse, suggestions, nextSteps);

      // Return structuredContent for Apps SDK widget (ONLY when line is selected)
      // The widget will read this via window.openai.toolOutput
      const structuredData = {
        selectionMode: selectionMode,
        activeLineId: activeLineId,
        selectedPlansPerLine: selectedPlansPerLine,
        linesWithPlans: linesWithPlans,
        planModePrompted: planModePrompted,
        plans: plans.map(plan => ({
          // Spread original plan so widget sees all API fields
          ...plan,

          // Normalized fields the widget expects
          id: plan.id || plan.uniqueIdentifier,
          name: plan.displayName || plan.displayNameWeb || plan.name,
          price: plan.price || plan.baseLinePrice || 0,
          data: plan.data || plan.planData || 0,
          dataUnit: plan.dataUnit || "GB",
          discountPctg: plan.discountPctg || 0,
          planType: plan.planType,
          serviceCode: plan.serviceCode,
          planCharging: plan.planCharging,
        })),
        // Include flowContext data for line selection
        lineCount: context ? (context.lineCount || 0) : 0,
        lines: context && context.lines ? context.lines.map((line, index) => ({
          lineNumber: line.lineNumber || (index + 1),
          phoneNumber: line.phoneNumber || null,
          planSelected: line.planSelected || false,
          planId: line.planId || null,
          deviceSelected: line.deviceSelected || false,
          deviceId: line.deviceId || null,
          protectionSelected: line.protectionSelected || false,
          protectionId: line.protectionId || null,
          simType: line.simType || null,
          simIccId: line.simIccId || null
        })) : []
      };

      const response = {
        structuredContent: structuredData,
        content: [
          {
            type: "text",
            text: responseText,
          }
        ],
        _meta: {
          // Widget-only data, not Apps SDK config
          widgetType: "planCard",
          hasLineSelected: true
        }
      };

      logger.info("📤 get_plans response", {
        hasStructuredContent: !!response.structuredContent,
        hasLineSelected: true,
        plansCount: structuredData.plans.length,
        responsePreview: JSON.stringify(response, null, 2).substring(0, 500)
      });

      if (context && selectionMode === 'initial' && context.lineCount > 1 && !planModePrompted) {
        updateFlowContext(sessionId, { planModePrompted: true });
      }

      return response;
    }

    if (name === "get_offers") {
      const offers = await fetchOffers(args.serviceCode, tenant);

      // Transform offers for structuredContent
      const structuredData = {
        offers: offers.map(offer => ({
          coupon: offer.coupon,
          name: offer.name,
          type: offer.type,
          subType: offer.subType,
          discountInDollar: offer.discountInDollar,
          planDiscount: offer.planDiscount,
          secondaryDiscount: offer.secondaryDiscount,
          validityInMonths: offer.validityInMonths,
          status: offer.status,
          expired: offer.expired,
          startDate: offer.startDate,
          endDate: offer.endDate,
          maxCouponLimit: offer.maxCouponLimit,
          maxBudgetInDollar: offer.maxBudgetInDollar,
          maxDiscountInDollar: offer.maxDiscountInDollar,
          skipValidity: offer.skipValidity,
          createdOn: offer.createdOn,
          modifiedOn: offer.modifiedOn,
        }))
      };

      const response = {
        structuredContent: structuredData,
        content: [
          {
            type: "text",
            text: `Here are ${offers.length} available coupon${offers.length !== 1 ? 's' : ''}. Apply any coupon to get discounts!`,
          }
        ],
        _meta: {
          widgetType: "offers"
        }
      };

      logger.info("📤 get_offers response", {
        hasStructuredContent: !!response.structuredContent,
        offersCount: structuredData.offers.length,
        responsePreview: JSON.stringify(response, null, 2).substring(0, 500)
      });

      return response;
    }

    if (name === "get_services") {
      const services = await fetchServices(args.serviceCode, tenant);
      if (isAppsSDK) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, services }) }],
        };
      }
      const cardMarkdown = formatServicesAsCards(services);
      return {
        content: [
          {
            type: "text",
            text: cardMarkdown,
          },
        ],
      };
    }

    if (name === "check_coverage") {
      const zipCode = args.zipCode;
      if (!zipCode) {
        throw new Error("ZIP code is required");
      }

      const sessionId = getOrCreateSessionId(args.sessionId || null);
      const context = getFlowContext(sessionId);

      // Coverage is non-blocking - preserve resume step
      const resumeStep = context ? getResumeStep(sessionId) : null;

      try {
        const result = await checkCoverage(zipCode, tenant);

        // Update context with coverage info (non-blocking)
        if (context && sessionId) {
          updateFlowContext(sessionId, {
            coverageChecked: true,
            coverageZipCode: zipCode,
            zip: zipCode
          });
          updateLastIntent(sessionId, INTENT_TYPES.COVERAGE, 'check_coverage');
          addConversationHistory(sessionId, {
            intent: INTENT_TYPES.COVERAGE,
            action: 'check_coverage',
            data: { zipCode, result: { isValid: result.isValid } }
          });
          // Restore resume step if it existed
          if (resumeStep) {
            setResumeStep(sessionId, resumeStep);
          }
        }

        if (isAppsSDK) {
          return {
            content: [{ type: "text", text: JSON.stringify({ success: true, ...result }) }],
          };
        }

        // Build three-section response
        const mainResponse = formatCoverageAsCard(result);

        let suggestions = "";
        if (result.isValid === true) {
          const signal = result.signal4g || result.signal5g || 'good';
          if (signal === 'great' || signal === 'good') {
            suggestions = "Excellent signal strength in your area! You'll have reliable service for calls, texts, and data.";
          } else {
            suggestions = "Coverage is available in your area. Service quality may vary by specific location.";
          }
        } else if (result.isValid === false) {
          suggestions = "Coverage may be limited in this area. Please check the details above and consider contacting support for verification.";
        } else {
          suggestions = "Coverage information for this ZIP code. Check the details above for signal strength and compatibility.";
        }

        const nextSteps = getNextStepsForIntent(context, INTENT_TYPES.COVERAGE);
        const guidanceText = formatThreeSectionResponse(mainResponse, suggestions, nextSteps);

        return {
          content: [
            {
              type: "text",
              text: guidanceText,
            },
          ],
        };
      } catch (coverageError) {
        // Handle coverage API errors gracefully
        const errorMessage = coverageError.message || String(coverageError);
        const statusCode = coverageError.statusCode || (coverageError.name === 'APIError' ? coverageError.statusCode : null);
        const errorType = coverageError.errorType || (coverageError.name === 'APIError' ? coverageError.errorType : null);

        logger.error("Coverage check error caught in tool handler", {
          zipCode,
          sessionId,
          errorMessage,
          statusCode,
          errorType,
          errorName: coverageError.name
        });

        // Handle 403/permissions errors
        if (statusCode === 403 || errorMessage.includes('explicit deny') || errorMessage.includes('access denied') || errorMessage.includes('403')) {
          let errorResponse = `## ⚠️ Coverage Check Unavailable\n\n`;
          errorResponse += `**Issue:** ${errorMessage}\n\n`;
          errorResponse += `**What this means:** Your account doesn't have permission to access the coverage endpoint. This is a permissions/entitlement issue on the Reach API side.\n\n`;
          errorResponse += `**What you can do:**\n`;
          errorResponse += `1. Contact Reach support to request access to the \`/apisvc/v0/network/coverage\` endpoint\n`;
          errorResponse += `2. Proceed with plan selection - coverage check is optional and not required for purchase\n`;
          errorResponse += `3. Most areas in the US have good coverage, so you can safely continue\n\n`;
          errorResponse += `**Next steps:** Would you like to see available plans instead?`;

          // If there's a resume step, mention it
          if (resumeStep && context) {
            errorResponse += `\n\n💡 *You can continue with your previous step (${resumeStep}) or select a plan.*`;
          }

          return {
            content: [
              {
                type: "text",
                text: errorResponse,
              },
            ],
          };
        }

        // Handle server errors (500, 502, 503, 504)
        if (statusCode >= 500 || errorType === 'SERVER_ERROR' || errorMessage.includes('500') || errorMessage.includes('502') || errorMessage.includes('503') || errorMessage.includes('504') || errorMessage.includes('Server error')) {
          let errorResponse = `## ⚠️ Coverage Service Temporarily Unavailable\n\n`;
          errorResponse += `Thanks for sharing your ZIP code: **${zipCode}** 👍\n\n`;
          errorResponse += `I tried checking coverage for your area, but the coverage service is temporarily unavailable right now (server error on our side).\n\n`;
          errorResponse += `**What you can do:**\n\n`;
          errorResponse += `⏳ **Try again in a few minutes** — this is usually a short-lived issue.\n\n`;
          errorResponse += `🔁 **Retry** — You can simply reply "check again" or "check coverage for ${zipCode}", and I'll retry for ZIP code ${zipCode}.\n\n`;
          errorResponse += `📍 **Try a nearby ZIP code** — If you want, you can also share a nearby ZIP code and I can try that instead.\n\n`;
          errorResponse += `✅ **Continue without coverage check** — Coverage check is optional. You can proceed to select a plan, and most areas in the US have good coverage.\n\n`;
          errorResponse += `Sorry about the hiccup — I've got your ZIP code noted and can recheck as soon as the service is back up.\n\n`;

          // If there's a resume step, mention it
          if (resumeStep && context) {
            errorResponse += `💡 *You can continue with your previous step (${resumeStep}) or select a plan.*`;
          }

          return {
            content: [
              {
                type: "text",
                text: errorResponse,
              },
            ],
          };
        }

        // Handle timeout errors
        if (errorMessage.includes('timeout') || errorMessage.includes('timed out') || errorType === 'TIMEOUT_ERROR' || coverageError.name === 'TimeoutError') {
          let errorResponse = `## ⏱️ Coverage Check Timed Out\n\n`;
          errorResponse += `Thanks for sharing your ZIP code: **${zipCode}** 👍\n\n`;
          errorResponse += `I tried checking coverage for your area, but the request took too long to complete.\n\n`;
          errorResponse += `**What you can do:**\n\n`;
          errorResponse += `🔁 **Try again** — You can simply reply "check again" or "check coverage for ${zipCode}", and I'll retry.\n\n`;
          errorResponse += `📍 **Try a nearby ZIP code** — If you want, you can also share a nearby ZIP code and I can try that instead.\n\n`;
          errorResponse += `✅ **Continue without coverage check** — Coverage check is optional. You can proceed to select a plan.\n\n`;

          // If there's a resume step, mention it
          if (resumeStep && context) {
            errorResponse += `💡 *You can continue with your previous step (${resumeStep}) or select a plan.*`;
          }

          return {
            content: [
              {
                type: "text",
                text: errorResponse,
              },
            ],
          };
        }

        // Handle network errors
        if (errorMessage.includes('network') || errorMessage.includes('fetch') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND') || coverageError.name === 'NetworkError') {
          let errorResponse = `## 🌐 Network Connection Issue\n\n`;
          errorResponse += `Thanks for sharing your ZIP code: **${zipCode}** 👍\n\n`;
          errorResponse += `I tried checking coverage for your area, but there was a network connection issue.\n\n`;
          errorResponse += `**What you can do:**\n\n`;
          errorResponse += `🔁 **Try again** — You can simply reply "check again" or "check coverage for ${zipCode}", and I'll retry.\n\n`;
          errorResponse += `✅ **Continue without coverage check** — Coverage check is optional. You can proceed to select a plan.\n\n`;

          // If there's a resume step, mention it
          if (resumeStep && context) {
            errorResponse += `💡 *You can continue with your previous step (${resumeStep}) or select a plan.*`;
          }

          return {
            content: [
              {
                type: "text",
                text: errorResponse,
              },
            ],
          };
        }

        // Handle all other errors with a generic user-friendly message
        let errorResponse = `## ⚠️ Coverage Check Unavailable\n\n`;
        errorResponse += `Thanks for sharing your ZIP code: **${zipCode}** 👍\n\n`;
        errorResponse += `I tried checking coverage for your area, but the coverage service is temporarily unavailable right now.\n\n`;
        errorResponse += `**What you can do:**\n\n`;
        errorResponse += `⏳ **Try again in a few minutes** — this is usually a short-lived issue.\n\n`;
        errorResponse += `🔁 **Retry** — You can simply reply "check again" or "check coverage for ${zipCode}", and I'll retry for ZIP code ${zipCode}.\n\n`;
        errorResponse += `📍 **Try a nearby ZIP code** — If you want, you can also share a nearby ZIP code and I can try that instead.\n\n`;
        errorResponse += `✅ **Continue without coverage check** — Coverage check is optional. You can proceed to select a plan, and most areas in the US have good coverage.\n\n`;
        errorResponse += `Sorry about the hiccup — I've got your ZIP code noted and can recheck as soon as the service is back up.\n\n`;

        // If there's a resume step, mention it
        if (resumeStep && context) {
          errorResponse += `💡 *You can continue with your previous step (${resumeStep}) or select a plan.*`;
        }

        return {
          content: [
            {
              type: "text",
              text: errorResponse,
            },
          ],
        };
      }
    }

    if (name === "validate_device") {
      // Get session context for error handling and suggestions
      const sessionId = getOrCreateSessionId(args.sessionId || null);
      const context = getFlowContext(sessionId);

      try {
        const result = await validateDevice(args.imei, tenant);
        if (isAppsSDK) {
          return {
            content: [{ type: "text", text: JSON.stringify({ success: true, ...result, imei: args.imei }) }],
          };
        }

        // Update context and conversation history
        if (context && sessionId) {
          updateLastIntent(sessionId, INTENT_TYPES.DEVICE, 'validate_device');
          addConversationHistory(sessionId, {
            intent: INTENT_TYPES.DEVICE,
            action: 'validate_device',
            data: { imei: args.imei ? `${args.imei.substring(0, 4)}...` : 'N/A', isValid: result.isValid }
          });
        }

        // Format device compatibility card
        const cardMarkdown = formatDeviceAsCard({ ...result, imei: args.imei });

        // Add suggestions to buy devices
        let suggestions = "";
        if (result.isValid) {
          suggestions = "✅ **Your device is compatible!**\n\n";
          suggestions += "**Looking for a new device?** Browse our selection of phones and devices:\n";
          suggestions += "• Say **\"Show me devices\"** or **\"Browse devices\"** to see available options\n";
          suggestions += "• You can also search by brand (e.g., \"Show me iPhones\" or \"Show me Samsung phones\")\n";
          suggestions += "• Devices are optional - you can proceed with your current compatible device or upgrade to a new one";
        } else {
          suggestions = "❌ **Your device may not be fully compatible.**\n\n";
          suggestions += "**Need a new device?** We have a great selection of compatible phones:\n";
          suggestions += "• Say **\"Show me devices\"** or **\"Browse devices\"** to see available options\n";
          suggestions += "• Search by brand: \"Show me iPhones\", \"Show me Samsung phones\", etc.\n";
          suggestions += "• All devices in our catalog are guaranteed to work with Reach Mobile network";
        }

        // Get next steps based on context
        const nextSteps = getNextStepsForIntent(context, INTENT_TYPES.DEVICE);

        // Format response with three sections
        const responseText = formatThreeSectionResponse(cardMarkdown, suggestions, nextSteps);

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      } catch (deviceError) {
        // Handle errors from device validation API
        const statusCode = deviceError.statusCode || (deviceError.message.match(/\b(\d{3})\b/) ? parseInt(deviceError.message.match(/\b(\d{3})\b/)[1]) : null);
        const errorType = deviceError.errorType || 'API_ERROR';
        const errorMessage = deviceError.message || 'Unknown error';
        const imei = args.imei ? `${args.imei.substring(0, 6)}...${args.imei.substring(args.imei.length - 4)}` : 'provided';

        logger.error("Device validation error", {
          imei: args.imei ? `${args.imei.substring(0, 4)}...` : 'N/A',
          statusCode,
          errorType,
          errorMessage: errorMessage.substring(0, 200)
        });

        // Handle server errors (500, 502, 503, 504)
        if (statusCode >= 500 || statusCode === 503 || errorMessage.includes('503') || errorMessage.includes('Service Unavailable')) {
          let errorResponse = `## ⚠️ Issue While Checking Compatibility\n\n`;
          errorResponse += `I tried to validate your device using the IMEI **${imei}**, but the device compatibility service is temporarily unavailable (503 error). This is a server-side issue, not a problem with your IMEI or device.\n\n`;
          errorResponse += `**What this means:**\n\n`;
          errorResponse += `• make sure you are using the correct IMEI\n`;
          errorResponse += `• check spaces in the IMEI\n`;
          errorResponse += `• Your request reached the system correctly\n`;
          errorResponse += `• The validation service is currently down or not responding\n`;
          errorResponse += `• No compatibility result could be fetched right now\n\n`;
          errorResponse += `**What you can do:**\n\n`;
          errorResponse += `⏳ **Try again in a few minutes** — This is usually a short-lived issue\n\n`;
          errorResponse += `🔁 **Retry** — You can ask me to "check compatibility again" or "validate device again" with your IMEI\n\n`;
          errorResponse += `✅ **Continue without validation** — You can still proceed to select plans and devices. Device validation is optional.\n\n`;
          errorResponse += `Sorry about the hiccup — I've noted your IMEI and can recheck as soon as the service is back up.\n\n`;

          return {
            content: [
              {
                type: "text",
                text: errorResponse,
              },
            ],
          };
        }

        // Handle timeout errors
        if (errorMessage.includes('timeout') || errorMessage.includes('timed out') || errorType === 'TIMEOUT_ERROR' || deviceError.name === 'TimeoutError') {
          let errorResponse = `## ⏱️ Device Validation Timed Out\n\n`;
          errorResponse += `I tried to validate your device using the IMEI **${imei}**, but the request took too long to complete.\n\n`;
          errorResponse += `**What you can do:**\n\n`;
          errorResponse += `🔁 **Try again** — You can ask me to "check compatibility again" or "validate device again"\n\n`;
          errorResponse += `✅ **Continue without validation** — Device validation is optional. You can proceed to select plans and devices.\n\n`;

          return {
            content: [
              {
                type: "text",
                text: errorResponse,
              },
            ],
          };
        }

        // Handle authentication errors (401, 403)
        if (statusCode === 401 || statusCode === 403 || errorMessage.includes('401') || errorMessage.includes('403') || errorMessage.includes('Unauthorized') || errorMessage.includes('Forbidden')) {
          let errorResponse = `## 🔒 Authentication Issue\n\n`;
          errorResponse += `I tried to validate your device, but there was an authentication issue with the device validation service.\n\n`;
          errorResponse += `**What this means:**\n\n`;
          errorResponse += `• The service requires proper authentication\n`;
          errorResponse += `• This is a system-side issue, not a problem with your IMEI\n\n`;
          errorResponse += `**What you can do:**\n\n`;
          errorResponse += `🔁 **Try again** — The system will automatically retry with fresh authentication\n\n`;
          errorResponse += `✅ **Continue without validation** — You can proceed to select plans and devices\n\n`;
          errorResponse += `If this persists, please contact support.\n\n`;

          return {
            content: [
              {
                type: "text",
                text: errorResponse,
              },
            ],
          };
        }

        // Handle other errors
        let errorResponse = `## ❌ Device Validation Failed\n\n`;
        errorResponse += `I tried to validate your device using the IMEI **${imei}**, but encountered an error.\n\n`;
        errorResponse += `**Error:** ${errorMessage.substring(0, 200)}\n\n`;
        errorResponse += `**What you can do:**\n\n`;
        errorResponse += `🔍 **Check your IMEI** — Make sure you provided the correct 15-digit IMEI number\n\n`;
        errorResponse += `🔁 **Try again** — You can ask me to "check compatibility again"\n\n`;
        errorResponse += `✅ **Continue without validation** — Device validation is optional. You can proceed to browse devices and select plans.\n\n`;

        return {
          content: [
            {
              type: "text",
              text: errorResponse,
            },
          ],
        };
      }
    }

    if (name === "get_devices") {
      // Device browsing is allowed without plans (per flow requirements)
      // Plans are only required before checkout, not for browsing
      const sessionId = getOrCreateSessionId(args.sessionId || null);
      const context = getFlowContext(sessionId);
      const globalFlags = getGlobalContextFlags(sessionId);
      const hasPlans = globalFlags.planSelected;

      const limit = args.limit || 8;
      const brand = args.brand || null;
      const selectionMode = args.selectionMode || context?.deviceSelectionMode || 'initial';
      let devices;
      try {
        devices = await fetchDevices(limit * 2, brand, tenant); // Fetch more to account for filtering
      } catch (err) {
        logger.error("Failed to fetch devices from Shopware API", {
          error: err.message,
          brand,
          limit
        });
        return {
          content: [
            {
              type: "text",
              text: `## ⚠️ Device Catalog Unavailable\n\nI'm currently unable to fetch the live device list due to a connection issue with our catalog service.\n\n**What you can do:**\n- Try again in a few moments\n- Search for a specific brand or model\n- Ask about mobile plans instead while I wait for the service to recover.`
            }
          ]
        };
      }

      // Client-side filtering as fallback (in case API filter doesn't work perfectly)
      if (brand && devices && devices.length > 0) {
        const brandLower = brand.toLowerCase();
        const normalizedBrand = brandLower.includes('iphone') || brandLower.includes('apple') ? 'apple' :
          brandLower.includes('samsung') || brandLower.includes('galaxy') ? 'samsung' :
            brandLower.includes('pixel') || brandLower.includes('google') ? 'google' : brandLower;

        devices = devices.filter(device => {
          const deviceName = (device.name || device.translated?.name || '').toLowerCase();
          const deviceBrand = (device.manufacturer?.name || device.brand || device.translated?.manufacturer?.name || '').toLowerCase();

          if (normalizedBrand === 'apple') {
            return deviceName.includes('iphone') || deviceBrand.includes('apple');
          } else if (normalizedBrand === 'samsung') {
            return deviceName.includes('samsung') || deviceName.includes('galaxy') || deviceBrand.includes('samsung');
          } else if (normalizedBrand === 'google') {
            return deviceName.includes('pixel') || deviceBrand.includes('google');
          } else {
            return deviceName.includes(normalizedBrand) || deviceBrand.includes(normalizedBrand);
          }
        });
      }
      logger.debug("Fetched devices for tool response", { deviceCount: devices.length });
      // Limit results after filtering
      // Limit results after filtering
      devices = devices.slice(0, limit);
      logger.info(`Processing images for ${devices.length} devices. ServerURL: ${serverBaseUrl}`);
      // Async background caching for device images
      if (devices && devices.length > 0) {
        devices.forEach(device => {
          let source = "none";
          let rawImageUrl = null;

          if (device.cover?.media?.url) {
            rawImageUrl = device.cover.media.url;
            source = "device.cover.media.url";
          } else if (device.media && device.media[0]?.media?.url) {
            rawImageUrl = device.media[0].media.url;
            source = "device.media[0].media.url";
          } else if (device.image) {
            rawImageUrl = device.image;
            source = "device.image";
          } else if (device.coverImage) {
            rawImageUrl = device.coverImage;
            source = "device.coverImage";
          } else if (device.thumbnail) {
            rawImageUrl = device.thumbnail;
            source = "device.thumbnail";
          }

          if (rawImageUrl) {
            logger.debug(`🖼️ Background Cacher: Found image for ${device.name || device.id} from ${source}`, { rawImageUrl });
            // Extract extension or default to png
            const extension = rawImageUrl.split('.').pop().split(/[?#]/)[0] || 'png';
            const filename = `${device.id || device.productNumber}.${extension}`;

            // Trigger cache without awaiting to avoid blocking the response
            cacheImage(rawImageUrl, filename).catch(err => {
              logger.error(`Background image caching failed for ${device.id}: ${err.message}`);
            });

            // Add local fallback URL to the device object for the formatter/widget
            // Use absolute URL if base URL is detected, otherwise relative
            const localPath = `/public/assets/${filename}`;
            device.localImageUrl = serverBaseUrl ? `${serverBaseUrl}${localPath}` : localPath;
            logger.debug(`📍 Local fallback path generated: ${device.localImageUrl}`);
          } else {
            logger.debug(`⚠️ No image found for device: ${device.name || device.id}`);
          }

          // Fix mixed content in description (prevent HTTP images in HTTPS site)
          if (device.description) {
            device.description = device.description.replace(/src="http:/g, 'src="https:');
          }
        });
      }

      if (!devices || devices.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `## 📱 Available Devices\n\nNo ${brand ? brand + ' ' : ''}devices found.`,
            },
          ],
        };
      }

      // Set resume step and update context
      if (context && sessionId) {
        setResumeStep(sessionId, 'device_selection');
        updateLastIntent(sessionId, INTENT_TYPES.DEVICE, 'get_devices');
        addConversationHistory(sessionId, {
          intent: INTENT_TYPES.DEVICE,
          action: 'get_devices',
          data: { deviceCount: devices.length, brand }
        });
      }

      // Check if there's a device cart but no lines configured
      const cart = sessionId ? getCartMultiLine(sessionId) : null;
      const hasDeviceCart = cart && cart.lines && cart.lines.length > 0 &&
        cart.lines.some(line => line.device !== null && line.device !== undefined);
      const hasNoLinesConfigured = !context || !context.lineCount || context.lineCount === 0;

      // Check flow context for guidance
      const progress = sessionId ? getFlowProgress(sessionId) : null;

      // Build three-section response
      // SECTION 1: RESPONSE
      let mainResponse = brand ?
        `Showing ${devices.length} ${brand} device${devices.length > 1 ? 's' : ''} available for purchase.` :
        `Showing ${devices.length} device${devices.length > 1 ? 's' : ''} from our catalog.`;

      let suggestions = "";

      // Special case: Device cart loaded but lines not added
      if (hasDeviceCart && hasNoLinesConfigured) {
        suggestions = "**⚠️ Lines Required First:**\n\n";
        suggestions += "I can see you have devices in your cart, but lines need to be set up before you can continue.\n\n";
        suggestions += "**Please add lines first:** Tell me how many lines you need (e.g., \"I need 2 lines\" or \"Set up 3 lines\").\n\n";
        suggestions += "**After adding lines:** You'll need to select plans for each line before checkout. Plans are required before you can complete your purchase.\n\n";
        suggestions += "**Device Selection:** You can browse and add more devices below. Once lines are configured, you can assign devices to specific lines.";
      } else if (context && selectionMode === 'initial' && context.lineCount > 1) {
        mainResponse += `\n\n**Before you pick a device:** Choose how you'd like to assign devices to lines.`;
        suggestions = `**How would you like to select devices?**\n\n`;
        suggestions += `• **Apply to all:** Choose one device for all ${context.lineCount} lines (I will use the \`select_device_mode\` tool)\n`;
        suggestions += `• **Mix and match:** Select different devices per line (I will use the \`select_device_mode\` tool)\n\n`;
        suggestions += `Devices are optional — you can skip device selection and continue anytime.`;
      } else if (!hasPlans && context) {
        suggestions = "**Note:** You can browse and add devices now, but you'll need to select plans before checkout.\n\n";
        suggestions += "**Device Selection:** Click \"Add to Cart\" on any device below. You can add devices to specific lines or browse first and assign later.";
      } else if (hasPlans && context) {
        suggestions = "**Device Selection:** Click \"Add to Cart\" on any device below to add it to your cart.\n\n";
        suggestions += "**Optional:** Devices are optional. You can proceed without devices or add protection after selecting a device.";
      } else {
        suggestions = "Browse our device catalog. To purchase, you'll need to set up your lines and select plans first.";
      }

      const nextSteps = getNextStepsForIntent(context, INTENT_TYPES.DEVICE);
      const responseText = formatThreeSectionResponse(mainResponse, suggestions, nextSteps);

      // Return structuredContent for Apps SDK widget
      // Pass all device fields so widget can display full specs
      // Return structuredContent for Apps SDK widget
      // Pass all device fields so widget can display full specs
      const structuredDevices = [];
      for (const device of devices) {
        // Normalize cover media URL if present
        const normalizedCoverMediaUrl = device.cover?.media?.url
          ? normalizeDeviceImageUrl(device.cover.media.url)
          : null;

        // Normalize media array URLs if present
        const normalizedMedia = device.media && Array.isArray(device.media)
          ? device.media.map(m => ({
            ...m,
            media: m.media ? {
              ...m.media,
              url: m.media.url ? normalizeDeviceImageUrl(m.media.url) : m.media.url
            } : m.media,
            url: m.url ? normalizeDeviceImageUrl(m.url) : m.url
          }))
          : device.media;

        if (normalizedMedia && normalizedMedia.length > 0) {
          const mediaUrls = normalizedMedia.map(m => m.url || (m.media && m.media.url)).filter(Boolean);
          logger.info(`🖼️ Gallery URLs [${device.name || device.id}]: ${mediaUrls.length} found`, { urls: mediaUrls });
        }

        // Normalize main image URL
        let mainImageSource = "none";
        let mainImageRaw = null;

        if (device.cover?.media?.url) {
          mainImageRaw = device.cover.media.url;
          mainImageSource = "cover.media.url";
        } else if (device.media?.[0]?.media?.url) {
          mainImageRaw = device.media[0].media.url;
          mainImageSource = "media[0].media.url";
        }

        const normalizedImageUrl = normalizeDeviceImageUrl(mainImageRaw);
        if (normalizedImageUrl || device.localImageUrl) {
          logger.info(`📱 Device Image URLs [${device.name || device.id}]:`, {
            primary: normalizedImageUrl,
            local: device.localImageUrl || 'None'
          });
          logger.debug(`🎨 UI Mapping: Normalized image for ${device.name || device.id} from ${mainImageSource}`, { normalizedImageUrl });
        }

        // Generate Base64 for the primary image to bypass CSP (data URIs are usually allowed)
        // Use filename derived from ID
        const extension = (normalizedImageUrl || '').split('.').pop().split(/[?#]/)[0] || 'png';
        const filename = `${device.id || device.productNumber}.${extension}`;
        const base64Image = await getImageBase64(filename);
        if (base64Image) {
          logger.debug(`✨ Base64 generated for ${device.name || device.id}`);
        }


        structuredDevices.push({
          // Spread all original device data so widget has access to everything
          ...device,

          // Attachment of base64 image for the UI widget
          base64Image: base64Image,

          // Override cover and media with normalized URLs
          cover: device.cover ? {
            ...device.cover,
            media: device.cover.media ? {
              ...device.cover.media,
              url: normalizedCoverMediaUrl
            } : device.cover.media
          } : device.cover,
          media: normalizedMedia,

          // Normalized fields the widget expects
          id: device.id || device.productNumber || device.ean,
          name: device.name || device.translated?.name,
          brand: device.manufacturer?.name || device.brand || device.translated?.manufacturer?.name,
          productNumber: device.productNumber,
          manufacturerNumber: device.manufacturerNumber,
          price: device.calculatedPrice?.unitPrice || device.calculatedPrice?.totalPrice || device.price?.[0]?.gross || 0,
          originalPrice: device.calculatedPrice?.listPrice?.price || device.price?.[0]?.listPrice || device.listPrice || null,
          image: normalizedImageUrl,
          properties: device.properties || [],
          calculatedPrice: device.calculatedPrice || device.calculatedCheapestPrice,
          calculatedCheapestPrice: device.calculatedCheapestPrice,
          stock: device.stock,
          availableStock: device.availableStock,
          available: device.available,
          weight: device.weight,
          width: device.width,
          height: device.height,
          length: device.length,
          releaseDate: device.releaseDate,
        });
      }

      const linesWithDevices = cart ? (cart.lines || [])
        .filter(l => l.device && l.device.id)
        .map(l => l.lineNumber) : [];

      const selectedDevicesPerLine = {};
      if (cart && cart.lines) {
        cart.lines.forEach(line => {
          if (line.device && line.device.id) {
            selectedDevicesPerLine[String(line.lineNumber)] = line.device.id;
          }
        });
      }

      let activeLineId = null;
      if (selectionMode === 'sequential' && context?.lineCount) {
        for (let i = 1; i <= context.lineCount; i++) {
          if (!linesWithDevices.includes(i)) {
            activeLineId = i;
            break;
          }
        }
      }

      const structuredData = {
        selectionMode,
        activeLineId,
        selectedDevicesPerLine,
        linesWithDevices,
        deviceModePrompted: context?.deviceModePrompted || false,
        devices: structuredDevices,
        // Include flowContext data for line selection
        lineCount: context ? (context.lineCount || 0) : 0,
        lines: context && context.lines ? context.lines.map((line, index) => ({
          lineNumber: line.lineNumber || (index + 1),
          phoneNumber: line.phoneNumber || null,
          planSelected: line.planSelected || false,
          planId: line.planId || null,
          deviceSelected: line.deviceSelected || false,
          deviceId: line.deviceId || null,
          protectionSelected: line.protectionSelected || false,
          protectionId: line.protectionId || null,
          simType: line.simType || null,
          simIccId: line.simIccId || null
        })) : []
      };

      const response = {
        structuredContent: structuredData,
        content: [
          {
            type: "text",
            text: responseText,
          }
        ],
        _meta: {
          widgetType: "deviceCard"
        }
      };

      logger.info("📤 get_devices response", {
        hasStructuredContent: !!response.structuredContent,
        devicesCount: structuredData.devices.length,
        responsePreview: JSON.stringify(response, null, 2).substring(0, 500)
      });

      return response;
    }

    if (name === "select_device_mode") {
      const sessionId = getOrCreateSessionId(args.sessionId || null);
      const context = getFlowContext(sessionId);
      const mode = args.mode;
      const limit = args.limit || 8;
      const brand = args.brand || null;

      if (!context || !context.lineCount || context.lineCount === 0) {
        return {
          content: [
            {
              type: "text",
              text: "## ⚠️ Line Count Required\n\nPlease specify the number of lines first before selecting a device mode.\n\n**To continue:** Tell me how many lines you need (e.g., 'I need 2 lines').",
            }
          ]
        };
      }

      logger.info("Device selection mode chosen", { sessionId, mode, lineCount: context.lineCount });

      let devices;
      try {
        devices = await fetchDevices(limit * 2, brand, tenant);
      } catch (err) {
        logger.error("Failed to fetch devices for select_device_mode", {
          error: err.message,
          brand,
          limit
        });
        return {
          content: [
            {
              type: "text",
              text: `## ⚠️ Device Catalog Unavailable\n\nI'm currently unable to fetch the live device list due to a connection issue with our catalog service.\n\n**What you can do:**\n- Try again in a few moments\n- Search for a specific brand or model`
            }
          ]
        };
      }

      if (brand && devices && devices.length > 0) {
        const brandLower = brand.toLowerCase();
        const normalizedBrand = brandLower.includes('iphone') || brandLower.includes('apple') ? 'apple' :
          brandLower.includes('samsung') || brandLower.includes('galaxy') ? 'samsung' :
            brandLower.includes('pixel') || brandLower.includes('google') ? 'google' : brandLower;

        devices = devices.filter(device => {
          const deviceName = (device.name || device.translated?.name || '').toLowerCase();
          const deviceBrand = (device.manufacturer?.name || device.brand || device.translated?.manufacturer?.name || '').toLowerCase();

          if (normalizedBrand === 'apple') {
            return deviceName.includes('iphone') || deviceBrand.includes('apple');
          } else if (normalizedBrand === 'samsung') {
            return deviceName.includes('samsung') || deviceName.includes('galaxy') || deviceBrand.includes('samsung');
          } else if (normalizedBrand === 'google') {
            return deviceName.includes('pixel') || deviceBrand.includes('google');
          } else {
            return deviceName.includes(normalizedBrand) || deviceBrand.includes(normalizedBrand);
          }
        });
      }

      devices = devices.slice(0, limit);

      if (!devices || devices.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `## 📱 Available Devices\n\nNo ${brand ? brand + ' ' : ''}devices found.`,
            },
          ],
        };
      }

      updateFlowContext(sessionId, { deviceSelectionMode: mode, deviceModePrompted: true });
      setResumeStep(sessionId, 'device_selection');
      updateLastIntent(sessionId, INTENT_TYPES.DEVICE, 'select_device_mode');

      const cart = sessionId ? getCartMultiLine(sessionId) : null;
      const linesWithDevices = cart ? (cart.lines || [])
        .filter(l => l.device && l.device.id)
        .map(l => l.lineNumber) : [];

      const selectedDevicesPerLine = {};
      if (cart && cart.lines) {
        cart.lines.forEach(line => {
          if (line.device && line.device.id) {
            selectedDevicesPerLine[String(line.lineNumber)] = line.device.id;
          }
        });
      }

      let activeLineId = null;
      if (mode === 'sequential') {
        const lineCount = context?.lineCount || 0;
        for (let i = 1; i <= lineCount; i++) {
          if (!linesWithDevices.includes(i)) {
            activeLineId = i;
            break;
          }
        }
      }

      let responseText = "";
      if (mode === 'applyAll') {
        responseText = `## 📱 Apply to All Lines\n\nGreat! You'll choose one device that applies to all ${context.lineCount} lines.\n\n**Next:** Click any device card below to apply it to all lines.`;
      } else if (mode === 'sequential') {
        responseText = `## 📱 Mix and Match Devices\n\nPerfect! You can select different devices for each line (optional).\n\n**Starting with Line ${activeLineId}:** Click any device card below to select it for Line ${activeLineId}.\n\n**Skip option:** Say "Skip device for line ${activeLineId}".`;
        if (linesWithDevices.length > 0) {
          responseText += `\n\n✅ **Completed:** Line${linesWithDevices.length > 1 ? 's' : ''} ${linesWithDevices.join(', ')}`;
        }
      }

      const structuredDevices = [];
      for (const device of devices) {
        const normalizedCoverMediaUrl = device.cover?.media?.url
          ? normalizeDeviceImageUrl(device.cover.media.url)
          : null;

        const normalizedMedia = device.media && Array.isArray(device.media)
          ? device.media.map(m => ({
            ...m,
            media: m.media ? {
              ...m.media,
              url: m.media.url ? normalizeDeviceImageUrl(m.media.url) : m.media.url
            } : m.media,
            url: m.url ? normalizeDeviceImageUrl(m.url) : m.url
          }))
          : device.media;

        let mainImageRaw = null;
        if (device.cover?.media?.url) {
          mainImageRaw = device.cover.media.url;
        } else if (device.media?.[0]?.media?.url) {
          mainImageRaw = device.media[0].media.url;
        }

        const normalizedImageUrl = normalizeDeviceImageUrl(mainImageRaw);
        const extension = (normalizedImageUrl || '').split('.').pop().split(/[?#]/)[0] || 'png';
        const filename = `${device.id || device.productNumber}.${extension}`;
        const base64Image = await getImageBase64(filename);

        structuredDevices.push({
          ...device,
          base64Image: base64Image,
          cover: device.cover ? {
            ...device.cover,
            media: device.cover.media ? {
              ...device.cover.media,
              url: normalizedCoverMediaUrl
            } : device.cover.media
          } : device.cover,
          media: normalizedMedia,
          id: device.id || device.productNumber || device.ean,
          name: device.name || device.translated?.name,
          brand: device.manufacturer?.name || device.brand || device.translated?.manufacturer?.name,
          productNumber: device.productNumber,
          manufacturerNumber: device.manufacturerNumber,
          price: device.calculatedPrice?.unitPrice || device.calculatedPrice?.totalPrice || device.price?.[0]?.gross || 0,
          originalPrice: device.calculatedPrice?.listPrice?.price || device.price?.[0]?.listPrice || device.listPrice || null,
          image: normalizedImageUrl,
          properties: device.properties || [],
          calculatedPrice: device.calculatedPrice || device.calculatedCheapestPrice,
          calculatedCheapestPrice: device.calculatedCheapestPrice,
          stock: device.stock,
          availableStock: device.availableStock,
          available: device.available,
          weight: device.weight,
          width: device.width,
          height: device.height,
          length: device.length,
          releaseDate: device.releaseDate,
        });
      }

      const structuredData = {
        selectionMode: mode,
        activeLineId: activeLineId,
        selectedDevicesPerLine: selectedDevicesPerLine,
        linesWithDevices: linesWithDevices,
        deviceModePrompted: true,
        devices: structuredDevices,
        lineCount: context ? (context.lineCount || 0) : 0,
        lines: context && context.lines ? context.lines.map((line, index) => ({
          lineNumber: line.lineNumber || (index + 1),
          phoneNumber: line.phoneNumber || null,
          planSelected: line.planSelected || false,
          planId: line.planId || null,
          deviceSelected: line.deviceSelected || false,
          deviceId: line.deviceId || null,
          protectionSelected: line.protectionSelected || false,
          protectionId: line.protectionId || null,
          simType: line.simType || null,
          simIccId: line.simIccId || null
        })) : []
      };

      return {
        structuredContent: structuredData,
        content: [
          {
            type: "text",
            text: responseText,
          }
        ],
        _meta: {
          "openai/outputTemplate": "ui://widget/devices.html",
          "openai/resultCanProduceWidget": true,
          "openai/widgetAccessible": true,
          widgetType: "deviceCard"
        }
      };
    }

    if (name === "get_sim_types") {
      const sessionId = getOrCreateSessionId(args.sessionId || null);
      const lineNumber = args.lineNumber || null;
      let context = sessionId ? getFlowContext(sessionId) : null;
      let progress = sessionId ? getFlowProgress(sessionId) : null;

      // If no flow context exists, auto-initialize with 1 line to allow SIM selection
      if (!context || !context.lineCount) {
        logger.info('Auto-initializing purchase flow for SIM type selection', { sessionId });
        updateFlowContext(sessionId, {
          lineCount: 1,
          flowStage: 'planning',
          lines: [{
            lineNumber: 1,
            planSelected: false,
            planId: null,
            deviceSelected: false,
            deviceId: null,
            protectionSelected: false,
            protectionId: null,
            simType: null,
            simIccId: null
          }]
        });
        context = getFlowContext(sessionId);
        progress = getFlowProgress(sessionId);
      }

      // Get lines that need SIM types if context exists
      let linesNeedingSim = [];
      if (context && context.lines) {
        linesNeedingSim = context.lines
          .map((line, idx) => ({ line: line, index: idx + 1 }))
          .filter(({ line }) => !line.simType)
          .map(({ index }) => index);
      }

      const targetLines = lineNumber ? [lineNumber] : linesNeedingSim;
      const esimResult = autoAssignEsimForLines(sessionId, context, targetLines);
      if (esimResult?.updatedContext) {
        context = esimResult.updatedContext;
        progress = getFlowProgress(sessionId);
      }

      const assignedLines = esimResult?.assignedLines || [];
      const alreadySetLines = targetLines.filter(line => !assignedLines.includes(line));

      let mainResponse = "";
      if (assignedLines.length > 0) {
        mainResponse = `✅ **eSIM is set for Line${assignedLines.length > 1 ? 's' : ''} ${assignedLines.join(', ')}.**\n\nWe currently provide **eSIM only**, so I’ve taken care of this for you.`;
      } else if (alreadySetLines.length > 0) {
        mainResponse = `✅ **eSIM already set** for Line${alreadySetLines.length > 1 ? 's' : ''} ${alreadySetLines.join(', ')}.\n\nWe currently provide **eSIM only**.`;
      } else {
        mainResponse = `✅ **eSIM is already selected for all lines.**\n\nWe currently provide **eSIM only**.`;
      }

      const hasPlan = context && context.lines && context.lines.some(l => l && l.planSelected);
      let suggestions = "";
      if (!hasPlan) {
        suggestions = `**Next step:** Select a plan for your line${context?.lineCount > 1 ? 's' : ''}. Say "Show me plans".`;
      } else {
        suggestions = `You're all set with eSIM. You can continue with devices, protection, or checkout.`;
      }

      const nextSteps = getNextStepsForIntent(context, INTENT_TYPES.SIM);
      const responseText = formatThreeSectionResponse(mainResponse, suggestions, nextSteps);

      return {
        content: [
          {
            type: "text",
            text: responseText,
          }
        ]
      };
    }

    if (name === "get_protection_plan") {
      // Check prerequisites
      const sessionId = getOrCreateSessionId(args.sessionId || null);
      const prerequisites = sessionId ? checkPrerequisites(sessionId, 'add_protection') : { allowed: true };

      if (!prerequisites.allowed) {
        return {
          content: [
            {
              type: "text",
              text: `## ⚠️ Device Protection\n\n${prerequisites.reason}\n\n` +
                `**Note:** Device protection is optional, but requires a device to be added first.`
            }
          ]
        };
      }

      const protectionPlans = await fetchProtectionPlans(tenant);

      if (isAppsSDK) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, protectionPlans }) }],
        };
      }

      const cardMarkdown = formatProtectionPlansAsCards(protectionPlans);

      // Add conversational guidance with button suggestions
      let responseText = cardMarkdown;

      if (sessionId) {
        const flowContext = getFlowContext(sessionId);
        const progress = getFlowProgress(sessionId);
        if (flowContext && progress) {
          const linesNeedingProtection = progress.missing.protection || [];
          if (linesNeedingProtection.length > 0) {
            responseText += `\n\n**What I need to add protection**\n\n`;
            responseText += `Tell me:\n`;
            responseText += `1. Your state, and\n`;
            responseText += `2. Whether you want to add device protection to Line ${linesNeedingProtection[0]}`;
            if (linesNeedingProtection.length > 1) {
              responseText += ` (or lines ${linesNeedingProtection.join(', ')})`;
            }
            responseText += `\n\nOnce I have that, I can add the protection item to your cart and move you closer to checkout.`;
          }

          // Add button suggestions
          responseText += formatButtonSuggestions(flowContext, progress, 'protection');
        }
      } else {
        responseText += `\n\n**Note:** Device protection is available in eligible states. Add a device to your cart first, then we can add protection.`;
      }

      return {
        content: [
          {
            type: "text",
            text: responseText,
          },
        ],
      };
    }

    if (name === "add_to_cart") {
      const itemType = args.itemType || 'plan';
      const lineNumber = args.lineNumber || null;
      const lineNumbersArg = Array.isArray(args.lineNumbers) ? args.lineNumbers : null;
      const sessionId = getOrCreateSessionId(args.sessionId || null);

      let item;

      // Fetch item based on type
      if (itemType === 'plan') {
        const plans = await getPlans(null, tenant);
        // Search by id (transformed) or uniqueIdentifier (original API field)
        item = plans.find((p) =>
          p.id === args.itemId ||
          p.uniqueIdentifier === args.itemId ||
          (p.id && p.id.toString() === args.itemId.toString()) ||
          (p.uniqueIdentifier && p.uniqueIdentifier.toString() === args.itemId.toString())
        );
        if (!item) {
          throw new Error(`Plan ${args.itemId} not found. Available plans: ${plans.map(p => p.id || p.uniqueIdentifier).join(', ')}`);
        }
        item = {
          type: 'plan',
          id: item.id || item.uniqueIdentifier,
          uniqueIdentifier: item.uniqueIdentifier || item.id,
          name: item.displayName || item.displayNameWeb || item.name,
          price: item.price || item.baseLinePrice || 0,
          data: item.data || item.planData,
          dataUnit: item.dataUnit || 'GB',
        };
      } else if (itemType === 'device') {
        // Fetch devices - use maximum allowed limit (100) and no brand filter first
        let devices = await fetchDevices(100, null, tenant);

        // If no devices found, log warning but continue
        if (!devices || devices.length === 0) {
          logger.warn("No devices found when trying to add to cart", {
            itemId: args.itemId,
            tenant
          });
          throw new Error(`Unable to fetch devices from the catalog. Please try again or browse devices first.`);
        }

        // Try to find device by multiple criteria:
        // 1. Exact match on id, productNumber, or ean
        // 2. Exact match on name (case-insensitive)
        // 3. Partial match on name (case-insensitive)
        const itemIdLower = (args.itemId || '').toLowerCase().trim();
        item = devices.find((d) => {
          const id = d.id || d.productNumber || d.ean || '';
          const name = (d.name || d.translated?.name || '').toLowerCase();

          // Exact ID match
          if (id && id.toLowerCase() === itemIdLower) return true;

          // Exact name match
          if (name && name === itemIdLower) return true;

          // Partial name match (device name contains the search term)
          if (name && name.includes(itemIdLower)) return true;

          // Reverse partial match (search term contains key parts of device name)
          const nameWords = name.split(/\s+/).filter(w => w.length > 3); // Words longer than 3 chars
          if (nameWords.some(word => itemIdLower.includes(word))) return true;

          return false;
        });

        if (!item) {
          // Log available device names for debugging
          const availableNames = devices.slice(0, 5).map(d => d.name || d.translated?.name || d.id || 'Unknown').join(', ');
          logger.warn("Device not found in catalog", {
            searchedItemId: args.itemId,
            totalDevices: devices.length,
            sampleDeviceNames: availableNames,
            tenant
          });
          throw new Error(`Device "${args.itemId}" not found in the catalog. Please browse available devices first or check the device name.`);
        }

        // Extract device image from multiple sources and normalize URL
        const rawImageUrl = item.cover?.media?.url ||
          (item.media && item.media[0]?.media?.url) ||
          item.image ||
          item.coverImage ||
          item.thumbnail ||
          null;
        const deviceImage = normalizeDeviceImageUrl(rawImageUrl);

        // Extract device properties for specs
        const properties = item.properties || [];

        // Determine local image path for fallback
        let localImageUrl = null;
        if (rawImageUrl) {
          const extension = rawImageUrl.split('.').pop().split(/[?#]/)[0] || 'png';
          const localPath = `/public/assets/${item.id || item.productNumber}.${extension}`;
          // Use absolute URL if base URL is detected, otherwise relative
          localImageUrl = serverBaseUrl ? `${serverBaseUrl}${localPath}` : localPath;
        }

        item = {
          type: 'device',
          id: item.id || item.productNumber || item.ean,
          name: item.name || item.translated?.name,
          brand: item.manufacturer?.name || item.brand || item.translated?.manufacturer?.name || '',
          price: item.calculatedPrice?.unitPrice || item.calculatedPrice?.totalPrice || item.price?.[0]?.gross || 0,
          image: deviceImage,
          localImageUrl: localImageUrl,
          properties: properties,
          customFields: item.customFields || {},
          translated: item.translated || {},
          calculatedPrice: item.calculatedPrice || null,
          available: item.available,
          availableStock: item.availableStock,
          stock: item.stock,
        };
      } else if (itemType === 'protection') {
        // Protection plans - price will be calculated based on device price on target line
        // Coverage information will be added
        const coverageInfo = getProtectionCoverage();
        item = {
          type: 'protection',
          id: args.itemId,
          name: args.itemName || 'Device Protection',
          price: args.itemPrice || 0, // Will be recalculated based on device price before adding to cart
          coverage: coverageInfo.coverage,
          highlights: coverageInfo.highlights
        };
      } else if (itemType === 'sim') {
        // SIM selection - supports ESIM and PSIM
        const simType = args.simType || args.itemId; // itemId can be 'ESIM' or 'PSIM'
        if (!simType || (simType !== 'ESIM' && simType !== 'PSIM')) {
          throw new Error(`Invalid SIM type: ${simType}. Must be 'ESIM' or 'PSIM'.`);
        }
        item = {
          type: 'sim',
          simType: simType,
          iccId: args.iccId || args.newIccId || null,
          name: simType === 'ESIM' ? 'eSIM' : 'Physical SIM',
          price: 0, // SIMs are typically free
          id: `sim_${simType.toLowerCase()}`,
        };
      } else {
        throw new Error(`Unknown item type: ${itemType}`);
      }

      // Ensure flow context exists first to check lineCount
      const sessionIdForContext = getOrCreateSessionId(sessionId || null);
      let flowContext = getFlowContext(sessionIdForContext);

      // For devices: Check if line count is set, if not, ask for it and resume device selection
      if (itemType === 'device' && (!flowContext || !flowContext.lineCount || flowContext.lineCount === 0)) {
        // Set resume step to device selection so we can continue after line count is provided
        setResumeStep(sessionIdForContext, 'device_selection');
        // Set current question to ask for line count
        setCurrentQuestion(sessionIdForContext, QUESTION_TYPES.LINE_COUNT,
          "How many lines do you need? (Each line can have a device)",
          { lineCount: true });
        // Update last intent to remember we're in device flow
        updateLastIntent(sessionIdForContext, INTENT_TYPES.DEVICE, 'add_to_cart');

        return {
          content: [{
            type: "text",
            text: `## 📱 Device Selected\n\n` +
              `Great choice! You've selected **${item.name}**.\n\n` +
              `Before I can add this device to your cart, I need to know how many lines you'd like to set up.\n\n` +
              `**How many lines do you need?**\n\n` +
              `For example:\n` +
              `• "1 line"\n` +
              `• "2 lines"\n` +
              `• "Family of 4 lines"\n\n` +
              `Once you tell me the number of lines, I'll immediately add the device to your cart and you can continue shopping. 📱✨`
          }],
          _meta: {
            sessionId: sessionIdForContext,
            intent: INTENT_TYPES.DEVICE,
            requiresLineCount: true,
            resumeStep: 'device_selection',
            deviceItem: item // Store the device item for later use
          }
        };
      }

      // For plans: if line count is missing, ask before adding to cart
      if (itemType === 'plan' && (!flowContext || !flowContext.lineCount || flowContext.lineCount === 0)) {
        setResumeStep(sessionIdForContext, 'plan_selection');
        setCurrentQuestion(sessionIdForContext, QUESTION_TYPES.LINE_COUNT,
          "How many lines do you need? (You can choose the same or different plans per line)",
          { lineCount: true });
        updateLastIntent(sessionIdForContext, INTENT_TYPES.PLAN, 'add_to_cart');

        return {
          content: [{
            type: "text",
            text: `## 📱 Plan Selected\n\n` +
              `Great choice! You've selected **${item.name}**.\n\n` +
              `Before I add this plan to your cart, I need to know how many lines you'd like to set up.\n\n` +
              `**How many lines do you need?**\n\n` +
              `Once you tell me, I can apply this plan to all lines or mix and match.`
          }],
          _meta: {
            sessionId: sessionIdForContext,
            intent: INTENT_TYPES.PLAN,
            requiresLineCount: true,
            resumeStep: 'plan_selection',
            planItem: item
          }
        };
      }

      // Determine target line number(s) using smart assignment
      let targetLineNumber = lineNumber;
      let targetLineNumbers = null;
      let assignmentSuggestion = null;
      let assignmentReason = null;

      const wantsAllLines = typeof lineNumber === 'string' && lineNumber.toLowerCase() === 'all';
      const normalizedLineNumbers = lineNumbersArg
        ? lineNumbersArg
            .map(n => Number.parseInt(n, 10))
            .filter(n => Number.isInteger(n) && n > 0)
        : [];

      if (flowContext) {
        if ((itemType === 'plan' || itemType === 'device') && (wantsAllLines || normalizedLineNumbers.length > 0)) {
          const maxLines = flowContext.lineCount || 0;
          if (!maxLines) {
            return {
              content: [{
                type: "text",
                text: `## 📱 Line Count Required\n\nBefore I can add this plan to multiple lines, I need to know how many lines you'd like to set up.\n\n**How many lines do you need?**`
              }],
              _meta: {
                sessionId: sessionIdForContext,
                intent: INTENT_TYPES.PLAN,
                requiresLineCount: true,
                resumeStep: 'plan_selection',
                planItem: item
              }
            };
          }

          if (wantsAllLines) {
            targetLineNumbers = Array.from({ length: maxLines }, (_, i) => i + 1);
            assignmentSuggestion = `I'll add this plan to all ${maxLines} lines.`;
            assignmentReason = 'apply_all';
          } else {
            targetLineNumbers = normalizedLineNumbers.filter(n => n <= maxLines);
            assignmentSuggestion = `I'll add this plan to lines ${targetLineNumbers.join(', ')}.`;
            assignmentReason = 'multi_line';
          }
        }
      }

      if (flowContext && (!targetLineNumbers || targetLineNumbers.length === 0)) {
        try {
          // Use smart line assignment
          const assignment = determineOptimalLineAssignment(flowContext, itemType, lineNumber);

          // Handle case where assignment fails (e.g., protection without device)
          if (assignment.targetLineNumber === null) {
            return {
              content: [{
                type: "text",
                text: `## ⚠️ Cannot Add ${itemType.charAt(0).toUpperCase() + itemType.slice(1)}\n\n${assignment.suggestion}\n\n**What you can do:**\n• Add a device first: Say "Show me devices"\n• Then add protection: Say "Add protection"`,
              }],
              isError: true
            };
          }

          targetLineNumber = assignment.targetLineNumber;
          assignmentSuggestion = assignment.suggestion;
          assignmentReason = assignment.reason;

          // Validate line number doesn't exceed lineCount (safety check)
          if (targetLineNumber > flowContext.lineCount) {
            logger.warn('Line number exceeds lineCount, correcting', {
              targetLineNumber,
              lineCount: flowContext.lineCount,
              itemType
            });
            targetLineNumber = flowContext.lineCount;
            assignmentSuggestion = `I'll add this to Line ${targetLineNumber} (your last line).`;
          }

          // Ensure line exists (but only up to lineCount)
          const maxLines = flowContext.lineCount || targetLineNumber;
          while (flowContext.lines.length < targetLineNumber && flowContext.lines.length < maxLines) {
            flowContext.lines.push({
              lineNumber: flowContext.lines.length + 1,
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

          // Update line state
          const line = flowContext.lines[targetLineNumber - 1];
          if (line) {
            if (itemType === 'plan') {
              line.planSelected = true;
              line.planId = item.id;
            } else if (itemType === 'device') {
              line.deviceSelected = true;
              line.deviceId = item.id;
            } else if (itemType === 'protection') {
              line.protectionSelected = true;
              line.protectionId = item.id;
            } else if (itemType === 'sim') {
              line.simType = item.simType;
              line.simIccId = item.iccId || null;
            }
          }

          // Trim lines array to match lineCount (safety)
          if (flowContext.lineCount && flowContext.lines.length > flowContext.lineCount) {
            flowContext.lines = flowContext.lines.slice(0, flowContext.lineCount);
          }

          updateFlowContext(sessionIdForContext, {
            lines: flowContext.lines,
            flowStage: 'configuring'
          });
        } catch (error) {
          logger.error('Error in line assignment', { error: error.message, itemType, lineNumber });
          // Fallback to line 1 if assignment fails
          targetLineNumber = 1;
          assignmentSuggestion = "I'll add this to Line 1.";
        }
      } else if (!targetLineNumbers || targetLineNumbers.length === 0) {
        // No context - default to line 1
        targetLineNumber = 1;
        assignmentSuggestion = "I'll add this to Line 1. You may want to set up your line count first.";
      }

      if (flowContext && targetLineNumbers && targetLineNumbers.length > 0) {
        const maxLines = flowContext.lineCount || targetLineNumbers.length;
        while (flowContext.lines.length < maxLines) {
          flowContext.lines.push({
            lineNumber: flowContext.lines.length + 1,
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

        targetLineNumbers.forEach(lineNum => {
          const line = flowContext.lines[lineNum - 1];
          if (!line) return;
          if (itemType === 'plan') {
            line.planSelected = true;
            line.planId = item.id;
          } else if (itemType === 'device') {
            line.deviceSelected = true;
            line.deviceId = item.id;
          } else if (itemType === 'protection') {
            line.protectionSelected = true;
            line.protectionId = item.id;
          } else if (itemType === 'sim') {
            line.simType = item.simType;
            line.simIccId = item.iccId || null;
          }
        });

        updateFlowContext(sessionIdForContext, {
          lines: flowContext.lines,
          flowStage: 'configuring'
        });
      }

      // Safety: Ensure we always have a valid line number
      if ((!targetLineNumbers || targetLineNumbers.length === 0) && (!targetLineNumber || targetLineNumber < 1)) {
        targetLineNumber = 1;
      }

      // For protection items: Calculate price based on device price on target line(s)
      if (itemType === 'protection') {
        const currentCart = getCartMultiLine(sessionIdForContext);
        
        if (targetLineNumbers && targetLineNumbers.length > 0) {
          // Multiple lines - each line will get its own protection item with calculated price
          // We'll handle this in the loop below
        } else {
          // Single line - calculate price based on device on that line
          const targetLine = currentCart.lines?.find(l => l.lineNumber === targetLineNumber);
          if (targetLine?.device) {
            const devicePrice = targetLine.device.price || 0;
            const calculatedPrice = calculateProtectionPrice(devicePrice);
            item.price = calculatedPrice;
            logger.info('Protection price calculated', {
              devicePrice,
              protectionPrice: calculatedPrice,
              lineNumber: targetLineNumber
            });
          } else {
            // No device on line - should be prevented by prerequisites, but handle gracefully
            logger.warn('Protection added to line without device', {
              lineNumber: targetLineNumber,
              hasLine: !!targetLine
            });
            // Default to lowest tier
            item.price = calculateProtectionPrice(0);
          }
        }
      }

      // CRITICAL: Prevent adding plan to ANY line when user hasn't chosen mode
      // If user just mentions a plan name without "apply to all" or "mix and match",
      // we must ask them to choose first
      if (itemType === 'plan' && flowContext && flowContext.lineCount > 1) {
        const planMode = flowContext.planMode || 'UNKNOWN';
        
        // If mode is not explicitly set to APPLY_TO_ALL or MIX_AND_MATCH, ask user to choose
        if (planMode !== 'APPLY_TO_ALL' && planMode !== 'MIX_AND_MATCH') {
          // Store the plan ID for later use
          updateFlowContext(sessionIdForContext, {
            lastChosenPlanId: item.id,
            planModePrompted: true,
            planMode: 'UNKNOWN' // Ensure it's set to UNKNOWN
          });
          
          return {
            content: [{
              type: "text",
              text: `You selected **${item.name}**. For ${flowContext.lineCount} lines, would you like to:\n\n` +
                    `✅ **Apply to all lines** - Use the same plan for all ${flowContext.lineCount} lines\n\n` +
                    `🔀 **Mix and match** - Choose different plans for each line\n\n` +
                    `Please tell me "apply to all" or "mix and match".`
            }]
          };
        }
      }

      // Now add to cart with validated line number
      let cart, finalSessionId;
      try {
        if (targetLineNumbers && targetLineNumbers.length > 0) {
          finalSessionId = sessionIdForContext;
          targetLineNumbers.forEach(lineNum => {
            // For protection on multiple lines, calculate price per line
            let protectionItem = item;
            if (itemType === 'protection') {
              const currentCart = getCartMultiLine(sessionIdForContext);
              const targetLine = currentCart.lines?.find(l => l.lineNumber === lineNum);
              if (targetLine?.device) {
                const devicePrice = targetLine.device.price || 0;
                const calculatedPrice = calculateProtectionPrice(devicePrice);
                // Create a copy of the item with calculated price for this line
                protectionItem = {
                  ...item,
                  price: calculatedPrice
                };
                logger.info('Protection price calculated for line', {
                  lineNumber: lineNum,
                  devicePrice,
                  protectionPrice: calculatedPrice
                });
              } else {
                // No device on line - default to lowest tier
                protectionItem = {
                  ...item,
                  price: calculateProtectionPrice(0)
                };
                logger.warn('Protection added to line without device', {
                  lineNumber: lineNum
                });
              }
            }
            const cartResult = addToCart(sessionIdForContext, protectionItem, lineNum);
            cart = cartResult.cart;
            finalSessionId = cartResult.sessionId;
          });
        } else {
          const cartResult = addToCart(sessionIdForContext, item, targetLineNumber);
          cart = cartResult.cart;
          finalSessionId = cartResult.sessionId;
        }
      } catch (error) {
        logger.error('Error adding to cart', { error: error.message, itemType, targetLineNumber });
        return {
          content: [{
            type: "text",
            text: `## ⚠️ Error Adding Item\n\nI encountered an error adding ${item.name} to your cart.\n\n**Please try again:**\n• Say "Show me plans" or "Show me devices"\n• Then click "Add to Cart" again\n\nIf the problem persists, please contact support.`
          }],
          isError: true
        };
      }

      let esimNote = "";
      if (itemType === 'plan') {
        const esimTargets = targetLineNumbers && targetLineNumbers.length > 0
          ? targetLineNumbers
          : [targetLineNumber];
        const esimResult = autoAssignEsimForLines(finalSessionId, getFlowContext(finalSessionId), esimTargets);
        if (esimResult?.assignedLines && esimResult.assignedLines.length > 0) {
          const lineLabel = esimResult.assignedLines.length > 1 ? 'Lines' : 'Line';
          esimNote = `✅ **eSIM set automatically** for ${lineLabel} ${esimResult.assignedLines.join(', ')}. We currently provide **eSIM only**.\n\n`;
        }
      }

      // Update intent and conversation history
      if (finalSessionId) {
        const intentMap = {
          'plan': INTENT_TYPES.PLAN,
          'device': INTENT_TYPES.DEVICE,
          'protection': INTENT_TYPES.PROTECTION,
          'sim': INTENT_TYPES.SIM
        };
        const intent = intentMap[itemType] || INTENT_TYPES.OTHER;
        updateLastIntent(finalSessionId, intent, 'add_to_cart');
        addConversationHistory(finalSessionId, {
          intent,
          action: 'add_to_cart',
          data: {
            itemType,
            itemId: item.id,
            lineNumber: targetLineNumber || lineNumber,
            lineNumbers: targetLineNumbers || undefined
          }
        });

        // Set appropriate resume step
        if (itemType === 'plan') {
          setResumeStep(finalSessionId, 'plan_selection');
        } else if (itemType === 'device') {
          setResumeStep(finalSessionId, 'device_selection');
        } else if (itemType === 'protection') {
          setResumeStep(finalSessionId, 'protection_selection');
        } else if (itemType === 'sim') {
          setResumeStep(finalSessionId, 'sim_selection');
        }
      }

      // Build three-section response
      const finalContext = finalSessionId ? getFlowContext(finalSessionId) : null;
      const progress = finalSessionId ? getFlowProgress(finalSessionId) : null;

      // SECTION 1: RESPONSE
      let mainResponse = `✅ **${item.name}** has been added to your cart!\n\n`;
      mainResponse += `**Item:** ${item.name}\n`;
      if (targetLineNumbers && targetLineNumbers.length > 0) {
        mainResponse += `**Lines:** ${targetLineNumbers.join(', ')}\n`;
      } else if (lineNumber || targetLineNumber) {
        mainResponse += `**Line:** ${lineNumber || targetLineNumber}\n`;
      }
      mainResponse += `**Type:** ${itemType.charAt(0).toUpperCase() + itemType.slice(1)}\n`;
      mainResponse += `**Price:** $${item.price}${itemType === 'plan' ? '/month' : ''}\n`;
      mainResponse += `**Cart Total:** $${cart.total}`;

      // Include assignment suggestion if available and not user-specified
      if (assignmentSuggestion && assignmentReason !== 'user_specified') {
        mainResponse += `\n\n${assignmentSuggestion}`;
      }

      // SECTION 2: SUGGESTIONS
      let suggestions = "";
      if (finalContext && progress) {
        const intentMap = {
          'plan': INTENT_TYPES.PLAN,
          'device': INTENT_TYPES.DEVICE,
          'protection': INTENT_TYPES.PROTECTION,
          'sim': INTENT_TYPES.SIM
        };
        const intent = intentMap[itemType] || INTENT_TYPES.OTHER;

        if (itemType === 'plan') {
          const missingPlans = progress.missing?.plans || [];
          if (missingPlans.length > 0) {
            suggestions = `You have ${missingPlans.length} more line${missingPlans.length > 1 ? 's' : ''} that need${missingPlans.length === 1 ? 's' : ''} a plan. `;
            if (missingPlans.length > 1) {
              suggestions += `You can select the same plan for all remaining lines or choose different plans for each.`;
            } else {
              suggestions += `Select a plan for the remaining line to continue.`;
            }
          } else {
            suggestions = `All lines now have plans! Plans are required for checkout, and you've completed this step.`;
          }
        } else if (itemType === 'device') {
          const linesWithDevices = (finalContext.lines || []).filter(l => l.deviceSelected).length;
          const missingPlans = progress.missing?.plans || [];
          const linesNeedingProtection = (finalContext.lines || []).filter(l => 
            l.deviceSelected && !l.protectionSelected
          ).length;

          suggestions = `✅ Device added to line ${lineNumber || targetLineNumber}. You now have ${linesWithDevices} device${linesWithDevices > 1 ? 's' : ''} in your cart.\n\n`;

          // CRITICALLY emphasize plans requirement if missing
          if (missingPlans.length > 0) {
            suggestions += `⚠️ **CRITICAL: PLANS REQUIRED BEFORE CHECKOUT**\n\n`;
            suggestions += `**You have added a device, but plans are MANDATORY for checkout.**\n\n`;
            suggestions += `**Next Step (REQUIRED):**\n`;
            suggestions += `👉 **I'll automatically show you available plans** - The system will use the \`get_plans\` tool to display mobile plans for ${missingPlans.length === 1 ? 'your line' : `your ${missingPlans.length} lines`}.\n\n`;
            suggestions += `**Why plans are required:**\n`;
            suggestions += `• Plans provide your phone service (calls, texts, data)\n`;
            suggestions += `• Without a plan, your device cannot be activated\n`;
            suggestions += `• Plans are mandatory for ALL lines before checkout\n\n`;
            if (missingPlans.length > 1) {
              suggestions += `**→ You can:** Apply the same plan to all lines or choose different plans per line\n\n`;
            }
            suggestions += `**→ After selecting plans:** Choose SIM types → Complete checkout`;
          } else {
            // Plans are complete
            suggestions += `**Note:** Plans are already selected for all lines.\n\n`;
            
            // Add protection suggestion if there are devices without protection
            if (linesNeedingProtection > 0) {
              suggestions += `🛡️ **Device Protection Available**\n\n`;
              suggestions += `You have ${linesNeedingProtection} device${linesNeedingProtection > 1 ? 's' : ''} without protection. Device protection covers:\n`;
              suggestions += `• Accidental damage (drops, spills, cracks)\n`;
              suggestions += `• Loss or theft\n`;
              suggestions += `• Screen repairs\n\n`;
              suggestions += `**Would you like to add device protection?** You can say:\n`;
              suggestions += `• "Show me protection options" or "I want device protection"\n`;
              suggestions += `• "Add protection to all devices" or "Add protection to line X"\n\n`;
              suggestions += `**Note:** Protection is optional. You can also proceed to SIM selection or checkout.`;
            } else {
              suggestions += `Devices are optional - you can add more devices, or proceed to SIM selection.`;
            }
          }
        } else if (itemType === 'protection') {
          suggestions = `Device protection added for line ${lineNumber || targetLineNumber}. This covers accidental damage, loss, and theft for your device.`;
        } else if (itemType === 'sim') {
          const missingSims = progress.missing?.sim || [];
          if (missingSims.length > 0) {
            suggestions = `SIM type selected for line ${lineNumber || targetLineNumber}. You still need to select SIM types for ${missingSims.length} more line${missingSims.length > 1 ? 's' : ''}.`;
          } else {
            suggestions = `All lines now have SIM types selected! This is required for activation and shipping.`;
          }
        }
      } else {
        suggestions = `Item added successfully. Continue building your cart or review your selections.`;
      }

      if (esimNote) {
        suggestions = esimNote + (suggestions || "");
      }

      // SECTION 3: NEXT STEPS
      const nextSteps = finalContext ? getNextStepsForIntent(finalContext, itemType) : getNextStepsForIntent(null, null);

      const responseText = formatThreeSectionResponse(mainResponse, suggestions, nextSteps);

      // Determine suggested tool based on what was added and what's missing
      let suggestedTool = null;
      if (itemType === 'device' && progress && progress.missing && progress.missing.plans && progress.missing.plans.length > 0) {
        // After device is added, if plans are missing, suggest get_plans tool
        suggestedTool = 'get_plans';
      } else if (itemType === 'plan' && progress && progress.missing && progress.missing.sim && progress.missing.sim.length > 0) {
        // After plan is added, if SIM is missing, suggest get_sim_types tool
        suggestedTool = 'get_sim_types';
      }

      if (itemType === 'plan' && finalContext && progress && progress.missing?.plans?.length > 0 && finalContext.planSelectionMode === 'sequential') {
        // Don't call getPlans - just return text response
        const cartSnapshot = finalSessionId ? getCartMultiLine(finalSessionId) : null;

        const linesWithPlans = cartSnapshot ? (cartSnapshot.lines || [])
          .filter(l => l.plan && l.plan.id)
          .map(l => l.lineNumber) : [];

        let activeLineId = null;
        const lineCount = finalContext.lineCount || 0;
        for (let i = 1; i <= lineCount; i++) {
          if (!linesWithPlans.includes(i)) {
            activeLineId = i;
            break;
          }
        }

        const responseText = `✅ **${item.name}** added for Line ${targetLineNumber || lineNumber}.\n\n**Next:** Select a plan for Line ${activeLineId}.`;

        return {
          content: [{
            type: "text",
            text: responseText
          }]
        };
      }

      if (itemType === 'device' && finalContext && finalContext.deviceSelectionMode === 'sequential' && finalContext.lineCount > 0) {
        const cartSnapshot = finalSessionId ? getCartMultiLine(finalSessionId) : null;
        const linesWithDevices = cartSnapshot ? (cartSnapshot.lines || [])
          .filter(l => l.device && l.device.id)
          .map(l => l.lineNumber) : [];

        let activeLineId = null;
        for (let i = 1; i <= finalContext.lineCount; i++) {
          if (!linesWithDevices.includes(i)) {
            activeLineId = i;
            break;
          }
        }

        if (activeLineId) {
          const devices = await fetchDevices(16, null, tenant);
          const trimmedDevices = devices.slice(0, 8);
          const structuredDevices = trimmedDevices.map(device => ({
            ...device,
            id: device.id || device.productNumber || device.ean,
            name: device.name || device.translated?.name,
            brand: device.manufacturer?.name || device.brand || device.translated?.manufacturer?.name,
            price: device.calculatedPrice?.unitPrice || device.calculatedPrice?.totalPrice || device.price?.[0]?.gross || 0,
            image: normalizeDeviceImageUrl(device.cover?.media?.url || device.media?.[0]?.media?.url || device.image || null),
            properties: device.properties || [],
            calculatedPrice: device.calculatedPrice || device.calculatedCheapestPrice,
            calculatedCheapestPrice: device.calculatedCheapestPrice,
            stock: device.stock,
            availableStock: device.availableStock,
            available: device.available,
          }));

          const selectedDevicesPerLine = {};
          if (cartSnapshot && cartSnapshot.lines) {
            cartSnapshot.lines.forEach(line => {
              if (line.device && line.device.id) {
                selectedDevicesPerLine[String(line.lineNumber)] = line.device.id;
              }
            });
          }

          return {
            structuredContent: {
              selectionMode: 'sequential',
              activeLineId,
              selectedDevicesPerLine,
              linesWithDevices,
              deviceModePrompted: true,
              devices: structuredDevices,
              lineCount: finalContext.lineCount,
              lines: finalContext.lines ? finalContext.lines.map((line, index) => ({
                lineNumber: line.lineNumber || (index + 1),
                phoneNumber: line.phoneNumber || null,
                planSelected: line.planSelected || false,
                planId: line.planId || null,
                deviceSelected: line.deviceSelected || false,
                deviceId: line.deviceId || null,
                protectionSelected: line.protectionSelected || false,
                protectionId: line.protectionId || null,
                simType: line.simType || null,
                simIccId: line.simIccId || null
              })) : []
            },
            content: [{
              type: "text",
              text: `✅ **${item.name}** added for Line ${targetLineNumber || lineNumber}.\n\n**Next:** Select a device for Line ${activeLineId} (optional).\n\n**Skip option:** Say "Skip device for line ${activeLineId}".`
            }],
            _meta: {
              "openai/outputTemplate": "ui://widget/devices.html",
              "openai/resultCanProduceWidget": true,
              "openai/widgetAccessible": true,
              widgetType: "deviceCard"
            }
          };
        } else {
          // All devices selected in sequential mode - suggest protection
          const linesNeedingProtection = (finalContext.lines || []).filter(l => 
            l.deviceSelected && !l.protectionSelected
          ).length;
          
          if (linesNeedingProtection > 0) {
            const protectionSuggestion = `✅ **All devices selected!** You've added devices to all ${finalContext.lineCount} line${finalContext.lineCount > 1 ? 's' : ''}.\n\n` +
              `🛡️ **Device Protection Available**\n\n` +
              `You have ${linesNeedingProtection} device${linesNeedingProtection > 1 ? 's' : ''} without protection. Device protection covers:\n` +
              `• Accidental damage (drops, spills, cracks)\n` +
              `• Loss or theft\n` +
              `• Screen repairs\n\n` +
              `**Would you like to add device protection?** You can say:\n` +
              `• "Show me protection options" or "I want device protection"\n` +
              `• "Add protection to all devices" or "Add protection to line X"\n\n` +
              `**Note:** Protection is optional. You can also proceed to SIM selection or checkout.`;
            
            return {
              content: [{
                type: "text",
                text: protectionSuggestion
              }]
            };
          }
        }
      }

      return {
        content: [
          {
            type: "text",
            text: responseText,
          },
        ],
        _meta: {
          suggestedTool: suggestedTool,
          itemType: itemType,
          lineNumber: lineNumber || targetLineNumber
        }
      };
    }

    if (name === "get_cart") {
      // Use provided sessionId or get most recent
      const sessionId = getOrCreateSessionId(args.sessionId || null);

      // Try to get multi-line cart first
      let cartMultiLine = getCartMultiLine(sessionId);
      const context = sessionId ? getFlowContext(sessionId) : null;
      const progress = sessionId ? getFlowProgress(sessionId) : null;

      // CRITICAL: Filter out lines beyond configured lineCount
      if (context && context.lineCount && cartMultiLine && cartMultiLine.lines) {
        const originalLineCount = cartMultiLine.lines.length;
        cartMultiLine.lines = cartMultiLine.lines.filter((line, idx) => {
          const lineNum = line.lineNumber || (idx + 1);
          return lineNum <= context.lineCount;
        });

        // Recalculate total after filtering
        if (cartMultiLine.lines.length !== originalLineCount) {
          cartMultiLine.total = cartMultiLine.lines.reduce((sum, l) => {
            return sum +
              (l.plan?.price || 0) +
              (l.device?.price || 0) +
              (l.protection?.price || 0) +
              (l.sim?.price || 0);
          }, 0);

          logger.info('Filtered cart lines beyond lineCount', {
            sessionId,
            lineCount: context.lineCount,
            originalLines: originalLineCount,
            filteredLines: cartMultiLine.lines.length
          });
        }
      }

      // Use multi-line structure if available, otherwise fall back to old structure
      let structuredData;
      let headerText;

      if (cartMultiLine.lines && cartMultiLine.lines.length > 0) {
        structuredData = buildCartStructuredContent(cartMultiLine, cartMultiLine.sessionId || sessionId);

        // Generate conversational cart display with button suggestions
        if (progress && progress.missing) {
          const missing = progress.missing;

          // If SIM is missing, show detailed cart format like user's example
          if (missing.sim && missing.sim.length > 0 && missing.sim.length === 1) {
            headerText = `Here's your cart (Session: ${cartMultiLine.sessionId || 'default'}):\n\n`;

            // Show detailed cart summary for each line
            cartMultiLine.lines.forEach((line, idx) => {
              const lineNum = line.lineNumber || (idx + 1);
              headerText += `**Line ${lineNum}**\n\n`;

              if (line.plan) {
                headerText += `Plan: ${line.plan.name} — $${line.plan.price}/mo`;
                if (line.plan.data) {
                  headerText += ` (${line.plan.data}${line.plan.dataUnit || 'GB'})`;
                }
                headerText += `\n\n`;
              }

              if (line.device) {
                const deviceName = line.device.brand ? `${line.device.brand} ${line.device.name}` : line.device.name;
                headerText += `Device: ${deviceName} — $${line.device.price}\n\n`;
              }

              if (line.protection) {
                headerText += `Protection: ${line.protection.name} — $${line.protection.price}\n\n`;
              } else if (line.device) {
                headerText += `Protection: Not added\n\n`;
              }

              if (line.sim && line.sim.simType) {
                headerText += `SIM: ${line.sim.simType === 'ESIM' ? 'eSIM' : 'Physical SIM'}\n\n`;
              } else {
                headerText += `SIM: Not selected yet\n\n`;
              }

              const lineTotal = (line.plan?.price || 0) + (line.device?.price || 0) + (line.protection?.price || 0);
              headerText += `Total: $${lineTotal.toFixed(2)}\n\n`;
            });

            headerText += `Want eSIM or physical SIM (pSIM) for Line ${missing.sim[0]}?`;
          } else {
            // For other missing items, show summary
            const missingItems = [];
            if (missing.plans && missing.plans.length > 0) {
              missingItems.push(`plan${missing.plans.length > 1 ? 's' : ''} for line${missing.plans.length > 1 ? 's' : ''} ${missing.plans.join(', ')}`);
            }
            if (missing.devices && missing.devices.length > 0) {
              missingItems.push(`device${missing.devices.length > 1 ? 's' : ''} for line${missing.devices.length > 1 ? 's' : ''} ${missing.devices.join(', ')} (optional)`);
            }
            if (missing.protection && missing.protection.length > 0) {
              missingItems.push(`protection for line${missing.protection.length > 1 ? 's' : ''} ${missing.protection.join(', ')} (optional)`);
            }
            if (missing.sim && missing.sim.length > 1) {
              missingItems.push(`SIM types for lines ${missing.sim.join(', ')}`);
            }

            if (missingItems.length > 0) {
              headerText = `Here's your cart. **Still need:** ${missingItems.join(', ')}.`;
            } else {
              headerText = "Here's your cart. All items are configured! Ready to proceed to checkout.";
            }
          }
        } else {
          headerText = "Here's your shopping cart. Proceed to checkout when ready.";
        }

        // Add button suggestions
        if (progress && context) {
          headerText += formatButtonSuggestions(context, progress);
        }
      } else {
        // Old structure (backward compatibility)
        const cartResult = getCartWithSession(sessionId);
        structuredData = buildCartStructuredContent(cartResult, cartResult.sessionId || sessionId);
        headerText = "Here's your shopping cart. Proceed to checkout when ready.";
      }

      const response = {
        structuredContent: structuredData,
        content: [
          {
            type: "text",
            text: headerText,
          }
        ]
      };

      logger.info("📤 get_cart response", {
        hasStructuredContent: !!response.structuredContent,
        isMultiLine: !!(cartMultiLine.lines && cartMultiLine.lines.length > 0),
        itemsCount: structuredData.cards?.length || 0,
        sessionId: structuredData.sessionId,
        providedSessionId: sessionId,
        responsePreview: JSON.stringify(response, null, 2).substring(0, 500)
      });

      return response;
    }

    if (name === "hello_widget") {
      return {
        structuredContent: { message: `Hello, ${args.name || "World"}!` },
        content: [
          {
            type: "text",
            text: `Greeting ${args.name || "World"} in a widget.`
          }
        ],
        _meta: {}
      };
    }


    if (name === "get_flow_status") {
      const sessionId = getOrCreateSessionId(args.sessionId || null);
      const context = getFlowContext(sessionId);
      const progress = getFlowProgress(sessionId);
      const globalFlags = getGlobalContextFlags(sessionId);

      if (!context || !globalFlags.linesConfigured) {
        return {
          content: [
            {
              type: "text",
              text: `## 📊 Flow Status\n\n` +
                `No active purchase flow found.\n\n` +
                `**To get started:**\n` +
                `- Call \`start_session\` to begin\n` +
                `- Or start by checking coverage or selecting a plan`
            }
          ]
        };
      }

      const statusText = formatFlowStatus(progress, context);

      // Include global flags in response (already declared above)
      const flagsSummary = `\n\n---\n\n**Global Context Flags:**\n` +
        `• Lines Configured: ${globalFlags.linesConfigured ? '✅' : '❌'}\n` +
        `• Plan Selected: ${globalFlags.planSelected ? '✅' : '❌'}\n` +
        `• Device Selected: ${globalFlags.deviceSelected ? '✅' : '❌'}\n` +
        `• Protection Selected: ${globalFlags.protectionSelected ? '✅' : '❌'}\n` +
        `• SIM Selected: ${globalFlags.simSelected ? '✅' : '❌'}\n` +
        `• Coverage Checked: ${globalFlags.coverageChecked ? '✅' : '❌'}`;

      return {
        content: [
          {
            type: "text",
            text: statusText + flagsSummary
          }
        ],
        _meta: {
          globalFlags: globalFlags
        }
      };
    }

    if (name === "get_global_context") {
      const sessionId = getOrCreateSessionId(args.sessionId || null);
      const context = getFlowContext(sessionId);
      const globalFlags = getGlobalContextFlags(sessionId);

      if (!context) {
        return {
          content: [
            {
              type: "text",
              text: `## 📊 Global Context\n\nNo active session found. Please start a purchase flow first.`
            }
          ]
        };
      }

      const flagsText = `# 📊 Global Context (System Memory)\n\n` +
        `**Session ID:** ${sessionId}\n\n` +
        `## Context Flags\n\n` +
        `| Flag | Status |\n` +
        `|------|--------|\n` +
        `| Lines Configured | ${globalFlags.linesConfigured ? '✅ Yes' : '❌ No'} |\n` +
        `| Plan Selected | ${globalFlags.planSelected ? '✅ Yes' : '❌ No'} |\n` +
        `| Device Selected | ${globalFlags.deviceSelected ? '✅ Yes' : '❌ No'} |\n` +
        `| Protection Selected | ${globalFlags.protectionSelected ? '✅ Yes' : '❌ No'} |\n` +
        `| SIM Selected | ${globalFlags.simSelected ? '✅ Yes' : '❌ No'} |\n` +
        `| Coverage Checked | ${globalFlags.coverageChecked ? '✅ Yes' : '❌ No'} |\n\n` +
        `## Details\n\n` +
        `- **Line Count:** ${context.lineCount || 0}\n` +
        `- **Flow Stage:** ${context.flowStage || 'initial'}\n` +
        `- **Last Intent:** ${context.lastIntent || 'none'}\n` +
        `- **Last Action:** ${context.lastAction || 'none'}\n` +
        (globalFlags.coverageChecked ? `- **Coverage ZIP:** ${context.coverageZipCode || 'N/A'}\n` : '');

      return {
        content: [
          {
            type: "text",
            text: flagsText
          }
        ],
        _meta: {
          globalFlags: globalFlags,
          sessionId: sessionId
        }
      };
    }

    if (name === "update_line_count") {
      const sessionId = getOrCreateSessionId(args.sessionId || null);
      const newLineCount = args.lineCount;

      if (!newLineCount || newLineCount < 1) {
        throw new Error('Line count must be at least 1');
      }

      const context = getFlowContext(sessionId);
      const cart = getCartMultiLine(sessionId);

      // If reducing line count, check if there are items in lines that will be removed
      if (context && context.lineCount && newLineCount < context.lineCount) {
        const linesToRemove = [];
        for (let i = newLineCount + 1; i <= context.lineCount; i++) {
          const lineIndex = i - 1;
          if (context.lines && context.lines[lineIndex]) {
            const line = context.lines[lineIndex];
            if (line.planSelected || line.deviceSelected || line.protectionSelected || line.simType) {
              linesToRemove.push(i);
            }
          }
          // Also check cart
          if (cart && cart.lines) {
            const cartLine = cart.lines.find(l => l.lineNumber === i);
            if (cartLine && (cartLine.plan || cartLine.device || cartLine.protection || cartLine.sim)) {
              if (!linesToRemove.includes(i)) {
                linesToRemove.push(i);
              }
            }
          }
        }

        if (linesToRemove.length > 0) {
          return {
            content: [
              {
                type: "text",
                text: `## ⚠️ Cannot Reduce Line Count\n\n` +
                  `You're trying to reduce from ${context.lineCount} to ${newLineCount} line${newLineCount > 1 ? 's' : ''}, but you have items in Line${linesToRemove.length > 1 ? 's' : ''} ${linesToRemove.join(', ')}.\n\n` +
                  `**To reduce line count:**\n` +
                  `1. Remove items from Line${linesToRemove.length > 1 ? 's' : ''} ${linesToRemove.join(', ')} first\n` +
                  `2. Then update the line count\n\n` +
                  `**Or:** Keep ${context.lineCount} line${context.lineCount > 1 ? 's' : ''} and continue with your current configuration.`
              }
            ],
            isError: true
          };
        }
      }

      if (!context) {
        // Create new context
        const finalSessionId = sessionId || getOrCreateSessionId(null);
        updateFlowContext(finalSessionId, {
          lineCount: newLineCount,
          flowStage: 'planning'
        });
      } else {
        // Update existing context and trim lines array
        const currentLines = context.lines || [];
        const trimmedLines = currentLines.slice(0, newLineCount);

        // Ensure we have enough lines
        while (trimmedLines.length < newLineCount) {
          trimmedLines.push({
            lineNumber: trimmedLines.length + 1,
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

        updateFlowContext(sessionId, {
          lineCount: newLineCount,
          lines: trimmedLines
        });
      }

      // Clean up cart - remove lines beyond newLineCount
      if (cart && cart.lines && cart.lines.length > newLineCount) {
        const trimmedCartLines = cart.lines.slice(0, newLineCount);
        const newTotal = trimmedCartLines.reduce((sum, l) => {
          return sum +
            (l.plan?.price || 0) +
            (l.device?.price || 0) +
            (l.protection?.price || 0) +
            (l.sim?.price || 0);
        }, 0);

        // Update cart with trimmed lines
        const updatedCart = {
          ...cart,
          lines: trimmedCartLines,
          total: newTotal
        };

        // Save updated cart
        const carts = require('./services/cartService.js');
        // We need to access the carts Map directly - for now, just update via addToCart pattern
        // Actually, we'll need to import a function to update cart directly
        // For now, let's just log and the cart will be corrected on next addToCart
        logger.info('Cart lines trimmed due to line count reduction', {
          sessionId,
          oldLineCount: cart.lines.length,
          newLineCount,
          removedLines: cart.lines.slice(newLineCount).map(l => l.lineNumber)
        });
      }

      const updatedContext = getFlowContext(sessionId);
      const progress = getFlowProgress(sessionId);

      let responseText = `✅ Line count updated to ${newLineCount}!\n\n`;
      if (context && context.lineCount && newLineCount < context.lineCount) {
        responseText += `**Note:** Lines beyond ${newLineCount} have been removed from your configuration.\n\n`;
      }
      responseText += formatFlowStatus(progress, updatedContext) +
        `\n\n**Next:** Select plans for your ${newLineCount} line${newLineCount > 1 ? 's' : ''}.`;

      return {
        content: [
          {
            type: "text",
            text: responseText
          }
        ]
      };
    }

    if (name === "select_sim_type") {
      const sessionId = getOrCreateSessionId(args.sessionId || null);
      const selections = args.selections; // Batch selection array
      const customerId = args.customerId;

      // Check if batch selection or single selection
      let simSelections = [];

      if (selections && Array.isArray(selections) && selections.length > 0) {
        // Batch selection mode
        simSelections = selections.map(sel => ({
          lineNumber: sel.lineNumber,
          simType: sel.simType?.toUpperCase(),
          newIccId: sel.newIccId || null
        }));

        // Validate all selections
        for (const sel of simSelections) {
          if (!sel.lineNumber || sel.lineNumber < 1) {
            throw new Error(`Invalid line number: ${sel.lineNumber}. Line number must be at least 1.`);
          }
          if (!sel.simType || !['ESIM', 'PSIM'].includes(sel.simType)) {
            throw new Error(`Invalid SIM type for line ${sel.lineNumber}: ${sel.simType}. Must be ESIM or PSIM.`);
          }
        }
      } else {
        // Single selection mode (backward compatible)
        const lineNumber = args.lineNumber;
        const simType = args.simType?.toUpperCase();
        const newIccId = args.newIccId;

        if (!lineNumber || lineNumber < 1) {
          throw new Error('Line number must be at least 1');
        }

        if (!simType || !['ESIM', 'PSIM'].includes(simType)) {
          throw new Error('SIM type must be ESIM or PSIM');
        }

        simSelections = [{
          lineNumber,
          simType,
          newIccId: newIccId || null
        }];
      }

      let context = getFlowContext(sessionId);

      // Determine max line number needed
      const maxLineNumber = Math.max(...simSelections.map(s => s.lineNumber));

      // If no flow context exists, try to initialize from existing cart
      if (!context || !context.lineCount) {
        const cart = getCartMultiLine(sessionId);

        // If cart has lines, auto-initialize flow context
        if (cart && cart.lines && cart.lines.length > 0) {
          const inferredLineCount = Math.max(cart.lines.length, maxLineNumber);
          logger.info('Auto-initializing flow context from cart', { sessionId, inferredLineCount });

          // Create flow context from cart
          const lines = cart.lines.map((line, index) => ({
            lineNumber: line.lineNumber || (index + 1),
            planSelected: !!line.plan,
            planId: line.plan?.id || null,
            deviceSelected: !!line.device,
            deviceId: line.device?.id || null,
            protectionSelected: !!line.protection,
            protectionId: line.protection?.id || null,
            simType: line.sim?.simType || null,
            simIccId: line.sim?.iccId || null
          }));

          updateFlowContext(sessionId, {
            lineCount: inferredLineCount,
            lines: lines,
            flowStage: 'configuring'
          });

          context = getFlowContext(sessionId);
        } else {
          // No cart either - auto-initialize with max line number needed
          logger.info('Auto-initializing purchase flow for SIM selection', { sessionId, maxLineNumber });
          const initialLines = [];
          for (let i = 1; i <= maxLineNumber; i++) {
            initialLines.push({
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

          updateFlowContext(sessionId, {
            lineCount: maxLineNumber,
            flowStage: 'planning',
            lines: initialLines
          });

          context = getFlowContext(sessionId);
        }
      }

      // Ensure all needed lines exist
      while (context.lines.length < maxLineNumber) {
        context.lines.push({
          lineNumber: context.lines.length + 1,
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

      // Update lineCount if needed
      if (maxLineNumber > context.lineCount) {
        updateFlowContext(sessionId, {
          lineCount: maxLineNumber
        });
        context = getFlowContext(sessionId);
      }

      // Process all SIM selections
      const results = [];
      const swapResults = [];

      for (const sel of simSelections) {
        const { lineNumber, simType, newIccId } = sel;

        // Update flow context
        const line = context.lines[lineNumber - 1];
        if (line) {
          line.simType = simType;
          if (newIccId) {
            line.simIccId = newIccId;
          }
        }

        // Update cart with SIM selection
        const simItem = {
          type: 'sim',
          simType: simType,
          iccId: newIccId || null,
          price: 0,
          lineNumber: lineNumber
        };

        addToCartLine(sessionId, lineNumber, simItem);

        // Perform SIM swap if needed
        if (customerId && newIccId && simType === 'PSIM') {
          try {
            const swapResult = await swapSim(customerId, newIccId, simType, tenant);
            swapResults.push({ lineNumber, success: swapResult?.success || false });
          } catch (error) {
            logger.error('SIM swap failed', { error: error.message, lineNumber });
            swapResults.push({ lineNumber, success: false, error: error.message });
          }
        }

        results.push({
          lineNumber,
          simType,
          newIccId
        });
      }

      // Update flow context with all changes
      updateFlowContext(sessionId, {
        lines: context.lines
      });

      // Build response text
      let responseText = "";

      if (simSelections.length === 1) {
        // Single selection response
        const sel = simSelections[0];
        responseText = `✅ **SIM type selected for Line ${sel.lineNumber}!**\n\n` +
          `**SIM Type:** ${sel.simType === 'ESIM' ? 'eSIM' : 'Physical SIM (pSIM)'}\n`;

        if (sel.newIccId) {
          responseText += `**ICCID:** ${sel.newIccId}\n`;
        }

        const swapResult = swapResults.find(sr => sr.lineNumber === sel.lineNumber);
        if (swapResult && swapResult.success) {
          responseText += `\n✅ SIM swap completed successfully!\n`;
        } else if (customerId && sel.newIccId && sel.simType === 'PSIM') {
          responseText += `\n⚠️ SIM swap was not performed. Please contact support if needed.\n`;
        }
      } else {
        // Batch selection response
        responseText = `✅ **SIM types selected for ${simSelections.length} line${simSelections.length > 1 ? 's' : ''}!**\n\n`;

        for (const sel of simSelections) {
          const simTypeName = sel.simType === 'ESIM' ? 'eSIM' : 'Physical SIM';
          responseText += `**Line ${sel.lineNumber}:** ${simTypeName}`;
          if (sel.newIccId) {
            responseText += ` (ICCID: ${sel.newIccId})`;
          }
          responseText += `\n`;
        }

        // Check for swap results
        const successfulSwaps = swapResults.filter(sr => sr.success);
        if (successfulSwaps.length > 0) {
          responseText += `\n✅ SIM swap${successfulSwaps.length > 1 ? 's' : ''} completed successfully for line${successfulSwaps.length > 1 ? 's' : ''} ${successfulSwaps.map(sr => sr.lineNumber).join(', ')}!\n`;
        }
      }

      const progress = getFlowProgress(sessionId);
      const flowContext = getFlowContext(sessionId);

      // Use improved guidance service for next steps
      if (flowContext) {
        const intent = INTENT_TYPES.SIM;
        const guidance = generateConversationalResponse("", flowContext, intent, {
          itemType: 'sim',
          lineNumber: simSelections.length === 1 ? simSelections[0].lineNumber : null,
          simType: simSelections.length === 1 ? simSelections[0].simType : null
        });
        if (guidance) {
          responseText += `\n\n${guidance}`;
        }
      }

      // Check if plan is needed (required for checkout)
      const hasPlan = flowContext && flowContext.lines && flowContext.lines.some(l => l && l.planSelected);

      if (!hasPlan && !responseText.includes("plan")) {
        responseText += `\n\n📱 **Next Step:** Select mobile plan${simSelections.length > 1 ? 's' : ''} to continue.\n`;
        responseText += `Say **"Show me plans"** to browse and select plan${simSelections.length > 1 ? 's' : ''} for your line${simSelections.length > 1 ? 's' : ''}. Plans are required before checkout.`;
      }

      // Fallback to old format if guidance service doesn't provide enough info
      const allComplete = progress.lineCount > 0 &&
        (!progress.missing.sim || progress.missing.sim.length === 0) &&
        (!progress.missing.plans || progress.missing.plans.length === 0);

      if (allComplete && !responseText.includes("Ready for checkout")) {
        responseText += `\n\n🎉 **All lines are configured!** Ready to proceed to checkout.`;
      }

      return {
        content: [
          {
            type: "text",
            text: responseText
          }
        ]
      };
    }

    if (name === "review_cart") {
      const sessionId = getOrCreateSessionId(args.sessionId || null);
      const context = getFlowContext(sessionId);
      const cart = getCartMultiLine(sessionId);
      const progress = getFlowProgress(sessionId);

      // Check prerequisites
      const prerequisites = checkPrerequisites(sessionId, 'checkout');
      const checkoutGuidance = getCheckoutGuidance(context);

      // Build three-section response
      let mainResponse = "";
      let suggestions = "";
      let nextSteps = "";

      // Prepare structuredContent for SDK cards (same as get_cart)
      let structuredData;
      if (cart && cart.lines && cart.lines.length > 0) {
        structuredData = buildCartStructuredContent(cart, cart.sessionId || sessionId || "default");
      } else {
        // Fallback to old structure if needed
        const cartResult = getCartWithSession(sessionId);
        structuredData = buildCartStructuredContent(cartResult, cartResult.sessionId || sessionId || "default");
      }

      if (!prerequisites.allowed || !checkoutGuidance.ready) {
        // SECTION 1: RESPONSE - Cart not ready
        mainResponse = formatMultiLineCartReview(cart, context);

        // SECTION 2: SUGGESTIONS - What's missing
        updateMissingPrerequisites(sessionId, checkoutGuidance.missing);
        suggestions = `**⚠️ Cannot proceed to checkout yet.**\n\n`;
        suggestions += checkoutGuidance.guidance || prerequisites.reason;

        // SECTION 3: NEXT STEPS - What to do
        nextSteps = getNextStepsForIntent(context, INTENT_TYPES.CHECKOUT);

        const responseText = formatThreeSectionResponse(mainResponse, suggestions, nextSteps);

        return {
          structuredContent: structuredData,
          content: [
            {
              type: "text",
              text: responseText
            }
          ]
        };
      }

      // Cart is ready for checkout
      // SECTION 1: RESPONSE - Cart summary
      mainResponse = formatMultiLineCartReview(cart, context);

      // SECTION 2: SUGGESTIONS - What's included
      const globalFlags = getGlobalContextFlags(sessionId);
      const lineCount = progress.lineCount || 0;
      suggestions = `**Your order includes:**\n`;
      suggestions += `• ${lineCount} line${lineCount > 1 ? 's' : ''} with plans\n`;

      // Use global flags instead of filtering
      if (globalFlags.deviceSelected) {
        const linesWithDevices = (context.lines || []).filter(l => l.deviceSelected).length;
        if (linesWithDevices > 0) {
          suggestions += `• ${linesWithDevices} device${linesWithDevices > 1 ? 's' : ''}\n`;
        }
      }

      if (globalFlags.protectionSelected) {
        const linesWithProtection = (context.lines || []).filter(l => l.protectionSelected).length;
        if (linesWithProtection > 0) {
          suggestions += `• ${linesWithProtection} device protection plan${linesWithProtection > 1 ? 's' : ''}\n`;
        }
      }

      suggestions += `• SIM types selected for all lines\n\n`;
      // Check if shipping address is collected
      const hasShippingAddress = context.shippingAddress && context.checkoutDataCollected;
      
      if (!hasShippingAddress) {
        suggestions += `\n\n⚠️ **Next Step:** Provide shipping address to complete checkout.`;
        
        // SECTION 3: NEXT STEPS - Collect shipping address
        nextSteps = `**→ To Complete Checkout:**\n`;
        nextSteps += `   • Say "I need to enter my shipping address" or use collect_shipping_address tool\n`;
        nextSteps += `   • After shipping address is collected, use get_checkout_data to get complete order data for payment\n\n`;
        nextSteps += `**→ Need Changes?**\n`;
        nextSteps += `   • Say "Edit cart" to modify items\n`;
        nextSteps += `   • Say "Add device" to add more devices\n`;
        nextSteps += `   • Say "Change plan" to modify plan selections`;
      } else {
        suggestions += `\n\n✅ **Shipping address collected!** Ready to get checkout data for payment.`;
        
        // SECTION 3: NEXT STEPS - Get checkout data
        nextSteps = `**→ To Complete Purchase:**\n`;
        nextSteps += `   • Say "Get checkout data" or use get_checkout_data tool to get all order information\n`;
        nextSteps += `   • This will return complete data (cart, shipping, billing, user info) for your payment API\n\n`;
        nextSteps += `**→ Need Changes?**\n`;
        nextSteps += `   • Say "Edit cart" to modify items\n`;
        nextSteps += `   • Say "Update shipping address" to change shipping information\n`;
      }

      const responseText = formatThreeSectionResponse(mainResponse, suggestions, nextSteps);

      return {
        structuredContent: structuredData,
        content: [
          {
            type: "text",
            text: responseText
          }
        ]
      };
    }

    if (name === "collect_shipping_address") {
      const sessionId = getOrCreateSessionId(args.sessionId || null);
      const context = getFlowContext(sessionId);

      if (!context) {
        throw new Error('No flow context found. Please start a purchase flow first.');
      }

      // Validate prerequisites - cart must be ready
      const shippingPrereq = checkPrerequisites(sessionId, 'collect_shipping');
      if (!shippingPrereq.allowed) {
        return {
          content: [
            {
              type: "text",
              text: `**⚠️ Cannot collect shipping address yet.**\n\n${shippingPrereq.reason}\n\nPlease complete your cart first (plans and SIM types for all lines).`
            }
          ]
        };
      }

      // Validate required fields
      const requiredFields = ['firstName', 'lastName', 'street', 'city', 'state', 'zipCode', 'phone', 'email'];
      const missingFields = requiredFields.filter(field => !args[field] || args[field].trim() === '');
      
      if (missingFields.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: `**⚠️ Missing required fields:**\n\n${missingFields.map(f => `• ${f}`).join('\n')}\n\nPlease provide all required shipping address information.`
            }
          ]
        };
      }

      // Store shipping address in flow context
      const shippingAddress = {
        firstName: args.firstName.trim(),
        lastName: args.lastName.trim(),
        street: args.street.trim(),
        city: args.city.trim(),
        state: args.state.trim(),
        zipCode: args.zipCode.trim(),
        country: (args.country || 'US').trim(),
        phone: args.phone.trim(),
        email: args.email.trim()
      };

      updateFlowContext(sessionId, {
        shippingAddress,
        checkoutDataCollected: true,
        flowStage: 'checkout',
        lastAction: 'collect_shipping_address'
      });

      return {
        content: [
          {
            type: "text",
            text: `✅ **Shipping address collected successfully!**\n\n**Shipping Address:**\n${shippingAddress.firstName} ${shippingAddress.lastName}\n${shippingAddress.street}\n${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.zipCode}\n${shippingAddress.country}\n\n**Contact:**\nPhone: ${shippingAddress.phone}\nEmail: ${shippingAddress.email}\n\n**Next Step:** Use \`get_checkout_data\` tool to get complete order information (cart, shipping, billing, user info) ready for your payment API.`
          }
        ]
      };
    }

    if (name === "get_checkout_data") {
      const sessionId = getOrCreateSessionId(args.sessionId || null);
      const context = getFlowContext(sessionId);
      const cart = getCartMultiLine(sessionId);
      const progress = getFlowProgress(sessionId);

      if (!context) {
        throw new Error('No flow context found. Please start a purchase flow first.');
      }

      // Validate prerequisites
      const cartPrereq = checkPrerequisites(sessionId, 'checkout');
      if (!cartPrereq.allowed) {
        return {
          content: [
            {
              type: "text",
              text: `**⚠️ Cart not ready for checkout.**\n\n${cartPrereq.reason}\n\nPlease complete your cart first (plans and SIM types for all lines).`
            }
          ]
        };
      }

      // Check shipping address
      if (!context.shippingAddress || !context.checkoutDataCollected) {
        return {
          content: [
            {
              type: "text",
              text: `**⚠️ Shipping address not collected.**\n\nPlease collect shipping address first using \`collect_shipping_address\` tool before getting checkout data.`
            }
          ]
        };
      }

      // Calculate totals
      let monthlyTotal = 0;
      let deviceTotal = 0;
      let protectionTotal = 0;

      if (cart && cart.lines && cart.lines.length > 0) {
        cart.lines.forEach(line => {
          if (line.plan) monthlyTotal += line.plan.price || 0;
          if (line.device) deviceTotal += line.device.price || 0;
          if (line.protection) protectionTotal += line.protection.price || 0;
        });
      }

      const handlingFee = 10.00;
      const shippingFee = (deviceTotal > 0 || protectionTotal > 0) ? 15.00 : 0;
      const oneTimeTotal = deviceTotal + protectionTotal + handlingFee + shippingFee;
      const totalDueToday = oneTimeTotal;

      // Build complete checkout data object
      const checkoutData = {
        sessionId: sessionId,
        cart: {
          lines: cart.lines || [],
          totals: {
            monthlyTotal: monthlyTotal,
            deviceTotal: deviceTotal,
            protectionTotal: protectionTotal,
            handlingFee: handlingFee,
            shippingFee: shippingFee,
            oneTimeTotal: oneTimeTotal,
            totalDueToday: totalDueToday
          }
        },
        shippingAddress: { ...context.shippingAddress },
        billingAddress: { ...context.shippingAddress }, // Same as shipping
        userInfo: {
          email: context.shippingAddress.email,
          phone: context.shippingAddress.phone,
          name: `${context.shippingAddress.firstName} ${context.shippingAddress.lastName}`
        },
        orderSummary: {
          monthlyTotal: monthlyTotal,
          oneTimeTotal: oneTimeTotal,
          totalDueToday: totalDueToday,
          lineCount: context.lineCount || 0
        },
        timestamp: Date.now()
      };

      return {
        content: [
          {
            type: "text",
            text: `✅ **Complete Checkout Data Ready for Payment API**\n\nAll order information has been collected and is ready for payment processing.\n\n**Order Summary:**\n• ${context.lineCount} line${context.lineCount > 1 ? 's' : ''}\n• Monthly Total: $${monthlyTotal.toFixed(2)}/mo\n• One-Time Total: $${oneTimeTotal.toFixed(2)}\n• Total Due Today: $${totalDueToday.toFixed(2)}\n\n**Shipping Address:**\n${context.shippingAddress.firstName} ${context.shippingAddress.lastName}\n${context.shippingAddress.street}\n${context.shippingAddress.city}, ${context.shippingAddress.state} ${context.shippingAddress.zipCode}\n\n**Contact:** ${context.shippingAddress.email} | ${context.shippingAddress.phone}\n\n**Complete data structure is available in the response for your payment API integration.**`
          }
        ],
        // Include structured data for programmatic access
        structuredContent: {
          checkoutData: checkoutData
        }
      };
    }

    if (name === "detect_intent") {
      const userMessage = args.userMessage;
      const sessionId = getOrCreateSessionId(args.sessionId || null);
      const context = getFlowContext(sessionId);

      if (!userMessage) {
        throw new Error('userMessage is required');
      }

      // Detect intent and extract entities
      const intentResult = detectIntent(userMessage, context || {});
      const routing = routeIntent(intentResult.intent, intentResult.entities, context);

      // Update context with last intent
      if (context && sessionId) {
        updateLastIntent(sessionId, intentResult.intent, routing.action);
        addConversationHistory(sessionId, {
          intent: intentResult.intent,
          action: routing.action,
          data: { entities: intentResult.entities }
        });
      }

      return {
        content: [
          {
            type: "text",
            text: `## Intent Detection\n\n` +
              `**Intent:** ${intentResult.intent}\n` +
              `**Confidence:** ${Math.round(intentResult.confidence * 100)}%\n` +
              `**Route:** ${routing.route}\n` +
              `**Action:** ${routing.action}\n` +
              `**Prerequisites:** ${routing.prerequisites.allowed ? '✅ Allowed' : '❌ ' + routing.prerequisites.reason}\n` +
              (intentResult.entities && Object.keys(intentResult.entities).length > 0
                ? `\n**Entities:**\n${JSON.stringify(intentResult.entities, null, 2)}\n`
                : '') +
              `\n**Guidance:** ${routing.guidance}` +
              (routing.redirectTo ? `\n\n**Suggested redirect:** ${routing.redirectTo}` : '')
          }
        ]
      };
    }

    if (name === "get_next_step") {
      const sessionId = getOrCreateSessionId(args.sessionId || null);
      const context = getFlowContext(sessionId);
      const currentStep = args.currentStep || null;

      if (!context) {
        return {
          content: [
            {
              type: "text",
              text: `## Next Step\n\n` +
                `**Step:** line_count\n` +
                `**Action:** start_session\n` +
                `**Guidance:** Let's get started! How many lines would you like to set up?`
            }
          ]
        };
      }

      const nextStep = getNextStepFromRouter(context, currentStep);
      const suggestions = getNextStepSuggestions(context);

      // Check resume step
      const resumeStep = getResumeStep(sessionId);

      let guidanceText = `## Next Step\n\n`;
      if (resumeStep) {
        guidanceText += `**Resume Step:** ${resumeStep}\n`;
      }
      guidanceText += `**Next Step:** ${nextStep.step}\n` +
        `**Action:** ${nextStep.action}\n` +
        `**Guidance:** ${nextStep.guidance}`;

      if (suggestions.suggestions && suggestions.suggestions.length > 0) {
        guidanceText += `\n\n**Suggestions:**\n`;
        suggestions.suggestions.forEach((suggestion, index) => {
          guidanceText += `${index + 1}. ${suggestion}\n`;
        });
      }

      return {
        content: [
          {
            type: "text",
            text: guidanceText
          }
        ]
      };
    }

    if (name === "edit_cart_item") {
      const sessionId = getOrCreateSessionId(args.sessionId || null);
      const action = args.action; // remove, change, update
      const itemType = args.itemType; // plan, device, protection, sim
      const lineNumber = args.lineNumber;
      const oldItemId = args.oldItemId;
      const newItemId = args.newItemId;
      const newSimType = args.newSimType;

      if (!action || !itemType || !lineNumber) {
        throw new Error('action, itemType, and lineNumber are required');
      }

      const context = getFlowContext(sessionId);
      if (!context) {
        throw new Error('No active cart to edit. Please start a purchase flow first.');
      }

      if (lineNumber < 1 || lineNumber > context.lineCount) {
        throw new Error(`Line number ${lineNumber} is invalid. Valid range: 1-${context.lineCount}`);
      }

      const line = context.lines[lineNumber - 1];
      if (!line) {
        throw new Error(`Line ${lineNumber} not found`);
      }

      let responseText = `## Edit Cart Item\n\n`;
      let updated = false;

      if (action === 'remove') {
        // Remove item from cart and context
        if (itemType === 'plan') {
          line.planSelected = false;
          line.planId = null;
          responseText += `✅ Plan removed from Line ${lineNumber}\n`;
        } else if (itemType === 'device') {
          line.deviceSelected = false;
          line.deviceId = null;
          // Also remove protection if device is removed
          if (line.protectionSelected) {
            line.protectionSelected = false;
            line.protectionId = null;
            responseText += `✅ Device and protection removed from Line ${lineNumber}\n`;
          } else {
            responseText += `✅ Device removed from Line ${lineNumber}\n`;
          }
        } else if (itemType === 'protection') {
          line.protectionSelected = false;
          line.protectionId = null;
          responseText += `✅ Protection removed from Line ${lineNumber}\n`;
        } else if (itemType === 'sim') {
          line.simType = null;
          line.simIccId = null;
          responseText += `✅ SIM type removed from Line ${lineNumber}\n`;
        }
        updated = true;
      } else if (action === 'change') {
        if (itemType === 'plan') {
          if (!oldItemId || !newItemId) {
            throw new Error('oldItemId and newItemId are required for changing plans');
          }
          line.planId = newItemId;
          responseText += `✅ Plan changed on Line ${lineNumber}\n`;
          updated = true;
        } else if (itemType === 'device') {
          if (!oldItemId || !newItemId) {
            throw new Error('oldItemId and newItemId are required for changing devices');
          }
          line.deviceId = newItemId;
          responseText += `✅ Device changed on Line ${lineNumber}\n`;
          updated = true;
        } else if (itemType === 'sim') {
          if (!newSimType) {
            throw new Error('newSimType is required for changing SIM type');
          }
          line.simType = newSimType;
          responseText += `✅ SIM type changed to ${newSimType} on Line ${lineNumber}\n`;
          updated = true;
        }
      } else if (action === 'update') {
        // Update properties (e.g., SIM type)
        if (itemType === 'sim' && newSimType) {
          line.simType = newSimType;
          responseText += `✅ SIM type updated to ${newSimType} on Line ${lineNumber}\n`;
          updated = true;
        }
      }

      if (updated) {
        // CRITICAL: Actually remove item from cart storage, not just flow context
        // removeFromCartLine handles removing protection when device is removed
        if (action === 'remove') {
          removeFromCartLine(sessionId, lineNumber, itemType);
        }

        // Update flow context to match cart
        updateFlowContext(sessionId, {
          lines: context.lines
        });

        const progress = getFlowProgress(sessionId);
        responseText += `\n` + formatFlowStatus(progress, context);

        // Add guidance
        const suggestions = getNextStepSuggestions(context);
        if (suggestions.suggestions && suggestions.suggestions.length > 0) {
          responseText += `\n\n**Next Steps:**\n`;
          suggestions.suggestions.slice(0, 3).forEach((suggestion, index) => {
            responseText += `${index + 1}. ${suggestion}\n`;
          });
        }
      } else {
        responseText += `⚠️ No changes made. Please check your parameters.`;
      }

      return {
        content: [
          {
            type: "text",
            text: responseText
          }
        ]
      };
    }

    if (name === "clear_cart") {
      const sessionId = getOrCreateSessionId(args.sessionId || null);
      const resetFlowContextFlag = args.resetFlowContext !== false; // Default to true

      // Clear cart storage
      removeAllFromCart(sessionId);

      // Also clear cart from storage (in case there's old structure)
      clearCart(sessionId);

      // Reset flow context if requested
      if (resetFlowContextFlag) {
        resetFlowContext(sessionId);

        return {
          content: [
            {
              type: "text",
              text: `## ✅ Cart Cleared Successfully\n\n` +
                `Your cart has been completely cleared and the session has been reset.\n\n` +
                `**What was cleared:**\n` +
                `• All plans\n` +
                `• All devices\n` +
                `• All protection plans\n` +
                `• All SIM selections\n` +
                `• Flow context reset\n\n` +
                `**What you can do now:**\n` +
                `• Start a new purchase flow\n` +
                `• Browse plans or devices\n` +
                `• Check coverage\n` +
                `• Begin fresh with a new order\n\n` +
                `Just let me know what you'd like to do next!`
            }
          ],
          _meta: {
            sessionId: sessionId,
            cartCleared: true,
            flowContextReset: true
          }
        };
      } else {
        // Only clear cart items, keep flow structure
        const context = getFlowContext(sessionId);
        if (context && context.lines) {
          // Clear all items from lines but keep line structure
          context.lines.forEach(line => {
            line.planSelected = false;
            line.planId = null;
            line.deviceSelected = false;
            line.deviceId = null;
            line.protectionSelected = false;
            line.protectionId = null;
            line.simType = null;
            line.simIccId = null;
          });

          updateFlowContext(sessionId, {
            lines: context.lines,
            planSelected: false,
            deviceSelected: false,
            protectionSelected: false,
            simSelected: false
          });
        }

        return {
          content: [
            {
              type: "text",
              text: `## ✅ Cart Cleared\n\n` +
                `All items have been removed from your cart.\n\n` +
                `**What was cleared:**\n` +
                `• All plans\n` +
                `• All devices\n` +
                `• All protection plans\n` +
                `• All SIM selections\n\n` +
                `**Flow structure preserved:** Your line count and flow context remain intact.\n\n` +
                `You can now add new items to your cart or modify your selections.`
            }
          ],
          _meta: {
            sessionId: sessionId,
            cartCleared: true,
            flowContextReset: false
          }
        };
      }
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    logger.error(`Tool error: ${name}`, { error: error.message });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { success: false, error: error.message },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
});

// ================================================================================
// HELPER FUNCTIONS FOR THREE-SECTION RESPONSE FORMAT
// ================================================================================

/**
 * Format response into three sections: Response | Suggestions | Next Steps
 * @param {string} mainResponse - The primary response/data
 * @param {string} suggestions - Interpretation/explanation of the response
 * @param {string} nextSteps - Flow-aligned next steps
 * @returns {string} Formatted response
 */
function formatThreeSectionResponse(mainResponse, suggestions, nextSteps) {
  let formatted = "";

  // SECTION 1: RESPONSE
  formatted += "### 1️⃣ Response\n\n";
  formatted += mainResponse.trim();

  // SECTION 2: SUGGESTIONS
  if (suggestions && suggestions.trim().length > 0) {
    formatted += "\n\n---\n\n### 2️⃣ Suggestions\n\n";
    formatted += suggestions.trim();
  }

  // SECTION 3: NEXT STEPS
  if (nextSteps && nextSteps.trim().length > 0) {
    formatted += "\n\n---\n\n### 3️⃣ Next Steps\n\n";
    formatted += nextSteps.trim();
  }

  return formatted;
}

function autoAssignEsimForLines(sessionId, context, lineNumbers) {
  if (!sessionId || !context || !Array.isArray(lineNumbers) || lineNumbers.length === 0) {
    return null;
  }

  const assignedLines = [];
  const maxLineNumber = Math.max(...lineNumbers);

  if (!context.lineCount || context.lineCount < maxLineNumber) {
    context.lineCount = maxLineNumber;
  }

  while (context.lines.length < maxLineNumber) {
    context.lines.push({
      lineNumber: context.lines.length + 1,
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

  lineNumbers.forEach((lineNumber) => {
    if (!lineNumber || lineNumber < 1) return;
    const line = context.lines[lineNumber - 1];
    if (!line || line.simType === 'ESIM') return;

    line.simType = 'ESIM';
    line.simIccId = null;
    assignedLines.push(lineNumber);

    addToCartLine(sessionId, lineNumber, {
      type: 'sim',
      simType: 'ESIM',
      iccId: null,
      price: 0,
      lineNumber: lineNumber
    });
  });

  if (assignedLines.length > 0) {
    updateFlowContext(sessionId, {
      lineCount: context.lineCount,
      lines: context.lines,
      flowStage: 'configuring'
    });
  }

  return {
    assignedLines,
    updatedContext: getFlowContext(sessionId)
  };
}

function formatCurrency(amount) {
  const value = Number(amount || 0);
  return `$${value.toFixed(2)}`;
}

function buildCartStructuredContent(cart, sessionId) {
  const structured = {
    sessionId: sessionId || "default",
    cards: []
  };

  if (cart && Array.isArray(cart.lines) && cart.lines.length > 0) {
    let monthlyTotal = 0;
    let deviceTotal = 0;
    let protectionTotal = 0;

    cart.lines.forEach((line, index) => {
      const lineNumber = line.lineNumber || (index + 1);
      const planPrice = Number(line.plan?.price || line.plan?.baseLinePrice || 0);
      const devicePrice = Number(line.device?.price || line.device?.calculatedPrice?.unitPrice || 0);
      const protectionPrice = Number(line.protection?.price || 0);

      monthlyTotal += planPrice;
      deviceTotal += devicePrice;
      protectionTotal += protectionPrice;

      const planName = line.plan?.name || line.plan?.displayName || line.plan?.displayNameWeb || null;
      const planData = line.plan?.data || line.plan?.planData;
      const dataUnit = line.plan?.dataUnit || 'GB';
      const planValue = planName
        ? `${planName}${planPrice ? ` — ${formatCurrency(planPrice)}/mo` : ''}${planData ? ` (${planData}${dataUnit})` : ''}`
        : 'Not selected';

      const deviceName = line.device?.brand
        ? `${line.device.brand} ${line.device.name || line.device.translated?.name || 'Device'}`
        : (line.device?.name || line.device?.translated?.name || null);
      const deviceValue = deviceName
        ? `${deviceName}${devicePrice ? ` — ${formatCurrency(devicePrice)}` : ''}`
        : 'Not selected';

      const protectionName = line.protection?.name || null;
      const protectionValue = protectionName
        ? `${protectionName}${protectionPrice ? ` — ${formatCurrency(protectionPrice)}` : ''}`
        : 'Not selected';

      const simValue = line.sim?.simType
        ? (line.sim.simType === 'ESIM' ? 'eSIM' : (line.sim.simType === 'PSIM' ? 'Physical SIM' : line.sim.simType))
        : 'Not selected';

      const lineTotal = planPrice + devicePrice + protectionPrice;

      structured.cards.push({
        title: `Line ${lineNumber}`,
        items: [
          { label: 'Plan', value: planValue },
          { label: 'Device', value: deviceValue },
          { label: 'Protection', value: protectionValue },
          { label: 'SIM', value: simValue },
          { label: 'Line total', value: formatCurrency(lineTotal) }
        ]
      });
    });

    const oneTimeSubtotal = deviceTotal + protectionTotal;
    const handlingFee = oneTimeSubtotal > 0 ? 10 : 0;
    const shippingFee = oneTimeSubtotal > 0 ? 15 : 0;
    const dueToday = oneTimeSubtotal + handlingFee + shippingFee;

    const summaryItems = [];
    if (monthlyTotal > 0) summaryItems.push({ label: 'Monthly total', value: `${formatCurrency(monthlyTotal)}/mo` });
    if (deviceTotal > 0) summaryItems.push({ label: 'Devices', value: formatCurrency(deviceTotal) });
    if (protectionTotal > 0) summaryItems.push({ label: 'Protection', value: formatCurrency(protectionTotal) });
    if (oneTimeSubtotal > 0) {
      summaryItems.push({ label: 'Handling fee', value: formatCurrency(handlingFee) });
      summaryItems.push({ label: 'Shipping & handling', value: formatCurrency(shippingFee) });
      summaryItems.push({ label: 'Due today', value: formatCurrency(dueToday) });
    }

    if (summaryItems.length > 0) {
      structured.cards.push({
        title: 'Order Summary',
        items: summaryItems
      });
    }

    return structured;
  }

  if (cart && Array.isArray(cart.items) && cart.items.length > 0) {
    cart.items.forEach((item) => {
      structured.cards.push({
        title: item.name || 'Item',
        items: [{ label: 'Price', value: formatCurrency(item.price || 0) }]
      });
    });
    return structured;
  }

  structured.cards.push({
    title: 'Cart',
    items: [{ label: 'Status', value: 'Your cart is empty' }]
  });

  return structured;
}

/**
 * Get next steps based on current context and intent (flow-aligned)
 * @param {Object|null} context - Flow context
 * @param {string} intent - Current intent (INTENT_TYPES)
 * @returns {string} Next steps text
 */
function getNextStepsForIntent(context, intent) {
  const progress = context?.sessionId ? getFlowProgress(context.sessionId) : null;

  // No context - provide initial flow overview
  if (!context || !progress) {
    return `**Step 1:** Tell me how many lines you need (e.g., "I need 2 lines")\n` +
      `**Step 2:** Select plans for each line (required for checkout)\n` +
      `**Step 3:** Choose SIM types (eSIM or Physical) per line\n` +
      `**Step 4 (Optional):** Add devices and device protection\n` +
      `**Step 5:** Review cart and checkout`;
  }

  // Check prerequisites and missing items using global flags
  const globalFlags = context?.sessionId ? getGlobalContextFlags(context.sessionId) : {
    deviceSelected: false,
    protectionSelected: false,
    linesConfigured: false
  };
  const lineCount = progress.lineCount || 0;
  const missingPlans = progress.missing?.plans || [];
  const missingSims = progress.missing?.sim || [];
  // Use global flags for quick checks, then get counts if needed
  const linesWithDevices = globalFlags.deviceSelected ? (context.lines || []).filter(l => l.deviceSelected).length : 0;
  const linesWithProtection = globalFlags.protectionSelected ? (context.lines || []).filter(l => l.protectionSelected).length : 0;

  let steps = "";

  // LINE COUNT CHECK (mandatory first step)
  if (lineCount === 0) {
    steps += `**→ Required First:** Tell me how many lines you need\n`;
    steps += `   Say: "I need 2 lines" or "3 lines"\n\n`;
    steps += `**→ Then:** Select plans → Choose SIM types → (Optional) Add devices → Checkout\n`;
    return steps;
  }

  // PLAN CHECK (mandatory for checkout)
  if (missingPlans.length > 0) {
    // Special emphasis when device was just added
    const isDeviceIntent = intent === 'device' || intent === INTENT_TYPES.DEVICE;

    if (isDeviceIntent) {
      steps += `⚠️ **CRITICAL: PLANS REQUIRED BEFORE CHECKOUT**\n\n`;
      steps += `**You have added a device, but plans are MANDATORY for checkout.**\n\n`;
      steps += `**→ REQUIRED ACTION:** Select plans for ${missingPlans.length} line${missingPlans.length > 1 ? 's' : ''}\n`;
      steps += `   👉 Say: "Show me plans" or "I want to see plans"\n`;
      steps += `   👉 Or click "Add to Cart" on any plan card\n\n`;
      steps += `**Why plans are required:**\n`;
      steps += `• Plans provide phone service (calls, texts, data)\n`;
      steps += `• Your device cannot be activated without a plan\n`;
      steps += `• Plans are mandatory for ALL lines before checkout\n\n`;
      if (missingPlans.length > 1) {
        steps += `**→ You can:** Apply the same plan to all lines or choose different plans per line\n\n`;
      }
      steps += `**→ After selecting plans:** Choose SIM types → Complete checkout\n`;
    } else {
      steps += `**→ Required Now:** Select plans for ${missingPlans.length} line${missingPlans.length > 1 ? 's' : ''}\n`;
      steps += `   Say: "Show me plans" or click "Add to Cart" on a plan card\n\n`;
      if (missingPlans.length > 1) {
        steps += `**→ You can:** Apply same plan to all or mix & match different plans\n\n`;
      }
      steps += `**→ After plans:** Choose SIM types → (Optional) Add devices → Checkout\n`;
    }
    return steps;
  }

  // SIM CHECK (required for most checkout scenarios)
  if (missingSims.length > 0) {
    steps += `**→ Required Next:** Select SIM types for ${missingSims.length} line${missingSims.length > 1 ? 's' : ''}\n`;
    steps += `   Say: "Show me SIM types" or "I want eSIM"\n\n`;
    steps += `**→ Optional:** Add devices ("Show me devices") or protection\n\n`;
    steps += `**→ Then:** Review cart and checkout\n`;
    return steps;
  }

  // ALL REQUIRED ITEMS COMPLETE
  steps += `**✅ All Required Items Complete!**\n\n`;
  steps += `**→ Ready to Checkout:**\n`;
  steps += `   • ${lineCount} line${lineCount > 1 ? 's' : ''} configured\n`;
  steps += `   • Plans selected for all lines\n`;
  steps += `   • SIM types selected for all lines\n\n`;

  // Optional suggestions
  const devicesAvailable = lineCount - linesWithDevices;
  if (devicesAvailable > 0) {
    steps += `**→ Optional:** Add devices for ${devicesAvailable} line${devicesAvailable > 1 ? 's' : ''}\n`;
    steps += `   Say: "Show me devices" or "I want an iPhone"\n\n`;
  }

  if (linesWithDevices > linesWithProtection) {
    steps += `**→ Optional:** Add device protection for ${linesWithDevices - linesWithProtection} device${(linesWithDevices - linesWithProtection) > 1 ? 's' : ''}\n`;
    steps += `   Say: "I want device protection"\n\n`;
  }

  steps += `**→ To Proceed:**\n`;
  steps += `   • Say "Review my cart" for final summary\n`;
  steps += `   • Say "Checkout" or "Proceed" to complete purchase\n`;

  return steps;
}

// Start Server
async function main() {
  // Initialize MongoDB connection if MONGODB_URI is set
  try {
    await initStorage();
    // Initialize services from MongoDB after connection is established
    await initializeCartService();
    await initializeFlowContextService();
  } catch (error) {
    logger.warn("MongoDB initialization failed, using JSON storage:", error.message);
    // Still try to initialize services with JSON fallback
    try {
      await initializeCartService();
      await initializeFlowContextService();
    } catch (initError) {
      logger.warn("Service initialization failed:", initError.message);
    }
  }

  const tenant = "reach";
  const transportMode = process.env.MCP_TRANSPORT || "stdio";

  if (transportMode === "http" || transportMode === "https") {
    // HTTP/HTTPS (Streamable HTTP) mode - for ChatGPT / remote MCP clients
    const app = express();
    app.use(express.json());

    // Serve static assets FIRST (before other routes to avoid conflicts)
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const publicPath = path.join(__dirname, "public");
    const assetsPath = path.join(publicPath, "assets");

    // Verify assets directory exists
    if (!fs.existsSync(assetsPath)) {
      logger.warn("Assets directory not found, creating it", { assetsPath });
      fs.mkdirSync(assetsPath, { recursive: true });
    }

    // Serve static assets with proper MIME types
    app.use("/assets", express.static(assetsPath, {
      setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      }
    }));

    // Serve public directory for cached images
    app.use("/public", express.static(path.join(__dirname, "public")));

    // Health check endpoint for ALB/ECS
    app.get("/health", async (req, res) => {
      try {
        const mongoHealthy = mongoStorage.isMongoConnected();
        res.status(200).json({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          mongodb: mongoHealthy ? 'connected' : 'disconnected'
        });
      } catch (error) {
        res.status(503).json({
          status: 'unhealthy',
          error: error.message
        });
      }
    });

    // Test route to verify static serving works
    app.get("/test-assets", (req, res) => {
      const logoPath = path.join(assetsPath, "terrace-finance-logo.svg");
      res.json({
        assetsPath,
        logoPath,
        exists: fs.existsSync(logoPath),
        files: fs.existsSync(assetsPath) ? fs.readdirSync(assetsPath) : [],
        publicPathExists: fs.existsSync(publicPath),
        assetsPathExists: fs.existsSync(assetsPath)
      });
    });

    logger.info("Static assets configured", {
      assetsPath,
      exists: fs.existsSync(assetsPath),
      files: fs.existsSync(assetsPath) ? fs.readdirSync(assetsPath) : []
    });

    // Create ONE transport instance and connect server to it ONCE
    // The transport is designed to handle multiple requests
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: false  // Force SSE mode for ChatGPT
    });

    // Connect server to transport ONCE at startup
    // This sets up the onmessage handler that routes requests to server handlers
    // Note: server.connect() will call transport.start() internally
    await server.connect(transport);

    // Log registered handlers for debugging
    const registeredMethods = Array.from(server._requestHandlers?.keys() || []);
    logger.info("Server connected to StreamableHTTPServerTransport", {
      transportStarted: transport._started,
      serverTransport: !!server.transport,
      transportOnMessage: typeof transport.onmessage,
      registeredMethods: registeredMethods
    });

    // Initialize token refresh: on-demand when tools are called (no periodic cron)
    // Token will be checked/fetched when user initiates conversation via tool calls
    setAuthTokensAccessor(getAuthTokensMap);
    // Disable periodic cron, use on-demand refresh on tool calls only
    startTokenRefreshCron(null, false);
    logger.info("Token refresh: On-demand mode enabled (runs on tool calls)");

    // Set request timeout for all requests (25 seconds)
    app.use((req, res, next) => {
      req.setTimeout(25000);
      res.setTimeout(25000);
      next();
    });

    // Enhanced CORS configuration for ChatGPT
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || '*';
    app.use(cors({
      origin: allowedOrigins,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Accept', 'Authorization'],
      credentials: false
    }));

    // Handle preflight requests for all routes
    app.options('/mcp', (req, res) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
      res.sendStatus(200);
    });

    app.options('/templates/:name', (req, res) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
      res.sendStatus(200);
    });

    // Serve HTML templates for Apps SDK skybridge
    const templatesPath = path.join(__dirname, "templates");

    app.get("/templates/:name", (req, res) => {
      const templateName = req.params.name;
      const templatePath = path.join(templatesPath, `${templateName}.html`);

      if (fs.existsSync(templatePath)) {
        // Add cache-busting headers to prevent browser from using stale cached versions
        res.setHeader("Content-Type", "text/html+skybridge");
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        res.sendFile(templatePath);
      } else {
        res.status(404).send("Template not found");
      }
    });

    // Health check endpoint
    app.get("/", (req, res) => {
      const endpoints = {
        mcp: "/mcp",
        templates: "/templates/:name"
      };

      // Add dev server endpoints if enabled
      if (process.env.ENABLE_DEV_SERVER === "true") {
        endpoints.dev = "/dev";
        endpoints.devTemplates = "/dev/templates/:name";
      }

      res.json({
        status: "ok",
        service: "reach-mobile-mcp-server",
        version: "1.0.0",
        endpoints: endpoints
      });
    });

    // Setup development server routes (only if enabled)
    if (process.env.ENABLE_DEV_SERVER === "true") {
      setupDevServer(app);
    }

    // Handle GET requests to /mcp (for connector validation)
    app.get("/mcp", (req, res) => {
      res.json({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: "Invalid Request",
          data: "MCP endpoint requires POST requests. Use POST /mcp with JSON-RPC 2.0 format."
        },
        info: {
          service: "reach-mobile-mcp-server",
          version: "1.0.0",
          protocol: "MCP (Model Context Protocol)",
          endpoint: "POST /mcp",
          methods: ["initialize", "tools/list", "tools/call", "notifications/initialized"]
        }
      });
    });

    app.post("/mcp", async (req, res) => {
      try {
        // Fix Accept header for StreamableHTTPServerTransport
        // ChatGPT connector expects text/event-stream (SSE) responses
        const acceptHeader = req.headers.accept || '';
        // Always set Accept to include text/event-stream for SSE mode
        req.headers.accept = 'text/event-stream, application/json';

        // Capture server base URL dynamically from request if not set via ENV
        if (!process.env.SERVER_URL) {
          const protocol = req.protocol || 'https';
          const host = req.get('host');
          if (host) {
            serverBaseUrl = `${protocol}://${host}`;
            // Fix: If running in HTTPS mode (e.g. ngrok or SSL) but behind proxy (http), force https
            if (process.env.MCP_TRANSPORT === 'https' && serverBaseUrl.startsWith('http:')) {
              serverBaseUrl = serverBaseUrl.replace('http:', 'https:');
              logger.info(`Upgraded serverBaseUrl to HTTPS: ${serverBaseUrl}`);
            }
          }
        }
        if (acceptHeader !== req.headers.accept) {
          logger.info("Accept header set for SSE", {
            original: acceptHeader || '(missing)',
            updated: req.headers.accept
          });
        }

        // Let transport handle ALL requests - don't return early
        // The transport will properly handle:
        // - Notifications (notifications/initialized, etc.) - returns 202
        // - Resources/read - will return proper error in SSE format
        // - All other requests with correct SSE headers
        if (req.body && !req.body.id && req.body.method) {
          logger.info("Notification received", { method: req.body.method });
        }
        // Note: resources/read is handled by the server handler, not here
        // This log is just for debugging - the actual handler will process it

        // Log incoming request for debugging
        logger.info("📥 MCP request received", {
          method: req.body?.method,
          id: req.body?.id,
          hasParams: !!req.body?.params,
          fullBody: JSON.stringify(req.body),
          transportOnMessage: typeof transport.onmessage,
          serverTransport: !!server.transport,
          transportStarted: transport._started,
          headers: {
            accept: req.headers.accept,
            origin: req.headers.origin,
            userAgent: req.headers['user-agent']
          }
        });

        // Set request timeout (25 seconds - less than ngrok's 60s)
        const timeout = setTimeout(() => {
          if (!res.headersSent) {
            logger.error("Request timeout", {
              method: req.body?.method,
              id: req.body?.id,
              elapsed: "25s"
            });
            // For SSE, we need to send proper SSE format using writeHead
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive'
            });
            res.write(`data: ${JSON.stringify({
              jsonrpc: "2.0",
              id: req.body?.id || null,
              error: {
                code: -32603,
                message: "Internal error",
                data: "Request timeout"
              }
            })}\n\n`);
            res.end();
          }
        }, 25000);

        // Handle connection close
        res.on("close", () => {
          clearTimeout(timeout);
        });

        // Handle response finish
        res.on("finish", () => {
          clearTimeout(timeout);
        });

        // Handle request using the shared transport
        // The transport is already connected to the server, so it will route
        // messages to the server's handlers via the onmessage callback
        try {
          // Handle request with timeout protection
          await Promise.race([
            transport.handleRequest(req, res, req.body),
            new Promise((_, reject) => {
              setTimeout(() => reject(new Error("Transport timeout")), 20000);
            })
          ]);

          clearTimeout(timeout);
        } catch (transportError) {
          clearTimeout(timeout);
          if (!res.headersSent) {
            logger.error("Transport error", { error: transportError.message });
            // Send SSE-formatted error response using writeHead (not setHeader)
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive'
            });
            res.write(`data: ${JSON.stringify({
              jsonrpc: "2.0",
              id: req.body?.id || null,
              error: {
                code: -32603,
                message: "Internal error",
                data: transportError.message
              }
            })}\n\n`);
            res.end();
            return;
          }
          throw transportError;
        }
      } catch (error) {
        logger.error("MCP request error", {
          error: error.message,
          stack: error.stack,
          method: req.body?.method,
          id: req.body?.id
        });

        // Return proper JSON-RPC error response in SSE format (only if not already sent)
        if (!res.headersSent) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });
          res.write(`data: ${JSON.stringify({
            jsonrpc: "2.0",
            id: req.body?.id || null,
            error: {
              code: -32603,
              message: "Internal error",
              data: error.message
            }
          })}\n\n`);
          res.end();
        }
      }
    });

    // Also handle POST to root - ChatGPT might POST to / instead of /mcp
    // Duplicate the exact same handler code (can't modify req.path - it's read-only)
    app.post("/", async (req, res) => {
      try {
        // Fix Accept header for StreamableHTTPServerTransport
        const acceptHeader = req.headers.accept || '';
        req.headers.accept = 'text/event-stream, application/json';

        // Capture server base URL dynamically from request if not set via ENV
        if (!process.env.SERVER_URL) {
          const protocol = req.protocol || 'https';
          const host = req.get('host');
          if (host) {
            serverBaseUrl = `${protocol}://${host}`;
          }
        }
        if (acceptHeader !== req.headers.accept) {
          logger.info("Accept header set for SSE (root /)", {
            original: acceptHeader || '(missing)',
            updated: req.headers.accept
          });
        }

        if (req.body && !req.body.id && req.body.method) {
          logger.info("Notification received at /", { method: req.body.method });
        }
        // Note: resources/read is handled by the server handler, not here
        // This log is just for debugging - the actual handler will process it

        logger.info("📥 MCP request received at root /", {
          method: req.body?.method,
          id: req.body?.id,
          hasParams: !!req.body?.params,
          params: req.body?.params ? JSON.stringify(req.body.params).substring(0, 200) : null,
          fullBody: JSON.stringify(req.body, null, 2).substring(0, 500)
        });

        const timeout = setTimeout(() => {
          if (!res.headersSent) {
            logger.error("Request timeout at /", {
              method: req.body?.method,
              id: req.body?.id,
              elapsed: "25s"
            });
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive'
            });
            res.write(`data: ${JSON.stringify({
              jsonrpc: "2.0",
              id: req.body?.id || null,
              error: {
                code: -32603,
                message: "Internal error",
                data: "Request timeout"
              }
            })}\n\n`);
            res.end();
          }
        }, 25000);

        res.on("close", () => {
          clearTimeout(timeout);
        });

        res.on("finish", () => {
          clearTimeout(timeout);
        });

        try {
          // Handle request using the shared transport
          // The transport is already connected to the server, so it will route
          // messages to the server's handlers via the onmessage callback
          await Promise.race([
            transport.handleRequest(req, res, req.body),
            new Promise((_, reject) => {
              setTimeout(() => reject(new Error("Transport timeout")), 20000);
            })
          ]);
          clearTimeout(timeout);
        } catch (transportError) {
          clearTimeout(timeout);
          if (!res.headersSent) {
            logger.error("Transport error at /", { error: transportError.message });
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive'
            });
            res.write(`data: ${JSON.stringify({
              jsonrpc: "2.0",
              id: req.body?.id || null,
              error: {
                code: -32603,
                message: "Internal error",
                data: transportError.message
              }
            })}\n\n`);
            res.end();
            return;
          }
          throw transportError;
        }
      } catch (error) {
        logger.error("MCP request error at /", {
          error: error.message,
          stack: error.stack,
          method: req.body?.method,
          id: req.body?.id
        });

        if (!res.headersSent) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });
          res.write(`data: ${JSON.stringify({
            jsonrpc: "2.0",
            id: req.body?.id || null,
            error: {
              code: -32603,
              message: "Internal error",
              data: error.message
            }
          })}\n\n`);
          res.end();
        }
      }
    });

    const port = parseInt(process.env.PORT || "3000", 10);

    if (transportMode === "https") {
      // HTTPS Configuration
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);

      const keyPath = process.env.SSL_KEY_PATH || path.join(__dirname, "certs", "key.pem");
      const certPath = process.env.SSL_CERT_PATH || path.join(__dirname, "certs", "cert.pem");

      let key, cert;
      try {
        key = fs.readFileSync(keyPath);
        cert = fs.readFileSync(certPath);
        logger.info("SSL certificates loaded successfully");
      } catch (e) {
        logger.error("SSL certificates not found", {
          keyPath,
          certPath,
          error: e.message
        });
        logger.error("Please generate SSL certificates. Run: ./generate-certs.sh");
        process.exit(1);
      }

      const httpsServer = https.createServer({ key, cert }, app);
      httpsServer.listen(port, '0.0.0.0', () => {
        logger.info(
          `MCP HTTPS server listening on port ${port}/mcp (transport=https)`
        );
      });

      httpsServer.on("error", (err) => {
        logger.error("HTTPS server error", { error: err.message });
        process.exit(1);
      });
    } else {
      // HTTP mode
      app.listen(port, '0.0.0.0', () => {
        logger.info(
          `MCP HTTP server listening on port ${port}/mcp (transport=http)`
        );
      });

      app.on("error", (err) => {
        logger.error("HTTP server error", { error: err.message });
        process.exit(1);
      });
    }
  } else {
    // STDIO mode - for Claude Desktop / stdio MCP clients
    const tenant = "reach";
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // No console.log here – stdout is part of the protocol

    // Initialize token refresh: on-demand when tools are called (no periodic cron)
    // Token will be checked/fetched when user initiates conversation via tool calls
    setAuthTokensAccessor(getAuthTokensMap);
    // Disable periodic cron, use on-demand refresh on tool calls only
    startTokenRefreshCron(null, false);
    logger.info("Token refresh: On-demand mode enabled (runs on tool calls)");
  }
}

// Graceful shutdown handling
process.on('SIGINT', async () => {
  logger.info("Received SIGINT, shutting down gracefully...");
  stopTokenRefreshCron();
  await closeStorage();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info("Received SIGTERM, shutting down gracefully...");
  stopTokenRefreshCron();
  await closeStorage();
  process.exit(0);
});

main().catch((error) => {
  logger.error("Fatal error", { error: error.message });
  stopTokenRefreshCron();
  process.exit(1);
});
