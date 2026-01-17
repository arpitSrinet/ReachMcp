import { MongoClient } from 'mongodb';
import { logger } from './logger.js';

// MongoDB connection
let client = null;
let db = null;
let isConnected = false;

// Collection names
const COLLECTIONS = {
  FLOW_CONTEXT: 'flowContext',
  CARTS: 'carts',
  STATE: 'state'
};

/**
 * Connect to MongoDB
 * @param {string} connectionString - MongoDB connection string
 * @param {string} dbName - Database name
 * @returns {Promise<void>}
 */
export async function connect(connectionString, dbName = 'reach_mobile') {
  try {
    if (client && isConnected) {
      return;
    }

    client = new MongoClient(connectionString, {
      // Connection pool settings for AWS
      maxPoolSize: 10,
      minPoolSize: 2,
      maxIdleTimeMS: 30000,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      // Retry settings
      retryWrites: true,
      retryReads: true,
    });
    await client.connect();
    db = client.db(dbName);
    isConnected = true;
    
    logger.info(`Connected to MongoDB database: ${dbName}`);
    
    // Create indexes for better performance
    await createIndexes();
  } catch (error) {
    logger.error('MongoDB connection error:', error);
    isConnected = false;
    throw error;
  }
}

/**
 * Disconnect from MongoDB
 * @returns {Promise<void>}
 */
export async function disconnect() {
  try {
    if (client) {
      await client.close();
      client = null;
      db = null;
      isConnected = false;
      logger.info('Disconnected from MongoDB');
    }
  } catch (error) {
    logger.error('MongoDB disconnection error:', error);
  }
}

/**
 * Create indexes for collections
 * @returns {Promise<void>}
 */
async function createIndexes() {
  try {
    if (!db) return;

    // Index for flowContext by sessionId
    await db.collection(COLLECTIONS.FLOW_CONTEXT).createIndex({ sessionId: 1 }, { unique: true });
    
    // Index for carts by sessionId
    await db.collection(COLLECTIONS.CARTS).createIndex({ sessionId: 1 }, { unique: true });
    
    // Index for lastUpdated in flowContext for cleanup queries
    await db.collection(COLLECTIONS.FLOW_CONTEXT).createIndex({ lastUpdated: 1 });
    
    logger.info('MongoDB indexes created');
  } catch (error) {
    logger.error('Error creating indexes:', error);
  }
}

/**
 * Check if MongoDB is connected
 * @returns {boolean}
 */
export function isMongoConnected() {
  return isConnected && db !== null;
}

/**
 * Get database instance (for testing/debugging)
 * @returns {Db|null}
 */
export function getDb() {
  return db;
}

/**
 * Save data to MongoDB
 * @param {string} collectionName - Collection name
 * @param {any} data - Data to save
 * @returns {Promise<void>}
 */
async function saveToMongo(collectionName, data) {
  if (!db) {
    throw new Error('MongoDB not connected');
  }

  const collection = db.collection(collectionName);
  
  // If data is an object with individual documents (like flowContext), insert/update each
  if (typeof data === 'object' && !Array.isArray(data) && data !== null) {
    const operations = Object.entries(data).map(([key, value]) => ({
      updateOne: {
        filter: { sessionId: key },
        update: { $set: { ...value, sessionId: key } },
        upsert: true
      }
    }));

    if (operations.length > 0) {
      await collection.bulkWrite(operations);
    }
  } else {
    // Single document save
    await collection.deleteMany({});
    await collection.insertOne(data);
  }
}

/**
 * Load data from MongoDB
 * @param {string} collectionName - Collection name
 * @returns {Promise<any|null>}
 */
async function loadFromMongo(collectionName) {
  if (!db) {
    return null;
  }

  const collection = db.collection(collectionName);
  
  // For flowContext and carts, we store multiple documents
  if (collectionName === COLLECTIONS.FLOW_CONTEXT || collectionName === COLLECTIONS.CARTS) {
    const documents = await collection.find({}).toArray();
    const result = {};
    documents.forEach(doc => {
      const sessionId = doc.sessionId || doc._id.toString();
      const { _id, sessionId: _, ...data } = doc;
      result[sessionId] = data;
    });
    return Object.keys(result).length > 0 ? result : null;
  } else {
    // For state, get the single document
    const doc = await collection.findOne({});
    if (!doc) return null;
    const { _id, ...data } = doc;
    return data;
  }
}

/**
 * Save flowContext to MongoDB
 * @param {object} contexts - Flow contexts object
 * @returns {Promise<void>}
 */
export async function saveFlowContext(contexts) {
  if (!isConnected) return;
  try {
    await saveToMongo(COLLECTIONS.FLOW_CONTEXT, contexts);
  } catch (error) {
    logger.error('Error saving flowContext to MongoDB:', error);
    throw error;
  }
}

/**
 * Load flowContext from MongoDB
 * @returns {Promise<object|null>}
 */
export async function loadFlowContext() {
  if (!isConnected) return null;
  try {
    return await loadFromMongo(COLLECTIONS.FLOW_CONTEXT);
  } catch (error) {
    logger.error('Error loading flowContext from MongoDB:', error);
    return null;
  }
}

/**
 * Save carts to MongoDB
 * @param {object} carts - Carts object
 * @returns {Promise<void>}
 */
export async function saveCarts(carts) {
  if (!isConnected) return;
  try {
    await saveToMongo(COLLECTIONS.CARTS, carts);
  } catch (error) {
    logger.error('Error saving carts to MongoDB:', error);
    throw error;
  }
}

/**
 * Load carts from MongoDB
 * @returns {Promise<object|null>}
 */
export async function loadCarts() {
  if (!isConnected) return null;
  try {
    return await loadFromMongo(COLLECTIONS.CARTS);
  } catch (error) {
    logger.error('Error loading carts from MongoDB:', error);
    return null;
  }
}

/**
 * Save state to MongoDB
 * @param {object} state - State object
 * @returns {Promise<void>}
 */
export async function saveState(state) {
  if (!isConnected) return;
  try {
    const collection = db.collection(COLLECTIONS.STATE);
    await collection.deleteMany({});
    await collection.insertOne(state);
  } catch (error) {
    logger.error('Error saving state to MongoDB:', error);
    throw error;
  }
}

/**
 * Load state from MongoDB
 * @returns {Promise<object|null>}
 */
export async function loadState() {
  if (!isConnected) return null;
  try {
    return await loadFromMongo(COLLECTIONS.STATE);
  } catch (error) {
    logger.error('Error loading state from MongoDB:', error);
    return null;
  }
}

/**
 * Delete old sessions (cleanup)
 * @param {number} olderThan - Timestamp in milliseconds
 * @returns {Promise<number>} Number of deleted sessions
 */
export async function deleteOldSessions(olderThan) {
  if (!isConnected) return 0;
  try {
    const collection = db.collection(COLLECTIONS.FLOW_CONTEXT);
    const result = await collection.deleteMany({ 
      lastUpdated: { $lt: olderThan } 
    });
    return result.deletedCount;
  } catch (error) {
    logger.error('Error deleting old sessions:', error);
    return 0;
  }
}
