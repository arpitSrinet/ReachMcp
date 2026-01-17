#!/usr/bin/env node

/**
 * Migration script to upload JSON data to MongoDB
 * Usage: node scripts/migrateToMongoDB.js <mongodb_connection_string> [database_name]
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'data');

// Get connection string from command line or environment
const connectionString = process.argv[2] || process.env.MONGODB_URI;
const dbName = process.argv[3] || process.env.MONGODB_DB_NAME || 'reach_mobile';

if (!connectionString) {
  console.error('Error: MongoDB connection string is required');
  console.error('Usage: node scripts/migrateToMongoDB.js <mongodb_connection_string> [database_name]');
  console.error('   Or set MONGODB_URI environment variable');
  process.exit(1);
}

/**
 * Read and parse JSON file
 */
function readJSONFile(filename) {
  const filePath = path.join(DATA_DIR, `${filename}.json`);
  if (!fs.existsSync(filePath)) {
    console.warn(`Warning: ${filePath} does not exist, skipping...`);
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.trim() === '' || content === '{}') {
      console.log(`${filename}.json is empty, skipping...`);
      return null;
    }
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error parsing ${filename}.json:`, error.message);
    return null;
  }
}

/**
 * Migrate flowContext data
 */
async function migrateFlowContext(db) {
  const data = readJSONFile('flowContext');
  if (!data || typeof data !== 'object') {
    console.log('No flowContext data to migrate');
    return;
  }

  const collection = db.collection('flowContext');
  const sessionIds = Object.keys(data);
  
  console.log(`Migrating ${sessionIds.length} flow contexts...`);
  
  const operations = sessionIds.map(sessionId => ({
    updateOne: {
      filter: { sessionId },
      update: { 
        $set: { 
          ...data[sessionId],
          sessionId 
        } 
      },
      upsert: true
    }
  }));

  const result = await collection.bulkWrite(operations);
  console.log(`✓ Migrated ${result.upsertedCount + result.modifiedCount} flow contexts`);
  
  // Create index
  await collection.createIndex({ sessionId: 1 }, { unique: true });
  await collection.createIndex({ lastUpdated: 1 });
}

/**
 * Migrate carts data
 */
async function migrateCarts(db) {
  const data = readJSONFile('carts');
  if (!data || typeof data !== 'object') {
    console.log('No carts data to migrate');
    return;
  }

  const collection = db.collection('carts');
  const sessionIds = Object.keys(data);
  
  if (sessionIds.length === 0) {
    console.log('No carts data to migrate');
    return;
  }

  console.log(`Migrating ${sessionIds.length} carts...`);
  
  const operations = sessionIds.map(sessionId => {
    const cartData = data[sessionId];
    return {
      updateOne: {
        filter: { sessionId },
        update: { 
          $set: { 
            ...(typeof cartData === 'object' ? cartData : {}),
            sessionId 
          } 
        },
        upsert: true
      }
    };
  });

  const result = await collection.bulkWrite(operations);
  console.log(`✓ Migrated ${result.upsertedCount + result.modifiedCount} carts`);
  
  // Create index
  await collection.createIndex({ sessionId: 1 }, { unique: true });
}

/**
 * Migrate state data
 */
async function migrateState(db) {
  const data = readJSONFile('state');
  if (!data) {
    console.log('No state data to migrate');
    return;
  }

  const collection = db.collection('state');
  
  console.log('Migrating state...');
  
  // Clear existing state (should only be one document)
  await collection.deleteMany({});
  await collection.insertOne(data);
  
  console.log('✓ Migrated state');
}

/**
 * Main migration function
 */
async function main() {
  let client = null;

  try {
    console.log('Connecting to MongoDB...');
    console.log(`Database: ${dbName}`);
    
    client = new MongoClient(connectionString);
    await client.connect();
    
    console.log('✓ Connected to MongoDB\n');

    const db = client.db(dbName);

    // Migrate each collection
    await migrateFlowContext(db);
    await migrateCarts(db);
    await migrateState(db);

    console.log('\n✓ Migration completed successfully!');
    console.log(`\nYour data is now in MongoDB. You can configure your app to use MongoDB by setting:`);
    console.log(`  MONGODB_URI=${connectionString}`);
    console.log(`  MONGODB_DB_NAME=${dbName}`);
    console.log(`\nOr use the .env file (see .env.example)`);

  } catch (error) {
    console.error('\n✗ Migration failed:', error.message);
    if (error.message.includes('authentication')) {
      console.error('\nTip: Check your MongoDB connection string. It should look like:');
      console.error('   mongodb://username:password@host:port/database');
      console.error('   or');
      console.error('   mongodb+srv://username:password@cluster.mongodb.net/database');
    }
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('\nDisconnected from MongoDB');
    }
  }
}

// Run migration
main().catch(console.error);
