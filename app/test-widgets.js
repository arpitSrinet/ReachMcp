/**
 * Test script for Apps SDK widgets
 * Tests widget rendering and MCP integration
 */
import { app } from './app.js';

async function testWidgets() {
  console.log('🧪 Testing Apps SDK Widgets\n');
  console.log('='.repeat(50));
  
  // Test 1: Get Plans
  console.log('\n📱 Test 1: Get Plans');
  console.log('-'.repeat(50));
  try {
    const plans = await app.processToolCall('get_plans', {});
    console.log(`✅ Success: ${plans.length} plans rendered as widgets`);
    console.log(`   First plan: ${plans[0].title} - ${plans[0].subtitle}`);
    console.log(`   Has action button: ${plans[0].actions ? 'Yes' : 'No'}`);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
  }
  
  // Test 2: Get Offers
  console.log('\n🎁 Test 2: Get Offers');
  console.log('-'.repeat(50));
  try {
    const offers = await app.processToolCall('get_offers', {});
    if (offers && offers.length > 0) {
      console.log(`✅ Success: ${offers.length} offers rendered`);
      console.log(`   First offer: ${offers[0].title}`);
    } else {
      console.log('⚠️  No offers found');
    }
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
  }
  
  // Test 3: Get Cart
  console.log('\n🛒 Test 3: Get Cart');
  console.log('-'.repeat(50));
  try {
    const cart = await app.processToolCall('get_cart', {});
    console.log(`✅ Success: Cart widget rendered`);
    console.log(`   Items: ${cart.metadata?.itemCount || 0}`);
    console.log(`   Total: $${cart.fields?.find(f => f.name === 'total')?.value || 0}`);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
  }
  
  // Test 4: Add to Cart
  console.log('\n➕ Test 4: Add to Cart');
  console.log('-'.repeat(50));
  try {
    const result = await app.processToolCall('add_to_cart', {
      itemType: 'plan',
      itemId: 'M0028122398SHKAEF34A7711A1'
    });
    console.log(`✅ Success: Item added to cart`);
    console.log(`   Session ID: ${result.sessionId || 'N/A'}`);
    console.log(`   Cart items: ${result.cart?.items?.length || 0}`);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('✅ All tests completed!\n');
}

// Run tests
testWidgets().catch(console.error);

