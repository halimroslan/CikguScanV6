const sharp = require('sharp');
const fs = require('fs');

async function createIcon(name, size, bg) {
  const svg = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" rx="${size/4}" fill="${bg}" />
      <text x="50%" y="50%" font-family="Arial" font-size="${size/3}" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="central">CS</text>
    </svg>
  `;
  await sharp(Buffer.from(svg))
    .png()
    .toFile(name);
  console.log(`Generated ${name}`);
}

async function main() {
  await createIcon('public/pwa-192x192.png', 192, '#0062FF');
  await createIcon('public/pwa-512x512.png', 512, '#0062FF');
  await createIcon('public/pwa-512x512-maskable.png', 512, '#0062FF');
}

main().catch(console.error);
