/**
 * Apps SDK Application
 * Main entry point for the Reach Mobile app
 */
import { callMCPServer } from './mcp-client.js';
import { renderPlanCard } from './widgets/planCard.js';
import { renderOfferCard } from './widgets/offerCard.js';
import { renderCart } from './widgets/cartWidget.js';
import { appSpec } from './app-spec.js';

// Note: This is a placeholder structure
// The actual Apps SDK implementation depends on OpenAI's SDK availability
// This structure can be adapted when the SDK is available

class ReachMobileApp {
  constructor() {
    this.spec = appSpec;
  }

  /**
   * Handle tool calls - delegate to MCP server
   */
  async handleToolCall(toolName, params = {}) {
    try {
      const result = await callMCPServer(toolName, params);
      
      // Check if result has error
      if (result.error) {
        return { error: result.error };
      }
      
      // Extract data from result
      const data = result.plans || result.offers || result.services || result.cart || result;
      
      return {
        success: result.success !== false,
        data: data
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Render results using widgets
   */
  renderResult(toolName, result) {
    const mapping = this.spec.toolMappings[toolName];
    
    if (!mapping || !result.success) {
      return result;
    }
    
    const data = result.data;
    
    if (mapping.renderMode === 'list' && Array.isArray(data)) {
      // Render each item as a widget
      return data.map(item => {
        if (toolName === 'get_plans') {
          return renderPlanCard(item);
        } else if (toolName === 'get_offers') {
          return renderOfferCard(item);
        }
        return item;
      });
    }
    
    // Single result
    if (toolName === 'get_cart') {
      return renderCart(data, result.sessionId);
    }
    
    return {
      type: "result_block",
      data: data
    };
  }

  /**
   * Process a tool call and return rendered widget
   */
  async processToolCall(toolName, params = {}) {
    const result = await this.handleToolCall(toolName, params);
    return this.renderResult(toolName, result);
  }
}

// Export singleton instance
export const app = new ReachMobileApp();

// If running as main module, start the app
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Reach Mobile App initialized');
  console.log('Available tools:', Object.keys(appSpec.toolMappings));
}

