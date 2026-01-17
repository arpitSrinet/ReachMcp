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
      if (plan.allowPlanChange || plan.isAllowPlanChange) {
        markdown += `🔄 Plan changes allowed\n`;
      }
      
      // Show upgrade/downgrade options if available
      if (plan.upGradableTo && plan.upGradableTo.length > 0) {
        markdown += `⬆️ Upgradeable to: ${plan.upGradableTo.join(', ')}\n`;
      }
      if (plan.downGradableTo && plan.downGradableTo.length > 0) {
        markdown += `⬇️ Downgradeable to: ${plan.downGradableTo.join(', ')}\n`;
      }
      
      markdown += `\n**🔘 Select Plan**\n\n`;
      markdown += `To add this plan:\n`;
      markdown += `itemId: \`${planId}\`\n\n`;
      
      // Broadband Facts - using markdown details
      markdown += `<details>\n<summary>📋 <strong>Broadband Facts</strong></summary>\n\n`;
      markdown += `- Plan ID: \`${planId}\`\n`;
      if (plan.uniqueIdentifier && plan.uniqueIdentifier !== planId) {
        markdown += `- Unique Identifier: \`${plan.uniqueIdentifier}\`\n`;
      }
      if (plan.planType) {
        markdown += `- Type: ${plan.planType}\n`;
      }
      if (plan.serviceCode) {
        markdown += `- Service: ${plan.serviceCode}\n`;
      }
      if (plan.planCharging) {
        markdown += `- Charging: ${plan.planCharging}\n`;
      }
      if (plan.throttleSpeed && plan.throttleSpeed > 0) {
        markdown += `- Throttle Speed: ${plan.throttleSpeed} ${plan.throttleSpeedUnit || 'Kbps'}\n`;
      }
      if (plan.addThrottle) {
        markdown += `- Throttling: Enabled after data limit\n`;
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
  // Handle null/undefined for isValid - null means unknown, not false
  const isValid = coverage.isValid === true 
    ? true 
    : (coverage.isValid === false ? false : (coverage.brandCoverage === true ? true : null));
  
  let status, statusColor;
  if (isValid === true) {
    status = "✅ Available";
    statusColor = "🟢";
  } else if (isValid === false) {
    status = "❌ Not Available";
    statusColor = "🔴";
  } else {
    status = "⚠️ Coverage information unavailable";
    statusColor = "🟡";
  }
  
  let markdown = `## 📶 Network Coverage Details\n\n`;
  
  // ZIP Code & headline
  markdown += `### 📍 Location\n\n`;
  markdown += `**ZIP Code:** ${coverage.zipCode || 'N/A'}\n\n`;
  if (coverage.msg) {
    markdown += `**Signal Summary:** ${coverage.msg}\n\n`;
  }
  markdown += `${statusColor} **Coverage Status:** ${status}\n\n`;
  
  // Brand Coverage
  if (coverage.brandCoverage !== undefined) {
    markdown += `**Brand Coverage:** ${coverage.brandCoverage ? '✅ Available' : '❌ Not Available'}\n\n`;
  }
  
  // SIM Availability
  markdown += `### 📲 SIM Card Availability\n\n`;
  if (coverage.esimAvailable !== undefined) {
    markdown += `**eSIM:** ${coverage.esimAvailable ? '✅ Available' : '❌ Not Available'}\n`;
  } else {
    markdown += `**eSIM:** ⚠️ Information not available\n`;
  }
  
  if (coverage.psimAvailable !== undefined) {
    markdown += `**Physical SIM (PSIM):** ${coverage.psimAvailable ? '✅ Available' : '❌ Not Available'}\n`;
  } else {
    markdown += `**Physical SIM (PSIM):** ⚠️ Information not available\n`;
  }
  markdown += `\n`;
  
  // Network Compatibility
  markdown += `### 📡 Network Compatibility\n\n`;
  
  // 4G / LTE
  if (coverage.signal4g) {
    markdown += `**4G Signal:** ${coverage.signal4g}\n`;
  }
  if (coverage.compatibility4G !== undefined || coverage.compatibility4g !== undefined || coverage.lteCompatible !== undefined) {
    const has4G = coverage.compatibility4G || coverage.compatibility4g || coverage.lteCompatible;
    markdown += `**4G/LTE Network:** ${has4G ? '✅ Compatible' : '❌ Not Compatible'}\n`;
  } else {
    markdown += `**4G/LTE Network:** ⚠️ Information not available\n`;
  }
  
  // 5G
  if (coverage.signal5g) {
    markdown += `**5G Signal:** ${coverage.signal5g}\n`;
  }
  if (coverage.compatibility5G !== undefined || coverage.compatibility5g !== undefined) {
    const has5G = coverage.compatibility5G || coverage.compatibility5g;
    markdown += `**5G Network:** ${has5G ? '✅ Compatible' : '❌ Not Compatible'}\n`;
  } else {
    markdown += `**5G Network:** ⚠️ Information not available\n`;
  }
  
  if (coverage.volteCompatible !== undefined) {
    markdown += `**VoLTE (Voice over LTE):** ${coverage.volteCompatible ? '✅ Compatible' : '❌ Not Compatible'}\n`;
  } else {
    markdown += `**VoLTE (Voice over LTE):** ⚠️ Information not available\n`;
  }
  
  if (coverage.wfcCompatible !== undefined) {
    markdown += `**WiFi Calling (WFC):** ${coverage.wfcCompatible ? '✅ Compatible' : '❌ Not Compatible'}\n`;
  } else {
    markdown += `**WiFi Calling (WFC):** ⚠️ Information not available\n`;
  }
  
  // WiFi Calling details
  if (coverage.wifiCalling !== undefined && coverage.wifiCalling !== null && coverage.wifiCalling !== 'NA') {
    markdown += `**WiFi Calling Mode:** ${coverage.wifiCalling}\n`;
  }
  
  // HD Voice
  if (coverage.hdVoice !== undefined && coverage.hdVoice !== null && coverage.hdVoice !== 'NA') {
    markdown += `**HD Voice:** ${coverage.hdVoice}\n`;
  }
  
  // CDMA Less
  if (coverage.cdmaLess !== undefined && coverage.cdmaLess !== null && coverage.cdmaLess !== 'NA') {
    markdown += `**CDMA Less:** ${coverage.cdmaLess}\n`;
  }
  
  // Mode
  if (coverage.mode !== undefined && coverage.mode !== null && coverage.mode !== 'NA') {
    markdown += `**Network Mode:** ${coverage.mode}\n`;
  }
  
  markdown += `\n`;
  
  // Device Status & Validation
  markdown += `### 🔍 Device Status & Validation\n\n`;
  
  if (coverage.isValid !== undefined) {
    markdown += `**Validation Status:** ${coverage.isValid ? '✅ Valid' : '❌ Invalid'}\n`;
  }
  
  if (coverage.errorText && coverage.errorText !== 'NA' && coverage.errorText.trim() !== '') {
    markdown += `**Error/Message:** ${coverage.errorText}\n`;
  }
  
  if (coverage.isLocked !== undefined && coverage.isLocked !== null && coverage.isLocked !== 'NA') {
    markdown += `**Device Lock Status:** ${coverage.isLocked}\n`;
  }
  
  if (coverage.lostOrStolen !== undefined && coverage.lostOrStolen !== null && coverage.lostOrStolen !== 'NA') {
    markdown += `**Lost/Stolen Status:** ${coverage.lostOrStolen}\n`;
  }
  
  if (coverage.inProgress !== undefined) {
    markdown += `**In Progress:** ${coverage.inProgress ? 'Yes' : 'No'}\n`;
  }
  
  if (coverage.filteredDevice !== undefined && coverage.filteredDevice !== null && coverage.filteredDevice !== 'NA') {
    markdown += `**Filtered Device:** ${coverage.filteredDevice}\n`;
  }
  
  if (coverage.compatibleFuture !== undefined) {
    markdown += `**Future Compatibility:** ${coverage.compatibleFuture ? '✅ Yes' : '❌ No'}\n`;
  }
  
  if (coverage.preLoadedValid !== undefined) {
    markdown += `**Pre-loaded Valid:** ${coverage.preLoadedValid ? '✅ Yes' : '❌ No'}\n`;
  }
  
  markdown += `\n`;
  
  // Additional Services & Features
  markdown += `### 🛠️ Additional Services & Features\n\n`;
  
  if (coverage.tradeInEnable !== undefined) {
    markdown += `**Trade-In Enabled:** ${coverage.tradeInEnable ? '✅ Yes' : '❌ No'}\n`;
  }
  
  if (coverage.fiberValid !== undefined) {
    markdown += `**Fiber Service Valid:** ${coverage.fiberValid ? '✅ Yes' : '❌ No'}\n`;
  }
  
  if (coverage.refNumbers && Array.isArray(coverage.refNumbers) && coverage.refNumbers.length > 0) {
    markdown += `**Reference Numbers:** ${coverage.refNumbers.join(', ')}\n`;
  }
  
  markdown += `\n`;
  
  // Additional Details (if any other fields exist that weren't displayed)
  const additionalFields = {};
  const knownFields = ['zipCode', 'isValid', 'brandCoverage', 'esimAvailable', 'psimAvailable', 
                       'compatibility4G', 'compatibility4g', 'lteCompatible', 'compatibility5G', 'compatibility5g', 
                       'volteCompatible', 'wfcCompatible', 'msg', 'signal4g', 'signal5g',
                       'errorText', 'mode', 'wifiCalling', 'cdmaLess', 'hdVoice', 'lostOrStolen',
                       'inProgress', 'isLocked', 'filteredDevice', 'compatibleFuture', 'refNumbers',
                       'preLoadedValid', 'tradeInEnable', 'fiberValid'];
  
  Object.keys(coverage).forEach(key => {
    if (!knownFields.includes(key) && coverage[key] !== null && coverage[key] !== undefined) {
      // Skip if value is 'NA' or empty string
      if (coverage[key] !== 'NA' && coverage[key] !== '') {
      additionalFields[key] = coverage[key];
      }
    }
  });
  
  if (Object.keys(additionalFields).length > 0) {
    markdown += `### 📋 Additional Technical Details\n\n`;
    Object.entries(additionalFields).forEach(([key, value]) => {
      if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value) && value.length > 0) {
          markdown += `**${key}:** ${value.join(', ')}\n`;
        } else {
        markdown += `**${key}:** \`${JSON.stringify(value)}\`\n`;
        }
      } else {
        markdown += `**${key}:** ${value}\n`;
      }
    });
    markdown += `\n`;
  }
  
  // Summary and Action
  markdown += `### 📊 Summary\n\n`;
  if (isValid === true) {
    markdown += `✅ **Coverage is available** in ZIP code ${coverage.zipCode}\n\n`;
    markdown += `**Next Steps:**\n`;
    markdown += `• You can proceed to select a mobile plan\n`;
    markdown += `• Choose between eSIM or Physical SIM (if both available)\n`;
    if (coverage.compatibility4G || coverage.compatibility4g || coverage.lteCompatible) {
      markdown += `• 4G/LTE network is available for reliable data connectivity\n`;
    }
    if (coverage.compatibility5G || coverage.compatibility5g) {
      markdown += `• 5G network is available for high-speed data\n`;
    }
  } else if (isValid === false) {
    markdown += `❌ **Coverage may be limited** in ZIP code ${coverage.zipCode}\n\n`;
    markdown += `**Recommendation:**\n`;
    markdown += `• Contact support to verify coverage in your area\n`;
    markdown += `• Consider checking a nearby ZIP code\n`;
  } else {
    // isValid is null (unknown)
    markdown += `⚠️ **Coverage information is not available** for ZIP code ${coverage.zipCode}\n\n`;
    markdown += `**This could mean:**\n`;
    markdown += `• Coverage data for this area is not in our database\n`;
    markdown += `• The API did not return coverage information\n\n`;
    markdown += `**What you can do:**\n`;
    markdown += `• Try a nearby ZIP code to check coverage\n`;
    markdown += `• Contact support for coverage verification\n`;
    markdown += `• Proceed with plan selection - coverage may still be available\n`;
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

/**
 * Format flow status for display
 * @param {Object} progress - Flow progress object from getFlowProgress
 * @param {Object} context - Flow context object
 * @returns {string} Formatted markdown
 */
export function formatFlowStatus(progress, context) {
  if (!progress || !context) {
    return "## 📊 Purchase Flow Status\n\nNo active purchase flow. Start by selecting a plan or checking coverage!";
  }

  let markdown = `## 📊 Purchase Flow Status\n\n`;
  
  // Progress bar
  markdown += `**Progress: ${progress.progress}%**\n\n`;
  markdown += `[${'█'.repeat(Math.floor(progress.progress / 5))}${'░'.repeat(20 - Math.floor(progress.progress / 5))}]\n\n`;
  
  // Line count
  if (progress.lineCount > 0) {
    markdown += `**Lines:** ${progress.lineCount} line${progress.lineCount > 1 ? 's' : ''}\n`;
    markdown += `**Completed:** ${progress.completedLines} of ${progress.lineCount} lines have plans\n\n`;
  } else {
    markdown += `**Status:** Flow not started - Please specify number of lines\n\n`;
  }
  
  // Missing items
  if (progress.missing) {
    const missing = progress.missing;
    let hasMissing = false;
    
    if (missing.plans && missing.plans.length > 0) {
      hasMissing = true;
      markdown += `### ⚠️ Missing Plans\n\n`;
      markdown += `Lines ${missing.plans.join(', ')} need plan selection\n\n`;
    }
    
    if (missing.devices && missing.devices.length > 0) {
      hasMissing = true;
      markdown += `### 📱 Missing Devices\n\n`;
      markdown += `Lines ${missing.devices.join(', ')} need device selection\n\n`;
    }
    
    if (missing.protection && missing.protection.length > 0) {
      hasMissing = true;
      markdown += `### 🛡️ Missing Protection\n\n`;
      markdown += `Lines ${missing.protection.join(', ')} have devices but no protection\n\n`;
    }
    
    if (missing.sim && missing.sim.length > 0) {
      hasMissing = true;
      markdown += `### 📲 Missing SIM Type\n\n`;
      markdown += `Lines ${missing.sim.join(', ')} need SIM type selection\n\n`;
    }
    
    if (!hasMissing && progress.lineCount > 0) {
      markdown += `### ✅ All Complete!\n\n`;
      markdown += `All lines are fully configured. Ready for checkout!\n\n`;
    }
  }
  
  // Next steps
  markdown += `### 🎯 Next Steps\n\n`;
  if (!progress.lineCount || progress.lineCount === 0) {
    markdown += `1. Specify number of lines\n`;
  } else if (progress.missing.plans && progress.missing.plans.length > 0) {
    markdown += `1. Select plans for lines ${progress.missing.plans.join(', ')}\n`;
  } else if (progress.missing.devices && progress.missing.devices.length > 0) {
    markdown += `1. Add devices for lines ${progress.missing.devices.join(', ')} (optional)\n`;
  } else if (progress.missing.protection && progress.missing.protection.length > 0) {
    markdown += `1. Add protection for lines ${progress.missing.protection.join(', ')} (optional)\n`;
  } else if (progress.missing.sim && progress.missing.sim.length > 0) {
    markdown += `1. Select SIM type for lines ${progress.missing.sim.join(', ')}\n`;
  } else {
    markdown += `1. Review your cart\n`;
    markdown += `2. Proceed to checkout\n`;
  }
  
  return markdown;
}

/**
 * Format guidance message after an action
 * @param {string} action - Action taken ('coverage', 'plan', 'device', 'protection', 'sim')
 * @param {Object} context - Flow context
 * @param {Object} progress - Flow progress
 * @returns {string} Guidance message
 */
export function formatGuidanceMessage(action, context, progress) {
  if (!context || !progress) {
    return "";
  }

  let message = "";
  
  switch (action) {
    case 'coverage':
      message = "✅ Coverage checked! ";
      if (!progress.lineCount || progress.lineCount === 0) {
        message += "Ready to choose a plan? Let me know how many lines you need!";
      } else if (progress.missing.plans && progress.missing.plans.length > 0) {
        message += `Ready to choose plans? You have ${progress.lineCount} line${progress.lineCount > 1 ? 's' : ''} to configure.`;
      } else {
        message += "Your coverage looks great! Want to proceed with device selection?";
      }
      break;
      
    case 'plan':
      message = "✅ Plan selected! ";
      if (progress.missing.devices && progress.missing.devices.length > 0) {
        message += `Would you like to add a device for ${progress.missing.devices.length > 1 ? 'these lines' : 'this line'}?`;
      } else if (progress.missing.sim && progress.missing.sim.length > 0) {
        message += "Ready to select SIM type?";
      } else {
        message += "Great! Ready to review your cart?";
      }
      break;
      
    case 'device':
      message = "✅ Device added! ";
      if (progress.missing.protection && progress.missing.protection.length > 0) {
        message += "Want to protect it with device protection?";
      } else if (progress.missing.sim && progress.missing.sim.length > 0) {
        message += "Ready to select SIM type?";
      } else {
        message += "Ready to review your cart?";
      }
      break;
      
    case 'protection':
      message = "✅ Protection added! ";
      if (progress.missing.sim && progress.missing.sim.length > 0) {
        message += "Ready to select SIM type?";
      } else {
        message += "Ready to review your cart?";
      }
      break;
      
    case 'sim':
      message = "✅ SIM type selected! ";
      message += "Ready to review your cart and proceed to checkout?";
      break;
      
    default:
      message = "What would you like to do next?";
  }
  
  return message;
}

/**
 * Format multi-line cart review
 * @param {Object} cart - Multi-line cart object
 * @param {Object} context - Flow context
 * @returns {string} Formatted markdown
 */
export function formatMultiLineCartReview(cart, context) {
  if (!cart || !cart.lines || cart.lines.length === 0) {
    return "## 🛒 Cart Review\n\nYour cart is empty. Add items to get started!";
  }

  // Calculate detailed totals
  const monthlyTotal = cart.lines.reduce((sum, line) => {
    return sum + (line.plan?.price || 0);
  }, 0);
  
  const oneTimeTotal = cart.lines.reduce((sum, line) => {
    return sum + (line.device?.price || 0) + (line.protection?.price || 0) + (line.sim?.price || 0);
  }, 0);
  
  const plansSelected = cart.lines.filter(l => l.plan).length;
  const devicesSelected = cart.lines.filter(l => l.device).length;
  const protectionsSelected = cart.lines.filter(l => l.protection).length;
  const simsSelected = cart.lines.filter(l => l.sim && l.sim.simType).length;

  let markdown = `## 🛒 Complete Cart Review\n\n`;
  
  // Summary section
  markdown += `### 📊 Order Summary\n\n`;
  markdown += `**Total Lines:** ${cart.lines.length}\n`;
  markdown += `**Monthly Recurring:** $${monthlyTotal.toFixed(2)}/month\n`;
  if (oneTimeTotal > 0) {
    markdown += `**One-Time Charges:** $${oneTimeTotal.toFixed(2)}\n`;
  }
  markdown += `**Grand Total:** $${cart.total.toFixed(2)}\n\n`;
  
  markdown += `**Items Selected:**\n`;
  markdown += `• Plans: ${plansSelected}/${cart.lines.length} line${cart.lines.length > 1 ? 's' : ''}\n`;
  markdown += `• Devices: ${devicesSelected} (optional)\n`;
  markdown += `• Protection: ${protectionsSelected} (optional)\n`;
  markdown += `• SIM Types: ${simsSelected}/${cart.lines.length} line${cart.lines.length > 1 ? 's' : ''}\n\n`;
  
  markdown += `---\n\n`;
  
  // Detailed line-by-line breakdown
  markdown += `### 📋 Line-by-Line Details\n\n`;
  
  cart.lines.forEach((line, index) => {
    markdown += `#### 📱 Line ${line.lineNumber || (index + 1)}\n\n`;
    
    // Plan details
    if (line.plan) {
      markdown += `**📱 Mobile Plan:**\n`;
      markdown += `   • Name: ${line.plan.name}\n`;
      markdown += `   • Price: $${line.plan.price}/month\n`;
      if (line.plan.data) {
        markdown += `   • Data: ${line.plan.data} ${line.plan.dataUnit || 'GB'}\n`;
      }
      if (line.plan.talktime === -1) {
        markdown += `   • Talk & Text: Unlimited\n`;
      }
      markdown += `\n`;
    } else {
      markdown += `**⚠️ Plan:** Not selected (required)\n\n`;
    }
    
    // Device details
    if (line.device) {
      markdown += `**📱 Device:**\n`;
      markdown += `   • Name: ${line.device.name || line.device.brand + ' ' + line.device.model}\n`;
      if (line.device.brand) {
        markdown += `   • Brand: ${line.device.brand}\n`;
      }
      markdown += `   • Price: $${line.device.price}\n`;
      if (line.device.storage) {
        markdown += `   • Storage: ${line.device.storage}\n`;
      }
      if (line.device.color) {
        markdown += `   • Color: ${line.device.color}\n`;
      }
      markdown += `\n`;
    } else {
      markdown += `**📱 Device:** None (optional - you can add later)\n\n`;
    }
    
    // Protection details
    if (line.protection) {
      markdown += `**🛡️ Device Protection:**\n`;
      markdown += `   • Plan: ${line.protection.name}\n`;
      markdown += `   • Price: $${line.protection.price}\n`;
      if (line.protection.coverage) {
        markdown += `   • Coverage: ${line.protection.coverage}\n`;
      }
      markdown += `\n`;
    } else if (line.device) {
      markdown += `**🛡️ Protection:** None (optional - recommended for devices)\n\n`;
    } else {
      markdown += `**🛡️ Protection:** N/A (no device selected)\n\n`;
    }
    
    // SIM details
    if (line.sim && line.sim.simType) {
      markdown += `**📲 SIM Type:**\n`;
      markdown += `   • Type: ${line.sim.simType}\n`;
      if (line.sim.simType === 'ESIM') {
        markdown += `   • Activation: Instant (digital)\n`;
      } else {
        markdown += `   • Delivery: 3-6 business days (physical card)\n`;
      }
      if (line.sim.iccId) {
        markdown += `   • ICCID: ${line.sim.iccId}\n`;
      }
      markdown += `\n`;
    } else {
      markdown += `**⚠️ SIM Type:** Not selected (required for activation)\n\n`;
    }
    
    // Line total
    const lineMonthly = line.plan?.price || 0;
    const lineOneTime = (line.device?.price || 0) + (line.protection?.price || 0) + (line.sim?.price || 0);
    const lineTotal = lineMonthly + lineOneTime;
    
    markdown += `**💰 Line ${line.lineNumber || (index + 1)} Totals:**\n`;
    if (lineMonthly > 0) {
      markdown += `   • Monthly: $${lineMonthly.toFixed(2)}/month\n`;
    }
    if (lineOneTime > 0) {
      markdown += `   • One-time: $${lineOneTime.toFixed(2)}\n`;
    }
    markdown += `   • **Total: $${lineTotal.toFixed(2)}**\n\n`;
    
    markdown += `---\n\n`;
  });
  
  // Validation and status
  markdown += `### ✅ Order Status\n\n`;
  
  const missingPlans = cart.lines.filter(l => !l.plan).length;
  const missingSims = cart.lines.filter(l => !l.sim || !l.sim.simType).length;
  
  if (missingPlans === 0 && missingSims === 0) {
    markdown += `✅ **Ready for Checkout!**\n\n`;
    markdown += `All required items are selected:\n`;
    markdown += `• All lines have plans\n`;
    markdown += `• All lines have SIM types\n`;
    markdown += `• Optional items (devices, protection) can be added or skipped\n\n`;
  } else {
    markdown += `⚠️ **Not Ready for Checkout**\n\n`;
    if (missingPlans > 0) {
      markdown += `• Missing plans for ${missingPlans} line${missingPlans > 1 ? 's' : ''} (required)\n`;
    }
    if (missingSims > 0) {
      markdown += `• Missing SIM types for ${missingSims} line${missingSims > 1 ? 's' : ''} (required)\n`;
    }
    markdown += `\nPlease complete the missing items before proceeding to checkout.\n\n`;
  }
  
  // Payment summary
  markdown += `### 💳 Payment Summary\n\n`;
  markdown += `**Due Today:** $${oneTimeTotal.toFixed(2)}\n`;
  markdown += `**Monthly Recurring:** $${monthlyTotal.toFixed(2)}/month\n`;
  markdown += `**First Month Total:** $${(oneTimeTotal + monthlyTotal).toFixed(2)}\n\n`;
  
  // Next actions
  markdown += `### 🎯 Next Actions\n\n`;
  if (missingPlans === 0 && missingSims === 0) {
    markdown += `✅ **Proceed to Checkout** - Complete your purchase\n`;
    markdown += `   • Say: "Checkout" or "Proceed to checkout"\n`;
    markdown += `   • You'll be asked for shipping and payment information\n\n`;
  }
  markdown += `✏️ **Edit Cart** - Modify any line or item\n`;
  markdown += `   • Say: "Edit cart" or "Change plan for line 1"\n\n`;
  markdown += `➕ **Add More** - Add devices or protection\n`;
  markdown += `   • Say: "Add device" or "Show me devices"\n`;
  
  return markdown;
}

/**
 * Format button suggestions based on flow state
 * @param {Object} context - Flow context
 * @param {Object} progress - Flow progress
 * @param {string} currentAction - Current action taken
 * @returns {string} Formatted button suggestions
 */
export function formatButtonSuggestions(context, progress, currentAction = null) {
  // Intentionally return no markdown-based quick actions so that
  // ChatGPT does not render grey suggestion chips. All interactive
  // actions are provided via in-widget buttons (cart / plans / devices).
  return '';
}

/**
 * Format conversational response with button suggestions
 * @param {string} message - Main message
 * @param {Object} context - Flow context
 * @param {Object} progress - Flow progress
 * @param {string} action - Action taken
 * @returns {string} Formatted response with buttons
 */
export function formatConversationalResponse(message, context, progress, action = null) {
  let response = message;
  
  // Add button suggestions
  const buttonSuggestions = formatButtonSuggestions(context, progress, action);
  response += buttonSuggestions;
  
  return response;
}
