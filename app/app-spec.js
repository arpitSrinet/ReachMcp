/**
 * Apps SDK Application Specification
 * Defines the app structure, widgets, and tool mappings
 */
export const appSpec = {
  name: "Reach Mobile",
  description: "Browse mobile plans, check coverage, and manage your cart",
  version: "1.0.0",
  
  // Define UI widgets
  widgets: {
    planCard: {
      type: "result_block",
      title: "Mobile Plan",
      fields: [
        { name: "name", label: "Plan Name", type: "text", display: "header" },
        { name: "price", label: "Price", type: "currency", format: "${value}/mo" },
        { name: "data", label: "Data", type: "text" },
        { name: "features", label: "Features", type: "list" }
      ],
      actions: [
        {
          label: "Select Plan",
          action: "add_to_cart",
          tool: "add_to_cart"
        }
      ]
    },
    
    offerCard: {
      type: "result_block",
      title: "Offer",
      fields: [
        { name: "name", label: "Offer Name", type: "text" },
        { name: "coupon", label: "Coupon Code", type: "code" },
        { name: "discount", label: "Discount", type: "text" }
      ]
    },
    
    cartSummary: {
      type: "result_block",
      title: "Shopping Cart",
      fields: [
        { name: "items", label: "Items", type: "list" },
        { name: "total", label: "Total", type: "currency" }
      ],
      actions: [
        {
          label: "Proceed to Checkout",
          action: "checkout"
        }
      ]
    }
  },
  
  // Map MCP tools to widgets
  toolMappings: {
    get_plans: {
      widget: "planCard",
      renderMode: "list"
    },
    get_offers: {
      widget: "offerCard",
      renderMode: "list"
    },
    get_services: {
      widget: "result_block",
      renderMode: "list"
    },
    get_cart: {
      widget: "cartSummary",
      renderMode: "single"
    },
    check_coverage: {
      widget: "result_block",
      renderMode: "single"
    },
    validate_device: {
      widget: "result_block",
      renderMode: "single"
    }
  }
};

