import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMAGE_DIR = path.join(__dirname, '../public/images/devices');

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

    return new Promise((resolve) => {
        const file = fs.createWriteStream(targetPath);

        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                logger.error(`Failed to download image: ${url}, Status: ${response.statusCode}`);
                fs.unlink(targetPath, () => { }); // Delete partial file
                resolve(null);
                return;
            }

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                logger.info(`Successfully cached image: ${filename}`);
                resolve(filename);
            });
        }).on('error', (err) => {
            fs.unlink(targetPath, () => { }); // Delete partial file
            logger.error(`Error downloading image ${url}: ${err.message}`);
            resolve(null);
        });
    });
}

/**
 * Batch cache multiple images
 * @param {Array<{url: string, filename: string}>} items 
 */
export async function cacheImages(items) {
    const results = await Promise.all(items.map(item => cacheImage(item.url, item.filename)));
    return results;
}
