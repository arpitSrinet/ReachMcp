import dotenv from 'dotenv';
dotenv.config();

import { validateDevice } from './services/deviceService.js';
import { getAuthToken, getAuthTokensMap } from './services/authService.js';
import { logger } from './utils/logger.js';

async function testDeviceValidationAuth() {
  // Test IMEI (15 digits) - using a sample/test IMEI
  const testImei = '123456789012345';
  
  console.log(`\n🔍 Testing Device Validation Authentication\n`);
  console.log('='.repeat(60));
  
  try {
    // Step 1: Check if auth token exists
    console.log('\n1️⃣ Checking Authentication Token Status...');
    const tokensMap = getAuthTokensMap();
    const cachedToken = tokensMap?.get('reach');
    
    if (cachedToken) {
      const now = Date.now();
      const timeUntilExpiration = cachedToken.expiresAt - now;
      const minutesUntilExpiration = Math.floor(timeUntilExpiration / (60 * 1000));
      console.log(`   ✅ Cached token found`);
      console.log(`   📅 Expires: ${new Date(cachedToken.expiresAt).toISOString()}`);
      console.log(`   ⏰ Minutes until expiration: ${minutesUntilExpiration}`);
      console.log(`   🔑 Token prefix: ${cachedToken.token.substring(0, 30)}...`);
    } else {
      console.log(`   ⚠️  No cached token found - will fetch new token`);
    }
    
    // Step 2: Get/Fetch auth token
    console.log('\n2️⃣ Ensuring Authentication Token...');
    const authToken = await getAuthToken('reach', false);
    console.log(`   ✅ Auth token retrieved/verified`);
    console.log(`   🔑 Token prefix: ${authToken.substring(0, 30)}...`);
    
    // Step 3: Test device validation
    console.log(`\n3️⃣ Testing Device Validation API Call...`);
    console.log(`   📱 IMEI: ${testImei}`);
    console.log(`   🌐 Endpoint: /apisvc/v0/device/imei/${testImei}`);
    console.log(`   🔐 Using authenticated API call (callReachAPI)...`);
    
    const result = await validateDevice(testImei, 'reach');
    
    console.log('\n✅ Device Validation Successful!\n');
    console.log('Results:');
    console.log(JSON.stringify(result, null, 2));
    
    console.log('\n📊 Summary:');
    if (result.isValid !== undefined) {
      console.log(`  Device Valid: ${result.isValid}`);
    }
    if (result.make) {
      console.log(`  Make: ${result.make}`);
    }
    if (result.model) {
      console.log(`  Model: ${result.model}`);
    }
    if (result.esimAvailable !== undefined) {
      console.log(`  eSIM Available: ${result.esimAvailable}`);
    }
    if (result.wifiCalling !== undefined) {
      console.log(`  WiFi Calling: ${result.wifiCalling}`);
    }
    if (result.volteCompatible !== undefined) {
      console.log(`  VoLTE Compatible: ${result.volteCompatible}`);
    }
    
  } catch (error) {
    console.error('\n❌ Device Validation Failed!\n');
    console.error('Error Details:');
    console.error(`  Message: ${error.message}`);
    console.error(`  Status Code: ${error.statusCode || 'N/A'}`);
    console.error(`  Error Type: ${error.errorType || 'N/A'}`);
    
    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      console.error('\n  ⚠️  Authentication Error Detected!');
      console.error('  This indicates the auth token may be invalid or expired.');
    }
    
    if (error.responseBody) {
      console.error('\n  Response Body:');
      console.error(JSON.stringify(error.responseBody, null, 2));
    }
    
    console.error('\n  Full Error:');
    console.error(error);
    
    process.exit(1);
  }
}

testDeviceValidationAuth().then(() => {
  console.log('\n' + '='.repeat(60));
  console.log('✅ Authentication check completed\n');
  process.exit(0);
}).catch(error => {
  console.error('\n❌ Unexpected error:', error);
  process.exit(1);
});

