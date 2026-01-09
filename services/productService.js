import { callReachAPI } from "./apiClient.js";
import { logger } from "../utils/logger.js";

export async function fetchProducts(tenant = "reach") {
  const response = await callReachAPI("/apisvc/v0/product/fetch", {
    method: "GET",
  }, tenant);

  // Check if response has a status field - only validate if it exists
  // Some API responses may not have a status field and are successful by default
  if (response.status !== undefined && response.status !== "SUCCESS") {
    logger.error("Products API returned non-SUCCESS status", {
      status: response.status,
      message: response.message,
      tenant
    });
    throw new Error(`Failed to fetch products: ${response.message || "Unknown error"}`);
  }

  // Response structure: { status: "SUCCESS", data: { plans: [], offers: [], services: [] } }
  // OR: { data: { plans: [], offers: [], services: [] } } (if status field is missing)
  
  // Handle different response structures
  if (response.data) {
  return response.data;
  } else if (response.plans !== undefined || response.offers !== undefined || response.services !== undefined) {
    // Response itself is the data object
    return response;
  } else {
    logger.error("Products API returned unexpected response structure", {
      hasStatus: response.status !== undefined,
      hasData: response.data !== undefined,
      hasPlans: response.plans !== undefined,
      hasOffers: response.offers !== undefined,
      hasServices: response.services !== undefined,
      responseKeys: Object.keys(response),
      tenant
    });
    throw new Error("Products API returned unexpected response structure");
  }
}

export async function fetchPlans(serviceCode = null, tenant = "reach") {
  // ALWAYS use unified endpoint: /apisvc/v0/product/fetch
  // This endpoint works correctly and doesn't have the modifiedDate issue
  // The item-wise endpoints (/apisvc/v0/product/fetch/plan) have the modifiedDate bug
  // Response structure: { status: "SUCCESS", data: { plans: [], offers: [], services: [] } }
  
  try {
    // Use unified endpoint - this is the reliable one that works
    const allProducts = await fetchProducts(tenant);
    
    if (!allProducts || !allProducts.plans || !Array.isArray(allProducts.plans)) {
      logger.warn("Unified endpoint returned invalid or empty plans data", {
        hasData: !!allProducts,
        hasPlans: !!(allProducts && allProducts.plans),
        planCount: allProducts?.plans?.length || 0,
        serviceCode,
        tenant
      });
      throw new Error("No plans found in unified endpoint response");
    }
    
    let plans = allProducts.plans;
  
  // Filter by serviceCode if provided
  if (serviceCode && plans.length > 0) {
    plans = plans.filter(plan => plan.serviceCode === serviceCode);
  }
  
    if (plans.length === 0) {
      logger.warn("No plans found after filtering", {
        totalPlans: allProducts.plans.length,
        serviceCode,
        tenant
      });
      throw new Error(`No plans found${serviceCode ? ` for service code: ${serviceCode}` : ''}`);
    }
    
    logger.info("Successfully fetched plans from unified endpoint", {
      planCount: plans.length,
      serviceCode,
      tenant
    });

  return plans;
    
  } catch (error) {
    const errorMessage = error.message || String(error);
    
    // Check if this is the modifiedDate unconversion error (shouldn't happen with unified endpoint)
    if (errorMessage.includes('modifiedDate') || errorMessage.includes('unconvert') || errorMessage.includes('ReachPlanDTO')) {
      logger.error("Unified endpoint returned modifiedDate error - this should not happen", {
        error: errorMessage,
        serviceCode,
        tenant
      });
      throw new Error(`Server error: The Reach API has a server-side bug with the modifiedDate field. The unified endpoint should work, but it's also affected. Please contact Reach support.`);
    }
    
    // If unified endpoint fails for other reasons, log and throw
    logger.error("Failed to fetch plans from unified endpoint", {
      error: errorMessage,
      serviceCode,
      tenant,
      errorType: error.errorType || error.name
    });
    
    throw new Error(`Failed to fetch plans: ${errorMessage}`);
  }
}

export async function fetchOffers(serviceCode = null, tenant = "reach") {
  // Try unified endpoint first, then fall back to item-wise endpoints
  let response;
  let offers = [];
  
  try {
    // First try unified endpoint
    const allProducts = await fetchProducts(tenant);
    if (allProducts && allProducts.offers && Array.isArray(allProducts.offers)) {
      offers = allProducts.offers;
    }
  } catch (error) {
    // If unified endpoint fails, try item-wise endpoint
    let endpoint;
    if (serviceCode) {
      endpoint = `/nbi/v0/product/fetch/offer?serviceCode=${serviceCode}`;
    } else {
      endpoint = `/nbi/v0/product/fetch/offer`;
    }
    
    try {
      response = await callReachAPI(endpoint, {
        method: "GET",
      }, tenant);
      
      if (response.status === "SUCCESS") {
        offers = response.data.offers || response.data || [];
      }
    } catch (nbiError) {
      // Final fallback to apisvc item-wise endpoint
      endpoint = serviceCode 
        ? `/apisvc/v0/product/fetch/offer?serviceCode=${serviceCode}`
        : `/apisvc/v0/product/fetch/offer`;
      
      response = await callReachAPI(endpoint, {
        method: "GET",
      }, tenant);
      
      if (response.status === "SUCCESS") {
        offers = response.data.offers || response.data || [];
      }
    }
  }
  
  // Filter by serviceCode if provided
  if (serviceCode && offers.length > 0) {
    offers = offers.filter(offer => offer.serviceCode === serviceCode);
  }
  
  if (offers.length === 0 && response && response.status !== "SUCCESS") {
    throw new Error(`Failed to fetch offers: ${response?.message || "Unknown error"}`);
  }

  return offers;
}

export async function fetchServices(serviceCode = null, tenant = "reach") {
  // Try unified endpoint first, then fall back to item-wise endpoints
  let response;
  let services = [];
  
  try {
    // First try unified endpoint
    const allProducts = await fetchProducts(tenant);
    if (allProducts && allProducts.services && Array.isArray(allProducts.services)) {
      services = allProducts.services;
    }
  } catch (error) {
    // If unified endpoint fails, try item-wise endpoint
    let endpoint;
    if (serviceCode) {
      endpoint = `/nbi/v0/product/fetch/service?serviceCode=${serviceCode}`;
    } else {
      endpoint = `/nbi/v0/product/fetch/service`;
    }
    
    try {
      response = await callReachAPI(endpoint, {
        method: "GET",
      }, tenant);
      
      if (response.status === "SUCCESS") {
        services = response.data.services || response.data || [];
      }
    } catch (nbiError) {
      // Final fallback to apisvc item-wise endpoint
      endpoint = serviceCode 
        ? `/apisvc/v0/product/fetch/service?serviceCode=${serviceCode}`
        : `/apisvc/v0/product/fetch/service`;
      
      response = await callReachAPI(endpoint, {
        method: "GET",
      }, tenant);
      
      if (response.status === "SUCCESS") {
        services = response.data.services || response.data || [];
      }
    }
  }
  
  // Filter by serviceCode if provided
  if (serviceCode && services.length > 0) {
    services = services.filter(service => service.serviceCode === serviceCode);
  }
  
  if (services.length === 0 && response && response.status !== "SUCCESS") {
    throw new Error(`Failed to fetch services: ${response?.message || "Unknown error"}`);
  }

  return services;
}

