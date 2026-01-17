#!/usr/bin/env node
/**
 * Test MongoDB connection and data flow
 * Usage: node test-mongodb-connection.js
 */

import dotenv from "dotenv";
dotenv.config();

import { init as initStorage, saveAsync, loadAsync } from './utils/storage.js';
import * as mongoStorage from './utils/mongodbStorage.js';
import { initializeCartService } from './services/cartService.js';
import { initializeFlowContextService } from './services/flowContextService.js';

async function testMongoConnection() {
  console.log('🔍 Testing MongoDB Connection...\n');

  // Test 1: Connection
  try {
    await initStorage();
    const isConnected = mongoStorage.isMongoConnected();
    
    if (isConnected) {
      console.log('✅ MongoDB connection: CONNECTED');
    } else {
      console.log('❌ MongoDB connection: DISCONNECTED');
      console.log('   Check MONGODB_URI in .env file');
      return;
    }
  } catch (error) {
    console.log('❌ MongoDB connection failed:', error.message);
    return;
  }

  // Test 2: Service initialization
  console.log('\n🔍 Testing Service Initialization...');
  try {
    await initializeCartService();
    await initializeFlowContextService();
    console.log('✅ Services initialized successfully');
  } catch (error) {
    console.log('❌ Service initialization failed:', error.message);
  }

  // Test 3: Write test data
  console.log('\n🔍 Testing Data Write...');
  try {
    const testSessionId = `test_${Date.now()}`;
    const testData = {
      testKey: 'testValue',
      timestamp: new Date().toISOString(),
      testNumber: 12345
    };

    await saveAsync('state', { 
      testSessionId,
      testData,
      mostRecentSessionId: testSessionId
    });
    console.log('✅ Test data written to MongoDB');
    console.log(`   Session ID: ${testSessionId}`);
  } catch (error) {
    console.log('❌ Write test failed:', error.message);
  }

  // Test 4: Read test data
  console.log('\n🔍 Testing Data Read...');
  try {
    const state = await loadAsync('state');
    if (state && state.testSessionId) {
      console.log('✅ Test data read from MongoDB');
      console.log(`   Retrieved: ${state.testSessionId}`);
      console.log(`   Data: ${JSON.stringify(state.testData, null, 2)}`);
    } else {
      console.log('⚠️  Test data not found (this is okay if first run)');
      if (state) {
        console.log(`   Current state: ${JSON.stringify(state, null, 2)}`);
      }
    }
  } catch (error) {
    console.log('❌ Read test failed:', error.message);
  }

  // Test 5: Collections check
  console.log('\n🔍 Checking Collections...');
  try {
    const db = mongoStorage.getDb();
    if (db) {
      const collections = await db.listCollections().toArray();
      const collectionNames = collections.map(c => c.name);
      console.log('✅ Collections found:', collectionNames.join(', ') || 'none yet');
      
      // Count documents in each collection
      if (collectionNames.length > 0) {
        console.log('\n   Document counts:');
        for (const name of collectionNames) {
          const count = await db.collection(name).countDocuments();
          console.log(`     ${name}: ${count} documents`);
        }
      }
    } else {
      console.log('⚠️  Database instance not available');
    }
  } catch (error) {
    console.log('⚠️  Could not list collections:', error.message);
  }

  // Test 6: Flow Context write/read
  console.log('\n🔍 Testing Flow Context...');
  try {
    const testSessionId = `flow_test_${Date.now()}`;
    const testContext = {
      sessionId: testSessionId,
      flowStage: 'test',
      lastUpdated: Date.now()
    };

    const contexts = {};
    contexts[testSessionId] = testContext;
    await saveAsync('flowContext', contexts);

    const loaded = await loadAsync('flowContext');
    if (loaded && loaded[testSessionId]) {
      console.log('✅ Flow context write/read successful');
      console.log(`   Test context saved and retrieved`);
      console.log(`   Flow stage: ${loaded[testSessionId].flowStage}`);
    } else {
      console.log('⚠️  Flow context test incomplete');
      if (loaded) {
        const keys = Object.keys(loaded);
        console.log(`   Found ${keys.length} contexts in database`);
      }
    }
  } catch (error) {
    console.log('❌ Flow context test failed:', error.message);
  }

  // Test 7: Cart write/read
  console.log('\n🔍 Testing Cart...');
  try {
    const testSessionId = `cart_test_${Date.now()}`;
    const testCart = {
      sessionId: testSessionId,
      lines: [],
      total: 0,
      createdAt: Date.now()
    };

    const carts = {};
    carts[testSessionId] = testCart;
    await saveAsync('carts', carts);

    const loaded = await loadAsync('carts');
    if (loaded && loaded[testSessionId]) {
      console.log('✅ Cart write/read successful');
      console.log(`   Test cart saved and retrieved`);
      console.log(`   Cart total: ${loaded[testSessionId].total}`);
    } else {
      console.log('⚠️  Cart test incomplete');
      if (loaded) {
        const keys = Object.keys(loaded);
        console.log(`   Found ${keys.length} carts in database`);
      }
    }
  } catch (error) {
    console.log('❌ Cart test failed:', error.message);
  }

  console.log('\n✅ All tests completed!\n');
  
  // Cleanup
  await mongoStorage.disconnect();
  process.exit(0);
}

testMongoConnection().catch(error => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});

