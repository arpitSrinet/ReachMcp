#!/usr/bin/env node

/**
 * Simple test script for Conversational Purchase Flow
 * Run: node test-flow-simple.js
 * 
 * Make sure server is running: npm run start:https
 */

import https from 'https';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_URL = 'https://localhost:3000/mcp';
let sessionId = null;

// Helper to make MCP tool call
async function callTool(toolName, args = {}, id = 1) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      jsonrpc: '2.0',
      id: id,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      }
    });

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/mcp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      },
      rejectUnauthorized: false // For self-signed cert
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          if (response.error) {
            reject(new Error(response.error.message || 'Tool call failed'));
          } else {
            resolve(response.result);
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Extract session ID from response
function extractSessionId(result) {
  if (result.content && result.content[0] && result.content[0].text) {
    const text = result.content[0].text;
    const match = text.match(/Session ID: ([^\s\n]+)/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

// Test functions
async function testStartFlow() {
  console.log('\n📋 Test 1: Start Session');
  console.log('========================');
  const result = await callTool('start_session', { lineCount: 2 }, 1);
  console.log(result.content[0].text);
  sessionId = extractSessionId(result) || sessionId;
  return result;
}

async function testGetFlowStatus() {
  console.log('\n📊 Test 2: Get Flow Status');
  console.log('==========================');
  const result = await callTool('get_flow_status', sessionId ? { sessionId } : {}, 2);
  console.log(result.content[0].text);
  return result;
}

async function testCheckCoverage() {
  console.log('\n📶 Test 3: Check Coverage');
  console.log('=========================');
  const result = await callTool('check_coverage', { zipCode: '90210' }, 3);
  console.log(result.content[0].text);
  return result;
}

async function testGetPlans() {
  console.log('\n📱 Test 4: Get Plans');
  console.log('====================');
  const result = await callTool('get_plans', {}, 4);
  console.log(result.content[0].text);
  if (result.structuredContent && result.structuredContent.plans) {
    console.log(`\n✅ Found ${result.structuredContent.plans.length} plans`);
    if (result.structuredContent.plans.length > 0) {
      console.log(`   First plan: ${result.structuredContent.plans[0].name} - $${result.structuredContent.plans[0].price}/mo`);
    }
  }
  return result;
}

async function testGetDevices() {
  console.log('\n📱 Test 5: Get Devices');
  console.log('======================');
  const result = await callTool('get_devices', { limit: 5 }, 5);
  console.log(result.content[0].text);
  if (result.structuredContent && result.structuredContent.devices) {
    console.log(`\n✅ Found ${result.structuredContent.devices.length} devices`);
  }
  return result;
}

async function testSelectSimType() {
  console.log('\n📲 Test 6: Select SIM Type');
  console.log('==========================');
  if (!sessionId) {
    console.log('⚠️  No session ID, skipping...');
    return null;
  }
  const result = await callTool('select_sim_type', {
    lineNumber: 1,
    simType: 'ESIM'
  }, 6);
  console.log(result.content[0].text);
  return result;
}

async function testReviewCart() {
  console.log('\n🛒 Test 7: Review Cart');
  console.log('======================');
  const result = await callTool('review_cart', sessionId ? { sessionId } : {}, 7);
  console.log(result.content[0].text);
  return result;
}

// Main test runner
async function runTests() {
  console.log('🧪 Testing Conversational Purchase Flow');
  console.log('========================================');
  console.log('\nMake sure server is running: npm run start:https\n');

  try {
    await testStartFlow();
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await testGetFlowStatus();
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await testCheckCoverage();
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await testGetPlans();
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await testGetDevices();
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await testSelectSimType();
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await testReviewCart();
    
    console.log('\n✅ All tests completed!');
    console.log(`\nSession ID: ${sessionId || 'Not set'}`);
    console.log('\n💡 Next steps:');
    console.log('   - Test in ChatGPT Desktop for full UI experience');
    console.log('   - Check data/flowContext.json for context data');
    console.log('   - Check data/carts.json for cart data');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('\nMake sure:');
    console.error('   1. Server is running: npm run start:https');
    console.error('   2. SSL certificates are valid');
    console.error('   3. Port 3000 is available');
    process.exit(1);
  }
}

// Run tests
runTests();

