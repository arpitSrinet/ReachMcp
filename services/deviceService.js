import { callReachAPI } from "./apiClient.js";

export async function validateDevice(imei, tenant = "reach") {
  const response = await callReachAPI(`/apisvc/v0/device/imei/${imei}`, {
    method: "GET",
  }, tenant);

  if (response.status !== "SUCCESS") {
    throw new Error(`Device validation failed: ${response.message || "Unknown error"}`);
  }

  return response.data;
}

