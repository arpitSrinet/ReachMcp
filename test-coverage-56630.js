import dotenv from 'dotenv';
dotenv.config();

import { checkCoverage } from './services/coverageService.js';
import { logger } from './utils/logger.js';

async function testCoverage() {
  const zipCode = '56630';
  
  console.log(`\n🧪 Testing Coverage API for ZIP Code: ${zipCode}\n`);
  console.log('=' .repeat(60));
  
  try {
    const result = await checkCoverage(zipCode, 'reach');
    
    console.log('\n✅ Coverage Check Successful!\n');
    console.log('Results:');
    console.log(JSON.stringify(result, null, 2));
    
    console.log('\n📊 Summary:');
    console.log(`  ZIP Code: ${result.zipCode}`);
    console.log(`  Valid: ${result.isValid !== null ? result.isValid : 'Unknown'}`);
    console.log(`  Brand Coverage: ${result.brandCoverage !== null ? result.brandCoverage : 'Unknown'}`);
    console.log(`  5G Signal: ${result.signal5g || 'N/A'}`);
    console.log(`  4G Signal: ${result.signal4g || 'N/A'}`);
    console.log(`  eSIM Available: ${result.esimAvailable !== null ? result.esimAvailable : 'Unknown'}`);
    console.log(`  pSIM Available: ${result.psimAvailable !== null ? result.psimAvailable : 'Unknown'}`);
    console.log(`  5G Compatible: ${result.compatibility5G !== null ? result.compatibility5G : 'Unknown'}`);
    console.log(`  4G Compatible: ${result.compatibility4G !== null ? result.compatibility4G : 'Unknown'}`);
    console.log(`  VoLTE Compatible: ${result.volteCompatible !== null ? result.volteCompatible : 'Unknown'}`);
    console.log(`  WiFi Calling: ${result.wifiCalling !== null ? result.wifiCalling : 'Unknown'}`);
    
  } catch (error) {
    console.error('\n❌ Coverage Check Failed!\n');
    console.error('Error Details:');
    console.error(`  Message: ${error.message}`);
    console.error(`  Status Code: ${error.statusCode || 'N/A'}`);
    console.error(`  Error Type: ${error.errorType || 'N/A'}`);
    
    if (error.responseBody) {
      console.error('\n  Response Body:');
      console.error(JSON.stringify(error.responseBody, null, 2));
    }
    
    console.error('\n  Full Error:');
    console.error(error);
    
    process.exit(1);
  }
}

testCoverage().then(() => {
  console.log('\n' + '='.repeat(60));
  console.log('✅ Test completed\n');
  process.exit(0);
}).catch(error => {
  console.error('\n❌ Unexpected error:', error);
  process.exit(1);
});

