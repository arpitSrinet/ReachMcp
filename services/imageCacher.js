import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMAGE_DIR = path.join(__dirname, '../public/assets');

// Ensure directory exists
if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

/**
 * Helper to download with redirect support
 */
function downloadFile(url, destPath, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) {
      return reject(new Error('Too many redirects'));
    }

    const request = https.get(url, (response) => {
      // Handle Redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const redirectUrl = new URL(response.headers.location, url).toString();
        logger.info(`Following redirect for image: ${redirectUrl}`);
        downloadFile(redirectUrl, destPath, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        return reject(new Error(`Status code: ${response.statusCode}`));
      }

      const file = fs.createWriteStream(destPath);
      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve();
      });

      file.on('error', (err) => {
        fs.unlink(destPath, () => {}); // cleanup
        reject(err);
      });
    });

    request.on('error', (err) => {
      fs.unlink(destPath, () => {}); // cleanup
      reject(err);
    });
  });
}

/**
 * Downloads an image from a URL and saves it to the local storage
 * @param {string} url - The URL of the image to download
 * @param {string} filename - The name to save the file as
 * @returns {Promise<string|null>} - The local path or filename if successful, null otherwise
 */
export async function cacheImage(url, filename) {
    if (!url || !filename) return null;

    const targetPath = path.join(IMAGE_DIR, filename);

    // Skip if already exists
    if (fs.existsSync(targetPath)) {
        return filename;
    }

    try {
        await downloadFile(url, targetPath);
        logger.info(`Successfully cached image: ${filename}`);
        return filename;
    } catch (err) {
        logger.error(`Error downloading image ${url}: ${err.message}`);
        return null;
    }
}

/**
 * Batch cache multiple images
 * @param {Array<{url: string, filename: string}>} items 
 */
export async function cacheImages(items) {
    const results = await Promise.all(items.map(item => cacheImage(item.url, item.filename)));
    return results;
}
