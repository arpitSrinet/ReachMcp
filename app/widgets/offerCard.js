/**
 * Render offer data as Apps SDK widget
 */
export function renderOfferCard(offer) {
  const isActive = offer.expired === false;
  
  let discountText = "See details";
  if (offer.discountInDollar) {
    discountText = `$${offer.discountInDollar} off`;
  } else if (offer.planDiscount) {
    discountText = `${offer.planDiscount}% off`;
  }
  
  // Apps SDK widget format
  return {
    type: "widget",
    widget: "offerCard",
    data: {
      title: offer.name,
      subtitle: `Coupon: ${offer.coupon}`,
      discount: discountText,
      validity: offer.endDate 
        ? new Date(offer.endDate).toLocaleDateString()
        : "N/A",
      status: isActive ? "✅ Active" : "❌ Expired",
      metadata: {
        coupon: offer.coupon,
        active: isActive,
        startDate: offer.startDate,
        endDate: offer.endDate,
        maxCouponLimit: offer.maxCouponLimit,
        maxBudgetInDollar: offer.maxBudgetInDollar
      }
    },
    actions: [
      {
        type: "button",
        label: "Use Coupon",
        action: "show_coupon",
        params: {
          coupon: offer.coupon
        }
      }
    ]
  };
}

