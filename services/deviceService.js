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

export async function fetchDevices(limit = 8, tenant = "reach") {
  const shopwareApiUrl = "https://shopware-api-nctc-qa.reachmobileplatform.com/store-api/product";
  
  const requestBody = {
    limit: limit,
    order: "topseller",
    filter: [
      {
        type: "multi",
        operator: "and",
        queries: [
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
        ]
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
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Shopware API Error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  return data.data || data.elements || [];
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

