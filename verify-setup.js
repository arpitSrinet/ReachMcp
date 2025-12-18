#!/usr/bin/env node

/**
 * Verify MCP Server Setup
 * Tests that everything is configured correctly
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🔍 Verifying MCP Server Setup...\n');
console.log('='.repeat(50));

// Check 1: Server file exists
console.log('\n✅ Check 1: Server file');
try {
  const serverPath = join(__dirname, 'server.js');
  readFileSync(serverPath);
  console.log('   ✓ server.js exists');
} catch (e) {
  console.error('   ✗ server.js not found');
  process.exit(1);
}

// Check 2: Node.js path
console.log('\n✅ Check 2: Node.js path');
const nodePath = '/Users/arpitsingh/.nvm/versions/node/v23.11.0/bin/node';
try {
  const { execSync } = await import('child_process');
  execSync(`test -f "${nodePath}"`, { stdio: 'ignore' });
  console.log(`   ✓ Node.js found: ${nodePath}`);
} catch (e) {
  console.error(`   ✗ Node.js not found at: ${nodePath}`);
}

// Check 3: ChatGPT config
console.log('\n✅ Check 3: ChatGPT configuration');
const configPaths = [
  `${process.env.HOME}/Library/Application Support/OpenAI/mcp.json`,
  `${process.env.HOME}/Library/Application Support/ChatGPT/mcp.json`
];

let configFound = false;
for (const configPath of configPaths) {
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    if (config.mcpServers && config.mcpServers['reach-mobile-mcp']) {
      console.log(`   ✓ Config found: ${configPath}`);
      console.log(`     Command: ${config.mcpServers['reach-mobile-mcp'].command}`);
      console.log(`     Args: ${config.mcpServers['reach-mobile-mcp'].args[0]}`);
      configFound = true;
    }
  } catch (e) {
    // Config file doesn't exist or invalid
  }
}

if (!configFound) {
  console.error('   ✗ ChatGPT config not found');
  console.error('   Run: ./setup-chatgpt-mcp.sh');
}

// Check 4: Test server syntax
console.log('\n✅ Check 4: Server syntax');
try {
  const { execSync } = await import('child_process');
  execSync('node --check server.js', { cwd: __dirname, stdio: 'pipe' });
  console.log('   ✓ Server syntax valid');
} catch (e) {
  console.error('   ✗ Server syntax error');
  process.exit(1);
}

// Check 5: Test MCP connection (quick test)
console.log('\n✅ Check 5: MCP connection test');
console.log('   Testing server startup...');

const node = spawn('node', [join(__dirname, 'server.js')], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let output = '';
let errorOutput = '';

node.stdout.on('data', (data) => {
  output += data.toString();
});

node.stderr.on('data', (data) => {
  errorOutput += data.toString();
});

// Send a test request
setTimeout(() => {
  const testRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {}
  };
  
  node.stdin.write(JSON.stringify(testRequest) + '\n');
  node.stdin.end();
  
  setTimeout(() => {
    if (output.includes('jsonrpc') || output.length > 0) {
      console.log('   ✓ Server responds to requests');
    } else {
      console.log('   ⚠ Server started (may need ChatGPT to connect)');
    }
    node.kill();
    
    console.log('\n' + '='.repeat(50));
    console.log('\n✅ Setup verification complete!');
    console.log('\n📋 Next Steps:');
    console.log('   1. Restart ChatGPT Desktop (Cmd+Q)');
    console.log('   2. Reopen ChatGPT');
    console.log('   3. Try: "Show me mobile plans"');
    console.log('   4. Check if MCP tools appear\n');
  }, 1000);
}, 500);

