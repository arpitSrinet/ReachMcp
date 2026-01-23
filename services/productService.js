import { callReachAPI } from "./apiClient.js";
import { getTenantConfig } from "../config/tenantConfig.js";
import { logger } from "../utils/logger.js";
import crypto from "crypto";

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
  const config = getTenantConfig(tenant);
  const endpoint = "https://api-rm-common.reachmobileplatform.com/authsvc/v0/reachplans/active";
  const txnId = crypto.randomUUID();
  const reachDate = Date.now().toString();

  const response = await callReachAPI(endpoint, {
    method: "GET",
    headers: {
      "accept": "application/json, text/plain, */*",
      "origin": "https://nu-mobile.com",
      "referer": "https://nu-mobile.com/",
      "x-partner-tenant-id": config.partnerTenantId,
      "x-reach-date": reachDate,
      "x-reach-mvne": config.reachMvne,
      "x-reach-src": config.reachSrc,
      "txnid": txnId
    }
  }, tenant);

  if (response.status !== "SUCCESS" || !Array.isArray(response.data)) {
    logger.error("Plans API returned unexpected response", {
      status: response.status,
      hasDataArray: Array.isArray(response.data),
      tenant
    });
    throw new Error(response.message || "Failed to fetch plans from reachplans/active");
  }

  let plans = response.data;
  if (serviceCode) {
    plans = plans.filter(plan => plan.serviceCode === serviceCode);
  }

  logger.info("Successfully fetched plans from reachplans/active", {
    planCount: plans.length,
    serviceCode,
    tenant
  });

  return plans;
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
