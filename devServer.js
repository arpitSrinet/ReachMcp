#!/usr/bin/env node

/**
 * Development Server Routes
 * 
 * This file provides development routes for testing UI components locally
 * with real API data. It's isolated from the main MCP server.
 * 
 * Usage: Set ENABLE_DEV_SERVER=true to enable these routes
 */

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchDevices } from "./services/deviceService.js";
import { getPlans } from "./services/plansService.js";
import { fetchOffers, fetchServices } from "./services/productService.js";
import { getCartMultiLine, getMostRecentSession } from "./services/cartService.js";
import { getAuthToken } from "./services/authService.js";
import { logger } from "./utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templatesPath = path.join(__dirname, "templates");
const publicPath = path.join(__dirname, "public");

/**
 * Setup development routes for UI component testing
 * @param {express.Application} app - Express app instance
 */
export function setupDevServer(app) {
  logger.info("🔧 Development server routes enabled");

  // Serve static assets in dev mode too
  const assetsPath = path.join(publicPath, "assets");
  app.use("/assets", express.static(assetsPath, {
    maxAge: "1y",
    etag: true
  }));
  
  logger.info("Static assets configured", { assetsPath, exists: fs.existsSync(assetsPath) });

  // Dev server index page
  app.get("/dev", (req, res) => {
    const templates = ["devices", "plans", "cart", "offers", "services", "sim"];
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>UI Component Dev Server</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif; 
      padding: 40px; 
      background: #f5f5f5; 
      line-height: 1.6;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
    }
    h1 { 
      color: #333; 
      margin-bottom: 8px;
      font-size: 32px;
    }
    .subtitle {
      color: #666;
      margin-bottom: 24px;
      font-size: 14px;
    }
    .template-list { 
      display: grid; 
      gap: 16px; 
      margin-top: 24px; 
    }
    .template-link { 
      display: block; 
      padding: 20px; 
      background: white; 
      border-radius: 12px; 
      text-decoration: none; 
      color: #1976d2;
      border: 2px solid #e0e0e0;
      transition: all 0.2s;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    .template-link:hover { 
      border-color: #1976d2; 
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      transform: translateY(-2px);
    }
    .template-name {
      font-weight: 600;
      font-size: 16px;
      margin-bottom: 4px;
    }
    .template-desc {
      color: #666;
      font-size: 13px;
    }
    .info-box {
      margin-top: 32px;
      padding: 16px;
      background: #fff3cd;
      border: 1px solid #ffc107;
      border-radius: 8px;
      color: #856404;
      font-size: 14px;
    }
    .info-box strong {
      display: block;
      margin-bottom: 4px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎨 UI Component Dev Server</h1>
    <p class="subtitle">Test your UI components with real API data</p>
    
    <div class="template-list">
      ${templates.map(t => {
        const descriptions = {
          devices: "Browse and test device cards",
          plans: "View mobile plan options",
          cart: "Test shopping cart widget",
          offers: "Display promotional offers",
          services: "Show available services",
          sim: "SIM type selection interface"
        };
        return `
        <a href="/dev/templates/${t}" class="template-link">
          <div class="template-name">${t}.html</div>
          <div class="template-desc">${descriptions[t] || "UI component"}</div>
        </a>`;
      }).join('')}
    </div>
    
    <div class="info-box">
      <strong>ℹ️ Development Mode</strong>
      Templates will fetch real data from Reach Mobile API. Make sure your API credentials are configured.
    </div>
  </div>
</body>
</html>
    `;
    res.send(html);
  });

  // Development route to view templates with REAL API data
  app.get("/dev/templates/:name", async (req, res) => {
    const templateName = req.params.name;
    const templatePath = path.join(templatesPath, `${templateName}.html`);

    if (!fs.existsSync(templatePath)) {
      return res.status(404).send(`
        <html>
          <body style="font-family: system-ui; padding: 40px; text-align: center;">
            <h1>404 - Template Not Found</h1>
            <p>Template "${templateName}.html" does not exist.</p>
            <a href="/dev">← Back to Dev Server</a>
          </body>
        </html>
      `);
    }

    try {
      logger.info(`Loading template with API data: ${templateName}`);

      // Ensure we have auth token before making API calls
      await getAuthToken("reach");

      // Fetch real data from API based on template type
      let apiData = {};
      
      switch (templateName) {
        case "devices":
          logger.info("Fetching devices from API...");
          const devices = await fetchDevices(8, null, "reach");
          // Format devices the same way get_devices tool does
          apiData = {
            devices: devices.map(device => ({
              ...device,
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
              condition: device.properties?.find(p => p.group?.name === 'Condition')?.name || 
                         device.condition || 
                         device.customFields?.condition || 
                         null,
              financingMonthly: device.financing?.monthlyPayment || 
                               device.customFields?.financingMonthly || 
                               null,
              financingProvider: device.financing?.provider || 
                               device.customFields?.financingProvider || 
                               'TERRACE FINANCE',
            }))
          };
          logger.info(`Fetched ${apiData.devices.length} devices`);
          break;

        case "plans":
          logger.info("Fetching plans from API...");
          const plans = await getPlans(null, "reach");
          apiData = { plans: plans };
          logger.info(`Fetched ${plans.length} plans`);
          break;

        case "cart":
          logger.info("Fetching cart data...");
          // Get cart from most recent session or create empty structure
          const sessionId = getMostRecentSession();
          const cart = sessionId ? getCartMultiLine(sessionId) : null;
          apiData = cart || {
            lines: [],
            total: 0,
            sessionId: null
          };
          logger.info(`Cart loaded: ${apiData.lines?.length || 0} lines`);
          break;

        case "offers":
          logger.info("Fetching offers from API...");
          const offers = await fetchOffers(null, "reach");
          apiData = { offers: offers || [] };
          logger.info(`Fetched ${apiData.offers.length} offers`);
          break;

        case "services":
          logger.info("Fetching services from API...");
          const services = await fetchServices(null, "reach");
          apiData = { services: services || [] };
          logger.info(`Fetched ${apiData.services.length} services`);
          break;

        case "sim":
          // SIM types are static, but you could fetch from API if available
          apiData = {
            simTypes: [
              { type: "ESIM", description: "Digital SIM - Instant activation" },
              { type: "PSIM", description: "Physical SIM - Shipped to you" }
            ]
          };
          logger.info("SIM types loaded (static data)");
          break;

        default:
          apiData = {};
          logger.warn(`Unknown template type: ${templateName}`);
      }

      // Read the template
      let templateContent = fs.readFileSync(templatePath, "utf-8");

      // Inject real API data
      const dataScript = `
<script>
  // Real API data injected from server
  window.openai = window.openai || {};
  window.openai.toolOutput = ${JSON.stringify(apiData, null, 2)};
  window.openai.toolResponseMetadata = ${JSON.stringify(apiData, null, 2)};
  
  // Mock prompt functions for development
  window.openai.openPromptInput = function(message) {
    console.log('🔧 Dev Mode: openPromptInput called with:', message);
    alert('🔧 Dev Mode: Would send prompt:\\n\\n' + message);
  };
  
  window.openai.sendFollowUpMessage = function(message) {
    console.log('🔧 Dev Mode: sendFollowUpMessage called with:', message);
    alert('🔧 Dev Mode: Would send message:\\n\\n' + message);
  };
  
  console.log('✅ Real API data injected for ${templateName} template', apiData);
  console.log('📊 Data summary:', {
    template: '${templateName}',
    dataKeys: Object.keys(apiData),
    itemCount: Object.values(apiData)[0]?.length || 0
  });
</script>
      `;
      
      // Insert data script before closing </body> tag
      templateContent = templateContent.replace('</body>', `${dataScript}\n</body>`);

      res.setHeader("Content-Type", "text/html");
      res.send(templateContent);

      logger.info(`Template ${templateName} served successfully`);

    } catch (error) {
      logger.error("Error loading template with API data", {
        template: templateName,
        error: error.message,
        stack: error.stack
      });

      // Fallback: show template with error message
      let templateContent = fs.readFileSync(templatePath, "utf-8");
      const errorScript = `
<script>
  window.openai = window.openai || {};
  window.openai.toolOutput = {};
  console.error('❌ Failed to load API data:', ${JSON.stringify(error.message)});
  
  // Show error banner
  const errorBanner = document.createElement('div');
  errorBanner.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; background: #f44336; color: white; padding: 16px; text-align: center; z-index: 10000; font-family: system-ui;';
  errorBanner.innerHTML = '⚠️ Error loading ${templateName} data from API: ${error.message.replace(/'/g, "\\'")} | <a href="/dev" style="color: white; text-decoration: underline;">Back to Dev Server</a>';
  document.body.insertBefore(errorBanner, document.body.firstChild);
</script>
      `;
      templateContent = templateContent.replace('</body>', `${errorScript}\n</body>`);
      res.setHeader("Content-Type", "text/html");
      res.send(templateContent);
    }
  });

  logger.info("✅ Development server routes registered at /dev and /dev/templates/:name");
}

