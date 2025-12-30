import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Storage directory
const STORAGE_DIR = path.join(__dirname, '..', 'data');

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

/**
 * Save data to storage
 * @param {string} key - Storage key
 * @param {any} value - Value to save (will be JSON stringified)
 */
export function save(key, value) {
  try {
    const filePath = path.join(STORAGE_DIR, `${key}.json`);
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
  } catch (error) {
    console.error(`Error saving ${key}:`, error);
  }
}

/**
 * Load data from storage
 * @param {string} key - Storage key
 * @returns {any|null} - Loaded value or null if not found
 */
export function load(key) {
  try {
    const filePath = path.join(STORAGE_DIR, `${key}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error loading ${key}:`, error);
    return null;
  }
}

