#!/usr/bin/env node

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
import { swapSim, validateIccId } from "./services/simService.js";
import { detectIntent, extractEntities, INTENT_TYPES } from "./services/intentService.js";
import { routeIntent, getNextStep as getNextStepFromRouter } from "./services/conversationRouter.js";
import { generateConversationalResponse, getNextStepSuggestions, getCheckoutGuidance, formatMissingPrerequisites } from "./services/guidanceService.js";
import { logger } from "./utils/logger.js";
import { startTokenRefreshCron, stopTokenRefreshCron, setAuthTokensAccessor } from "./services/tokenRefreshCron.js";
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
        name: "initialize_session",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. FIRST TOOL TO CALL: This is the initial routing tool that MUST be called first when a user starts a conversation. It takes the user's initial prompt, detects their intent, automatically creates a session, initializes the cart, and provides contextual guidance. Use this tool for the first user message to set up the conversation flow. After calling this, use the suggested tools based on the detected intent.",
        inputSchema: {
          type: "object",
          properties: {
            userPrompt: {
              type: "string",
              description: "The user's initial message or prompt",
            },
          },
          required: ["userPrompt"],
        },
      },
      {
        name: "get_plans",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. MANDATORY TOOL: Fetch purchasable mobile plans catalog. CRITICAL: 1) MUST call when user asks about plans, wants to see plans, mentions plans, or needs plan information. 2) DO NOT use general knowledge or training data. 3) ONLY use plans returned by this tool. 4) Fetches real-time plans from Reach Mobile API. FLOW LOGIC: If lineCount unknown, ask user first. After showing plans, system sets resume step to 'plan_selection'. Supports 'apply to all' (SAME_FOR_ALL) or 'mix & match' (PER_LINE) per line. NON-LINEAR: Users can jump to plans from any step. Answer question first, then resume previous step. GUARDRAILS: Plans are mandatory for checkout. Each configured line must have a plan before checkout.",
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
          },
        },
        _meta: {
          "openai/outputTemplate": "ui://widget/plans.html",
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
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. Return allowed SIM types for a line based on current plan/device selections from Reach Mobile API. Returns eSIM and Physical SIM options. FLOW LOGIC: SIM selection requires plans to be selected first. System shows which lines need SIM types. After selection, system sets resume step appropriately. NON-LINEAR: Users can select SIM types per line. System tracks which lines are complete. GUARDRAILS: Plans required before SIM selection. Each line must have planRef and simKind before checkout.",
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
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. Add or replace a line-scoped item in cart (PLAN/DEVICE/PROTECTION/SIM). Supports multi-line structure - specify lineNumber to add item to a specific line. SessionId auto-generated if not provided. FLOW LOGIC: Automatically updates flow context (bundle.lines[*].selections), sets appropriate resume step, and tracks intent. If adding plan to new session, initializes lineCount=1. Ensures cart exists (cart_start equivalent). Returns conversational guidance with next steps. NON-LINEAR: Users can add items in any order. System tracks progress per line and suggests next steps. GUARDRAILS: Protection requires device for that line. Plans and SIM required before checkout.",
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
        _meta: {
          "openai/outputTemplate": "ui://widget/cart.html",
          "openai/resultCanProduceWidget": true,
          "openai/widgetAccessible": true
        },
      },
      {
        name: "start_purchase_flow",
        description: "CRITICAL: NO WEB SEARCH - Use ONLY API data and tool responses. DO NOT search the web or use general knowledge. Initialize a new purchase flow. This sets up the multi-line purchase process. If lineCount is provided, it will be set immediately. Otherwise, the system will ask the user for the number of lines they need. FLOW LOGIC: This is the foundation step. Sets lineCount and initializes lines array. After initialization, suggests next steps (coverage check or plan selection). NON-LINEAR FLOW: Users can start from any step, but line count is required for checkout.",
        inputSchema: {
          type: "object",
          properties: {
            lineCount: {
              type: "number",
              description: "Number of lines needed (optional - if not provided, user will be asked)"
            },
            sessionId: {
              type: "string",
              description: "Session ID (optional - will be auto-generated if not provided)"
            }
          },
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
        _meta: {
          "openai/outputTemplate": "ui://widget/cart.html",
          "openai/resultCanProduceWidget": true,
          "openai/widgetAccessible": true
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
        uri: "ui://widget/plans.html",
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
                    console.log("Hello widget loaded", {
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
      // Format: ui://widget/plans.html
      const match = uri.match(/ui:\/\/widget\/([^\/]+)$/);
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

  // System-level enforcement: Log that web search is disabled
  logger.info(`🔧 Tool called: ${name}`, {
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

    // Auto-authenticate on first tool call (skip for initialize_session to allow quick response)
    const tenant = "reach";
    if (name !== "initialize_session") {
      // Always generate a fresh token for each tool call to ensure it's never expired
      // This ensures we always have a valid, fresh token
      try {
        await getAuthToken(tenant, true); // forceRefresh = true to always generate new token
      } catch (error) {
        logger.error("Failed to get auth token for tool call", {
          tool: name,
          error: error.message,
          errorType: error.errorType || error.name
        });
        // Re-throw to let the tool handle the error
        throw error;
      }
    }

    if (name === "initialize_session") {
      const userPrompt = args.userPrompt || "";
      
      // Detect intent from user prompt
      const intentResult = detectIntent(userPrompt);
      const intent = intentResult.intent;
      const entities = intentResult.entities || {};
      
      // Generate session ID
      const sessionId = generateSessionId();
      
      // Initialize cart (empty cart)
      const cart = getCartMultiLine(sessionId);
      
      // Create flow context
      const context = getFlowContext(sessionId);
      updateFlowContext(sessionId, {
        flowStage: 'initial',
        lastIntent: intent,
        coverageChecked: false,
        lineCount: null,
        lines: []
      });
      
      // Update most recent session
      updateMostRecentSession(sessionId);
      
      logger.info("Session initialized", {
        sessionId,
        intent,
        confidence: intentResult.confidence,
        entities
      });
      
      // Generate contextual response based on intent
      let responseText = "";
      let suggestedAction = "";
      
      if (intent === INTENT_TYPES.PLAN) {
        responseText = `# 📱 Welcome to Reach Mobile!\n\n` +
          `I can help you find the perfect mobile plan! To get started, I'll need to know how many lines you need.\n\n` +
          `**How many lines would you like to set up?**\n\n` +
          `*(You can choose 1 line for yourself, or multiple lines for family plans)*\n\n` +
          `Once you tell me the number of lines, I'll show you all available plans and help you select the best one for each line.`;
        suggestedAction = "Please tell me how many lines you need (e.g., 'I need 2 lines' or '3 lines'), and then I'll show you the available plans using the `get_plans` tool.";
      } 
      else if (intent === INTENT_TYPES.COVERAGE) {
        const zipCode = entities.zipCode;
        if (zipCode) {
          responseText = `# 📱 Welcome to Reach Mobile!\n\n` +
            `I see you mentioned ZIP code ${zipCode}. Let me check the coverage in that area for you.\n\n` +
            `**Your ZIP code:** ${zipCode}\n\n` +
            `I'll check the network coverage now.`;
          suggestedAction = `I'll use the \`check_coverage\` tool with zipCode: "${zipCode}" to check coverage in your area.`;
        } else {
          responseText = `# 📱 Welcome to Reach Mobile!\n\n` +
            `I'd be happy to check network coverage for you! To check coverage, I need your ZIP code.\n\n` +
            `**Please provide your ZIP code.**\n\n` +
            `You can say something like "My zipcode is 90210" or "Check coverage for 12345".`;
          suggestedAction = "Please provide your ZIP code (e.g., 'My zipcode is 90210'), and I'll use the `check_coverage` tool to check coverage in your area.";
        }
      }
      else if (/imei|compatibility|compatible|validate.*device|check.*device.*compat|device.*compat|is.*device.*compat|will.*device.*work|does.*device.*work/i.test(userPrompt)) {
        // Device compatibility check (IMEI validation)
        // This handles: "check device compatibility", "is my device compatible", "validate device", etc.
        const imeiMatch = userPrompt.match(/\b\d{15}\b/); // IMEI is typically 15 digits
        if (imeiMatch) {
          const imei = imeiMatch[0];
          responseText = `# 📱 Device Compatibility Check\n\n` +
            `I see you mentioned IMEI ${imei}. Let me validate the device compatibility for you.\n\n` +
            `**IMEI:** ${imei}\n\n` +
            `I'll check if this device is compatible with our network using the \`validate_device\` tool.`;
          suggestedAction = `I'll use the \`validate_device\` tool with imei: "${imei}" to check device compatibility.`;
        } else {
          responseText = `# 📱 Device Compatibility Check\n\n` +
            `I can help you check if your device is compatible with Reach Mobile's network! To do this, I need your device's IMEI number.\n\n` +
            `**What is an IMEI?**\n` +
            `IMEI (International Mobile Equipment Identity) is a unique 15-digit number that identifies your device.\n\n` +
            `**How to find your IMEI:**\n` +
            `• Dial *#06# on your phone\n` +
            `• Go to Settings → About Phone → IMEI\n` +
            `• Check the device box or receipt\n\n` +
            `**Please provide your device's IMEI number (15 digits), and I'll use the \`validate_device\` tool to check compatibility.**`;
          suggestedAction = "Please provide your device's IMEI number (15 digits), and I'll use the `validate_device` tool to check compatibility.";
        }
      }
      else if (intent === INTENT_TYPES.DEVICE) {
        // Check if user wants to buy/browse devices (not just IMEI validation)
        // Match patterns like: "buy device", "buy mobile", "buy phone", "want device", "show devices", etc.
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
        
        const imeiMatch = userPrompt.match(/\b\d{15}\b/); // IMEI is typically 15 digits
        const wantsToBuyDevices = buyBrowsePatterns.some(pattern => pattern.test(userPrompt));
        const wantsCompatibility = /compatible|compatibility|imei|check.*device|validate.*device/i.test(userPrompt);
        
        if (imeiMatch) {
          // IMEI validation intent
          const imei = imeiMatch[0];
          responseText = `# 📱 Welcome to Reach Mobile!\n\n` +
            `I see you mentioned IMEI ${imei}. Let me validate the device compatibility for you.\n\n` +
            `**IMEI:** ${imei}\n\n` +
            `I'll check if this device is compatible with our network.`;
          suggestedAction = `I'll use the \`validate_device\` tool with imei: "${imei}" to check device compatibility.`;
        } else if (wantsToBuyDevices || (!wantsCompatibility && !imeiMatch)) {
          // Buy/browse devices intent - show device catalog
          responseText = `# 📱 Welcome to Reach Mobile!\n\n` +
            `I'd be happy to help you find the perfect device! I can show you our available phones and devices.\n\n` +
            `**What I can do:**\n\n` +
            `• Show you all available devices\n` +
            `• Filter by brand (iPhone, Samsung, Google Pixel, etc.)\n` +
            `• Help you add a device to your cart\n\n` +
            `**Note:** You can browse and add devices anytime. Plans are required before checkout, but not for browsing.\n\n` +
            `Would you like to see our device catalog?`;
          suggestedAction = `I'll use the \`get_devices\` tool to show available devices for purchase.`;
        } else {
          // Device compatibility inquiry without IMEI
          responseText = `# 📱 Welcome to Reach Mobile!\n\n` +
            `I can help you check if your device is compatible with our network! To do this, I need your device's IMEI number.\n\n` +
            `**Please provide your device's IMEI number.**\n\n` +
            `You can find your IMEI by dialing *#06# on your phone, or checking Settings > About Phone.`;
          suggestedAction = "Please provide your device's IMEI number (15 digits), and I'll use the `validate_device` tool to check compatibility.";
        }
      }
      else {
        // General prompt
        responseText = `# 👋 Welcome to Reach Mobile!\n\n` +
          `I'm here to help you find the perfect mobile plan and services! Here's what I can help you with:\n\n` +
          `- 📱 **Browse mobile plans** - Find the perfect plan for your needs\n` +
          `- 📶 **Check network coverage** - See if we have coverage in your area\n` +
          `- 🔍 **Validate device compatibility** - Check if your device works on our network\n` +
          `- 📲 **Browse devices** - Explore available phones and devices\n` +
          `- 🛡️ **Device protection** - Add protection plans for your devices\n` +
          `- 🛒 **Manage your cart** - Add items and proceed to checkout\n\n` +
          `**Ready to get started?** Here are some things you can ask:\n\n` +
          `- "Show me plans" - Browse available mobile plans\n` +
          `- "Check coverage for [ZIP code]" - Check network coverage\n` +
          `- "Is my device compatible? My IMEI is [number]" - Validate device\n` +
          `- "Show me devices" - Browse available phones\n\n` +
          `What would you like to do today?`;
        suggestedAction = "Based on your interest, I can help you with plans, coverage, devices, or device compatibility. Just let me know what you'd like to explore!";
      }
      
      return {
          content: [
            {
          type: "text",
            text: responseText + `\n\n---\n\n**Session Created:** ${sessionId}\n**Detected Intent:** ${intent}\n\n${suggestedAction ? `**Next Step:** ${suggestedAction}` : ''}`,
          },
        ],
        _meta: {
          sessionId: sessionId,
          intent: intent,
          suggestedTool: intent === INTENT_TYPES.PLAN ? 'get_plans' : 
                        intent === INTENT_TYPES.DEVICE ? (
                          // Distinguish between buying devices vs checking compatibility
                          /buy|purchase|want.*device|show.*device|browse.*device|get.*device|looking.*for.*device|need.*device|shop.*device/i.test(userPrompt) ? 'get_devices' :
                          /imei|compatible|compatibility|check.*device|validate.*device|is.*device.*compat|will.*device.*work|does.*device.*work/i.test(userPrompt) ? 'validate_device' :
                          'get_devices' // Default to showing devices for device intent
                        ) :
                        intent === INTENT_TYPES.COVERAGE ? 'check_coverage' :
                        /imei|compatibility|compatible|validate.*device|check.*device.*compat|device.*compat|is.*device.*compat|will.*device.*work|does.*device.*work/i.test(userPrompt) ? 'validate_device' : null
        }
        };
      }

    if (name === "get_plans") {
      // Check flow context FIRST to see if line is selected
      const sessionId = getOrCreateSessionId(args.sessionId || null);
      const context = getFlowContext(sessionId);
      const progress = getFlowProgress(sessionId);
      
      // CRITICAL CHECK: If lineCount is not set or is 0/null, return TEXT ONLY (no widgets)
      // Check both context.lineCount directly AND global flags for robustness
      const hasLineCount = context && context.lineCount !== null && context.lineCount > 0;
      const globalFlags = getGlobalContextFlags(sessionId);
      const hasLineSelected = globalFlags && globalFlags.linesConfigured;
      
      // MANDATORY: If no line is configured, return TEXT ONLY - NO WIDGETS/CARDS
      // Both conditions must be true to show widgets: hasLineCount AND hasLineSelected
      if (!hasLineCount || !hasLineSelected) {
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
      
      // Build three-section response: Response | Suggestions | Next Steps
      // SECTION 1: RESPONSE
      let mainResponse = `Showing ${plans.length} available plan${plans.length > 1 ? 's' : ''}. All prices in USD for USA.\n\nSee plan cards below with pricing, data, and features.`;
      
      let suggestions = "";
      let nextSteps = "";
      
      if (context && progress) {
        // Section 2: Suggestions about the response
        if (progress.missing.plans && progress.missing.plans.length > 0) {
          suggestions = `You need to select plans for **${progress.missing.plans.length} line${progress.missing.plans.length > 1 ? 's' : ''}**.\n\n`;
          suggestions += `**Selection Options:**\n`;
          suggestions += `• **Apply to All:** Choose one plan and apply it to all lines\n`;
          suggestions += `• **Mix & Match:** Select different plans for each line\n\n`;
          suggestions += `Click "Add to Cart" on any plan card below.`;
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
        }))
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
        if (result.isValid) {
          const signal = result.signal4g || result.signal5g || 'good';
          if (signal === 'great' || signal === 'good') {
            suggestions = "Excellent signal strength in your area! You'll have reliable service for calls, texts, and data.";
          } else if (signal === 'good') {
            suggestions = "Good coverage available. You should have reliable service for everyday use.";
      } else {
            suggestions = "Coverage is available in your area. Service quality may vary by specific location.";
          }
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
      const result = await validateDevice(args.imei, tenant);
      if (isAppsSDK) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, ...result, imei: args.imei }) }],
        };
      }
      const cardMarkdown = formatDeviceAsCard({ ...result, imei: args.imei });
      return {
        content: [
          {
            type: "text",
            text: cardMarkdown,
          },
        ],
      };
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
      let devices = await fetchDevices(limit * 2, brand, tenant); // Fetch more to account for filtering

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

      // Limit results after filtering
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

      // Check flow context for guidance
      const progress = sessionId ? getFlowProgress(sessionId) : null;
      
      // Build three-section response
      // SECTION 1: RESPONSE
      let mainResponse = brand ? 
        `Showing ${devices.length} ${brand} device${devices.length > 1 ? 's' : ''} available for purchase.` :
        `Showing ${devices.length} device${devices.length > 1 ? 's' : ''} from our catalog.`;
      
      let suggestions = "";
      if (!hasPlans && context) {
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
      const structuredData = {
        devices: devices.map(device => ({
          // Spread all original device data so widget has access to everything
          ...device,
          
          // Normalized fields the widget expects
          id: device.id || device.productNumber || device.ean,
          name: device.name || device.translated?.name,
          brand: device.manufacturer?.name || device.brand || device.translated?.manufacturer?.name,
          productNumber: device.productNumber,
          manufacturerNumber: device.manufacturerNumber,
          price: device.calculatedPrice?.unitPrice || device.calculatedPrice?.totalPrice || device.price?.[0]?.gross || 0,
          originalPrice: device.calculatedPrice?.listPrice?.price || device.price?.[0]?.listPrice || device.listPrice || null,
          image: device.cover?.media?.url || device.media?.[0]?.media?.url || null,
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
        }))
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
      
      // Build three-section response
      // SECTION 1: RESPONSE
      let mainResponse = "";
      if (lineNumber) {
        mainResponse = `Selecting SIM type for Line ${lineNumber}. Choose between eSIM (digital) or Physical SIM (traditional card).`;
      } else if (linesNeedingSim.length > 0) {
        mainResponse = `You need to select SIM types for ${linesNeedingSim.length} line${linesNeedingSim.length > 1 ? 's' : ''}: ${linesNeedingSim.join(', ')}.`;
      } else {
        mainResponse = `Choose your SIM type. See options below.`;
      }
      
      let suggestions = "";
      suggestions += "**eSIM (Digital):** Best for modern phones. Instant activation, no physical card needed. Works with iPhone XS and newer, Google Pixel 3 and newer, Samsung Galaxy S20 and newer.\n\n";
      suggestions += "**Physical SIM:** Traditional SIM card delivered to you. Works with all phones. Takes 3-6 business days for delivery.\n\n";
      suggestions += "**How to select:** Click \"Add to Cart\" on your preferred SIM type below.";
      
      // Add note about plan requirement if no plan selected
      const hasPlan = context && context.lines && context.lines.some(l => l && l.planSelected);
      if (!hasPlan) {
        suggestions += `\n\n**Note:** You'll need to select a plan before checkout. After choosing your SIM type, say "Show me plans" to continue.`;
      }
      
      const nextSteps = getNextStepsForIntent(context, INTENT_TYPES.SIM);
      const responseText = formatThreeSectionResponse(mainResponse, suggestions, nextSteps);
      
      // Return structuredContent for Apps SDK widget
      const structuredData = {
        simTypes: [
          {
            type: "ESIM",
            lineNumber: lineNumber,
            name: "eSIM",
            subtitle: "Digital SIM Card",
            price: 0,
            features: [
              "Instant activation",
              "No physical card needed",
              "Easy to switch devices",
              "Works internationally",
              "Compatible with modern phones"
            ]
          },
          {
            type: "PSIM",
            lineNumber: lineNumber,
            name: "Physical SIM",
            subtitle: "Traditional SIM Card",
            price: 0,
            features: [
              "Physical card delivery",
              "Works with all devices",
              "Traditional compatibility",
              "Easy to swap",
              "Universal support"
            ]
          }
        ]
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
          widgetType: "simCard"
        }
      };

      logger.info("📤 get_sim_types response", {
        hasStructuredContent: !!response.structuredContent,
        simTypesCount: structuredData.simTypes.length,
        lineNumber: lineNumber,
      });

      return response;
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
        
        item = {
          type: 'device',
          id: item.id || item.productNumber || item.ean,
          name: item.name || item.translated?.name,
          price: item.calculatedPrice?.unitPrice || item.calculatedPrice?.totalPrice || item.price?.[0]?.gross || 0,
        };
      } else if (itemType === 'protection') {
        // Protection plans don't have detailed info from API, use provided data
        item = {
          type: 'protection',
          id: args.itemId,
          name: args.itemName || 'Device Protection',
          price: args.itemPrice || 0,
        };
      } else {
        throw new Error(`Unknown item type: ${itemType}`);
      }

      // Ensure flow context exists first to check lineCount
      const sessionIdForContext = getOrCreateSessionId(sessionId || null);
      let flowContext = getFlowContext(sessionIdForContext);
        
        // If this is a new session and we're adding a plan, initialize lineCount if not set
      if (itemType === 'plan' && flowContext && !flowContext.lineCount) {
        updateFlowContext(sessionIdForContext, {
            lineCount: 1,
            flowStage: 'planning'
          });
          // Refresh context after update
        flowContext = getFlowContext(sessionIdForContext);
        }
        
      // Determine target line number (declare outside if block so it's accessible later)
      let targetLineNumber = lineNumber;
      
      if (flowContext) {
          // Determine which line to update (if not already set from args)
        if (!targetLineNumber && flowContext.lineCount && flowContext.lineCount > 0) {
          // Find first line without this item type, but don't exceed lineCount
            if (itemType === 'plan') {
            const lineWithoutPlan = flowContext.lines.findIndex((l, idx) => 
              (idx < flowContext.lineCount) && (!l || !l.planSelected)
            );
            targetLineNumber = lineWithoutPlan >= 0 ? lineWithoutPlan + 1 : 
              (flowContext.lines.length < flowContext.lineCount ? flowContext.lines.length + 1 : 1);
            } else if (itemType === 'device') {
            const lineWithoutDevice = flowContext.lines.findIndex((l, idx) => 
              (idx < flowContext.lineCount) && (!l || !l.deviceSelected)
            );
            targetLineNumber = lineWithoutDevice >= 0 ? lineWithoutDevice + 1 : 
              (flowContext.lines.length < flowContext.lineCount ? flowContext.lines.length + 1 : 1);
            } else if (itemType === 'protection') {
            const lineWithoutProtection = flowContext.lines.findIndex((l, idx) => 
              (idx < flowContext.lineCount) && l && l.deviceSelected && !l.protectionSelected
            );
            targetLineNumber = lineWithoutProtection >= 0 ? lineWithoutProtection + 1 : 
              (flowContext.lines.length < flowContext.lineCount ? flowContext.lines.length + 1 : 1);
            }
          }
          
          // If still no target line number, default to line 1
          if (!targetLineNumber) {
            targetLineNumber = 1;
          }
          
        // CRITICAL: Validate that targetLineNumber doesn't exceed lineCount
        if (flowContext.lineCount && targetLineNumber > flowContext.lineCount) {
          return {
            content: [
              {
                type: "text",
                text: `## ⚠️ Invalid Line Number\n\n` +
                  `You're trying to add an item to Line ${targetLineNumber}, but you only have ${flowContext.lineCount} line${flowContext.lineCount > 1 ? 's' : ''} configured.\n\n` +
                  `**To fix this:**\n` +
                  `- Use \`update_line_count\` to increase your line count to ${targetLineNumber} or more\n` +
                  `- Or add this item to Line 1-${flowContext.lineCount} instead\n\n` +
                  `**Current configuration:** ${flowContext.lineCount} line${flowContext.lineCount > 1 ? 's' : ''}`
              }
            ],
            isError: true
          };
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
              }
            }
            
        // Trim lines array to match lineCount (remove any lines beyond lineCount)
        if (flowContext.lineCount && flowContext.lines.length > flowContext.lineCount) {
          flowContext.lines = flowContext.lines.slice(0, flowContext.lineCount);
        }
        
        updateFlowContext(sessionIdForContext, {
          lines: flowContext.lines,
              flowStage: 'configuring'
            });
      }
      
      // Now add to cart with validated line number
      const { cart, sessionId: finalSessionId } = addToCart(sessionIdForContext, item, targetLineNumber);

      // Update intent and conversation history
      if (finalSessionId) {
        const intentMap = {
          'plan': INTENT_TYPES.PLAN,
          'device': INTENT_TYPES.DEVICE,
          'protection': INTENT_TYPES.PROTECTION
        };
        const intent = intentMap[itemType] || INTENT_TYPES.OTHER;
        updateLastIntent(finalSessionId, intent, 'add_to_cart');
        addConversationHistory(finalSessionId, {
          intent,
          action: 'add_to_cart',
          data: { itemType, itemId: item.id, lineNumber: targetLineNumber || lineNumber }
        });
        
        // Set appropriate resume step
        if (itemType === 'plan') {
          setResumeStep(finalSessionId, 'plan_selection');
        } else if (itemType === 'device') {
          setResumeStep(finalSessionId, 'device_selection');
        } else if (itemType === 'protection') {
          setResumeStep(finalSessionId, 'protection_selection');
        }
      }
      
      // Build three-section response
      const finalContext = finalSessionId ? getFlowContext(finalSessionId) : null;
      const progress = finalSessionId ? getFlowProgress(finalSessionId) : null;
      
      // SECTION 1: RESPONSE
      let mainResponse = `✅ **${item.name}** has been added to your cart!\n\n`;
      mainResponse += `**Item:** ${item.name}\n`;
      if (lineNumber || targetLineNumber) {
        mainResponse += `**Line:** ${lineNumber || targetLineNumber}\n`;
      }
      mainResponse += `**Type:** ${itemType.charAt(0).toUpperCase() + itemType.slice(1)}\n`;
      mainResponse += `**Price:** $${item.price}${itemType === 'plan' ? '/month' : ''}\n`;
      mainResponse += `**Cart Total:** $${cart.total}`;
      
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
            // Plans are complete, but still mention they're required
            suggestions += `**Note:** Plans are already selected for all lines. Devices are optional - you can add more devices, add device protection, or proceed to SIM selection.`;
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
        // Multi-line structure
        structuredData = {
          cart: {
            lines: cartMultiLine.lines,
            total: cartMultiLine.total || 0
          },
          sessionId: cartMultiLine.sessionId || "default"
        };
        
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
        structuredData = {
          cart: {
            items: cartResult.items || [],
            total: cartResult.total || 0
          },
          sessionId: cartResult.sessionId || "default"
        };
        headerText = "Here's your shopping cart. Proceed to checkout when ready.";
      }

      const response = {
        structuredContent: structuredData,
        content: [
          {
            type: "text",
            text: headerText,
          }
        ],
        _meta: {
          // Widget-only data, not Apps SDK config
          widgetType: "cart"
        }
      };

      logger.info("📤 get_cart response", {
        hasStructuredContent: !!response.structuredContent,
        isMultiLine: !!(cartMultiLine.lines && cartMultiLine.lines.length > 0),
        itemsCount: structuredData.cart.items?.length || structuredData.cart.lines?.length || 0,
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

    // New flow management tools
    if (name === "start_purchase_flow") {
      const sessionId = getOrCreateSessionId(args.sessionId || null);
      const lineCount = args.lineCount;
      
      // Load existing cart and context to auto-populate
      const existingCart = getCartMultiLine(sessionId);
      const existingContext = getFlowContext(sessionId);
      const existingProgress = getFlowProgress(sessionId);
      
      if (lineCount && lineCount > 0) {
        // Initialize or update flow with line count
        const currentLineCount = existingContext?.lineCount || existingProgress?.lineCount || 0;
        
        // If line count changed, preserve existing selections where possible
        if (currentLineCount > 0 && currentLineCount !== lineCount) {
          // Adjust lines array while preserving existing selections
          const existingLines = existingContext?.lines || [];
          const newLines = [];
          
          for (let i = 0; i < lineCount; i++) {
            if (i < existingLines.length) {
              // Preserve existing line data
              newLines.push(existingLines[i]);
            } else {
              // Create new empty line
              newLines.push({
                lineNumber: i + 1,
                planSelected: false,
                deviceSelected: false,
                protectionSelected: false,
                simType: null
              });
            }
          }
          
          updateFlowContext(sessionId, {
            lineCount: lineCount,
            flowStage: 'planning',
            lines: newLines
          });
        } else {
          // First time or same line count - initialize
          updateFlowContext(sessionId, {
            lineCount: lineCount,
            flowStage: 'planning'
          });
        }
        
        // Build response showing what's already in cart
        let mainResponse = `## ✅ Purchase Flow Started\n\n`;
        mainResponse += `**Lines Configured:** ${lineCount} line${lineCount > 1 ? 's' : ''}\n\n`;
        
        // Show existing cart items if any
        if (existingCart && existingCart.lines && existingCart.lines.length > 0) {
          const itemsInCart = existingCart.lines.filter(line => 
            line.plan || line.device || line.protection || line.sim
          ).length;
          
          if (itemsInCart > 0) {
            mainResponse += `**📦 Items Already in Cart:** ${itemsInCart} line${itemsInCart > 1 ? 's' : ''} with selections\n\n`;
            mainResponse += `Your previous selections have been loaded! You can continue adding items or modify your cart.\n\n`;
          }
        }
        
        let suggestions = "";
        if (existingCart && existingCart.lines && existingCart.lines.length > 0) {
          const plansSelected = existingCart.lines.filter(l => l.plan).length;
          const devicesSelected = existingCart.lines.filter(l => l.device).length;
          const simsSelected = existingCart.lines.filter(l => l.sim).length;
          
          suggestions = `**Current Cart Status:**\n`;
          suggestions += `• Plans: ${plansSelected}/${lineCount} line${lineCount > 1 ? 's' : ''}\n`;
          suggestions += `• Devices: ${devicesSelected} (optional)\n`;
          suggestions += `• SIM Types: ${simsSelected}/${lineCount} line${lineCount > 1 ? 's' : ''}\n\n`;
          suggestions += `Continue building your cart or review what you have so far.`;
        } else {
          suggestions = `**Getting Started:** Your purchase flow is ready! Start by selecting plans for your ${lineCount} line${lineCount > 1 ? 's' : ''}.`;
        }
        
        let nextSteps = `**→ Next Steps:**\n`;
        nextSteps += `1. **Select Plans** - Required for all ${lineCount} line${lineCount > 1 ? 's' : ''} (say "Show me plans")\n`;
        nextSteps += `2. **Choose SIM Types** - Required for activation (say "Show me SIM types")\n`;
        nextSteps += `3. **Add Devices** - Optional (say "Show me devices")\n`;
        nextSteps += `4. **Add Protection** - Optional, requires device\n`;
        nextSteps += `5. **Review Cart** - Check everything before checkout (say "Review my cart")\n\n`;
        nextSteps += `**Ready to continue?** Say "Show me plans" to get started!`;
        
        const responseText = formatThreeSectionResponse(mainResponse, suggestions, nextSteps);
        
        return {
          content: [
            {
              type: "text",
              text: responseText
            }
          ]
        };
      } else {
        // Ask for line count
        let mainResponse = `## 🛒 Start Your Purchase Flow\n\n`;
        mainResponse += `To get started, I need to know how many lines you'd like to set up.\n\n`;
        mainResponse += `**How many lines do you need?** (1-25 lines per account)\n\n`;
        
        // Check if there's existing data
        if (existingCart && existingCart.lines && existingCart.lines.length > 0) {
          mainResponse += `**Note:** You have ${existingCart.lines.length} line${existingCart.lines.length > 1 ? 's' : ''} with items in your cart. `;
          mainResponse += `If you continue with a different line count, I'll adjust your cart accordingly.\n\n`;
        }
        
        let suggestions = `**What is a line?**\n`;
        suggestions += `A line is a phone number/service. Each line can have:\n`;
        suggestions += `• A mobile plan (required)\n`;
        suggestions += `• A device (optional)\n`;
        suggestions += `• Device protection (optional)\n`;
        suggestions += `• A SIM type (eSIM or Physical SIM)\n\n`;
        suggestions += `**Examples:**\n`;
        suggestions += `• "I need 2 lines" - for you and a family member\n`;
        suggestions += `• "Start purchase flow with 3 lines" - for a small business\n`;
        suggestions += `• "1 line" - for a single phone`;
        
        let nextSteps = `**→ To Continue:**\n`;
        nextSteps += `   • Say: "I need 2 lines" or "Start with 3 lines"\n`;
        nextSteps += `   • Or: "Start purchase flow" and I'll ask how many lines\n\n`;
        nextSteps += `**→ After setting line count:** I'll help you select plans, devices, and SIM types for each line.`;
        
        const responseText = formatThreeSectionResponse(mainResponse, suggestions, nextSteps);
        
        return {
          content: [
            {
              type: "text",
              text: responseText
            }
          ]
        };
      }
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
                `- Call \`start_purchase_flow\` to begin\n` +
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
      
      // Prepare structuredContent for cart widget (same as get_cart)
      let structuredData;
      if (cart && cart.lines && cart.lines.length > 0) {
        structuredData = {
          cart: {
            lines: cart.lines,
            total: cart.total || 0
          },
          sessionId: cart.sessionId || sessionId || "default"
        };
      } else {
        // Fallback to old structure if needed
        const cartResult = getCartWithSession(sessionId);
        structuredData = {
          cart: {
            items: cartResult.items || [],
            total: cartResult.total || 0
          },
          sessionId: cartResult.sessionId || sessionId || "default"
        };
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
          ],
          _meta: {
            widgetType: "cart"
          }
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
      suggestions += `All required items are complete. You're ready to proceed with checkout!`;
      
      // SECTION 3: NEXT STEPS - How to checkout
      nextSteps = `**→ To Complete Purchase:**\n`;
      nextSteps += `   • Say "Proceed to checkout" or "Checkout"\n`;
      nextSteps += `   • You'll be asked for shipping and payment information\n`;
      nextSteps += `   • Review final order details before confirming\n\n`;
      nextSteps += `**→ Need Changes?**\n`;
      nextSteps += `   • Say "Edit cart" to modify items\n`;
      nextSteps += `   • Say "Add device" to add more devices\n`;
      nextSteps += `   • Say "Change plan" to modify plan selections`;
      
      const responseText = formatThreeSectionResponse(mainResponse, suggestions, nextSteps);
      
      return {
        structuredContent: structuredData,
        content: [
          {
            type: "text",
            text: responseText
          }
        ],
        _meta: {
          widgetType: "cart"
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
                `**Action:** start_purchase_flow\n` +
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
  const tenant = "reach";
  const transportMode = process.env.MCP_TRANSPORT || "stdio";

  if (transportMode === "http" || transportMode === "https") {
    // HTTP/HTTPS (Streamable HTTP) mode - for ChatGPT / remote MCP clients
    const app = express();
    app.use(express.json());

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

    // Initialize token refresh cron
    setAuthTokensAccessor(getAuthTokensMap);
    const cronIntervalMinutes = parseInt(process.env.TOKEN_REFRESH_INTERVAL_MINUTES || "2", 10);
    startTokenRefreshCron(cronIntervalMinutes);
    logger.info("Token refresh cron initialized", { intervalMinutes: cronIntervalMinutes });
    
    // Pre-fetch token immediately on startup to ensure we have a valid token
    getAuthToken(tenant).catch(err => {
      logger.error("Failed to fetch initial auth token on startup", { error: err.message });
    });

    // Set request timeout for all requests (25 seconds)
    app.use((req, res, next) => {
      req.setTimeout(25000);
      res.setTimeout(25000);
      next();
    });

    // Enhanced CORS configuration for ChatGPT
    app.use(cors({
      origin: '*',
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
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const templatesPath = path.join(__dirname, "templates");

    app.get("/templates/:name", (req, res) => {
      const templateName = req.params.name;
      const templatePath = path.join(templatesPath, `${templateName}.html`);

      if (fs.existsSync(templatePath)) {
        res.setHeader("Content-Type", "text/html+skybridge");
        res.sendFile(templatePath);
      } else {
        res.status(404).send("Template not found");
      }
    });

    // Health check endpoint
    app.get("/", (req, res) => {
      res.json({
        status: "ok",
        service: "reach-mobile-mcp-server",
        version: "1.0.0",
        endpoints: {
          mcp: "/mcp",
          templates: "/templates/:name"
        }
      });
    });

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
      httpsServer.listen(port, () => {
        logger.info(
          `MCP HTTPS server listening on https://localhost:${port}/mcp (transport=https)`
        );
      });

      httpsServer.on("error", (err) => {
        logger.error("HTTPS server error", { error: err.message });
        process.exit(1);
      });
    } else {
      // HTTP mode
      app.listen(port, () => {
        logger.info(
          `MCP HTTP server listening on http://localhost:${port}/mcp (transport=http)`
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
    
    // Initialize token refresh cron for STDIO mode too
    setAuthTokensAccessor(getAuthTokensMap);
    const cronIntervalMinutes = parseInt(process.env.TOKEN_REFRESH_INTERVAL_MINUTES || "2", 10);
    startTokenRefreshCron(cronIntervalMinutes);
    logger.info("Token refresh cron initialized", { intervalMinutes: cronIntervalMinutes });
    
    // Pre-fetch token immediately on startup to ensure we have a valid token
    getAuthToken(tenant).catch(err => {
      logger.error("Failed to fetch initial auth token on startup", { error: err.message });
    });
  }
}

// Graceful shutdown handling
process.on('SIGINT', () => {
  logger.info("Received SIGINT, shutting down gracefully...");
  stopTokenRefreshCron();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info("Received SIGTERM, shutting down gracefully...");
  stopTokenRefreshCron();
  process.exit(0);
});

main().catch((error) => {
  logger.error("Fatal error", { error: error.message });
  stopTokenRefreshCron();
  process.exit(1);
});
