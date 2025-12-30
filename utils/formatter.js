export function formatPlansAsCards(plans) {
  try {
    if (!plans || plans.length === 0) {
      return "## 📱 Available Mobile Plans\n\nNo plans available.";
    }

    let markdown = `## 📱 Here are a few great options for you\n\n`;
    
    plans.forEach((plan, index) => {
      const name = plan.displayName || plan.name || "Unnamed Plan";
      const price = plan.price || plan.baseLinePrice || 0;
      const data = plan.data || plan.planData || 0;
      const dataUnit = plan.dataUnit || "GB";
      const planId = plan.id || plan.uniqueIdentifier || "N/A";
      const discountPctg = plan.discountPctg || 0;
      
      // Calculate original price if there's a discount
      let originalPrice = null;
      let discountAmount = 0;
      if (discountPctg > 0) {
        originalPrice = Math.round(price / (1 - discountPctg / 100));
        discountAmount = Math.round(originalPrice - price);
      }
      
      // Card format using markdown that ChatGPT will preserve
      markdown += `### ⭐ ${name} (${data}${dataUnit}) — $${price}/mo\n\n`;
      
      // Pricing
      if (originalPrice && originalPrice > price) {
        markdown += `~~$${originalPrice}~~ **$${price}/mo**\n`;
        markdown += `*(Taxes & fees included)*\n\n`;
        markdown += `🟢 **$${discountAmount} off applied**\n\n`;
      } else {
        markdown += `**$${price}/mo**\n`;
        markdown += `*(Taxes & fees included)*\n\n`;
      }
      
      // Features - clean list format
      if (plan.isUnlimited || plan.unlimited) {
        markdown += `📞 Unlimited calls\n`;
      }
      if (data > 0) {
        const throttleText = plan.throttleSpeed > 0 ? " (reduced speeds thereafter)" : "";
        markdown += `📊 ${data}${dataUnit} high-speed data${throttleText}\n`;
      }
      if (plan.overageAllowedData && plan.overageAllowedData > 0) {
        markdown += `📈 ${plan.overageAllowedData}${plan.overageAllowedDataUnit || 'MB'} data\n`;
      }
      if (plan.maxLines && plan.maxLines > 1) {
        markdown += `👥 Up to ${plan.maxLines} lines\n`;
      }
      if (plan.additionalLinePrice) {
        markdown += `➕ Additional lines: $${plan.additionalLinePrice}/mo\n`;
      }
      if (plan.allowPlanChange) {
        markdown += `🔄 Plan changes allowed\n`;
      }
      
      markdown += `\n**🔘 Select Plan**\n\n`;
      markdown += `To add this plan:\n`;
      markdown += `itemId: \`${planId}\`\n\n`;
      
      // Broadband Facts - using markdown details
      markdown += `<details>\n<summary>📋 <strong>Broadband Facts</strong></summary>\n\n`;
      markdown += `- Plan ID: \`${planId}\`\n`;
      if (plan.planType) {
        markdown += `- Type: ${plan.planType}\n`;
      }
      if (plan.serviceCode) {
        markdown += `- Service: ${plan.serviceCode}\n`;
      }
      if (plan.planCharging) {
        markdown += `- Charging: ${plan.planCharging}\n`;
      }
      markdown += `\n</details>\n\n`;
      
      markdown += `---\n\n`;
    });

    return markdown;
  } catch (error) {
    return `## 📱 Available Mobile Plans\n\nError formatting plans. Raw data:\n\n\`\`\`json\n${JSON.stringify(plans, null, 2)}\n\`\`\``;
  }
}

