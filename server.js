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
import { addToCart, getCart, getCartWithSession } from "./services/cartService.js";
import { checkCoverage } from "./services/coverageService.js";
import { fetchOffers, fetchServices } from "./services/productService.js";
import { validateDevice } from "./services/deviceService.js";
import { getAuthToken } from "./services/authService.js";
import { logger } from "./utils/logger.js";
import {
  formatPlansAsCards,
  formatOffersAsCards,
  formatServicesAsCards,
  formatCoverageAsCard,
  formatDeviceAsCard,
  formatCartAsCard,
} from "./utils/formatter.js";
// Apps SDK Widget Renderers
import { renderPlanCard } from "./app/widgets/planCard.js";
import { renderOfferCard } from "./app/widgets/offerCard.js";
import { renderCart } from "./app/widgets/cartWidget.js";

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
    },
  };
});

// Define MCP Tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "greet",
        description: "AUTOMATIC GREETING: Show welcome message and introduce Reach Mobile services. This tool MUST be called automatically at the start of every new conversation or when the user says hello/greeting, WITHOUT asking for permission. It provides a friendly welcome and overview of available services. Do not ask the user if they want to call this - just call it proactively.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_plans",
        description: "Get available mobile plans. Filter by max price.",
        inputSchema: {
          type: "object",
          properties: {
            maxPrice: {
              type: "number",
              description: "Maximum monthly price (optional)",
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
        description: "Get available offers/coupons. Optionally filter by service code.",
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
        description: "Get available services (shipping, top-up, etc.). Optionally filter by service code.",
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
        name: "check_coverage",
        description: "Check network coverage and device compatibility by ZIP code",
        inputSchema: {
          type: "object",
          properties: {
            zipCode: {
              type: "string",
              description: "ZIP code to check coverage for",
            },
          },
          required: ["zipCode"],
        },
      },
      {
        name: "validate_device",
        description: "Validate device compatibility by IMEI number",
        inputSchema: {
          type: "object",
          properties: {
            imei: {
              type: "string",
              description: "Device IMEI number",
            },
          },
          required: ["imei"],
        },
      },
      {
        name: "add_to_cart",
        description: "Add plan or device to shopping cart. SessionId will be auto-generated if not provided.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { 
              type: "string",
              description: "Session ID (optional - will be auto-generated if not provided)"
            },
            itemType: { type: "string", enum: ["plan", "device", "protection"] },
            itemId: { type: "string" },
          },
          required: ["itemType", "itemId"],
        },
      },
      {
        name: "get_cart",
        description: "Get shopping cart contents. SessionId will be auto-generated if not provided.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { 
              type: "string",
              description: "Session ID (optional - will use default session if not provided)"
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
        name: "hello_widget",
        description: "Test widget rendering - minimal example",
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
                "openai/widgetPrefersBorder": true,
                "openai/widgetCSP": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:;",
                "openai/widgetDomain": "reachmobile.com"
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
              "openai/widgetPrefersBorder": true,
              "openai/widgetCSP": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:;",
              "openai/widgetDomain": "reachmobile.com"
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
              "openai/widgetPrefersBorder": true,
              "openai/widgetCSP": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:;",
              "openai/widgetDomain": "reachmobile.com"
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
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    logger.info(`🔧 Tool called: ${name}`, { 
      args,
      fullRequest: JSON.stringify(request.params, null, 2)
    });

    // Check if Apps SDK format is requested
    const returnFormat = args.returnFormat || request.params.returnFormat || 'markdown';
    const isAppsSDK = returnFormat === 'json' || returnFormat === 'apps-sdk';

    // Auto-authenticate on first tool call (skip for greet to show greeting immediately)
    const tenant = "reach";
    if (name !== "greet") {
      await getAuthToken(tenant);
    }

    if (name === "greet") {
      const greeting = `# 👋 Hello! Welcome to Reach Mobile!\n\n` +
        `I'm here to help you find the perfect mobile plan, check coverage, validate devices, and explore our services.\n\n` +
        `## What I can help you with:\n\n` +
        `- 📱 Browse mobile plans\n` +
        `- 📶 Check network coverage by ZIP code\n` +
        `- 🔍 Validate device compatibility\n` +
        `- 🎁 View available offers and coupons\n` +
        `- 🚚 Explore shipping and service options\n` +
        `- 🛒 Manage your shopping cart\n\n` +
        `**Ready to get started?** Ask me to show you plans, check coverage, or help you with anything else!`;
      
      return {
        content: [
          {
            type: "text",
            text: greeting,
          },
        ],
      };
    }

    if (name === "get_plans") {
      const plans = await getPlans(args.maxPrice, tenant);
      if (!plans || plans.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "## 📱 Available Mobile Plans\n\nNo plans found matching your criteria.",
            },
          ],
        };
      }
      
      // Return structuredContent for Apps SDK widget
      // The widget will read this via window.openai.toolOutput
      const structuredData = {
        plans: plans.map(plan => ({
          id: plan.id || plan.uniqueIdentifier,
          name: plan.displayName || plan.name,
          price: plan.price || plan.baseLinePrice || 0,
          data: plan.data || plan.planData || 0,
          dataUnit: plan.dataUnit || "GB",
          features: [
            ...(plan.isUnlimited || plan.unlimited ? ["📞 Unlimited calls"] : []),
            ...(plan.data || plan.planData ? [`📊 ${plan.data || plan.planData}${plan.dataUnit || 'GB'} high-speed data`] : []),
            ...(plan.maxLines && plan.maxLines > 1 ? [`👥 Up to ${plan.maxLines} lines`] : []),
            ...(plan.additionalLinePrice ? [`➕ Additional lines: $${plan.additionalLinePrice}/mo`] : []),
            ...(plan.allowPlanChange ? ["🔄 Plan changes allowed"] : []),
          ],
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
            text: "Here are the available mobile plans. Select a plan to add it to your cart.",
          }
        ],
        _meta: {
          // Widget-only data, not Apps SDK config
          widgetType: "planCard"
        }
      };
      
      logger.info("📤 get_plans response", {
        hasStructuredContent: !!response.structuredContent,
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
      const result = await checkCoverage(args.zipCode, tenant);
      if (isAppsSDK) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, ...result }) }],
        };
      }
      const cardMarkdown = formatCoverageAsCard(result);
      return {
        content: [
          {
            type: "text",
            text: cardMarkdown,
          },
        ],
      };
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

    if (name === "add_to_cart") {
      const plan = (await getPlans(null, tenant)).find((p) => p.id === args.itemId);
      if (!plan) throw new Error(`Item ${args.itemId} not found`);

      // Auto-generate sessionId if not provided
      const { cart, sessionId } = addToCart(args.sessionId || null, {
        type: args.itemType || 'plan',
        id: plan.id,
        name: plan.name,
        price: plan.price,
      });

      // Return updated cart data with sessionId prominently displayed
      return {
        content: [
          {
            type: "text",
            text: `✅ ${plan.name} plan has been added to your cart!\n\n` +
                  `🛒 Current Cart\n\n` +
                  `Item: ${plan.name} (Plan)\n` +
                  `Price: $${plan.price}/month\n` +
                  `Quantity: 1\n` +
                  `Cart Total: $${cart.total}\n\n` +
                  `🧾 System message: Item added to cart\n` +
                  `🆔 Session ID: ${sessionId}\n\n` +
                  `**Important:** Use this Session ID (${sessionId}) when calling get_cart to view your full cart.`,
          },
        ],
      };
    }

    if (name === "get_cart") {
      // Use provided sessionId or get most recent
      const sessionId = args.sessionId || null;
      
      // Use getCartWithSession to get cart with the actual sessionId used
      const cartResult = getCartWithSession(sessionId);
      
      const structuredData = {
        cart: {
          items: cartResult.items || [],
          total: cartResult.total || 0
        },
        sessionId: cartResult.sessionId || "default"
      };
      
      const response = {
        structuredContent: structuredData,
        content: [
          {
            type: "text",
            text: "Here's your shopping cart. Proceed to checkout when ready.",
          }
        ],
        _meta: {
          // Widget-only data, not Apps SDK config
          widgetType: "cart"
        }
      };
      
      logger.info("📤 get_cart response", {
        hasStructuredContent: !!response.structuredContent,
        itemsCount: structuredData.cart.items.length,
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

// Start Server
async function main() {
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
        // Force SSE mode by ensuring Accept header prioritizes text/event-stream
        // ChatGPT connector expects text/event-stream (SSE) responses
        const acceptHeader = req.headers.accept || '';
        // CRITICAL: Set Accept to ONLY text/event-stream (or prioritize it first)
        // The transport checks Accept header to decide between JSON and SSE mode
        // Even with enableJsonResponse: false, it may still check Accept header
        req.headers.accept = 'text/event-stream';
        
        if (acceptHeader !== req.headers.accept) {
          logger.info("Accept header forced to SSE-only", { 
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
        // Force SSE mode by ensuring Accept header prioritizes text/event-stream
        const acceptHeader = req.headers.accept || '';
        // CRITICAL: Set Accept to ONLY text/event-stream (or prioritize it first)
        // The transport checks Accept header to decide between JSON and SSE mode
        req.headers.accept = 'text/event-stream';
        
        if (acceptHeader !== req.headers.accept) {
          logger.info("Accept header forced to SSE-only (root /)", { 
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
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // No console.log here – stdout is part of the protocol
  }
}

main().catch((error) => {
  logger.error("Fatal error", { error: error.message });
  process.exit(1);
});
