import { fetchPlans } from "./productService.js";

export async function getPlans(maxPrice = null, tenant = "reach") {
  const plans = await fetchPlans(null, tenant);
  
  // Transform to match expected format
  const transformedPlans = plans.map(plan => ({
    id: plan.uniqueIdentifier,
    name: plan.displayName || plan.name,
    price: plan.baseLinePrice,
    data: plan.planData,
    dataUnit: plan.dataUnit,
    description: `${plan.planData}${plan.dataUnit} data`,
    unlimited: plan.isUnlimited,
    maxLines: plan.maxLines,
    additionalLinePrice: plan.additionalLinePrice,
    ...plan,
  }));

  if (maxPrice) {
    return transformedPlans.filter(p => p.price <= maxPrice);
  }

  return transformedPlans;
}

