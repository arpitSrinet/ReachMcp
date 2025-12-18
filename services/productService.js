import { callReachAPI } from "./apiClient.js";

export async function fetchProducts(tenant = "reach") {
  const response = await callReachAPI("/apisvc/v0/product/fetch", {
    method: "GET",
  }, tenant);

  if (response.status !== "SUCCESS") {
    throw new Error(`Failed to fetch products: ${response.message || "Unknown error"}`);
  }

  return response.data;
}

export async function fetchPlans(serviceCode = null, tenant = "reach") {
  const endpoint = serviceCode 
    ? `/apisvc/v0/product/fetch/plan?serviceCode=${serviceCode}`
    : `/apisvc/v0/product/fetch/plan`;
  
  const response = await callReachAPI(endpoint, {
    method: "GET",
  }, tenant);

  if (response.status !== "SUCCESS") {
    throw new Error(`Failed to fetch plans: ${response.message || "Unknown error"}`);
  }

  // Handle both response.data.plans (nested) and response.data (direct array)
  return response.data.plans || response.data || [];
}

export async function fetchOffers(serviceCode = null, tenant = "reach") {
  const endpoint = serviceCode 
    ? `/apisvc/v0/product/fetch/offer?serviceCode=${serviceCode}`
    : `/apisvc/v0/product/fetch/offer`;
  
  const response = await callReachAPI(endpoint, {
    method: "GET",
  }, tenant);

  if (response.status !== "SUCCESS") {
    throw new Error(`Failed to fetch offers: ${response.message || "Unknown error"}`);
  }

  // Handle both response.data.offers (nested) and response.data (direct array)
  return response.data.offers || response.data || [];
}

export async function fetchServices(serviceCode = null, tenant = "reach") {
  const endpoint = serviceCode 
    ? `/apisvc/v0/product/fetch/service?serviceCode=${serviceCode}`
    : `/apisvc/v0/product/fetch/service`;
  
  const response = await callReachAPI(endpoint, {
    method: "GET",
  }, tenant);

  if (response.status !== "SUCCESS") {
    throw new Error(`Failed to fetch services: ${response.message || "Unknown error"}`);
  }

  // Handle both response.data.services (nested) and response.data (direct array)
  return response.data.services || response.data || [];
}

