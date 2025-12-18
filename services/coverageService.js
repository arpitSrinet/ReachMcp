import { callReachAPI } from "./apiClient.js";

export async function checkCoverage(zipCode, tenant = "reach") {
  const response = await callReachAPI("/apisvc/v0/zipCode/validate", {
    method: "POST",
    body: JSON.stringify({ zipCode }),
  }, tenant);

  if (response.status !== "SUCCESS") {
    throw new Error(`Coverage check failed: ${response.message || "Unknown error"}`);
  }

  return {
    zipCode,
    isValid: response.data.isValid,
    brandCoverage: response.data.brandCoverage,
    esimAvailable: response.data.esimAvailable,
    psimAvailable: response.data.psimAvailable,
    compatibility5G: response.data.compatibility5G || response.data.compatibility5g,
    volteCompatible: response.data.volteCompatible,
    wfcCompatible: response.data.wfcCompatible,
    ...response.data,
  };
}

