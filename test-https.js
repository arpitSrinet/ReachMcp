#!/usr/bin/env node

/**
 * Test HTTPS MCP Server Connection
 */
import https from 'https';

const testRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list',
  params: {}
};

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/mcp',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  },
  rejectUnauthorized: false // Allow self-signed certificates
};

console.log('🧪 Testing HTTPS MCP Server...\n');
console.log('='.repeat(50));

const req = https.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      if (response.result && response.result.tools) {
        console.log('✅ HTTPS Connection Successful!\n');
        console.log(`📋 Found ${response.result.tools.length} tools:`);
        response.result.tools.forEach((tool, index) => {
          console.log(`   ${index + 1}. ${tool.name}`);
        });
        console.log('\n' + '='.repeat(50));
        console.log('✅ Server is ready for ChatGPT!');
      } else {
        console.log('⚠️  Response:', JSON.stringify(response, null, 2));
      }
    } catch (e) {
      console.error('❌ Error parsing response:', e.message);
      console.log('Raw response:', data);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Connection Error:', error.message);
  console.log('\n💡 Make sure the server is running:');
  console.log('   npm run start:https');
});

req.write(JSON.stringify(testRequest));
req.end();

