import { fetchPlans } from "./productService.js";
import { logger } from "../utils/logger.js";

/**
 * Strip the "REACH@nu@" prefix from plan names
 * @param {string} planName - Plan name that may contain the prefix
 * @returns {string} Plan name without the prefix
 */
function stripPlanNamePrefix(planName) {
  if (!planName || typeof planName !== 'string') {
    return planName;
  }
  // Remove "REACH@nu@" prefix if present
  return planName.replace(/^REACH@nu@/i, '').trim();
}

export async function getPlans(maxPrice = null, tenant = "reach") {
  let plans;
  
  try {
    plans = await fetchPlans(null, tenant);
  } catch (error) {
    logger.error("Failed to fetch plans from API", { error: error.message });
    throw new Error(`Unable to fetch plans: ${error.message}`);
  }
  
  // Transform to match expected format
  // Ensure we handle the actual API structure correctly
  const transformedPlans = plans.map(plan => ({
    id: plan.uniqueIdentifier,
    name: stripPlanNamePrefix(plan.displayName || plan.displayNameWeb || plan.name),
    price: plan.baseLinePrice,
    data: plan.planData,
    dataUnit: plan.dataUnit || "GB",
    description: `${plan.planData}${plan.dataUnit || 'GB'} data`,
    unlimited: plan.isUnlimited,
    maxLines: plan.maxLines,
    additionalLinePrice: plan.additionalLinePrice,
    discountPctg: plan.discountPctg || 0,
    planType: plan.planType,
    serviceCode: plan.serviceCode,
    planCharging: plan.planCharging,
    allowPlanChange: plan.allowPlanChange || plan.isAllowPlanChange,
    throttleSpeed: plan.throttleSpeed,
    overageAllowedData: plan.overageAllowedData,
    overageAllowedDataUnit: plan.overageAllowedDataUnit,
    upGradableTo: Array.isArray(plan.upGradableTo) 
      ? plan.upGradableTo.map(stripPlanNamePrefix)
      : [],
    downGradableTo: Array.isArray(plan.downGradableTo)
      ? plan.downGradableTo.map(stripPlanNamePrefix)
      : [],
    // Keep all original fields for backward compatibility
    ...plan,
  }));

  if (maxPrice) {
    return transformedPlans.filter(p => p.price <= maxPrice);
  }

  return transformedPlans;
}

