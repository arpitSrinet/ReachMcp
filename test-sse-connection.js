#!/usr/bin/env node

/**
 * Test script to verify SSE (Server-Sent Events) connection
 * Tests that the MCP server returns text/event-stream Content-Type
 */

import https from 'https';

const NGROK_URL = process.env.NGROK_URL || 'https://sprier-sage-nonfluidly.ngrok-free.dev';
const MCP_ENDPOINT = `${NGROK_URL}/mcp`;

console.log('🧪 Testing SSE Connection to MCP Server\n');
console.log(`📍 Endpoint: ${MCP_ENDPOINT}\n`);

// Test 1: Initialize request
const initializeRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: {
      name: 'test-client',
      version: '1.0.0'
    }
  }
};

// Test 2: List tools request
const listToolsRequest = {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/list',
  params: {}
};

function makeRequest(requestBody, testName) {
  return new Promise((resolve, reject) => {
    const url = new URL(MCP_ENDPOINT);
    
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream, application/json',
        'User-Agent': 'MCP-Test-Client/1.0'
      },
      rejectUnauthorized: false // For self-signed certs
    };

    console.log(`\n📤 ${testName}`);
    console.log(`   Method: ${requestBody.method}`);
    console.log(`   ID: ${requestBody.id}`);

    const req = https.request(options, (res) => {
      console.log(`\n📥 Response:`);
      console.log(`   Status: ${res.statusCode}`);
      console.log(`   Content-Type: ${res.headers['content-type']}`);
      console.log(`   Cache-Control: ${res.headers['cache-control']}`);
      console.log(`   Connection: ${res.headers['connection']}`);

      // Check if Content-Type is text/event-stream
      const contentType = res.headers['content-type'] || '';
      const isSSE = contentType.includes('text/event-stream');
      
      if (isSSE) {
        console.log(`   ✅ SSE mode detected!`);
      } else {
        console.log(`   ❌ Expected text/event-stream, got: ${contentType}`);
      }

      let data = '';
      res.on('data', (chunk) => {
        data += chunk.toString();
      });

      res.on('end', () => {
        console.log(`\n📄 Response Body:`);
        if (data) {
          // Try to parse SSE format
          const lines = data.split('\n');
          lines.forEach((line, index) => {
            if (line.startsWith('data: ')) {
              const jsonData = line.substring(6); // Remove 'data: ' prefix
              try {
                const parsed = JSON.parse(jsonData);
                console.log(`   Line ${index + 1}: ${JSON.stringify(parsed, null, 2)}`);
              } catch (e) {
                console.log(`   Line ${index + 1}: ${jsonData}`);
              }
            } else if (line.trim()) {
              console.log(`   Line ${index + 1}: ${line}`);
            }
          });
        } else {
          console.log('   (empty)');
        }

        resolve({
          statusCode: res.statusCode,
          contentType: res.headers['content-type'],
          isSSE: isSSE,
          body: data
        });
      });
    });

    req.on('error', (error) => {
      console.error(`\n❌ Request error: ${error.message}`);
      reject(error);
    });

    req.write(JSON.stringify(requestBody));
    req.end();
  });
}

async function runTests() {
  try {
    console.log('='.repeat(60));
    console.log('Test 1: Initialize Request');
    console.log('='.repeat(60));
    const result1 = await makeRequest(initializeRequest, 'Initialize');
    
    if (!result1.isSSE) {
      console.log('\n❌ FAILED: Initialize request did not return SSE format');
      process.exit(1);
    }

    // Wait a bit between requests
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('\n' + '='.repeat(60));
    console.log('Test 2: List Tools Request');
    console.log('='.repeat(60));
    const result2 = await makeRequest(listToolsRequest, 'List Tools');
    
    if (!result2.isSSE) {
      console.log('\n❌ FAILED: List tools request did not return SSE format');
      process.exit(1);
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ All tests passed!');
    console.log('='.repeat(60));
    console.log('\n✅ Server is correctly configured for SSE (text/event-stream)');
    console.log('✅ ChatGPT connector should work now!\n');

  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    process.exit(1);
  }
}

// Run tests
runTests();

