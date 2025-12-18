/**
 * Render plan data as Apps SDK widget
 */
export function renderPlanCard(plan) {
  const features = [];
  
  if (plan.isUnlimited || plan.unlimited) {
    features.push("📞 Unlimited calls");
  }
  if (plan.data || plan.planData) {
    const data = plan.data || plan.planData;
    const unit = plan.dataUnit || "GB";
    const throttleText = plan.throttleSpeed > 0 ? " (reduced speeds thereafter)" : "";
    features.push(`📊 ${data}${unit} high-speed data${throttleText}`);
  }
  if (plan.overageAllowedData && plan.overageAllowedData > 0) {
    features.push(`📈 ${plan.overageAllowedData}${plan.overageAllowedDataUnit || 'MB'} data`);
  }
  if (plan.maxLines && plan.maxLines > 1) {
    features.push(`👥 Up to ${plan.maxLines} lines`);
  }
  if (plan.additionalLinePrice) {
    features.push(`➕ Additional lines: $${plan.additionalLinePrice}/mo`);
  }
  if (plan.allowPlanChange) {
    features.push("🔄 Plan changes allowed");
  }
  
  const price = plan.price || plan.baseLinePrice || 0;
  const discountPctg = plan.discountPctg || 0;
  let discount = null;
  if (discountPctg > 0) {
    const originalPrice = Math.round(price / (1 - discountPctg / 100));
    discount = {
      amount: Math.round(originalPrice - price),
      percentage: discountPctg,
      originalPrice: originalPrice
    };
  }
  
  // Apps SDK widget format
  return {
    type: "widget",
    widget: "planCard",
    data: {
      title: plan.displayName || plan.name,
      subtitle: `${plan.data || plan.planData}${plan.dataUnit || 'GB'}`,
      price: `$${price}/mo`,
      priceNote: "(Taxes & fees included)",
      features: features,
      planId: plan.id || plan.uniqueIdentifier,
      discount: discount,
      metadata: {
        planId: plan.id || plan.uniqueIdentifier,
        planType: plan.planType,
        serviceCode: plan.serviceCode,
        planCharging: plan.planCharging
      }
    },
    actions: [
      {
        type: "button",
        label: "🔘 Select Plan",
        action: "call_tool",
        tool: "add_to_cart",
        params: {
          itemId: plan.id || plan.uniqueIdentifier,
          itemType: "plan"
        }
      }
    ]
  };
}

