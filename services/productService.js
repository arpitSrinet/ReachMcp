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
  // Try unified endpoint first, then fall back to item-wise endpoint
  // Unified: /apisvc/v0/product/fetch
  // Item-wise: /apisvc/v0/product/fetch/plan

  try {
    // Attempt unified endpoint - this is usually the most complete
    const allProducts = await fetchProducts(tenant);

    if (allProducts && allProducts.plans && Array.isArray(allProducts.plans) && allProducts.plans.length > 0) {
      let plans = allProducts.plans;
      if (serviceCode) {
        plans = plans.filter(plan => plan.serviceCode === serviceCode);
      }
      if (plans.length > 0) {
        logger.info("Successfully fetched plans from unified endpoint", {
          planCount: plans.length,
          serviceCode,
          tenant
        });
        return plans;
      }
    }

    throw new Error("No plans found in unified endpoint response");

  } catch (error) {
    const errorMessage = error.message || String(error);
    const statusCode = error.statusCode;

    logger.warn("Unified endpoint failed for plans, trying item-wise fallback", {
      error: errorMessage,
      statusCode,
      tenant
    });

    // FALLBACK: Try item-wise endpoint
    try {
      const endpoint = serviceCode
        ? `/apisvc/v0/product/fetch/plan?serviceCode=${serviceCode}`
        : `/apisvc/v0/product/fetch/plan`;

      const response = await callReachAPI(endpoint, {
        method: "GET",
      }, tenant);

      if (response.status === "SUCCESS" && response.data && Array.isArray(response.data.plans)) {
        logger.info("Successfully fetched plans from item-wise fallback endpoint", {
          planCount: response.data.plans.length,
          serviceCode,
          tenant
        });
        return response.data.plans;
      }

      throw new Error(response.message || "Item-wise endpoint returned empty or failed");

    } catch (fallbackError) {
      const finalErrorMessage = fallbackError.message || String(fallbackError);

      // Check for the specific modifiedDate unconversion error
      if (finalErrorMessage.includes('modifiedDate') || finalErrorMessage.includes('unconvert') || finalErrorMessage.includes('ReachPlanDTO')) {
        logger.error("Item-wise fallback also failed with modifiedDate error", {
          error: finalErrorMessage,
          tenant
        });
        throw new Error(`Server error: The Reach API has a server-side bug with the modifiedDate field. Both unified and item-wise endpoints are affected. Please contact Reach support.`);
      }

      logger.error("Final failure fetching plans after fallback", {
        originalError: errorMessage,
        fallbackError: finalErrorMessage,
        tenant
      });

      throw new Error(`Failed to fetch plans after trying fallback: ${finalErrorMessage}`);
    }
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