export function formatOffersAsCards(offers) {
  if (!offers || offers.length === 0) {
    return "## 🎁 Available Offers & Coupons\n\nNo offers available at this time.";
  }

  let markdown = `## 🎁 Here are great offers for you\n\n`;
  
  offers.forEach((offer, index) => {
    const isActive = offer.expired === false;
    
    markdown += `### 🎁 ${offer.name}\n\n`;
    
    // Coupon code prominently displayed
    markdown += `**Coupon Code:** \`${offer.coupon}\`\n\n`;
    
    // Discount information
    markdown += `**Discount:**\n`;
    if (offer.discountInDollar) {
      markdown += `💰 **$${offer.discountInDollar} off**\n`;
    }
    if (offer.planDiscount) {
      markdown += `💰 **${offer.planDiscount}% off plans**\n`;
    }
    if (offer.secondaryDiscount) {
      markdown += `💰 **${offer.secondaryDiscount}% secondary discount**\n`;
    }
    
    // Validity period
    if (offer.startDate && offer.endDate) {
      const startDate = new Date(offer.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const endDate = new Date(offer.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      markdown += `\n📅 **Valid:** ${startDate} - ${endDate}\n`;
    }
    
    // Status badge
    markdown += `\n**Status:**\n`;
    if (isActive) {
      markdown += `🟢 ✅ Active\n`;
    } else {
      markdown += `🔴 ❌ Expired\n`;
    }
    
    // Details
    if (offer.maxCouponLimit || offer.maxBudgetInDollar) {
      markdown += `\n**Details:**\n`;
      if (offer.maxCouponLimit) {
        markdown += `• 🎫 Max uses: ${offer.maxCouponLimit}\n`;
      }
      if (offer.maxBudgetInDollar) {
        markdown += `• 💵 Max budget: $${offer.maxBudgetInDollar}\n`;
      }
    }
    
    // Action
    markdown += `\n**✅ Use This Coupon**\n`;
    markdown += `\nCode: \`${offer.coupon}\` - Apply during checkout!\n\n`;
    
    markdown += `---\n\n`;
  });

  return markdown;
}

export function formatServicesAsCards(services) {
  if (!services || services.length === 0) {
    return "## 🚚 Available Services\n\nNo services available at this time.";
  }

  let markdown = `## 🚚 Here are service options for you\n\n`;
  
  services.forEach((service, index) => {
    const serviceName = service.name || service.serviceType || service.serviceCode || "Service";
    
    markdown += `### 🚚 ${serviceName}\n\n`;
    
    markdown += `**Service Type:** ${service.type || service.serviceCode}\n\n`;
    
    // Pricing
    markdown += `**Pricing:**\n`;
    if (service.shippingAmount) {
      markdown += `💰 **Cost: $${service.shippingAmount}**\n`;
    }
    if (service.pulseCost) {
      markdown += `💰 Pulse Cost: $${service.pulseCost}\n`;
    }
    
    // Features
    const features = [];
    if (service.deliveryDays) {
      features.push(`📦 ${service.deliveryDays} business day${service.deliveryDays > 1 ? 's' : ''} delivery`);
    }
    if (service.serviceType && service.serviceType !== serviceName) {
      features.push(`📋 ${service.serviceType}`);
    }
    if (service.dataPulse) {
      features.push(`📊 Data Pulse: ${service.dataPulse}${service.dataLimit ? ` (Limit: ${service.dataLimit})` : ''}`);
    }
    
    if (features.length > 0) {
      markdown += `\n**Features:**\n`;
      features.forEach(feature => {
        markdown += `• ${feature}\n`;
      });
    }
    
    // Action
    markdown += `\n**✅ Select Service**\n`;
    markdown += `\nAvailable during checkout\n\n`;
    
    markdown += `---\n\n`;
  });

  return markdown;
}

export function formatCoverageAsCard(coverage) {
  const isValid = coverage.isValid || coverage.brandCoverage;
  const status = isValid ? "✅ Available" : "❌ Not Available";
  const statusColor = isValid ? "🟢" : "🔴";
  
  let markdown = `## 📶 Network Coverage Check\n\n`;
  
  markdown += `### ZIP Code: ${coverage.zipCode}\n\n`;
  markdown += `${statusColor} **Coverage Status:** ${status}\n\n`;
  
  const features = [];
  if (coverage.esimAvailable) {
    features.push(`📱 eSIM: ✅ Available`);
  } else if (isValid) {
    features.push(`📱 eSIM: ❌ Not Available`);
  }
  if (coverage.psimAvailable) {
    features.push(`📲 Physical SIM: ✅ Available`);
  } else if (isValid) {
    features.push(`📲 Physical SIM: ❌ Not Available`);
  }
  if (coverage.compatibility5G || coverage.compatibility5g) {
    features.push(`5G: ✅ Compatible`);
  }
  if (coverage.volteCompatible) {
    features.push(`📞 VoLTE: ✅ Compatible`);
  }
  if (coverage.wfcCompatible) {
    features.push(`📶 WiFi Calling: ✅ Compatible`);
  }
  
  if (features.length > 0) {
    markdown += `**Compatibility Features:**\n`;
    features.forEach(feature => {
      markdown += `• ${feature}\n`;
    });
  }
  
  markdown += `\n**Action:**\n`;
  if (isValid) {
    markdown += `✅ **Proceed with Plans** - Coverage is available in this area!\n`;
  } else {
    markdown += `❌ **Check Another ZIP** - Please try a different ZIP code or contact support.\n`;
  }
  
  return markdown;
}

export function formatDevicesAsCards(devices) {
  try {
    if (!devices || devices.length === 0) {
      return "## 📱 Available Devices\n\nNo devices available.";
    }

    let markdown = `## 📱 Available Devices\n\n`;
    
    devices.forEach((device, index) => {
      const name = device.name || device.translated?.name || "Unnamed Device";
      const productNumber = device.productNumber || "N/A";
      const price = device.calculatedPrice?.unitPrice || device.price?.[0]?.gross || 0;
      const stock = device.availableStock || device.stock || 0;
      const description = device.description || device.translated?.description || "";
      
      markdown += `### ${index + 1}. ${name}\n\n`;
      markdown += `**Product Number:** ${productNumber}\n`;
      markdown += `**Price:** $${price}\n`;
      markdown += `**Stock:** ${stock > 0 ? `✅ In Stock (${stock})` : "❌ Out of Stock"}\n`;
      
      if (description) {
        const shortDesc = description.substring(0, 150);
        markdown += `**Description:** ${shortDesc}${description.length > 150 ? "..." : ""}\n`;
      }
      
      // Add categories if available
      if (device.categories && device.categories.length > 0) {
        const categories = device.categories.map(cat => cat.name || cat.translated?.name).filter(Boolean);
        if (categories.length > 0) {
          markdown += `**Categories:** ${categories.join(", ")}\n`;
        }
      }
      
      markdown += `\n---\n\n`;
    });

    return markdown;
  } catch (error) {
    return `## 📱 Available Devices\n\nError formatting devices: ${error.message}`;
  }
}

export function formatProtectionPlansAsCards(protectionPlans) {
  try {
    if (!protectionPlans || (Array.isArray(protectionPlans) && protectionPlans.length === 0)) {
      return "## 🛡️ Protection Plans\n\nNo protection plans available.";
    }

    let markdown = `## 🛡️ Eligible States for Device Protection\n\n`;
    markdown += `*Note: This endpoint returns eligible states only. Detailed plan information (pricing, coverage, plan IDs) is not available from this API.*\n\n`;
    
    // Handle array of states/plans
    if (Array.isArray(protectionPlans)) {
      protectionPlans.forEach((item, index) => {
        // Try to extract meaningful information
        const state = item.state || item.name || item.code || item.abbreviation || item;
        const eligible = item.eligible !== undefined ? item.eligible : true;
        const status = eligible ? "✅ Eligible" : "❌ Not Eligible";
        
        // If item is just a string (state name/code)
        if (typeof item === 'string') {
          markdown += `**${index + 1}. ${item}** - ✅ Eligible\n`;
        } else {
          // If item is an object
          markdown += `**${index + 1}. ${state}**\n`;
          markdown += `Status: ${status}\n`;
          
          // Only show fields that actually exist
          if (item.id) {
            markdown += `ID: ${item.id}\n`;
          }
          if (item.code && item.code !== state) {
            markdown += `Code: ${item.code}\n`;
          }
          if (item.description) {
            markdown += `Description: ${item.description}\n`;
          }
          if (item.price !== undefined && item.price !== null) {
            markdown += `Price: $${item.price}\n`;
          }
          if (item.coverage) {
            markdown += `Coverage: ${item.coverage}\n`;
          }
          
          markdown += `\n`;
        }
      });
    } else if (typeof protectionPlans === 'object') {
      // If it's a single object
      markdown += `### Protection Plan Information\n\n`;
      
      if (protectionPlans.states && Array.isArray(protectionPlans.states)) {
        protectionPlans.states.forEach((state, index) => {
          if (typeof state === 'string') {
            markdown += `**${index + 1}. ${state}** - ✅ Eligible\n`;
          } else {
            markdown += `**${index + 1}. ${state.name || state.code || state}**\n`;
          }
        });
      } else {
        // Display all object properties for debugging
        Object.keys(protectionPlans).forEach(key => {
          const value = protectionPlans[key];
          if (value !== null && value !== undefined) {
            if (Array.isArray(value)) {
              markdown += `**${key}:** ${value.length} items\n`;
            } else if (typeof value === 'object') {
              markdown += `**${key}:** ${JSON.stringify(value)}\n`;
            } else {
              markdown += `**${key}:** ${value}\n`;
            }
          }
        });
      }
      
      markdown += `\n`;
    }

    markdown += `\n---\n\n`;
    markdown += `*To get detailed protection plan information (pricing, coverage, plan IDs), a different API endpoint may be required.*\n`;

    return markdown;
  } catch (error) {
    return `## 🛡️ Protection Plans\n\nError formatting protection plans: ${error.message}`;
  }
}

export function formatDeviceAsCard(device) {
  const isValid = device.isValid;
  const status = isValid ? "✅ Compatible" : "❌ Not Compatible";
  const statusColor = isValid ? "🟢" : "🔴";
  
  let markdown = `## 📱 Device Validation\n\n`;
  
  markdown += `### IMEI: ${device.imei || 'N/A'}\n\n`;
  markdown += `${statusColor} **Device Status:** ${status}\n\n`;
  
  if (device.make || device.model) {
    markdown += `**Device Information:**\n`;
    if (device.make) {
      markdown += `• 🏭 Make: ${device.make}\n`;
    }
    if (device.model) {
      markdown += `• 📱 Model: ${device.model}\n`;
    }
    markdown += `\n`;
  }
  
  const features = [];
  if (device.esimAvailable !== undefined) {
    features.push(`📱 eSIM: ${device.esimAvailable ? '✅ Available' : '❌ Not Available'}`);
  }
  if (device.wifiCalling) {
    features.push(`📶 WiFi Calling: ${device.wifiCalling}`);
  }
  if (device.volteCompatible) {
    features.push(`📞 VoLTE: ✅ Compatible`);
  }
  if (device.compatibility5G || device.compatibility5g) {
    features.push(`5G: ✅ Compatible`);
  }
  
  if (features.length > 0) {
    markdown += `**Compatibility Features:**\n`;
    features.forEach(feature => {
      markdown += `• ${feature}\n`;
    });
  }
  
  markdown += `\n**Action:**\n`;
  if (isValid) {
    markdown += `✅ **Proceed with Plans** - Your device is compatible!\n`;
  } else {
    markdown += `❌ **Contact Support** - Your device may not be fully compatible.\n`;
  }
  
  return markdown;
}

export function formatCartAsCard(cart) {
  if (!cart || !cart.items || cart.items.length === 0) {
    return "## 🛒 Shopping Cart\n\n**Your cart is empty.**\n\nAdd plans or devices to get started!";
  }

  let markdown = `## 🛒 Your Shopping Cart\n\n`;
  markdown += `You have **${cart.items.length}** item${cart.items.length > 1 ? 's' : ''} in your cart:\n\n`;
  
  cart.items.forEach((item, index) => {
    markdown += `### ${index + 1}. ${item.name}\n\n`;
    
    markdown += `**Type:** ${item.type}\n`;
    markdown += `💰 **Price:** **$${item.price}**\n`;
    markdown += `🆔 **ID:** \`${item.id}\`\n`;
    
    markdown += `\n**Actions:** 🗑️ Remove | ✏️ Edit\n\n`;
    
    markdown += `---\n\n`;
  });
  
  markdown += `### 💰 Cart Summary\n\n`;
  markdown += `**Total: $${cart.total}**\n\n`;
  markdown += `**✅ Proceed to Checkout** - Ready to complete your order!\n`;
  
  return markdown;
}
