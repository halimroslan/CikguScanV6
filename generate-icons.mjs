import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const svgPath = path.join(process.cwd(), 'public', 'icon.svg');

async function generateIcons() {
    await sharp(svgPath)
        .resize(192, 192)
        .png()
        .toFile(path.join(process.cwd(), 'public', 'pwa-192x192.png'));

    await sharp(svgPath)
        .resize(512, 512)
        .png()
        .toFile(path.join(process.cwd(), 'public', 'pwa-512x512.png'));

    await sharp(svgPath)
        .resize(512, 512)
        .png()
        .toFile(path.join(process.cwd(), 'public', 'pwa-512x512-maskable.png'));

    await sharp(svgPath)
        .resize(180, 180)
        .png()
        .toFile(path.join(process.cwd(), 'public', 'apple-touch-icon.png'));

    console.log('Icons generated successfully.');
}

generateIcons().catch(console.error);
