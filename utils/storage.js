import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as mongoStorage from './mongodbStorage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Storage directory
const STORAGE_DIR = path.join(__dirname, '..', 'data');

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

// MongoDB connection state
let useMongoDB = false;
let mongoInitialized = false;
let mongoInitPromise = null;

/**
 * Initialize MongoDB connection if MONGODB_URI is set
 * Call this on application startup
 * @returns {Promise<void>}
 */
export async function init() {
  if (mongoInitialized) return;

  const connectionString = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || 'reach_mobile';

  if (connectionString) {
    try {
      await mongoStorage.connect(connectionString, dbName);
      useMongoDB = mongoStorage.isMongoConnected();
      mongoInitialized = true;
      if (useMongoDB) {
        logger.info('Using MongoDB for storage');
      }
    } catch (error) {
      logger.warn('MongoDB connection failed, falling back to JSON storage', { error: error.message });
      useMongoDB = false;
      mongoInitialized = true;
    }
  } else {
    mongoInitialized = true;
  }
}

/**
 * Save data to storage (MongoDB or JSON file)
 * Synchronous for backward compatibility - uses JSON if MongoDB not initialized
 * @param {string} key - Storage key
 * @param {any} value - Value to save (will be JSON stringified)
 */
export function save(key, value) {
  try {
    // If MongoDB is connected, save async (fire and forget to maintain sync API)
    if (useMongoDB && mongoInitialized) {
      // Queue async save (don't await to keep sync API)
      Promise.resolve().then(async () => {
        try {
          switch (key) {
            case 'flowContext':
              await mongoStorage.saveFlowContext(value);
              break;
            case 'carts':
              await mongoStorage.saveCarts(value);
              break;
            case 'state':
              await mongoStorage.saveState(value);
              break;
          }
        } catch (error) {
          logger.error(`Error saving ${key} to MongoDB`, { error: error.message });
          // Fallback to JSON on error
          saveToJSON(key, value);
        }
      }).catch(() => {
        // Silent catch for fire-and-forget
        saveToJSON(key, value);
      });
    }

    saveToJSON(key, value);
  } catch (error) {
    logger.error(`Error saving ${key}`, { error: error.message });
  }
}

/**
 * Save to JSON file
 */
function saveToJSON(key, value) {
  try {
    const filePath = path.join(STORAGE_DIR, `${key}.json`);
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
  } catch (error) {
    logger.error(`Error saving ${key} to JSON`, { error: error.message });
  }
}

/**
 * Load data from storage (MongoDB or JSON file)
 * Synchronous for backward compatibility - loads from JSON if MongoDB not initialized
 * @param {string} key - Storage key
 * @returns {any|null} - Loaded value or null if not found
 */
export function load(key) {
  try {
    // If MongoDB is connected, try loading from MongoDB (sync via cache or fallback)
    // For now, always load from JSON for backward compatibility
    // MongoDB will be the source of truth after migration
    return loadFromJSON(key);
  } catch (error) {
    logger.error(`Error loading ${key}`, { error: error.message });
    return null;
  }
}

/**
 * Load from JSON file
 */
function loadFromJSON(key) {
  try {
    const filePath = path.join(STORAGE_DIR, `${key}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const data = fs.readFileSync(filePath, 'utf8');
    if (data.trim() === '' || data === '{}') {
      return null;
    }
    return JSON.parse(data);
  } catch (error) {
    logger.error(`Error loading ${key} from JSON`, { error: error.message });
    return null;
  }
}

/**
 * Async load from MongoDB (for use after initialization)
 * @param {string} key - Storage key
 * @returns {Promise<any|null>}
 */
export async function loadAsync(key) {
  if (!useMongoDB || !mongoInitialized) {
    return load(key); // Fallback to JSON
  }

  try {
    switch (key) {
      case 'flowContext':
        return await mongoStorage.loadFlowContext();
      case 'carts':
        return await mongoStorage.loadCarts();
      case 'state':
        return await mongoStorage.loadState();
      default:
        return load(key);
    }
  } catch (error) {
    logger.error(`Error loading ${key} from MongoDB`, { error: error.message });
    return load(key); // Fallback to JSON
  }
}

/**
 * Async save to MongoDB (for use after initialization)
 * @param {string} key - Storage key
 * @param {any} value - Value to save
 * @returns {Promise<void>}
 */
export async function saveAsync(key, value) {
  if (!useMongoDB || !mongoInitialized) {
    save(key, value); // Fallback to JSON
    return;
  }

  try {
    switch (key) {
      case 'flowContext':
        await mongoStorage.saveFlowContext(value);
        break;
      case 'carts':
        await mongoStorage.saveCarts(value);
        break;
      case 'state':
        await mongoStorage.saveState(value);
        break;
      default:
        save(key, value);
        return;
    }
    // Also save to JSON as backup
    save(key, value);
  } catch (error) {
    logger.error(`Error saving ${key} to MongoDB`, { error: error.message });
    save(key, value); // Fallback to JSON
  }
}

/**
 * Close MongoDB connection (call on app shutdown)
 */
export async function close() {
  if (useMongoDB) {
    await mongoStorage.disconnect();
  }
}