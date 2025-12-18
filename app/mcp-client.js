import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MCP_SERVER_PATH = path.join(__dirname, '../server.js');

/**
 * Call MCP server tool and return JSON response
 */
export async function callMCPServer(toolName, params = {}) {
  return new Promise((resolve, reject) => {
    const node = spawn('node', [MCP_SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    node.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    node.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    node.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`MCP server error: ${stderr}`));
        return;
      }
      
      try {
        // Parse JSON-RPC response
        const lines = stdout.trim().split('\n').filter(line => line.trim());
        let response = null;
        
        // Find the last JSON object
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            response = JSON.parse(lines[i]);
            if (response.jsonrpc === '2.0') {
              break;
            }
          } catch (e) {
            continue;
          }
        }
        
        if (!response || !response.result) {
          reject(new Error(`Invalid MCP response: ${stdout}`));
          return;
        }
        
        // Extract content from MCP response
        const content = response.result.content?.[0];
        if (content && content.type === 'text') {
          try {
            const data = JSON.parse(content.text);
            resolve(data);
          } catch (e) {
            // If not JSON, return as text
            resolve({ text: content.text });
          }
        } else {
          resolve(response.result);
        }
      } catch (e) {
        reject(new Error(`Failed to parse response: ${e.message}`));
      }
    });

    // Send JSON-RPC request to MCP server
    const request = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: {
          ...params,
          returnFormat: 'json' // Request JSON format
        }
      }
    };

    node.stdin.write(JSON.stringify(request) + '\n');
    node.stdin.end();
  });
}

