#!/usr/bin/env node

/**
 * Purchase flow test: start_session → add plan → collect shipping → purchase_plans
 *
 * Run: node test-purchase-flow.js
 *
 * Prerequisites:
 *   - Server running: npm run start:https
 *   - Reach Mobile API accessible (plan-only cart, no devices)
 *
 * Optional env:
 *   - SKIP_POLLING=1  use purchase_plans with skipPolling: true, then check_purchase_status
 *   - PLAN_ID=...     use this plan ID instead of first from get_plans
 */

import https from 'https';

const BASE = { hostname: 'localhost', port: 3000, path: '/mcp', method: 'POST' };
let sessionId = null;
let callId = 0;

function callTool(name, args = {}) {
  const id = ++callId;
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args }
    });

    const opts = {
      ...BASE,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream, application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      rejectUnauthorized: false
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const ct = (res.headers['content-type'] || '').toLowerCase();
          let j;
          if (ct.includes('event-stream') || /^\s*(event:\s|data:\s)/m.test(data)) {
            j = parseSseResponse(data, id);
          } else {
            j = JSON.parse(data);
          }
          if (!j) reject(new Error('No JSON-RPC response found in SSE stream'));
          else if (j.error) reject(new Error(j.error.message || 'tool call failed'));
          else resolve(j.result);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(90_000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(body);
    req.end();
  });
}

function parseSseResponse(sse, expectedId) {
  let last = null;
  const lines = sse.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('data:')) {
      const raw = line.slice(5).trim();
      if (raw === '[DONE]' || !raw) continue;
      try {
        const j = JSON.parse(raw);
        if (j != null && (j.id === expectedId || (j.result != null || j.error != null))) {
          last = j;
          if (j.id === expectedId) return j;
        }
      } catch (_) {}
    }
  }
  return last;
}

function extractSessionId(result) {
  const text = result?.content?.[0]?.text || '';
  const m = text.match(/(?:\*\*)?Session ID(?:\*\*)?\s*:\s*(\S+)/);
  return m ? m[1] : null;
}

function text(result) {
  return result?.content?.[0]?.text || '';
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  console.log('🧪 Purchase flow test');
  console.log('   Server: https://localhost:3000');
  console.log('   Run with: npm run start:https\n');

  const skipPolling = process.env.SKIP_POLLING === '1';
  const planIdOverride = process.env.PLAN_ID || null;

  try {
    // 1. Start session
    console.log('1️⃣ start_session (lineCount: 1)');
    let res = await callTool('start_session', { lineCount: 1 });
    console.log(text(res));
    sessionId = extractSessionId(res) || sessionId;
    if (!sessionId) console.warn('⚠️  No Session ID in response; using "most recent" session.');
    await sleep(500);

    // 2. Get plan ID
    let planId = planIdOverride;
    if (!planId) {
      console.log('\n2️⃣ get_plans');
      res = await callTool('get_plans', sessionId ? { sessionId } : {});
      const plans = res?.structuredContent?.plans;
      if (Array.isArray(plans) && plans.length) {
        planId = plans[0].id || plans[0].uniqueIdentifier;
        console.log(`   Using first plan: ${plans[0].name} (${planId})`);
      } else {
        planId = 'M0028122398KED2591D0295B09'; // fallback from carts.json
        console.log(`   No plans in response; using fallback: ${planId}`);
      }
      await sleep(500);
    } else {
      console.log(`\n2️⃣ Using PLAN_ID: ${planId}`);
    }

    // 3. Add plan to cart
    console.log('\n3️⃣ add_to_cart (plan)');
    const addArgs = { itemType: 'plan', itemId: planId, lineNumber: 1 };
    if (sessionId) addArgs.sessionId = sessionId;
    res = await callTool('add_to_cart', addArgs);
    console.log(text(res));
    await sleep(500);

    // 4. Review cart (ensures "cart ready" before collect_shipping)
    console.log('\n4️⃣ review_cart');
    res = await callTool('review_cart', sessionId ? { sessionId } : {});
    console.log(text(res).slice(0, 300) + (text(res).length > 300 ? '...' : ''));
    await sleep(300);

    // 5. Collect shipping address
    console.log('\n5️⃣ collect_shipping_address');
    const ship = {
      firstName: 'Jane',
      lastName: 'Doe',
      street: '123 Main St',
      city: 'New York',
      state: 'NY',
      zipCode: '10001',
      country: 'US',
      phone: '5551234567',
      email: 'jane@example.com'
    };
    if (sessionId) ship.sessionId = sessionId;
    res = await callTool('collect_shipping_address', ship);
    console.log(text(res));
    await sleep(500);

    // 6. Purchase
    console.log('\n6️⃣ purchase_plans' + (skipPolling ? ' (skipPolling: true)' : ''));
    const purchaseArgs = skipPolling ? { skipPolling: true } : {};
    if (sessionId) purchaseArgs.sessionId = sessionId;
    res = await callTool('purchase_plans', purchaseArgs);
    console.log(text(res));

    const pr = res?.structuredContent?.purchaseResult;
    const hasUrl = !!(pr?.paymentUrl || (text(res).match(/\*\*Payment Link:\*\*\s*(\S+)/) || [])[1]);

    if (hasUrl) {
      console.log('\n✅ Purchase flow OK — payment URL present.');
      if (pr?.paymentUrl) console.log('   structuredContent.purchaseResult.paymentUrl:', pr.paymentUrl);
    } else if (skipPolling || text(res).includes('Payment Pending') || text(res).includes('Payment Link Pending')) {
      console.log('\n⏳ Purchase initiated; no payment URL yet. Checking status...');
      await sleep(2000);
      const statusArgs = sessionId ? { sessionId } : {};
      res = await callTool('check_purchase_status', statusArgs);
      console.log('\n   check_purchase_status:\n' + text(res));
      if (res?.structuredContent?.purchaseStatus?.paymentUrl) {
        console.log('\n✅ Payment URL from check_purchase_status:', res.structuredContent.purchaseStatus.paymentUrl);
      }
    } else {
      console.log('\n⚠️  No payment URL in response. Check server logs and API.');
    }

    console.log('\n   Session ID:', sessionId || '(see server most-recent session)');
  } catch (e) {
    console.error('\n❌ Test failed:', e.message);
    console.error('   Ensure server is running: npm run start:https');
    process.exit(1);
  }
}

run();
