import { callReachAPI } from "./apiClient.js";
import { logger } from "../utils/logger.js";

export async function validateDevice(imei, tenant = "reach") {
  const response = await callReachAPI(`/apisvc/v0/device/imei/${imei}`, {
    method: "GET",
  }, tenant);

  if (response.status !== "SUCCESS") {
    throw new Error(`Device validation failed: ${response.message || "Unknown error"}`);
  }

  return response.data;
}

export async function fetchDevices(limit = 8, brand = null, tenant = "reach") {
  const shopwareApiUrl = "https://shopware-api-nctc-qa.reachmobileplatform.com/store-api/product";
  
  // Build filter queries
  const filterQueries = [
          {
            type: "range",
            field: "stock",
            parameters: {
              gte: 1,
              lte: 1000000
            }
          },
          {
            type: "not",
            operator: "or",
            queries: [
              {
                type: "prefix",
                field: "productNumber",
                value: "DATA-"
              },
              {
                type: "prefix",
                field: "productNumber",
                value: "DEVPROTECT-"
              }
            ]
          }
  ];

  // Add brand filter if provided
  if (brand) {
    const brandLower = brand.toLowerCase();
    // Normalize common brand names
    let normalizedBrand = brandLower;
    if (brandLower.includes('iphone') || brandLower.includes('apple')) {
      normalizedBrand = 'apple';
    } else if (brandLower.includes('samsung') || brandLower.includes('galaxy')) {
      normalizedBrand = 'samsung';
    } else if (brandLower.includes('pixel') || brandLower.includes('google')) {
      normalizedBrand = 'google';
    }

    // Add brand filter - search in product name (contains)
    filterQueries.push({
      type: "contains",
      field: "name",
      value: normalizedBrand === 'apple' ? 'iPhone' : (normalizedBrand === 'samsung' ? 'Samsung' : (normalizedBrand === 'google' ? 'Pixel' : brand))
    });
  }
  
  const requestBody = {
    limit: limit,
    order: "topseller",
    filter: [
      {
        type: "multi",
        operator: "and",
        queries: filterQueries
      }
    ],
    sort: [
      {
        field: "categories.customFields.priority",
        order: "desc",
        naturalSorting: false
      }
    ],
    associations: {
      productReviews: {},
      categories: {},
      properties: {
        associations: {
          group: {}
        }
      }
    }
  };

  // Add timeout handling
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

  try {
  const response = await fetch(shopwareApiUrl, {
    method: "POST",
    headers: {
      "accept": "application/json, text/plain, */*",
      "accept-language": "en-GB,en;q=0.9",
      "content-type": "application/json",
      "origin": "https://devices-nctc-cds-qa.reachmobileplatform.com",
      "referer": "https://devices-nctc-cds-qa.reachmobileplatform.com/",
      "sw-access-key": "SWSCZVRZNDCWUJHTCHPLNUTLTQ",
      "sw-context-token": "ntNOIGq0lu2yarMNEq9QecRkgIMFkneR",
      "sw-include-seo-urls": "true",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
    },
      body: JSON.stringify(requestBody),
      signal: controller.signal
  });

    clearTimeout(timeoutId);

  if (!response.ok) {
    const errorText = await response.text();
      logger.error("Shopware API Error", {
        status: response.status,
        statusText: response.statusText,
        errorText: errorText.substring(0, 500)
      });
      throw new Error(`Shopware API Error: ${response.status} ${response.statusText} - ${errorText.substring(0, 200)}`);
  }

  const data = await response.json();
    const devices = data.data || data.elements || [];
    
    logger.info("Devices fetched successfully", {
      count: devices.length,
      limit: limit,
      brand: brand || 'all',
      hasData: !!data.data,
      hasElements: !!data.elements,
      responseKeys: Object.keys(data)
    });
    
    // If no devices found, log warning with more context
    if (devices.length === 0) {
      logger.warn("No devices returned from Shopware API", {
        limit: limit,
        brand: brand || 'all',
        responseStructure: {
          hasData: !!data.data,
          hasElements: !!data.elements,
          total: data.total,
          keys: Object.keys(data)
        }
      });
    }
    
    return devices;
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      logger.error("Devices API timeout", { timeout: 30000 });
      throw new Error("Devices API request timed out after 30 seconds. Please try again.");
    }
    
    logger.error("Devices API error", { error: error.message });
    throw error;
  }
}

export async function fetchProtectionPlans(tenant = "reach") {
  const protectionApiUrl = "https://api-nctc-qa.reachmobileplatform.com/protectionsvc/v0/device/protection/eligible/states";
  
  const response = await fetch(protectionApiUrl, {
    method: "GET",
    headers: {
      "accept": "application/json",
      "accept-language": "en-GB,en;q=0.9",
      "authorization": "fefc0fcf-5fa4-4966-9db1-fd7896c4b3e6",
      "origin": "https://devices-nctc-cds-qa.reachmobileplatform.com",
      "referer": "https://devices-nctc-cds-qa.reachmobileplatform.com/",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      "x-partner-tenant-id": "NCTC@flight-mobile",
      "x-reach-mvne": "ATT"
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Protection Plan API Error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  
  // Log the actual response structure for debugging
  logger.info("🛡️ Protection Plans API Response", {
    responseType: typeof data,
    isArray: Array.isArray(data),
    hasData: !!data.data,
    hasStates: !!(data.states && Array.isArray(data.states)),
    keys: typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : [],
    sampleData: Array.isArray(data) ? data.slice(0, 3) : (data.data ? data.data.slice(0, 3) : data),
    fullResponse: JSON.stringify(data, null, 2).substring(0, 500)
  });
  
  // The API endpoint returns eligible states for protection plans
  // This is not detailed plan information (pricing, coverage, plan IDs, etc.)
  // Return the raw data - could be array of states or object with states array
  if (data.data) {
    return data.data;
  } else if (Array.isArray(data)) {
    return data;
  } else if (data.states && Array.isArray(data.states)) {
    return data.states;
  } else {
    return [data];
  }
}

