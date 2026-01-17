import { getPlans } from "./services/plansService.js";
import { logger } from "./utils/logger.js";

async function testPlansAPI() {
  try {
    console.log("🔍 Fetching plans from API...\n");
    
    const plans = await getPlans(null, "reach");
    
    console.log(`✅ Successfully fetched ${plans.length} plans\n`);
    console.log("=".repeat(80));
    console.log("📋 FIELDS IN FIRST PLAN (Sample):");
    console.log("=".repeat(80));
    
    if (plans.length > 0) {
      const firstPlan = plans[0];
      
      // Display all fields with their values
      console.log("\n🔹 All Fields and Values:\n");
      for (const [key, value] of Object.entries(firstPlan)) {
        const valueStr = typeof value === 'object' && value !== null 
          ? JSON.stringify(value, null, 2) 
          : String(value);
        const truncated = valueStr.length > 200 ? valueStr.substring(0, 200) + "..." : valueStr;
        console.log(`  ${key}: ${truncated}`);
      }
      
      // Display field names only
      console.log("\n" + "=".repeat(80));
      console.log("📝 ALL FIELD NAMES:");
      console.log("=".repeat(80));
      console.log("\n" + Object.keys(firstPlan).join(", "));
      
      // Display field types
      console.log("\n" + "=".repeat(80));
      console.log("🔤 FIELD TYPES:");
      console.log("=".repeat(80));
      for (const [key, value] of Object.entries(firstPlan)) {
        const type = Array.isArray(value) ? 'array' : typeof value;
        console.log(`  ${key}: ${type}${Array.isArray(value) ? ` (length: ${value.length})` : ''}`);
      }
      
      // Show a few more plans for comparison
      if (plans.length > 1) {
        console.log("\n" + "=".repeat(80));
        console.log(`📊 COMPARING FIRST ${Math.min(3, plans.length)} PLANS:`);
        console.log("=".repeat(80));
        
        for (let i = 0; i < Math.min(3, plans.length); i++) {
          console.log(`\n--- Plan ${i + 1} ---`);
          console.log(`  ID: ${plans[i].id}`);
          console.log(`  Name: ${plans[i].name}`);
          console.log(`  Price: ${plans[i].price}`);
          console.log(`  Data: ${plans[i].data} ${plans[i].dataUnit || 'GB'}`);
          console.log(`  Unlimited: ${plans[i].unlimited}`);
        }
      }
    } else {
      console.log("⚠️  No plans returned from API");
    }
    
    console.log("\n" + "=".repeat(80));
    console.log("✅ Test completed successfully");
    console.log("=".repeat(80));
    
  } catch (error) {
    console.error("\n❌ Error fetching plans:", error.message);
    console.error("\nFull error:", error);
    process.exit(1);
  }
}

testPlansAPI();

