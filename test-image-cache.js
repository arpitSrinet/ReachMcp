import { cacheImage } from './services/imageCacher.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTest() {
    const testImageUrl = 'https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png';
    const testFilename = 'test-google-logo.png';
    const targetPath = path.join(__dirname, 'public/images/devices', testFilename);

    console.log('Testing image caching...');

    // Clean up if exists
    if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
        console.log('Removed existing test file.');
    }

    try {
        const result = await cacheImage(testImageUrl, testFilename);

        if (result && fs.existsSync(targetPath)) {
            const stats = fs.statSync(targetPath);
            console.log(`✅ Success: Image cached successfully!`);
            console.log(`- Path: ${targetPath}`);
            console.log(`- Size: ${stats.size} bytes`);
        } else {
            console.error('❌ Failure: Image was not cached.');
        }
    } catch (error) {
        console.error(`❌ Error during test: ${error.message}`);
    }
}

runTest();
